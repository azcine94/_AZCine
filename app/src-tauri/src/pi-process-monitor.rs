//! In-memory inventory of this application's owned transports. Never enumerate OS PIDs.
use super::*;
use serde::Serialize;
use std::sync::{OnceLock, Weak};

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct ProcessInfo {
    pub id:String, pub pid:u32, pub source:String, pub status:String, pub context:Option<String>,
    pub started_at:i64, pub ended_at:Option<i64>, pub last_activity_at:i64,
    pub pending:usize, pub active_processes:Option<u32>, pub error:Option<String>,
}
struct Entry { info:Arc<Mutex<ProcessInfo>>, process:Weak<Inner> }
static ENTRIES:OnceLock<Mutex<Vec<Entry>>>=OnceLock::new();
static NEXT_ID:AtomicU64=AtomicU64::new(1);
fn entries()->&'static Mutex<Vec<Entry>> { ENTRIES.get_or_init(||Mutex::new(Vec::new())) }
fn now()->i64 { chrono::Utc::now().timestamp_millis() }
pub(super) fn info(pid:u32,source:&str)->Arc<Mutex<ProcessInfo>> {
    Arc::new(Mutex::new(ProcessInfo{id:format!("process-{}",NEXT_ID.fetch_add(1,Ordering::Relaxed)),pid,source:source.into(),status:"idle".into(),context:None,started_at:now(),ended_at:None,last_activity_at:now(),pending:0,active_processes:Some(1),error:None}))
}
pub(super) fn register(inner:&Arc<Inner>) {
    if let Ok(mut rows)=entries().lock() {
        rows.push(Entry{info:inner.monitor.clone(),process:Arc::downgrade(inner)});
        // Retain all live handles and at most 100 released records.
        let mut finished=0;
        rows.reverse();rows.retain(|row| {if row.process.strong_count()>0{return true;}finished+=1;finished<=100});rows.reverse();
    }
}
pub(super) fn activity(inner:&Inner,event:&Value) {
    if let Ok(mut info)=inner.monitor.lock() {
        info.last_activity_at=now();
        if info.ended_at.is_some(){return;}
        // Only explicit session metadata; never retain prompt, response text or stderr.
        let context=if event["type"]=="response"&&event["command"]=="get_state"&&event["success"]==true {
            event["data"]["sessionName"].as_str().filter(|s|!s.is_empty()).or_else(||event["data"]["sessionId"].as_str())
        }else if event["type"]=="session_info_changed"{event["name"].as_str()}else{None};
        if let Some(context)=context{info.context=Some(context.chars().filter(|c|!c.is_control()).take(160).collect());}
        match event["type"].as_str() {
            Some("agent_start"|"tool_execution_start"|"message_update")=>info.status="running".into(),
            Some("agent_end"|"agent_settled")=>info.status="idle".into(),
            Some("extension_ui_request") if matches!(event["method"].as_str(),Some("select"|"confirm"|"input"|"editor"))=>info.status="waiting".into(),
            _=>{},
        }
    }
}
pub(super) fn finish(inner:&Inner,status:&str,reason:Option<&str>) {
    if let Ok(mut info)=inner.monitor.lock() {
        if info.ended_at.is_none(){info.status=status.into();info.ended_at=Some(now());info.error=reason.map(str::to_owned);}
    }
}
pub fn snapshot()->Result<Vec<ProcessInfo>,RpcError> {
    let rows=entries().lock().map_err(|_|poisoned())?.iter().map(|e|(e.info.clone(),e.process.clone())).collect::<Vec<_>>();
    let mut result=Vec::new();
    for (info,weak) in rows {
        let mut row=info.lock().map_err(|_|poisoned())?.clone();
        if let Some(inner)=weak.upgrade() {
            row.pending=inner.pending.try_lock().map(|p|p.len()).unwrap_or(0);
            row.active_processes=inner.process.try_lock().ok().and_then(|p|p.active_processes().ok());
            if row.ended_at.is_none()&&row.status=="idle"&&row.pending>0 {row.status="requesting".into();}
        } else {row.active_processes=Some(0);row.pending=0;}
        result.push(row);
    }
    result.reverse();Ok(result)
}
pub fn stop(id:&str)->Result<(),RpcError> {
    let process={let rows=entries().lock().map_err(|_|poisoned())?;
        rows.iter().find(|row|row.info.lock().map(|i|i.id==id).unwrap_or(false)).map(|row|row.process.clone())
    }.ok_or_else(||error("pi_process_missing","进程记录不存在，请刷新。"))?;
    let Some(inner)=process.upgrade() else {return Ok(());};
    if inner.process.lock().map_err(|_|poisoned())?.active_processes().map_err(|e|error(e.code,e.message))?==0{return Ok(());}
    finish(&inner,"stopped",Some("已从进程监控停止，未完成任务不会报告成功。"));
    if let Ok(handler)=inner.stop_handler.lock(){if let Some(handler)=handler.as_ref(){handler();}}
    inner.fault(error("pi_monitor_stopped","已从进程监控停止 Agent；输入与已有结果保留。"));
    // Reuse the tracked Job handle and verify the whole owned tree has exited.
    let process=RpcProcess{inner};
    process.shutdown(Duration::ZERO)?;Ok(())
}
