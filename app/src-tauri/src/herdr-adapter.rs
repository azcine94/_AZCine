use crate::storage::StorageError;
use crate::task_panel_store::invalid;
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::{path::{Path,PathBuf},process::{Command,Stdio},time::{Duration,Instant}};

#[derive(Debug,Clone,Serialize,Deserialize,Default)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct HerdrConfig {pub executable:String,pub session:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct HerdrCapabilities {pub executable:Option<String>,pub version:Option<String>,pub api_protocol:Option<i64>,pub service_version:Option<String>,pub service_protocol:Option<i64>,pub transport:String,pub methods:Vec<String>,pub identity_fields:Vec<String>,pub declared_events:Vec<String>,pub limitations:Vec<String>,pub observed_at:String,pub connected:bool,pub fixture:bool,pub reason:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct HerdrSession {pub server_id:String,pub workspace_id:String,pub pane_id:String,pub agent_id:String,pub terminal_id:String,pub kind:String,pub name:Option<String>,pub cwd:String,pub state:String,pub interactive_ready:bool,pub completion_seq:Option<u64>,pub state_change_seq:u64,pub identity_confirmed:bool,pub identity_source:String,pub process_id:Option<u32>,pub process_created_at:Option<String>,pub fixture:bool,pub observed_at:String}

