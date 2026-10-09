//! Long-lived RPC transport. Official JSONL, correlated IDs, continuous reads,
//! bounded writer queue and per-command deadline. No raw stderr/config logging.
//! Event callbacks must be short and MUST NOT issue synchronous RPC requests.
use crate::{pi_jsonl::{JsonlDecoder, encode_command}, pi_owned_process::OwnedProcess};
use serde_json::{Value, json};
use std::{collections::HashMap, ffi::OsString, io::{Read, Write}, path::Path,
    sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}, mpsc::{self, SyncSender, Sender}}, thread, time::{Duration, Instant}};

const MAX_RECORD: usize = crate::pi_image_limits::MAX_IMAGE_RPC_BYTES;
const MAX_PENDING: usize = 64;
#[path="pi-process-monitor.rs"] pub mod monitor;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcError { pub code: &'static str, pub message: &'static str }
fn error(code: &'static str, message: &'static str) -> RpcError { RpcError { code, message } }
fn disconnected() -> RpcError { error("pi_disconnected", "Agent 连接已断开；未确认的请求不会自动重发，请核对会话后再试。") }
fn poisoned() -> RpcError { error("pi_interrupted", "Agent 通信状态意外中断，未报告成功；请重新连接并核对会话。") }
struct Pending { command: String, result: Sender<Result<Value, RpcError>> }
struct Inner {
    monitor: Arc<Mutex<monitor::ProcessInfo>>,
    stop_handler: Mutex<Option<Box<dyn Fn()+Send+Sync>>>,
    process: Mutex<OwnedProcess>,
    writer: Mutex<Option<SyncSender<Vec<u8>>>>,
    pending: Mutex<HashMap<String, Pending>>,
    failed: AtomicBool,
    closing: AtomicBool,
    next: AtomicU64,
    stderr_bytes: AtomicU64,
    on_event: Box<dyn Fn(Value) + Send + Sync>,
}
impl Inner {
    fn reject_pending(&self, reason: RpcError) {
        if let Ok(mut pending) = self.pending.lock() {
            for (_, request) in pending.drain() { let _ = request.result.send(Err(reason.clone())); }
        }
    }
    fn fault(&self, reason: RpcError) {
        if self.failed.swap(true, Ordering::AcqRel) { return; }
        monitor::finish(self,"failed",Some(reason.message));
        self.reject_pending(reason.clone());
        if let Ok(mut writer) = self.writer.lock() { writer.take(); }
        // Closing our Job releases a blocked pipe writer too; never a global kill.
        if let Ok(mut process) = self.process.lock() { let _ = process.terminate_tree(); }
        if !self.closing.load(Ordering::Acquire) { (self.on_event)(json!({"type":"azcine_transport_error","code":reason.code,"message":reason.message})); }
    }
    fn record(&self, value: Value) {
        if self.failed.load(Ordering::Acquire) { return; }
        monitor::activity(self,&value);
        if value.get("type").and_then(Value::as_str) != Some("response") { (self.on_event)(value); return; }
        let Some(id) = value.get("id").and_then(Value::as_str) else {
            self.fault(error("pi_response_invalid", "Agent 返回了无法关联的命令响应，已停止连接；输入仍保留。")); return;
        };
        let pending = match self.pending.lock() { Ok(mut p) => p.remove(id), Err(_) => { self.fault(poisoned()); return; } };
        let Some(pending) = pending else {
            // Deadline failure already poisons the stream. Otherwise an unknown
            // or duplicate response is a protocol error, never an accepted result.
            if !self.closing.load(Ordering::Acquire) { self.fault(error("pi_response_unknown", "Agent 返回未知或重复响应，已停止连接；未把它当作执行成功。")); }
            return;
        };
        if value.get("command").and_then(Value::as_str) != Some(pending.command.as_str()) || !value.get("success").is_some_and(Value::is_boolean) {
            let reason = error("pi_response_invalid", "Agent 响应与原命令不一致，已停止连接；未将其当作执行成功。");
            let _ = pending.result.send(Err(reason.clone())); self.fault(reason); return;
        }
        // Preserve raw response only inside Rust. The app-level manager applies
        // command-specific projection before anything reaches the WebView.
        let _ = pending.result.send(Ok(value));
    }
}
pub struct RpcProcess { inner: Arc<Inner> }
pub struct RpcRequest { inner: Arc<Inner>, result: mpsc::Receiver<Result<Value, RpcError>> }
impl RpcRequest {
    pub fn wait(self, timeout: Duration) -> Result<Value, RpcError> {
        self.wait_paused(timeout,||false)
    }
    // An extension question pauses prompt acceptance in upstream RPC. User
    // thinking time must not consume the transport's response deadline.
    pub fn wait_paused(self,timeout:Duration,paused:impl Fn()->bool)->Result<Value,RpcError>{
        let mut remaining=timeout;let mut previous=Instant::now();
        loop{
            match self.result.recv_timeout(remaining.min(Duration::from_millis(100))){
                Ok(result)=>return result,
                Err(mpsc::RecvTimeoutError::Disconnected)=>return Err(disconnected()),
                Err(mpsc::RecvTimeoutError::Timeout)=>{},
            }
            let now=Instant::now();if !paused(){remaining=remaining.saturating_sub(now.duration_since(previous));}previous=now;
            if remaining.is_zero(){let reason=error("pi_timeout","Agent 响应超时，已停止本应用进程树；请求可能已被处理，不会自动重发，输入和原生会话仍保留。");self.inner.fault(reason.clone());return Err(reason);}
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shutdown { pub exit_code: Option<i32>, pub forced: bool, pub remaining: u32 }
impl RpcProcess {
    pub fn spawn(program: &Path, args: &[OsString], cwd: &Path, env: &[(OsString, OsString)], on_event: impl Fn(Value) + Send + Sync + 'static) -> Result<Self, RpcError> {
        Self::spawn_named("Agent RPC",program,args,cwd,env,on_event)
    }
    pub fn spawn_named(source:&str,program: &Path, args: &[OsString], cwd: &Path, env: &[(OsString, OsString)], on_event: impl Fn(Value) + Send + Sync + 'static) -> Result<Self, RpcError> {
        let mut process = OwnedProcess::spawn(program,args,cwd,env).map_err(|e| error(e.code,e.message))?;
        let monitor=monitor::info(process.id(),source);
        let mut stdin = process.take_stdin().ok_or_else(|| error("pi_pipe_missing", "Agent 输入管道没有建立。"))?;
        let mut stdout = process.take_stdout().ok_or_else(|| error("pi_pipe_missing", "Agent 输出管道没有建立。"))?;
        let mut stderr = process.take_stderr().ok_or_else(|| error("pi_pipe_missing", "Agent 诊断管道没有建立。"))?;
        let (send, receive) = mpsc::sync_channel::<Vec<u8>>(MAX_PENDING);
        let inner = Arc::new(Inner { monitor,stop_handler:Mutex::new(None),process:Mutex::new(process),writer:Mutex::new(Some(send)),pending:Mutex::new(HashMap::new()),failed:AtomicBool::new(false),closing:AtomicBool::new(false),next:AtomicU64::new(0),stderr_bytes:AtomicU64::new(0),on_event:Box::new(on_event) });
        monitor::register(&inner);
        let output = inner.clone();
        thread::Builder::new().name("azcine-pi-stdout".into()).spawn(move || {
            let mut decoder = match JsonlDecoder::new(MAX_RECORD) { Ok(d) => d, Err(_) => { output.fault(poisoned()); return; } };
            let mut bytes = [0u8; 8192];
            loop {
                let count = match stdout.read(&mut bytes) { Ok(n) => n, Err(_) => { output.fault(disconnected()); return; } };
                let frames = if count == 0 { decoder.finish() } else { decoder.push(&bytes[..count]) };
                match frames { Ok(frames) => for frame in frames { output.record(frame); }, Err(e) => { output.fault(error(e.code,e.message)); return; } }
                if count == 0 {
                    if !output.closing.load(Ordering::Acquire) { output.fault(disconnected()); }
                    else { output.reject_pending(disconnected()); }
                    return;
                }
            }
        }).map_err(|_| { inner.fault(poisoned()); poisoned() })?;
        let diagnostics = inner.clone();
        thread::Builder::new().name("azcine-pi-stderr".into()).spawn(move || {
            let mut bytes = [0u8; 8192];
            // Consume to avoid backpressure. Never persist or emit raw stderr:
            // third-party provider diagnostics can contain tokens or full headers.
            loop { match stderr.read(&mut bytes) {
                Ok(0) => return,
                Ok(n) => { diagnostics.stderr_bytes.fetch_add(n as u64,Ordering::Relaxed); },
                Err(_) => { if !diagnostics.closing.load(Ordering::Acquire) { diagnostics.fault(error("pi_stderr_io", "Agent 诊断通道中断，已停止连接。")); } return; }
            } }
        }).map_err(|_| { inner.fault(poisoned()); poisoned() })?;
        let input = inner.clone();
        thread::Builder::new().name("azcine-pi-stdin".into()).spawn(move || {
            while let Ok(bytes) = receive.recv() {
                if input.failed.load(Ordering::Acquire) || input.closing.load(Ordering::Acquire) { return; }
                if stdin.write_all(&bytes).and_then(|_|stdin.flush()).is_err() { input.fault(disconnected()); return; }
            }
            // Drop stdin is the official orderly-shutdown request.
        }).map_err(|_| { inner.fault(poisoned()); poisoned() })?;
        Ok(Self { inner })
    }
    pub fn id(&self) -> Result<u32, RpcError> { Ok(self.inner.process.lock().map_err(|_|poisoned())?.id()) }
    pub fn on_monitor_stop(&self,handler:impl Fn()+Send+Sync+'static)->Result<(),RpcError>{
        let mut slot=self.inner.stop_handler.lock().map_err(|_|poisoned())?;
        if self.inner.monitor.lock().map_err(|_|poisoned())?.status=="stopped"{handler();}
        *slot=Some(Box::new(handler));Ok(())
    }
    pub fn active_processes(&self) -> Result<u32, RpcError> { self.inner.process.lock().map_err(|_|poisoned())?.active_processes().map_err(|e|error(e.code,e.message)) }
    pub fn diagnostic_bytes(&self) -> u64 { self.inner.stderr_bytes.load(Ordering::Relaxed) }
    pub fn is_connected(&self) -> bool { !self.inner.failed.load(Ordering::Acquire) && !self.inner.closing.load(Ordering::Acquire) }
    /// Queue without waiting or invoking callbacks, so the manager can order
    /// prompt acceptance against stop under its short state lock.
    pub fn begin_request(&self, command: &str, fields: Value) -> Result<RpcRequest, RpcError> {
        if command.is_empty() || !fields.is_object() { return Err(error("pi_request_invalid", "Agent 请求参数无效，未发送。")); }
        if !self.is_connected() { return Err(disconnected()); }
        let number = self.inner.next.fetch_add(1,Ordering::Relaxed);
        if number == u64::MAX { return Err(poisoned()); }
        let id = format!("azcine-{number}");
        let mut record = fields; let object = record.as_object_mut().unwrap();
        if object.contains_key("id") || object.contains_key("type") { return Err(error("pi_request_invalid", "请求不能覆盖内部命令标识，未发送。")); }
        object.insert("type".into(),json!(command));object.insert("id".into(),json!(id));
        let bytes = encode_command(&record,MAX_RECORD).map_err(|e|error(e.code,e.message))?;
        let (result, wait) = mpsc::channel();
        {
            let mut pending = self.inner.pending.lock().map_err(|_|poisoned())?;
            if !self.is_connected() { return Err(disconnected()); }
            if pending.len() >= MAX_PENDING { return Err(error("pi_busy", "Agent 正在处理较多请求，请稍后再试；本次未发送。")); }
            pending.insert(id.clone(), Pending {command:command.into(),result});
        }
        let sent = self.inner.writer.lock().map_err(|_|poisoned()).and_then(|writer| {
            writer.as_ref().ok_or_else(disconnected)?.try_send(bytes).map_err(|e|match e { mpsc::TrySendError::Full(_) => error("pi_busy", "Agent 写入队列已满，本次未发送，请稍后再试。"), mpsc::TrySendError::Disconnected(_) => disconnected() })
        });
        if let Err(reason) = sent { if let Ok(mut pending) = self.inner.pending.lock() { pending.remove(&id); } return Err(reason); }
        Ok(RpcRequest { inner: self.inner.clone(), result: wait })
    }
    /// Private response only; command acceptance is not run completion.
    pub fn request(&self, command: &str, fields: Value, timeout: Duration) -> Result<Value, RpcError> {
        if timeout.is_zero() { return Err(error("pi_request_invalid", "Agent 请求期限无效，未发送。")); }
        self.begin_request(command, fields)?.wait(timeout)
    }
    /// For extension UI only (not a normal response-bearing command). S04 validates
    /// the outstanding request ID and method before calling this transport method.
    pub fn send_notification(&self, record: &Value) -> Result<(), RpcError> {
        if !self.is_connected() { return Err(disconnected()); }
        let bytes=encode_command(record,MAX_RECORD).map_err(|e|error(e.code,e.message))?;
        self.inner.writer.lock().map_err(|_|poisoned())?.as_ref().ok_or_else(disconnected)?.try_send(bytes).map_err(|_|error("pi_busy", "Agent 输入队列暂不可写，回应未确认，请重试。"))
    }
    pub fn shutdown(&self, grace: Duration) -> Result<Shutdown, RpcError> {
        self.inner.closing.store(true,Ordering::Release);
        self.inner.reject_pending(disconnected());
        self.inner.writer.lock().map_err(|_|poisoned())?.take();
        let deadline=Instant::now()+grace;
        let mut forced=self.inner.failed.load(Ordering::Acquire);
        let mut exit_code=None;
        let mut exit_seen=false;
        loop {
            {
                let mut process=self.inner.process.lock().map_err(|_|poisoned())?;
                if let Some(status)=process.try_wait().map_err(|e|error(e.code,e.message))? { exit_code=status.code(); exit_seen=true; }
                let remaining=process.active_processes().map_err(|e|error(e.code,e.message))?;
                if remaining==0 && exit_seen { monitor::finish(&self.inner,"exited",None);return Ok(Shutdown{exit_code,forced,remaining}); }
                if Instant::now()>=deadline { process.terminate_tree().map_err(|e|error(e.code,e.message))?; forced=true; break; }
            }
            thread::sleep(Duration::from_millis(10));
        }
        // Explicit bounded condition wait, not a fixed-delay success assumption.
        let deadline=Instant::now()+Duration::from_secs(5);
        loop {
            let remaining={ let mut process=self.inner.process.lock().map_err(|_|poisoned())?;
                if let Some(status)=process.try_wait().map_err(|e|error(e.code,e.message))? { exit_code=status.code(); exit_seen=true; }
                process.active_processes().map_err(|e|error(e.code,e.message))? };
            if remaining==0 && exit_seen { monitor::finish(&self.inner,"exited",None);return Ok(Shutdown{exit_code,forced,remaining}); }
            if Instant::now()>=deadline { return Err(error("pi_shutdown_incomplete", "本应用 Agent 子进程尚未完全退出，不能重新启动同一会话；请稍后核对。")); }
            thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for RpcProcess {
    fn drop(&mut self) {
        monitor::finish(&self.inner,"exited",None);
        self.inner.closing.store(true,Ordering::Release);
        self.inner.reject_pending(disconnected());
        if let Ok(mut writer)=self.inner.writer.lock() { writer.take(); }
        if let Ok(mut process)=self.inner.process.lock() { let _=process.terminate_tree(); }
    }
}
