//! Read-only Herdr/Git observations, independent of the selected UI tab.
use crate::{herdr_adapter::{self, HerdrSession}, storage::Store, task_panel_store::{bindings, executions, is_live, now}};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, process::{Command, Stdio}, time::Duration};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Observation {pub state:String, pub observed_at:String, pub state_since:String, pub first_working_at:Option<String>, pub reason:String}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct GitObservation {pub branch:String, pub head:String, pub path:String, pub changed_files:usize, pub observed_at:String, pub error:String}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Monitor {pub observed_at:String, pub error:String, pub sessions:Vec<HerdrSession>, pub runs:BTreeMap<String,Observation>, #[serde(default)] pub worktrees:BTreeMap<String,GitObservation>, pub git:GitObservation}
const KEY:&str="task-panel:monitor";
pub fn read(store:&Store)->Monitor {store.task_setting(KEY).ok().flatten().and_then(|s|serde_json::from_str(&s).ok()).unwrap_or_default()}

pub fn git(root:&Path)->GitObservation {
    let mut result=GitObservation{path:root.to_string_lossy().into_owned(),observed_at:now(),..Default::default()};
    let mut cmd=Command::new("git");
    cmd.args(["--no-optional-locks","status","--porcelain=v2","--branch","--untracked-files=normal"]).current_dir(root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] {use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000);}
    let Ok(mut child)=cmd.spawn() else {result.error="Git 不可用".into();return result};
    let stdout=child.stdout.take().unwrap();
    let reader=std::thread::spawn(move||{use std::io::Read;let mut bytes=Vec::new();let _=stdout.take(1_000_000).read_to_end(&mut bytes);bytes});
    let end=std::time::Instant::now()+Duration::from_secs(4);
    loop {match child.try_wait(){Ok(Some(status))=>{if !status.success(){result.error="非 Git 仓库或状态不可读".into();}break},Ok(None) if std::time::Instant::now()<end=>std::thread::sleep(Duration::from_millis(30)),_=>{let _=child.kill();let _=child.wait();result.error="Git 观察超时".into();break}}}
    let bytes=reader.join().unwrap_or_default();
    for line in String::from_utf8_lossy(&bytes).lines(){if let Some(v)=line.strip_prefix("# branch.head "){result.branch=v.into()}else if let Some(v)=line.strip_prefix("# branch.oid "){result.head=v.into()}else if !line.starts_with('#')&&!line.is_empty(){result.changed_files+=1}}
    result
}

fn matches(binding:&crate::task_panel_types::Binding,session:&HerdrSession)->bool {
    if binding.server_id!=session.server_id||binding.workspace_id!=session.workspace_id||binding.pane_id!=session.pane_id||binding.kind!=session.kind{return false;}
    if std::fs::canonicalize(&binding.cwd).ok().zip(std::fs::canonicalize(&session.cwd).ok()).is_none_or(|(a,b)|a!=b){return false;}
    // Poll public metadata without a CIM/process-tree scan on every pane.
    // A retained Windows process handle stamp must still match this binding.
    if let Some((prefix,process))=binding.agent_id.rsplit_once(":process:") {
        if !(prefix==format!("{}:{}",session.terminal_id,session.kind)||session.identity_confirmed&&prefix==session.agent_id){return false;}
        let Some((pid,stamp))=process.split_once(':') else{return false};
        return pid.parse::<u32>().ok().and_then(herdr_adapter::process_stamp).zip(u64::from_str_radix(stamp,16).ok()).is_some_and(|(a,b)|a==b);
    }
    session.identity_confirmed&&binding.agent_id==session.agent_id
}

pub fn start(app:tauri::AppHandle) {
    std::thread::spawn(move||loop {
        // Never hold the SQLite/workspace mutex across an external command.
        let targets={let state=app.state::<crate::task_panel_workspace::TaskWorkspaceState>();
            state.0.try_lock().ok().map(|guard|guard.iter().map(|(root,store)|(root.clone(),store.task_panel_herdr_config().unwrap_or_default(),executions(&store.db).unwrap_or_default(),bindings(&store.db).unwrap_or_default(),crate::task_panel_locations::paths(&store.db))).collect::<Vec<_>>()).unwrap_or_default()};
        let mut servers=BTreeMap::new();
        for (root,config,runs,bindings,paths) in targets {
            let config=if config.session.is_empty(){herdr_adapter::discover(config,Some(&root)).ok()}else{Some(config)};
            let (sessions,error)=if let Some(config)=config {
                let key=format!("{}:{}",config.executable,config.session);
                servers.entry(key).or_insert_with(||match herdr_adapter::metadata_sessions(&config){Ok(rows)=>(rows,String::new()),Err(e)=>(vec![],e.message)}).clone()
            }else{(vec![],"尚未连接 Herdr".into())};
            let worktrees=paths.into_iter().map(|path|{let observed=git(Path::new(&path));(path,observed)}).collect();
            let git=git(&root);
            let state=app.state::<crate::task_panel_workspace::TaskWorkspaceState>();
            if let Ok(mut guard)=state.0.try_lock(){if let Some(store)=guard.get_mut(&root) {
                let mut monitor=read(store);monitor.observed_at=now();monitor.error=error.clone();monitor.sessions=sessions.clone();monitor.git=git;monitor.worktrees=worktrees;
                let current=executions(&store.db).unwrap_or_default();
                for run in runs.iter().filter(|r|is_live(&r.state)) {
                    if !current.iter().any(|r|r.id==run.id&&r.binding_generation==run.binding_generation&&is_live(&r.state)){continue;}
                    let session=bindings.iter().find(|b|b.id==run.binding_id&&b.generation==run.binding_generation).and_then(|b|sessions.iter().find(|s|matches(b,s)));
                    let state=session.map(|s|s.state.as_str()).unwrap_or("disconnected");
                    let old=monitor.runs.get(&run.id);
                    let since=old.filter(|o|o.state==state).map(|o|o.state_since.clone()).unwrap_or_else(now);
                    let first=old.and_then(|o|o.first_working_at.clone()).or_else(||(state=="working").then(now));
                    let observation=Observation{state:state.into(),observed_at:now(),state_since:since,first_working_at:first,reason:if error.is_empty()&&session.is_none(){"原窗格或 Agent 身份已改变，需核对".into()}else{error.clone()}};
                    if old.is_none_or(|o|o.state!=state){let _=crate::task_panel_store::event(&store.db,&format!("monitor-{}",now()),&run.id,"terminal_observation","observed",&format!("Herdr 终端观察：{state}；不作为交付或验收依据"));}
                    monitor.runs.insert(run.id.clone(),observation);
                }
                if let Ok(json)=serde_json::to_string(&monitor){let _=store.save_task_setting(KEY,&json);}
                let _=app.emit("task-panel-changed",root.to_string_lossy());
            }};
        }
        std::thread::sleep(Duration::from_secs(3));
    });
}
