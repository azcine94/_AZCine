//! Durable application queue. SQLite claims precede RPC; ambiguous receipts never retry automatically.
use crate::{storage::{StorageError,Store},pi_manager::{SendInput,ImageInput},agent_store::{Source,Providers}};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use rusqlite::OptionalExtension;
use tauri::Manager as _;
use std::{collections::HashMap,sync::Mutex};
pub struct QueueControl {instance:String,operation:Mutex<()>}
impl Default for QueueControl{fn default()->Self{Self{instance:format!("{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()),operation:Mutex::new(())}}}
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct QueueImage {id:String,name:String,data:String,mime_type:String}
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Payload {text:String,images:Vec<QueueImage>,files:Vec<Value>,objects:Vec<Source>,source:Source,model:Value}
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Entry {id:String,conversation_key:String,session_id:String,revision:u64,behavior:String,status:String,payload:Payload,input_id:String,generation:u64,error:Option<String>}
#[derive(Default,Deserialize,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Document {instance:String,#[serde(default)] continued_after:HashMap<String,Value>,paused:HashMap<String,bool>,entries:Vec<Entry>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Mutation {pub root:String,pub action:String,pub conversation_key:String,pub id:Option<String>,pub revision:Option<u64>,pub payload:Option<Payload>,pub behavior:Option<String>}
fn error(message:&str)->StorageError{StorageError::new("agent_queue",message)}
fn failed()->StorageError{error("消息队列读取或保存失败，原内容保留。")}
fn pi(e:crate::pi_manager::PiError)->StorageError{StorageError::new(e.code,&e.message)}
fn terminal(entry:&Entry)->bool{matches!(entry.status.as_str(),"sent"|"removed")}
fn archive_key(id:&str)->String{format!("agent_queue_history_v1:{id}")}
fn archived(db:&rusqlite::Connection,id:&str)->Result<Option<Entry>,StorageError>{
    let text:Option<String>=db.query_row("SELECT value FROM app_meta WHERE key=?",[archive_key(id)],|r|r.get(0)).optional().map_err(|_|failed())?;
    text.map(|v|serde_json::from_str(&v).map_err(|_|failed())).transpose()
}
fn write_document(db:&rusqlite::Connection,document:&Document)->Result<(),StorageError>{
    // Archive payloads separately: no repeated decoding or pending-capacity charge.
    let active=Document{instance:document.instance.clone(),continued_after:document.continued_after.clone(),paused:document.paused.clone(),entries:document.entries.iter().filter(|e|!terminal(e)).cloned().collect()};
    let text=serde_json::to_string(&active).map_err(|_|failed())?;
    if text.len()>256*1024*1024{return Err(error("队列附件过大，请处理已有消息后重试；输入保留。"));}
    for entry in document.entries.iter().filter(|e|terminal(e)){
        db.execute("INSERT INTO app_meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",rusqlite::params![archive_key(&entry.id),serde_json::to_string(entry).map_err(|_|failed())?]).map_err(|_|failed())?;
    }
    db.execute("INSERT INTO app_meta(key,value) VALUES('agent_queue_v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[text]).map_err(|_|failed())?;Ok(())
}
fn save(store:&Store,document:&Document)->Result<(),StorageError>{let tx=store.db.unchecked_transaction().map_err(|_|failed())?;write_document(&tx,document)?;tx.commit().map_err(|_|failed())}
pub fn retire_conversation(db:&rusqlite::Connection,keys:&[String],session:&str)->Result<(),StorageError>{
    let text:Option<String>=db.query_row("SELECT value FROM app_meta WHERE key='agent_queue_v1'",[],|r|r.get(0)).optional().map_err(|_|failed())?;
    if let Some(text)=text{let mut doc:Document=serde_json::from_str(&text).map_err(|_|failed())?;for entry in &mut doc.entries{if keys.contains(&entry.conversation_key)||entry.session_id==session{entry.status="removed".into();entry.revision+=1;doc.paused.insert(entry.conversation_key.clone(),true);}}write_document(db,&doc)?;}Ok(())
}
fn read(store:&Store,root:&str,instance:&str)->Result<Document,StorageError>{
    if store.root.to_string_lossy()!=root{return Err(error("数据目录已变化，未操作其他目录的队列。"));}
    let text:Option<String>=store.db.query_row("SELECT value FROM app_meta WHERE key='agent_queue_v1'",[],|r|r.get(0)).optional().map_err(|_|failed())?;
    let mut document:Document=match text{Some(v)=>serde_json::from_str(&v).map_err(|_|failed())?,None=>Document::default()};
    let mut migrated=document.entries.iter().any(terminal);
    for entry in document.entries.iter_mut().filter(|e|!terminal(e)){
        let deleted:bool=store.db.query_row("SELECT EXISTS(SELECT 1 FROM agent_conversations WHERE id=?1 AND deleted_at IS NOT NULL) OR EXISTS(SELECT 1 FROM agent_deleted_sessions WHERE session_id=?2)",rusqlite::params![entry.conversation_key,entry.session_id],|r|r.get(0)).map_err(|_|failed())?;
        if deleted{entry.status="removed".into();entry.revision+=1;migrated=true;}
    }
    if migrated{save(store,&document)?;document.entries.retain(|e|!terminal(e));}
    if document.instance!=instance{document.instance=instance.into();for entry in &mut document.entries{document.paused.insert(entry.conversation_key.clone(),true);if entry.status=="editing"{entry.status="waiting".into();entry.revision+=1;}if matches!(entry.status.as_str(),"dispatching"|"nativeQueued"){entry.status="uncertain".into();entry.error=Some("应用曾在交接消息时退出，请先核对历史，再决定是否重新排队。".into());entry.revision+=1;}}save(store,&document)?;}Ok(document)
}
pub fn references(store:&Store,provider:&str,model:Option<&str>)->Result<bool,StorageError>{
    let text:Option<String>=store.db.query_row("SELECT value FROM app_meta WHERE key='agent_queue_v1'",[],|r|r.get(0)).optional().map_err(|_|failed())?;
    let Some(text)=text else{return Ok(false);};let doc:Document=serde_json::from_str(&text).map_err(|_|failed())?;
    Ok(doc.entries.iter().any(|e|!matches!(e.status.as_str(),"sent"|"removed")&&e.payload.model["provider"].as_str()==Some(provider)&&model.is_none_or(|id|e.payload.model["id"].as_str()==Some(id))))
}
fn public(mut document:Document)->Document{document.entries.retain(|e|!matches!(e.status.as_str(),"sent"|"removed"));document}
fn check_payload(payload:&Payload)->Result<(),StorageError>{
    if payload.text.chars().count()>100000||payload.text.trim().is_empty()&&payload.images.is_empty()&&payload.files.is_empty()&&payload.objects.is_empty()||payload.images.len()>4||payload.files.len()>16||payload.objects.len()>16{return Err(error("消息为空或超过文字/附件数量上限，输入保留。"));}
    if payload.text.trim_start().starts_with('/'){return Err(error("原生命令请在任务结束后单独发送，不加入业务消息队列。"));}
    if payload.model["provider"].as_str().is_none_or(|v|v.is_empty()||v.len()>200)||payload.model["id"].as_str().is_none_or(|v|v.is_empty()||v.len()>300)||payload.images.iter().map(|i|i.data.len()).sum::<usize>()>crate::pi_image_limits::MAX_IMAGE_BATCH_BASE64_BYTES{return Err(error("模型标识或图片总大小无效，输入保留。"));}
    if payload.images.iter().any(|i|!crate::pi_image_limits::image_encoded_size_allowed(&i.data)||!matches!(i.mime_type.as_str(),"image/png"|"image/jpeg"|"image/webp"|"image/gif")){return Err(error("图片格式或大小不支持，输入保留。"));}Ok(())
}
#[tauri::command]
pub async fn agent_queue_read(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String)->Result<Document,StorageError>{
    crate::main_window(&window)?;let instance=app.state::<QueueControl>().instance.clone();crate::with_storage(app,move|m|read(m.store()?,&root,&instance).map(public)).await
}
#[tauri::command]
pub async fn agent_queue_mutate(app:tauri::AppHandle,window:tauri::WebviewWindow,input:Mutation)->Result<Document,StorageError>{
    crate::main_window(&window)?;
    // Pause bypasses the in-flight send; the manager gate serializes with RPC submission.
    tauri::async_runtime::spawn_blocking(move||{let control=app.state::<QueueControl>();let _operation=if input.action=="pause"{None}else{Some(control.operation.lock().map_err(|_|failed())?)};let instance=control.instance.clone();let handle=app.clone();
        tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{
            let store=m.store()?;let mut doc=read(store,&input.root,&instance)?;let key=&input.conversation_key;
            if matches!(input.action.as_str(),"pause"|"resume"){handle.state::<crate::agent_runtime::AgentRuntime>().manager(key).map_err(pi)?.pause_business_queue(input.action=="pause").map_err(pi)?;doc.paused.insert(key.clone(),input.action=="pause");if input.action=="resume"{let summary=handle.state::<crate::agent_runtime::AgentRuntime>().manager(key).map_err(pi)?.summary().map_err(pi)?;doc.continued_after.insert(key.clone(),json!([summary["generation"],summary["seq"]]));}}
            else if input.action=="enqueue"{
                let id=input.id.ok_or_else(failed)?;if id.len()!=36||!id.bytes().all(|b|b.is_ascii_hexdigit()||b==b'-'){return Err(failed());}
                if doc.entries.iter().any(|e|e.id==id)||archived(&store.db,&id)?.is_some(){return Ok(public(doc));}
                if doc.entries.iter().filter(|e|e.conversation_key==*key&&!matches!(e.status.as_str(),"sent"|"removed")).count()>=50{return Err(error("此会话最多保留 50 条待发消息。"));}
                let payload=input.payload.ok_or_else(failed)?;check_payload(&payload)?;let behavior=input.behavior.unwrap_or_else(||"followUp".into());if !matches!(behavior.as_str(),"followUp"|"steer"){return Err(failed());}
                let manager=handle.state::<crate::agent_runtime::AgentRuntime>().manager(key).map_err(pi)?;let snapshot=manager.snapshot().map_err(pi)?;
                let session=snapshot["state"]["sessionId"].as_str().ok_or_else(failed)?.to_owned();let generation=snapshot["generation"].as_u64().ok_or_else(failed)?;
                if snapshot["connection"]!="ready"{return Err(error("请先连接此会话，再加入队列。"));}
                let ids=payload.files.iter().map(|f|f["id"].as_str().map(str::to_owned).ok_or_else(failed)).collect::<Result<Vec<_>,_>>()?;crate::agent_commands::verify_attachments(store,&ids)?;
                let (input_id,_)=store.agent_prepare_input_at(key,&session,generation,snapshot["projection"]["messages"].as_array().map(Vec::len).unwrap_or(0),&payload.objects,&ids,&handle.state::<Providers>(),Some(payload.source.clone()))?;
                doc.paused.entry(key.clone()).or_insert(false);
                doc.entries.push(Entry{id,conversation_key:key.clone(),session_id:session,revision:1,behavior,status:"waiting".into(),payload,input_id,generation,error:None});
            }else{
                if input.action=="restore"&&!doc.entries.iter().any(|e|Some(&e.id)==input.id.as_ref()){
                    let entry=archived(&store.db,input.id.as_deref().ok_or_else(failed)?)?.ok_or_else(failed)?;
                    if entry.conversation_key!=*key||entry.status!="removed"{return Err(failed());}
                    store.agent_check_open(key,None)?;
                    let deleted:bool=store.db.query_row("SELECT EXISTS(SELECT 1 FROM agent_deleted_sessions WHERE session_id=?)",[&entry.session_id],|r|r.get(0)).map_err(|_|failed())?;
                    if deleted{return Err(error("原会话已删除，队列内容已留存在历史中。"));}
                    if doc.entries.iter().filter(|e|e.conversation_key==*key).count()>=50{return Err(error("此会话最多保留 50 条待发消息。"));}
                    doc.entries.push(entry);
                }
                let index=doc.entries.iter().position(|e|Some(&e.id)==input.id.as_ref()&&e.conversation_key==*key).ok_or_else(failed)?;
                let entry=&mut doc.entries[index];if Some(entry.revision)!=input.revision{return Err(error("队列项已变化，请重新读取；编辑内容保留。"));}
                match input.action.as_str(){
                    "beginEdit" if matches!(entry.status.as_str(),"waiting"|"editing")=>entry.status="editing".into(),
                    "cancelEdit" if entry.status=="editing"=>entry.status="waiting".into(),
                    "edit" if entry.status=="editing"=>{let payload=input.payload.ok_or_else(failed)?;check_payload(&payload)?;
                        // The captured attachment/object set travels with the whole
                        // item; editing its text must not drop those references.
                        if serde_json::to_value(&payload.objects).ok()!=serde_json::to_value(&entry.payload.objects).ok()||payload.files!=entry.payload.files{return Err(error("队列对象与文件引用已锁定；请移除该项后重新加入。"));}entry.payload=payload;entry.status="waiting".into();},
                    "remove" if matches!(entry.status.as_str(),"waiting"|"editing"|"uncertain")=>entry.status="removed".into(),
                    "restore" if entry.status=="removed"=>entry.status="waiting".into(),
                    "steer" if entry.status=="waiting"=>entry.behavior="steer".into(),
                    "retry" if entry.status=="uncertain"=>{let summary=handle.state::<crate::agent_runtime::AgentRuntime>().manager(key).map_err(pi)?.summary().map_err(pi)?;if summary["active"]==true||summary["waiting"]==true{return Err(error("请先停止并核对原会话，避免重复发送。"));}entry.status="waiting".into();entry.error=None;},
                    _=>return Err(error("此消息已交给 Pi，不能再编辑或移除；请等待实际回执，必要时停止任务。")),
                }entry.revision+=1;
            }
            save(store,&doc)?;Ok(public(doc))
        }))
    }).await.map_err(|_|failed())?
}
#[tauri::command]
pub async fn agent_queue_tick(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String)->Result<Document,StorageError>{
    crate::main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move||{let control=app.state::<QueueControl>();let _operation=control.operation.lock().map_err(|_|failed())?;
        if app.state::<crate::pi_commands::PiExit>().0.load(std::sync::atomic::Ordering::Acquire)!=0{return Err(error("应用正在退出，队列保留。"));}
        let instance=control.instance.clone();let handle=app.clone();let load_root=root.clone();
        let doc=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|read(m.store()?,&load_root,&instance)))?;
        let mut selected=None;
        for entry in &doc.entries{
            if !matches!(entry.status.as_str(),"waiting"|"nativeQueued"){continue;}
            let manager=match handle.state::<crate::agent_runtime::AgentRuntime>().manager(&entry.conversation_key){Ok(v)=>v,Err(_)=>continue};let summary=manager.summary().map_err(pi)?;
            if entry.status=="nativeQueued"{let delivered=summary["deliveredInputIds"].as_array().is_some_and(|ids|ids.iter().any(|v|v==&entry.input_id));let lost=summary["generation"]!=entry.generation||summary["connection"]!="ready"||summary["active"]==false;
                if delivered||lost{selected=Some((entry.clone(),if delivered{"sent"}else{"uncertain"},summary));break;}continue;}
            if doc.paused.get(&entry.conversation_key)==Some(&true)||summary["connection"]!="ready"||summary["waiting"]==true||summary["stopping"]==true{continue;}
            if doc.entries.iter().any(|e|e.conversation_key==entry.conversation_key&&matches!(e.status.as_str(),"dispatching"|"nativeQueued"|"uncertain"|"editing")){continue;}
            if summary["active"]==true&&entry.behavior!="steer"{continue;}
            if summary["active"]==false&&!matches!(summary["outcome"].as_str(),Some("success"|"none"))&&doc.continued_after.get(&entry.conversation_key)!=Some(&json!([summary["generation"],summary["seq"]])){selected=Some((entry.clone(),"pause",summary));break;}
            selected=Some((entry.clone(),"dispatching",summary));break;
        }
        let Some((entry,status,summary))=selected else{return Ok(public(doc));};
        let instance=control.instance.clone();let claim_root=root.clone();let original=entry.clone();let current_model=handle.state::<crate::agent_runtime::AgentRuntime>().manager(&entry.conversation_key).map_err(pi)?.snapshot().map_err(pi)?["state"]["model"].clone();
        let claimed=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let store=m.store()?;let mut doc=read(store,&claim_root,&instance)?;let row=doc.entries.iter_mut().find(|e|e.id==original.id).ok_or_else(failed)?;if row.revision!=original.revision{return Err(error("队列项已变化，下次再处理。"));}
            if status=="dispatching"&&doc.paused.get(&row.conversation_key)==Some(&true){return Ok(None);}
            if status=="dispatching"&&(summary["sessionId"]!=row.session_id||current_model["provider"]!=row.payload.model["provider"]||current_model["id"]!=row.payload.model["id"]){doc.paused.insert(row.conversation_key.clone(),true);row.error=Some("会话或模型已变化，请恢复原会话和模型后继续。".into());save(store,&doc)?;return Ok(None);}
            if status=="pause"{doc.paused.insert(row.conversation_key.clone(),true);row.error=Some("上一轮未正常完成，请核对后手动继续队列。".into());save(store,&doc)?;return Ok(None);}
            row.error=None;row.status=status.into();row.revision+=1;if status=="dispatching"{row.generation=summary["generation"].as_u64().ok_or_else(failed)?;}if status=="uncertain"{doc.paused.insert(row.conversation_key.clone(),true);row.error=Some("未收到这条消息开始执行的事件，请核对会话后再决定是否重发。".into());}let result=row.clone();save(store,&doc)?;Ok(Some(result))
        }))?;
        if let Some(row)=claimed.filter(|_|status=="dispatching"){
            let ids=row.payload.files.iter().filter_map(|f|f["id"].as_str().map(str::to_owned)).collect::<Vec<_>>();let verify_root=root.clone();
            let verified=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let s=m.store()?;if s.root.to_string_lossy()!=verify_root{return Err(failed());}crate::agent_commands::verify_attachments(s,&ids)}));
            let result=verified.and_then(|_|handle.state::<crate::agent_runtime::AgentRuntime>().send_queued(&row.conversation_key,SendInput{generation:row.generation,session_id:row.session_id.clone(),message:if row.payload.text.trim().is_empty()&&row.payload.images.is_empty(){"请查看附加资料。".into()}else{row.payload.text.clone()},images:row.payload.images.iter().map(|i|ImageInput{data:i.data.clone(),mime_type:i.mime_type.clone()}).collect(),behavior:Some(row.behavior.clone())},crate::pi_commands::notify_for(&app,&row.conversation_key),row.input_id.clone()).map_err(pi));
            let instance=control.instance.clone();let save_root=root.clone();
            tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let s=m.store()?;let mut doc=read(s,&save_root,&instance)?;let entry=doc.entries.iter_mut().find(|e|e.id==row.id).ok_or_else(failed)?;
                match result{Ok(receipt)=>{entry.status=if receipt.disposition=="queued"{"nativeQueued"}else{"sent"}.into();s.agent_input_status(&entry.input_id,"accepted")?;},Err(e) if e.code=="agent_queue_paused"=>{entry.status="waiting".into();entry.error=None;},Err(e)=>{entry.status="uncertain".into();entry.error=Some(e.message);doc.paused.insert(entry.conversation_key.clone(),true);s.agent_input_status(&entry.input_id,"unconfirmed")?;}}entry.revision+=1;save(s,&doc)
            }))?;
        }
        let instance=control.instance.clone();tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|read(m.store()?,&root,&instance).map(public)))
    }).await.map_err(|_|failed())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database()->rusqlite::Connection{let db=rusqlite::Connection::open_in_memory().unwrap();db.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);").unwrap();db}
    fn entry(status:&str)->Entry{serde_json::from_value(json!({"id":"fixture-id","conversationKey":"fixture-conversation","sessionId":"fixture-session","revision":1,"behavior":"followUp","status":status,"payload":{"text":"draft","images":[{"id":"image","name":"fixture.png","data":"aGVsbG8=","mimeType":"image/png"}],"files":[],"objects":[],"source":{"module":"agent","page":"agent","objectId":null},"model":{"provider":"fixture","id":"model"}},"inputId":"input","generation":1,"error":null})).unwrap()}
    fn load(db:&rusqlite::Connection)->Document{let text:String=db.query_row("SELECT value FROM app_meta WHERE key='agent_queue_v1'",[],|r|r.get(0)).unwrap();serde_json::from_str(&text).unwrap()}
    #[test]
    fn terminal_payload_leaves_active_document_and_remains_restorable(){
        let mut db=database();let mut doc=Document::default();doc.entries.push(entry("removed"));
        let tx=db.transaction().unwrap();write_document(&tx,&doc).unwrap();tx.commit().unwrap();
        assert!(load(&db).entries.is_empty());let mut saved=archived(&db,"fixture-id").unwrap().unwrap();assert_eq!(saved.payload.images[0].data,"aGVsbG8=");
        saved.status="waiting".into();saved.revision+=1;doc.entries=vec![saved];write_document(&db,&doc).unwrap();assert_eq!(load(&db).entries[0].revision,2);
        doc.entries[0].status="sent".into();write_document(&db,&doc).unwrap();assert!(load(&db).entries.is_empty());assert_eq!(archived(&db,"fixture-id").unwrap().unwrap().status,"sent");
    }
    #[test]
    fn deleting_session_retires_payload_atomically_and_rollback_preserves_queue(){
        let mut db=database();let mut doc=Document::default();doc.entries.push(entry("waiting"));write_document(&db,&doc).unwrap();
        {let tx=db.transaction().unwrap();retire_conversation(&tx,&[],"fixture-session").unwrap();assert!(load(&tx).entries.is_empty());}
        assert_eq!(load(&db).entries.len(),1);assert!(archived(&db,"fixture-id").unwrap().is_none());
        let tx=db.transaction().unwrap();retire_conversation(&tx,&[],"fixture-session").unwrap();tx.commit().unwrap();assert!(load(&db).entries.is_empty());assert_eq!(archived(&db,"fixture-id").unwrap().unwrap().status,"removed");
    }
}
