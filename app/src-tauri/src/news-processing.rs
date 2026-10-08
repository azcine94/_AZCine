//! Public task progress only; no credentials, provider headers or reasoning text.
use crate::{news_ai::AiControl,news_editorial_types::{ModelChoice,EditorialRun},news_types::Material,storage::StorageError};
use serde::{Serialize,Deserialize};
use std::{sync::Arc,path::Path,time::Instant};
use tauri::{Manager as _,Emitter as _};

#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Step { pub at:String,pub phase:String }
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PendingMaterial {pub material_id:String,pub title:String,pub reason:String}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ProcessingProgress {
    pub run_id:String,pub phase:String,pub started_at:String,pub updated_at:String,
    pub batch:usize,pub batches:usize,pub batch_size:usize,pub completed:usize,pub total:usize,
    pub pid:Option<u32>,pub model:Option<ModelChoice>,pub input:Vec<Material>,
    pub response:String,pub received_chars:usize,pub steps:Vec<Step>,pub error:Option<String>,
    #[serde(default)] pub pending_materials:Vec<PendingMaterial>,
}
pub enum ProgressEvent { Phase(&'static str), Process(u32,Arc<crate::pi_rpc::RpcProcess>), Model(ModelChoice), Text(String,usize) }
pub type Observer=Arc<dyn Fn(ProgressEvent)+Send+Sync>;
fn now()->String{crate::news_store::now()}
pub fn begin(app:&tauri::AppHandle,run:&EditorialRun,batch_size:usize){
    if let Ok(mut state)=app.state::<AiControl>().progress.lock(){*state=Some(ProcessingProgress{run_id:run.id.clone(),phase:"preparing".into(),started_at:now(),updated_at:now(),batch:0,batches:run.total.div_ceil(batch_size),batch_size,completed:run.processed,total:run.total,pid:None,model:None,input:vec![],response:String::new(),received_chars:0,steps:vec![],error:None,pending_materials:vec![]});}
}
pub fn batch(app:&tauri::AppHandle,index:usize,input:&[Material],completed:usize){
    if let Ok(mut state)=app.state::<AiControl>().progress.lock(){if let Some(p)=state.as_mut(){p.batch=index+1;p.input=input.to_vec();p.completed=completed;p.response.clear();p.received_chars=0;}}
    observer(app)(ProgressEvent::Phase("preparing"));
}
pub fn observer(app:&tauri::AppHandle)->Observer {
    let app=app.clone();let last=std::sync::Mutex::new(Instant::now());
    let target=app.state::<AiControl>().progress.lock().ok().and_then(|p|p.as_ref().map(|p|(p.run_id.clone(),p.started_at.clone())));
    Arc::new(move|event|{
        let streaming=matches!(&event,ProgressEvent::Text(_, _));
        let mut updated=false;
        if let Ok(mut state)=app.state::<AiControl>().progress.lock(){if let Some(p)=state.as_mut().filter(|p|target.as_ref().is_some_and(|(id,at)|&p.run_id==id && &p.started_at==at) && !matches!(p.phase.as_str(),"completed"|"cancelled"|"failed"|"awaitingModel"|"interrupted"|"pendingMaterials")){
            updated=true;
            match event {
                ProgressEvent::Phase(phase)=>{if phase=="sending"{p.response.clear();p.received_chars=0;}p.phase=if phase=="waitingModel"&&p.received_chars>0{"receiving".into()}else if phase=="waitingModel"&&p.phase=="thinking"{"thinking".into()}else{phase.into()};p.steps.push(Step{at:now(),phase:phase.into()});},
                ProgressEvent::Process(pid,process)=>{p.pid=Some(pid);if let Ok(mut active)=app.state::<AiControl>().active.lock(){*active=Some(process);}},ProgressEvent::Model(model)=>p.model=Some(model),
                ProgressEvent::Text(text,count)=>{if p.phase!="receiving"{p.steps.push(Step{at:now(),phase:"receiving".into()});}p.phase="receiving".into();p.response=text;p.received_chars=count;},
            };if p.steps.len()>1000{p.steps.remove(0);}p.updated_at=now();
        }}
        if !updated{return;}
        let emit=if !streaming{true}else{last.lock().map(|mut value|{if value.elapsed().as_millis()<500{false}else{*value=Instant::now();true}}).unwrap_or(false)};
        if emit{let _=app.emit_to("main","news-processing-changed",());}
    })
}
pub fn completed(app:&tauri::AppHandle,count:usize){if let Ok(mut state)=app.state::<AiControl>().progress.lock(){if let Some(p)=state.as_mut(){p.completed=count;}}}
pub fn pending_material(app:&tauri::AppHandle,material:&Material,reason:&str){
    if let Ok(mut state)=app.state::<AiControl>().progress.lock(){if let Some(p)=state.as_mut(){p.pending_materials.push(PendingMaterial{material_id:material.id.clone(),title:material.title.clone(),reason:reason.into()});}}
    observer(app)(ProgressEvent::Phase("materialPending"));
}
pub fn terminal(app:&tauri::AppHandle,status:&str,error:Option<String>){
    if let Ok(mut state)=app.state::<AiControl>().progress.lock(){if let Some(p)=state.as_mut(){p.phase=status.into();p.error=error;p.updated_at=now();p.pid=None;p.steps.push(Step{at:now(),phase:status.into()});}}
    let _=app.emit_to("main","news-processing-changed",());
}
pub fn snapshot(app:&tauri::AppHandle)->Result<Option<ProcessingProgress>,StorageError>{app.state::<AiControl>().progress.lock().map(|p|p.clone()).map_err(|_|crate::news_editorial_types::invalid_reply())}
pub fn persist(app:&tauri::AppHandle,path:&Path)->Result<(),StorageError>{
    use std::io::Write;
    let Some(value)=snapshot(app)?else{return Ok(());};
    crate::pi_launch_plan::no_link(path).map_err(|e|StorageError::new(e.code,e.message))?;
    let mut candidate=tempfile::Builder::new().prefix("progress-").tempfile_in(path.parent().ok_or_else(crate::news_editorial_types::invalid_reply)?).map_err(|_|crate::news_editorial_types::invalid_reply())?;
    candidate.write_all(&serde_json::to_vec(&value).map_err(|_|crate::news_editorial_types::invalid_reply())?).map_err(|_|crate::news_editorial_types::invalid_reply())?;
    candidate.as_file().sync_all().map_err(|_|crate::news_editorial_types::invalid_reply())?;
    candidate.persist(path).map_err(|_|crate::news_editorial_types::invalid_reply())?;Ok(())
}