fn executable(config:&HerdrConfig)->Result<PathBuf,StorageError>{
    if !config.executable.is_empty(){let p=Path::new(&config.executable);if !p.is_absolute()||!p.is_file(){return Err(invalid("Herdr CLI 路径需为存在的绝对文件路径。"));}return Ok(p.into());}
    let name=if cfg!(windows){"herdr.exe"}else{"herdr"};
    std::env::var_os("PATH").and_then(|p|std::env::split_paths(&p).map(|d|d.join(name)).find(|p|p.is_file())).ok_or_else(||StorageError::new("herdr_unavailable","未找到本机 Herdr CLI；任务仍可保存和手工导入。"))
}
pub(crate) fn fixture_configured()->bool {
    #[cfg(test)] if TEST_FIXTURE.with(|f|f.borrow().is_some()){return true;}
    #[cfg(debug_assertions)] {std::env::var_os("AZCINE_TEST_HERDR_FIXTURE").is_some()}
    #[cfg(not(debug_assertions))] {false}
}
fn fixture(method:&str,params:&Value)->Result<Option<Value>,StorageError>{
    #[cfg(test)] if let Some(value)=TEST_FIXTURE.with(|f|f.borrow().clone()){
        TEST_CALLS.with(|calls|calls.borrow_mut().push(method.to_string()));
        let response=value.get(method).cloned().ok_or_else(||invalid("隔离 fixture 缺少接口，未操作真实会话。"))?;
        if response["fixture_error"].is_string(){return Err(StorageError::new("herdr_fixture_error",response["fixture_error"].as_str().unwrap()));}return Ok(Some(response));
    }
    #[cfg(debug_assertions)] {
        if let Some(file)=std::env::var_os("AZCINE_TEST_HERDR_FIXTURE") {
            let root=std::env::var_os("AZCINE_TEST_CONFIG_DIR").ok_or_else(||invalid("Herdr fixture 必须与显式隔离配置根一起使用。"))?;
            let root=std::fs::canonicalize(root).map_err(|_|invalid("隔离配置根不存在。"))?;
            let file=std::fs::canonicalize(file).map_err(|_|invalid("Herdr fixture 不存在。"))?;
            if !file.starts_with(&root){return Err(invalid("Herdr fixture 不在隔离配置根内，未连接真实服务。"));}
            let value:Value=serde_json::from_slice(&crate::task_panel_paths::read_limited(&file,2_000_000)?).map_err(|_|invalid("Herdr fixture 格式损坏。"))?;
            if let Some(path)=value.get("call_log").and_then(Value::as_str){
                let path=Path::new(path);
                let parent=path.parent().and_then(|p|std::fs::canonicalize(p).ok());
                if !path.is_absolute()||parent.as_ref().is_none_or(|p|!p.starts_with(&root))||path.components().any(|c|matches!(c,std::path::Component::ParentDir))||path.exists()&&std::fs::canonicalize(path).is_ok_and(|p|!p.starts_with(&root)){return Err(invalid("fixture 记录路径不在隔离配置根。"));}
                let path=parent.unwrap().join(path.file_name().ok_or_else(||invalid("fixture 记录文件名无效。"))?);
                use std::io::Write;let mut out=std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|_|invalid("fixture 调用记录失败。"))?;
                writeln!(out,"{}",json!({"method":method,"params":params,"fixture":true})).map_err(|_|invalid("fixture 调用记录失败。"))?;
            }
            let result=value.get("responses").and_then(|r|r.get(method)).cloned().ok_or_else(||invalid("fixture 未定义这项接口，未回退真实 Herdr。"))?;
            if result.get("fixture_error").is_some(){return Err(StorageError::new("herdr_fixture_error",result["fixture_error"].as_str().unwrap_or("fixture 错误")));}
            return Ok(Some(result));
        }
    }
    let _=(method,params);Ok(None)
}
#[cfg(test)] thread_local! {static TEST_FIXTURE:std::cell::RefCell<Option<Value>>=const{std::cell::RefCell::new(None)};static TEST_CALLS:std::cell::RefCell<Vec<String>>=const{std::cell::RefCell::new(Vec::new())};}
#[cfg(test)] pub(crate) fn test_fixture(value:Value){TEST_FIXTURE.with(|f|*f.borrow_mut()=Some(value));TEST_CALLS.with(|c|c.borrow_mut().clear());}
#[cfg(test)] pub(crate) fn test_calls(method:&str)->usize{TEST_CALLS.with(|c|c.borrow().iter().filter(|v|v.as_str()==method).count())}
fn run(config:&HerdrConfig,args:&[String],timeout:Duration)->Result<String,StorageError>{
    let binary=executable(config)?;let mut c=Command::new(binary);c.env_clear();
    // Only the official Herdr control process receives these locating/system values.
    // No credential variables, NODE_OPTIONS, modules, hooks or agent prompts are inherited.
    for key in ["PATH","SystemRoot","WINDIR","TEMP","TMP","APPDATA","LOCALAPPDATA","USERPROFILE"]{if let Some(v)=std::env::var_os(key){c.env(key,v);}}
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]{use std::os::windows::process::CommandExt;c.creation_flags(0x08000000);}
    let mut child=c.spawn().map_err(|_|StorageError::new("herdr_unavailable","Herdr 控制进程未能启动。"))?;
    let stdout=child.stdout.take().unwrap();let stderr=child.stderr.take().unwrap();
    let read=std::thread::spawn(move||{use std::io::Read;let mut out=Vec::new();let _=stdout.take(2_000_001).read_to_end(&mut out);out});
    let err=std::thread::spawn(move||{use std::io::Read;let mut out=Vec::new();let _=stderr.take(65537).read_to_end(&mut out);out});
    let end=Instant::now()+timeout;
    let status=loop{match child.try_wait(){Ok(Some(s))=>break s,Ok(None) if Instant::now()<end=>std::thread::sleep(Duration::from_millis(30)),_=>{let _=child.kill();let _=child.wait();return Err(StorageError::new("herdr_uncertain","Herdr 接口超时，发送或创建结果待核对；不会自动重试。"));}}};
    let out=read.join().map_err(|_|invalid("Herdr 返回中断。"))?;let errors=err.join().unwrap_or_default();
    if out.len()>2_000_000{return Err(invalid("Herdr 返回超出读取限制。"));}
    if !status.success(){let reason=String::from_utf8_lossy(&errors);return Err(StorageError::new("herdr_control_failed",&format!("Herdr 返回失败：{}。未自动重试或报告任务成功。",reason.chars().take(300).collect::<String>())));}
    String::from_utf8(out).map_err(|_|invalid("Herdr 返回不是 UTF-8 JSON。"))
}
pub(crate) fn discover(mut config:HerdrConfig,workspace:Option<&Path>)->Result<HerdrConfig,StorageError>{
    if fixture_configured(){return Ok(config);}
    let raw=run(&config,&["session".into(),"list".into(),"--json".into()],Duration::from_secs(5))?;
    let value:Value=serde_json::from_str(&raw).map_err(|_|invalid("Herdr 会话列表无法识别。"))?;
    let mut candidates:Vec<(bool,String)>=value["sessions"].as_array().ok_or_else(||invalid("Herdr 未返回会话列表。"))?.iter()
        .filter(|s|s["running"]==true).filter_map(|s|s["name"].as_str().map(|name|(s["default"]==true,name.to_string()))).collect();
    if candidates.iter().any(|(_,name)|name==&config.session){return Ok(config);}
    candidates.sort_by(|a,b|b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    if let Some(root)=workspace {
        let root=std::fs::canonicalize(root).ok();
        for (_,name) in &candidates {
            let probe=HerdrConfig{executable:config.executable.clone(),session:name.clone()};
            if let Ok(value)=call(&probe,"agent.list",json!({})) {
                if value["agents"].as_array().is_some_and(|agents|agents.iter().any(|agent|agent["foreground_cwd"].as_str().or_else(||agent["cwd"].as_str()).and_then(|p|std::fs::canonicalize(p).ok()).is_some_and(|p|Some(p)==root))) {config.session=name.clone();return Ok(config);}
            }
        }
    }
    config.session=candidates.first().map(|(_,name)|name.clone()).ok_or_else(||invalid("Herdr 尚未运行，请先打开 Herdr；连接后会自动创建任务窗格。"))?;
    Ok(config)
}
fn session_args(config:&HerdrConfig)->Result<Vec<String>,StorageError>{
    if config.session.is_empty()||config.session.len()>80||!config.session.bytes().all(|c|c.is_ascii_alphanumeric()||b"-_".contains(&c)){return Err(invalid("先明确选择本机 Herdr session；不会默认操作正在聚焦的窗格。"));}
    Ok(vec!["--session".into(),config.session.clone()])
}
pub(crate) fn call(config:&HerdrConfig,method:&str,params:Value)->Result<Value,StorageError>{
    if let Some(value)=fixture(method,&params)?{return Ok(value);}
    let mut args=session_args(config)?;
    let get=|name:&str|params.get(name).and_then(Value::as_str).map(String::from).ok_or_else(||invalid("Herdr 操作参数缺失。"));
    match method {
        "agent.list"=>args.extend(["agent".into(),"list".into()]),
        "agent.get"|"agent.focus"=>args.extend(["agent".into(),method.split('.').nth(1).unwrap().into(),get("target")?]),
        "agent.prompt"=>{let text=get("text")?;if text.len()>16000{return Err(invalid("发送消息过长，请使用有范围的上下文包文件。"));}args.extend(["agent".into(),"prompt".into(),get("target")?,text]);},
        "agent.send_keys"=>args.extend(["agent".into(),"send-keys".into(),get("target")?,"ctrl+c".into()]),
        "worktree.create"=>args.extend(["worktree".into(),"create".into(),"--cwd".into(),shell_path(Path::new(&get("cwd")?))?,"--branch".into(),get("branch")?,"--base".into(),get("base")?,"--path".into(),new_shell_path(Path::new(&get("path")?))?,"--label".into(),get("label")?,"--no-focus".into()]),
        "workspace.create"=>{let cwd=get("cwd")?;args.extend(["workspace".into(),"create".into(),"--cwd".into(),shell_path(Path::new(&cwd))?,"--label".into(),get("label")?,"--no-focus".into()]);if let Some(environment)=params["environment"].as_array(){for pair in environment{let pair=pair.as_array().filter(|p|p.len()==2).ok_or_else(||invalid("Herdr子进程环境格式不完整。"))?;let key=pair[0].as_str().ok_or_else(||invalid("Herdr环境名称无效。"))?;let value=pair[1].as_str().ok_or_else(||invalid("Herdr环境值无效。"))?;if key.is_empty()||!key.bytes().all(|b|b.is_ascii_alphanumeric()||b"_()".contains(&b))||value.contains('\0'){return Err(invalid("Herdr子进程环境无效。"));}args.extend(["--env".into(),format!("{key}={value}")]);}}},
        "agent.start"=>{let kind=get("kind")?;if !["codex","pi"].contains(&kind.as_str()){return Err(invalid("本任务仅支持已确认的 Codex 或 Pi Herdr 执行入口。"));}args.extend(["agent".into(),"start".into(),get("name")?,"--kind".into(),kind,"--pane".into(),get("pane_id")?]);},
        "pane.run"=>args.extend(["pane".into(),"run".into(),get("target")?,get("command")?]),
        "pane.rename"=>args.extend(["pane".into(),"rename".into(),get("target")?,get("label")?]),
        "pane.process_info"=>args.extend(["pane".into(),"process-info".into(),"--pane".into(),get("target")?]),
        _=>return Err(invalid("这项 Herdr 控制操作未开放。")),
    }
    let raw=run(config,&args,if method=="agent.start"{Duration::from_secs(40)}else{Duration::from_secs(15)})?;
    // Herdr 0.9.3 pane run acknowledges success with exit code 0 and no stdout.
    // This only acknowledges the command; readiness is checked separately.
    if method=="pane.run"&&raw.trim().is_empty(){return Ok(Value::Null);}
    let value:Value=serde_json::from_str(&raw).map_err(|_|StorageError::new("herdr_response_unknown","Herdr 返回格式无法核对，外部操作结果保持不确定。"))?;
    if value.get("error").is_some(){return Err(StorageError::new("herdr_control_failed","Herdr 返回错误，未报告任务成功。"));}
    Ok(value.get("result").cloned().unwrap_or(value))
}
pub fn capabilities(config:&HerdrConfig)->HerdrCapabilities{
    let identity_fields=["session","workspace_id","pane_id","terminal_id","agent","agent_session.value","foreground_processes.pid + Windows process creation time"].into_iter().map(String::from).collect();
    let mut limitations=vec!["CLI声明的方法不代表当前服务全部可用；服务重启后仍需核对原窗格及Agent进程。".into(),"按请求读取元数据与核对原执行，当前未订阅原生事件，也不读取终端正文。".into(),"completion_seq / state_change_seq仅是观察字段；idle或done不证明本任务交付或验收。".into(),"没有原生会话引用时，仅在Windows可核对同一Agent进程及创建时间；进程退出或重启后须重新绑定。".into(),"仅有进程身份时无法自动区分同进程内切换的对话；在原工具切换对话后，请先核对旧尝试并重新绑定。".into()];
    if fixture_configured(){return HerdrCapabilities{executable:None,version:Some("fixture-protocol-22".into()),api_protocol:Some(22),service_version:None,service_protocol:None,transport:"隔离协议 fixture".into(),methods:vec!["agent.list".into(),"agent.get".into(),"agent.prompt".into(),"agent.focus".into(),"agent.send_keys".into(),"workspace.create".into(),"agent.start".into()],identity_fields,declared_events:vec!["pane.agent_status_changed".into()],limitations,observed_at:crate::task_panel_store::now(),connected:false,fixture:true,reason:"虚构接口样本，不代表真实 Herdr 验证。".into()};}
    let path=executable(config).ok();let version=run(config,&["--version".into()],Duration::from_secs(5)).ok().map(|s|s.trim().to_string());
    let schema=run(config,&["api".into(),"schema".into(),"--json".into()],Duration::from_secs(5)).ok().and_then(|s|serde_json::from_str::<Value>(&s).ok());
    let api_protocol=schema.as_ref().and_then(|s|s["protocol"].as_i64());
    let declared_events=schema.as_ref().and_then(|s|s.pointer("/schemas/subscription_event/$defs/SubscriptionEventKind/enum")).and_then(Value::as_array).map(|events|events.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
    if api_protocol.is_none(){limitations.push("本机CLI未提供可读取的API schema，事件/协议能力未确认。".into());}
    let help=run(config,&["agent".into(),"--help".into()],Duration::from_secs(5)).unwrap_or_default();
    let mut methods:Vec<String>=[("list","agent.list"),("get","agent.get"),("prompt","agent.prompt"),("focus","agent.focus"),("start","agent.start"),("send-keys","agent.send_keys")].into_iter().filter(|(word,_)|help.split_whitespace().any(|s|s==*word)).map(|(_,name)|name.into()).collect();
    if run(config,&["workspace".into(),"create".into(),"--help".into()],Duration::from_secs(5)).is_ok(){methods.push("workspace.create".into());}
    let service=session_args(config).ok().and_then(|mut args|{args.extend(["status".into(),"server".into(),"--json".into()]);run(config,&args,Duration::from_secs(5)).ok()}).and_then(|raw|serde_json::from_str::<Value>(&raw).ok());
    let connected=service.as_ref().is_some_and(|s|s["running"]==true&&(s["session"].as_str()==Some(config.session.as_str())||config.session=="default"&&s.get("session").is_some_and(Value::is_null))&&s["compatible"]==true&&s["endpoint_compatible"]==true);
    let service_version=service.as_ref().and_then(|s|s["version"].as_str()).map(String::from);let service_protocol=service.as_ref().and_then(|s|s["protocol"].as_i64());
    if !connected{limitations.push("指定session未运行或协议不兼容；未回退默认或聚焦会话。".into());}
    HerdrCapabilities{executable:path.map(|p|p.to_string_lossy().into_owned()),version:version.clone(),api_protocol,service_version,service_protocol,transport:if cfg!(windows){"官方 CLI → Windows socket/命名管道"}else{"官方 CLI → 本机 Unix socket"}.into(),methods,identity_fields,declared_events,limitations,observed_at:crate::task_panel_store::now(),connected,fixture:false,reason:if connected{"已读取指定session的真实服务版本与协议；执行身份另行核对。"}else if version.is_some(){"CLI能力已读取，指定session未连接或尚未核对。"}else{"本机 Herdr CLI 不可用。"}.into()}
}
pub(crate) fn parse_session(config:&HerdrConfig,value:&Value)->Result<HerdrSession,StorageError>{
    let required=|key:&str|value.get(key).and_then(Value::as_str).filter(|s|!s.is_empty()).map(String::from).ok_or_else(||invalid("Herdr 身份字段缺失，未猜测会话归属。"));
    let terminal_id=required("terminal_id")?;let pane_id=required("pane_id")?;let workspace_id=required("workspace_id")?;
    let session=value.get("agent_session");let session_id=session.and_then(|s|s.get("value")).and_then(Value::as_str).unwrap_or("");
    let kind=value.get("agent").and_then(Value::as_str).unwrap_or("unknown").to_string();
    let identity_confirmed=!session_id.is_empty()&&kind!="unknown";
    let agent_id=if identity_confirmed{format!("{}:{}:{}",terminal_id,kind,session_id)}else{String::new()};
    Ok(HerdrSession{server_id:format!("local-session:{}",config.session),workspace_id,pane_id,agent_id,terminal_id,kind,name:value.get("name").and_then(Value::as_str).map(String::from),cwd:value.get("foreground_cwd").and_then(Value::as_str).or_else(||value.get("cwd").and_then(Value::as_str)).unwrap_or("").into(),state:value.get("agent_status").and_then(Value::as_str).unwrap_or("unknown").into(),interactive_ready:value.get("interactive_ready").and_then(Value::as_bool).unwrap_or(false),completion_seq:value.get("completion_seq").and_then(Value::as_u64),state_change_seq:value.get("state_change_seq").and_then(Value::as_u64).unwrap_or(0),identity_confirmed,identity_source:if identity_confirmed{"native_session"}else{"unverified"}.into(),process_id:None,process_created_at:None,fixture:fixture_configured(),observed_at:crate::task_panel_store::now()})
}

#[cfg(windows)]
pub(crate) fn process_stamp(pid:u32)->Option<u64>{
    use std::os::windows::io::{AsRawHandle,FromRawHandle,OwnedHandle};
    use windows::Win32::Foundation::{FILETIME,HANDLE};
    use windows::Win32::System::Threading::{OpenProcess,GetProcessTimes,GetExitCodeProcess,PROCESS_QUERY_LIMITED_INFORMATION};
    let handle=unsafe{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,false,pid)}.ok()?;
    let owner=unsafe{OwnedHandle::from_raw_handle(handle.0)};let handle=HANDLE(owner.as_raw_handle());
    let (mut created,mut exited,mut kernel,mut user)=(FILETIME::default(),FILETIME::default(),FILETIME::default(),FILETIME::default());let mut exit_code=0u32;
    unsafe{GetProcessTimes(handle,&mut created,&mut exited,&mut kernel,&mut user)}.ok()?;
    unsafe{GetExitCodeProcess(handle,&mut exit_code)}.ok()?;
    if exit_code!=259{return None;}
    Some((u64::from(created.dwHighDateTime)<<32)|u64::from(created.dwLowDateTime))
}
#[cfg(not(windows))]
pub(crate) fn process_stamp(_:u32)->Option<u64>{None}

#[cfg(windows)]
fn agent_child_pid(parent:u32,kind:&str)->Option<u32>{
    // PowerShell's batch launcher is the public foreground process. Inspect
    // only its direct Node children; output contains PIDs, never argv/auth.
    let parent_stamp=process_stamp(parent)?;
    let shell=PathBuf::from(std::env::var_os("SystemRoot")?).join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
    let test=if kind=="codex"{r#"$_.Name -eq 'codex.exe'"#}else{r#"$_.Name -eq 'node.exe' -and $_.CommandLine.Replace('\','/') -match '/pi-coding-agent/dist/(bundle/)?cli\.js(?:\s|"|$)'"#};
    // Read descendants of the exact public pane foreground process only. Keep
    // process arguments inside this short-lived observer; return only PIDs.
    let script=format!(r#"$queue=[System.Collections.Generic.Queue[uint32]]::new();$queue.Enqueue({parent});$ids=@();$count=0;while($queue.Count -gt 0 -and $count -lt 32){{$parentId=$queue.Dequeue();$count++;$children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentId" -Property ProcessId,Name,CommandLine);$ids+=@($children | Where-Object {{ {test} }} | ForEach-Object {{[uint32]$_.ProcessId}});foreach($child in $children){{$queue.Enqueue([uint32]$child.ProcessId)}}}};ConvertTo-Json -InputObject @($ids | Select-Object -Unique) -Compress"#);

    let mut command=Command::new(shell);command.env_clear();
    for key in ["SystemRoot","WINDIR","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA"]{if let Some(value)=std::env::var_os(key){command.env(key,value);}}
    use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);
    command.args(["-NoProfile","-NonInteractive","-Command",&script]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child=command.spawn().ok()?;let stdout=child.stdout.take()?;
    let read=std::thread::spawn(move||{use std::io::Read;let mut out=Vec::new();let _=stdout.take(4097).read_to_end(&mut out);out});
    let end=Instant::now()+Duration::from_secs(5);
    let status=loop{match child.try_wait(){Ok(Some(status))=>break status,Ok(None) if Instant::now()<end=>std::thread::sleep(Duration::from_millis(30)),_=>{let _=child.kill();let _=child.wait();let _=read.join();return None;}}};
    let bytes=read.join().ok()?;if !status.success()||bytes.len()>4096{return None;}
    let ids:Vec<u32>=serde_json::from_slice(&bytes).ok()?;if ids.len()!=1||process_stamp(parent)!=Some(parent_stamp){return None;}
    process_stamp(ids[0]).filter(|stamp|*stamp>=parent_stamp).map(|_|ids[0])
}
#[cfg(not(windows))]
fn agent_child_pid(_:u32,_:&str)->Option<u32>{None}
fn process_identity(config:&HerdrConfig,mut session:HerdrSession)->HerdrSession{
    if fixture_configured()||!["codex","pi"].contains(&session.kind.as_str()){return session;}
    let value=match call(config,"pane.process_info",json!({"target":session.pane_id})){Ok(v)=>v,Err(_)=>return session};
    let Some(info)=value.get("process_info") else{return session;};
    if info["pane_id"].as_str()!=Some(session.pane_id.as_str()){session.identity_confirmed=false;session.identity_source="unverified".into();session.agent_id.clear();return session;}
    let Some(processes)=info["foreground_processes"].as_array() else{return session;};
    let mut candidates:Vec<u32>=processes.iter().filter_map(|p|{
        let name=p["name"].as_str().unwrap_or("").to_ascii_lowercase();
        let pid=p["pid"].as_u64().and_then(|p|u32::try_from(p).ok())?;
        if ["pwsh.exe","powershell.exe","cmd.exe"].contains(&name.as_str()){return agent_child_pid(pid,&session.kind);}
        if session.kind=="codex"{return (name=="codex.exe"||name=="codex").then_some(pid);}
        let arguments:Vec<String>=p["argv"].as_array()?.iter().filter_map(Value::as_str).map(|a|a.split(['\\','/']).filter(|p|!p.is_empty()).collect::<Vec<_>>().join("/")).collect();
        if name=="node.exe"||name=="node"{return arguments.iter().any(|a|a.ends_with("/pi-coding-agent/dist/bundle/cli.js")||a.ends_with("/pi-coding-agent/dist/cli.js")).then_some(pid);}
        None
    }).collect();candidates.sort_unstable();candidates.dedup();
    if candidates.len()!=1{session.identity_confirmed=false;session.identity_source="unverified".into();session.agent_id.clear();return session;}
    let pid=Some(candidates[0]);
    let stamp=pid.and_then(process_stamp);
    if let (Some(pid),Some(stamp))=(pid,stamp){
        let native=session.identity_confirmed&&session.identity_source=="native_session";
        let identity=if native{session.agent_id.clone()}else{format!("{}:{}",session.terminal_id,session.kind)};
        session.agent_id=format!("{identity}:process:{pid}:{stamp:016x}");
        session.identity_confirmed=true;session.identity_source=if native{"native_session"}else{"local_process"}.into();session.process_id=Some(pid);session.process_created_at=Some(format!("{stamp:016x}"));
    }else{session.identity_confirmed=false;session.identity_source="unverified".into();session.agent_id.clear();}
    session
}

// A new pane only: run the user's existing PowerShell command, with its profile.
// Do not substitute the application-owned Pi for the separately selected OpenPI.
pub(crate) fn start_powershell(config:&HerdrConfig,pane:&str,kind:&str)->Result<(),StorageError>{
    let command=match kind {"codex"=>"codex","openpi"=>"opi",_=>return Err(invalid("请选择 Codex 或 OpenPI。"))};
    let shell=std::env::var_os("PATH").and_then(|p|std::env::split_paths(&p).map(|d|d.join("pwsh.exe")).find(|p|p.is_file()))
        .or_else(||std::env::var_os("SystemRoot").map(|p|PathBuf::from(p).join("System32/WindowsPowerShell/v1.0/powershell.exe")).filter(|p|p.is_file()))
        .ok_or_else(||invalid("未找到 PowerShell，已创建的窗格保留。"))?;
    // Invoke by fixed shell name: works from either cmd or PowerShell without
    // interpreting user-supplied pane labels, paths or prompt text as commands.
    let shell_name=shell.file_name().and_then(|s|s.to_str()).ok_or_else(||invalid("PowerShell 名称无效。"))?;
    call(config,"pane.run",json!({"target":pane,"command":format!("{shell_name} -NoLogo -NoExit -Command {command}")}))?;
    let end=Instant::now()+Duration::from_secs(25);
    loop {
        if let Ok(current)=get(config,pane) {
            let correct=if kind=="codex"{current.kind=="codex"}else{["pi","openpi","opi"].contains(&current.kind.as_str())};
            if correct&&current.identity_confirmed&&current.interactive_ready&&["idle","done"].contains(&current.state.as_str()){return Ok(());}
        }
        if Instant::now()>=end{return Err(StorageError::new("herdr_start_pending","已向新窗格发送 PowerShell 启动命令，Agent 尚未就绪。原窗格已保留，可在 Herdr 完成启动后继续核对；未发送任务或重复创建。"));}
        std::thread::sleep(Duration::from_millis(350));
    }
}

pub(crate) fn new_shell_path(path:&Path)->Result<String,StorageError>{
    let parent=path.parent().ok_or_else(||invalid("新工作区缺少父目录"))?;
    let name=path.file_name().ok_or_else(||invalid("新工作区名称无效"))?;
    Ok(PathBuf::from(shell_path(parent)?).join(name).to_string_lossy().into_owned())
}
pub(crate) fn shell_path(path:&Path)->Result<String,StorageError>{
    let canonical=std::fs::canonicalize(path).map_err(|_|invalid("Herdr启动路径无法核对。"))?;
    let original=canonical.to_str().ok_or_else(||invalid("Herdr启动路径不能表示为文本。"))?;
    #[cfg(windows)]
    let shell=match canonical.components().next(){
        Some(std::path::Component::Prefix(p))=>match p.kind(){
            std::path::Prefix::VerbatimDisk(_)=>original[4..].to_string(),
            std::path::Prefix::VerbatimUNC(_,_)=>format!("\\\\{}",&original[8..]),
            std::path::Prefix::Disk(_)|std::path::Prefix::UNC(_,_)=>original.to_string(),
            _=>return Err(invalid("Herdr启动不支持此Windows设备路径。")),
        },
        _=>return Err(invalid("Herdr启动需要可核对的Windows绝对路径。")),
    };
    #[cfg(not(windows))]
    let shell=original.to_string();
    if shell.contains(['\0','\r','\n'])||shell.split(['\\','/']).any(|part|part.ends_with([' ','.']))||std::fs::canonicalize(&shell).ok().as_ref()!=Some(&canonical){return Err(invalid("Herdr启动路径转换后位置不同，未启动其他目录。"));}
    Ok(shell)
}

pub(crate) fn owned_pi_environment(root:&Path,resource_dir:&Path,cwd:&Path)->Result<Vec<(String,String)>,StorageError>{
    let mapped=|e:crate::pi_model_config::ConfigError|StorageError::new(e.code,e.message);
    let runtime=crate::pi_runtime::resolve(resource_dir).map_err(mapped)?;
    let paths=crate::pi_launch_plan::PiPaths::prepare(root).map_err(mapped)?;
    paths.checked_cwd(Some(cwd)).map_err(mapped)?;
    let bin=paths.pi_root.join("native-herdr-bin");crate::pi_launch_plan::no_link(&bin).map_err(mapped)?;
    std::fs::create_dir_all(&bin).map_err(|_|invalid("本应用Herdr启动目录无法创建。"))?;
    let bin=std::fs::canonicalize(bin).map_err(|_|invalid("本应用Herdr启动目录无法核对。"))?;
    if !bin.starts_with(&paths.pi_root){return Err(invalid("Herdr启动目录不属于本应用Pi状态。"));}
    let launcher=bin.join("pi.cmd");crate::pi_launch_plan::no_link(&launcher).map_err(mapped)?;
    let quote=|p:&Path|shell_path(p).map(|p|format!("\"{}\"",p.replace('%',"%%")));
    let body=format!("@echo off\r\n{} --no-global-search-paths {} --offline --no-approve --no-context-files --session-dir {} %*\r\n",quote(&runtime.node)?,quote(&runtime.pi)?,quote(&paths.sessions)?);
    if launcher.exists(){if crate::task_panel_paths::read_limited(&launcher,16384)?!=body.as_bytes(){return Err(invalid("本应用Pi启动文件与当前资源版本不符；原文件保留，未调用其他Pi。"));}}
    else {use std::io::Write;let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&launcher).map_err(|_|invalid("Pi启动文件未能保存。"))?;file.write_all(body.as_bytes()).map_err(|_|invalid("Pi启动文件保存失败。"))?;}
    let windows=std::env::var_os("SystemRoot").map(PathBuf::from).ok_or_else(||invalid("Windows系统目录无法核对。"))?;
    let mut program_files=vec![std::env::var_os("ProgramFiles").map(PathBuf::from).ok_or_else(||invalid("Windows程序目录无法核对。"))?];
    if let Some(p)=std::env::var_os("ProgramFiles(x86)"){program_files.push(PathBuf::from(p));}
    let mut environment:Vec<(String,String)>=paths.environment(&runtime,&windows,&program_files).map_err(mapped)?.into_iter().map(|(k,v)|(k.to_string_lossy().into_owned(),v.to_string_lossy().into_owned())).collect();
    for (key,value) in &mut environment{
        if key=="PATH"{
            let mut paths=vec![PathBuf::from(shell_path(&bin)?)];
            for path in std::env::split_paths(value){paths.push(PathBuf::from(shell_path(&path)?));}
            *value=std::env::join_paths(paths).map_err(|_|invalid("Pi独立命令路径无法转换。"))?.into_string().map_err(|_|invalid("Pi命令路径不能表示为文本。"))?;
        }else if !["PI_OFFLINE","PI_SKIP_VERSION_CHECK","PI_TELEMETRY"].contains(&key.as_str()){
            *value=shell_path(Path::new(value))?;
        }
    }
    Ok(environment)
}
pub(crate) fn metadata_sessions(config:&HerdrConfig)->Result<Vec<HerdrSession>,StorageError>{
    let result=call(config,"agent.list",json!({}))?;
    result["agents"].as_array().ok_or_else(||invalid("Herdr 会话列表不可读"))?.iter().map(|a|parse_session(config,a)).collect()
}
pub(crate) fn sessions(config:&HerdrConfig)->Result<Vec<HerdrSession>,StorageError>{
    let result=call(config,"agent.list",json!({}))?;
    let agents=result.get("agents").and_then(Value::as_array).ok_or_else(||invalid("Herdr 会话列表格式不兼容，未读取聊天正文。"))?;
    agents.iter().map(|a|observe_session(config,a)).collect()
}
fn observe_session(config:&HerdrConfig,value:&Value)->Result<HerdrSession,StorageError>{
    let mut session=process_identity(config,parse_session(config,value)?);
    // The field is optional in protocol 22. Only infer readiness for a known,
    // verified agent in an input-ready state. An explicit false stays false.
    if value.get("interactive_ready").is_none(){
        session.interactive_ready=session.identity_confirmed
            &&["codex","pi","openpi","opi"].contains(&session.kind.as_str())
            &&["idle","done"].contains(&session.state.as_str());
    }
    Ok(session)
}
pub(crate) fn get(config:&HerdrConfig,pane:&str)->Result<HerdrSession,StorageError>{
    let result=call(config,"agent.get",json!({"target":pane}))?;
    let agent=result.get("agent").filter(|v|v.is_object()).unwrap_or(&result);observe_session(config,agent)
}
