use crate::{agent_store::{Source,Providers},pi_manager::{PiError,SendInput},storage::StorageError};
use serde::Deserialize;
use serde_json::{Value,json};
use tauri::{Manager as _,Emitter as _};
use std::{path::Path,fs,io::{Read,Write}};
use sha2::{Digest,Sha256};
fn pi(e:StorageError)->PiError{PiError::new(e.code,&e.message)}
fn io(_:std::io::Error)->StorageError{StorageError::new("agent_attachment_io","附件副本读取或保存失败，原件和输入保留。")}
fn allowed(app:&tauri::AppHandle,window:&tauri::WebviewWindow)->Result<(),StorageError>{crate::main_window(window)?;if app.state::<crate::pi_commands::PiExit>().0.load(std::sync::atomic::Ordering::Acquire)!=0{return Err(StorageError::new("agent_exiting","应用正在退出，未接受新任务。"));}Ok(())}
fn changed(app:&tauri::AppHandle){let _=app.emit_to("main","azcine-agent-data-changed",());}
pub fn persist_settled(app:&tauri::AppHandle,key:&str,snapshot:Value){
    let app=app.clone();let key=key.to_owned();
    tauri::async_runtime::spawn(async move{let result=crate::with_storage(app.clone(),move|m|{let store=m.store()?;store.agent_remember(&key,&snapshot)}).await;
        match result{Ok(())=>changed(&app),Err(e)=>{let _=app.emit_to("main","azcine-agent-data-error",e);}}
    });
}
#[tauri::command]
pub async fn agent_bind(app:tauri::AppHandle,window:tauri::WebviewWindow,source:Source,fresh:bool)->Result<Value,StorageError>{allowed(&app,&window)?;crate::with_storage(app,move|m|m.store()?.agent_bind(source,fresh)).await}
#[tauri::command]
pub async fn agent_remember(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:String)->Result<(),StorageError>{allowed(&app,&window)?;let snapshot=app.state::<crate::agent_runtime::AgentRuntime>().manager(&conversation_key).map_err(|e|StorageError::new(e.code,&e.message))?.snapshot().map_err(|e|StorageError::new(e.code,&e.message))?;crate::with_storage(app,move|m|m.store()?.agent_remember(&conversation_key,&snapshot)).await}
#[tauri::command]
pub async fn agent_conversation(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:String)->Result<Value,StorageError>{allowed(&app,&window)?;crate::with_storage(app,move|m|m.store()?.agent_conversation(&conversation_key)).await}
#[tauri::command]
pub async fn agent_view_conversation(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:String,session_path:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window).map_err(pi)?;
    let key=conversation_key.clone();let requested=session_path.clone();
    let (root,binding)=crate::with_storage(app.clone(),move|m|{let store=m.store()?;store.agent_check_open(&key,requested.as_deref())?;Ok((store.root.clone(),store.agent_conversation(&key)?))}).await.map_err(pi)?;
    tauri::async_runtime::spawn_blocking(move||{
        let manager=app.state::<crate::agent_runtime::AgentRuntime>().manager(&conversation_key)?;
        let mut snapshot=manager.snapshot()?;
        if manager.resident()?||snapshot["projection"]["messages"].as_array().is_some_and(|messages|!messages.is_empty()){return Ok(snapshot);}
        let path=session_path.or_else(||binding["sessionPath"].as_str().map(str::to_owned)).or_else(||snapshot["state"]["sessionFile"].as_str().map(str::to_owned));
        let Some(path)=path else{return Ok(snapshot);};
        let paths=crate::pi_launch_plan::PiPaths::prepare(&root)?;
        let (session,messages)=crate::pi_sessions::read_message_view(&paths,Path::new(&path))?;
        if manager.resident()?{return manager.snapshot();}
        let count=messages.as_array().map(Vec::len).unwrap_or(0);
        let old_state=snapshot["state"].clone();
        let state=json!({"sessionId":session.id,"sessionFile":session.path,"sessionName":session.name,"model":old_state["model"],"thinkingLevel":old_state["thinkingLevel"].as_str().unwrap_or("off"),"isStreaming":false,"isCompacting":false,"pendingMessageCount":0,"messageCount":count});
        let generation=snapshot["generation"].as_u64().unwrap_or(0);let seq=snapshot["seq"].as_u64().unwrap_or(0);
        if !manager.remember_history_view(generation,seq,state,session.cwd.clone())?{return manager.snapshot();}
        snapshot=manager.snapshot()?;
        if snapshot["generation"].as_u64()!=Some(generation)||snapshot["seq"].as_u64()!=seq.checked_add(1){return Ok(snapshot);}
        snapshot["projection"]=json!({"messages":messages,"partial":null,"tools":[],"steering":[],"followUp":[],"activity":"idle","outcome":"none","notice":null});
        snapshot["cwd"]=json!(session.cwd);snapshot["historyReleased"]=json!(false);Ok(snapshot)
    }).await.map_err(|_|PiError::new("pi_worker_interrupted","会话读取中断，原记录与输入保留。"))?
}
#[tauri::command]
pub async fn agent_delete_conversation(app:tauri::AppHandle,window:tauri::WebviewWindow,target:crate::agent_runtime::ConversationDelete)->Result<Value,StorageError>{
    allowed(&app,&window)?;let handle=app.clone();
    let result=crate::with_storage(app.clone(),move|m|{let store=m.store()?;let root=store.root.clone();
        handle.state::<crate::agent_runtime::AgentRuntime>().delete_idle(&root,&target,|keys,path|store.agent_delete_conversation(keys,path,&target.session_id).map_err(pi)).map_err(|e|StorageError::new(e.code,&e.message))
    }).await?;changed(&app);let _=app.emit_to("main","azcine-pi-changed",json!({"deleted":true}));Ok(result)
}
#[tauri::command]
pub async fn agent_context_catalog(app:tauri::AppHandle,window:tauri::WebviewWindow,query:Option<String>)->Result<Value,StorageError>{
    allowed(&app,&window)?;let providers=app.state::<Providers>().inner().clone();
    crate::with_storage(app,move|m|{let tx=m.store()?.db.transaction().map_err(|_|StorageError::new("agent_catalog","对象目录读取失败。"))?;providers.catalog(&tx,query.as_deref().unwrap_or(""))}).await
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AgentSend{pub conversation_key:String,pub input:SendInput,pub objects:Vec<Source>,pub attachments:Vec<String>,#[serde(default)]pub source:Option<Source>}
#[tauri::command]
pub async fn agent_send(app:tauri::AppHandle,window:tauri::WebviewWindow,request:AgentSend)->Result<Value,PiError>{
    allowed(&app,&window).map_err(pi)?;
    let native_command=request.input.message.trim_start().starts_with('/');if native_command&&(!request.attachments.is_empty()||!request.objects.is_empty()){return Err(PiError::new("agent_command_context","原生命令请单独发送；附加对象与文件仍保留，请另发资料请求。"));}
    let manager=app.state::<crate::agent_runtime::AgentRuntime>().manager(&request.conversation_key)?;let snapshot=manager.snapshot()?;
    if snapshot["generation"]!=request.input.generation||snapshot["state"]["sessionId"]!=request.input.session_id{return Err(PiError::new("pi_stale_session","会话已变化，文字与附件保留。"));}
    let key=request.conversation_key.clone();let session=request.input.session_id.clone();let generation=request.input.generation;let count=snapshot["projection"]["messages"].as_array().map(Vec::len).unwrap_or(0);let objects=request.objects;let attachments=request.attachments;let source=request.source;
    let providers=app.state::<Providers>().inner().clone();
    let (input_id,_context)=crate::with_storage(app.clone(),move|m|{let store=m.store()?;verify_attachments(store,&attachments)?;store.agent_prepare_input_at(&key,&session,generation,count,&objects,&attachments,&providers,source)}).await.map_err(pi)?;
    let handle=app.clone();let conversation=request.conversation_key;let remember_key=conversation.clone();let business_input=input_id.clone();
    let result=tauri::async_runtime::spawn_blocking(move||handle.state::<crate::agent_runtime::AgentRuntime>().send_business(&conversation,request.input,crate::pi_commands::notify_for(&handle,&conversation),business_input)).await.map_err(|_|PiError::new("pi_worker_interrupted","发送中断，未自动重发。"))?;
    let receipt=result.as_ref().ok().and_then(|r|serde_json::to_value(r).ok());let status=if result.is_ok(){"accepted"}else{"unconfirmed"};
    let id=input_id.clone();crate::with_storage(app.clone(),move|m|m.store()?.agent_input_status(&id,status)).await.map_err(pi)?;
    result?;let snapshot=manager.snapshot()?;persist_settled(&app,&remember_key,snapshot);let mut receipt=receipt.ok_or_else(||PiError::new("pi_receipt_invalid","发送回执无效，未自动重发。"))?;receipt["inputId"]=json!(input_id);Ok(receipt)
}
#[tauri::command]
pub async fn agent_drafts(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Vec<Value>,StorageError>{allowed(&app,&window)?;crate::with_storage(app,|m|m.store()?.agent_drafts()).await}
#[tauri::command]
pub async fn agent_revalidate_draft(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String,revision:i64)->Result<Value,StorageError>{allowed(&app,&window)?;let providers=app.state::<Providers>().inner().clone();let result=crate::with_storage(app.clone(),move|m|m.store()?.agent_revalidate(&id,revision,&providers)).await;changed(&app);result}
#[tauri::command]
pub async fn agent_apply_draft(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String,revision:i64)->Result<Value,StorageError>{
    allowed(&app,&window)?;let providers=app.state::<Providers>().inner().clone();let result=crate::with_storage(app.clone(),move|m|m.store()?.agent_apply(&id,revision,&providers)).await;changed(&app);
    if let Ok(receipt)=&result{let mut modules=receipt["items"].as_array().into_iter().flatten().filter_map(|item|item["module"].as_str()).collect::<Vec<_>>();modules.sort();modules.dedup();let _=app.emit_to("main","azcine-business-data-changed",modules);}
    result
}
#[tauri::command]
pub async fn agent_discard_draft(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String,revision:i64)->Result<(),StorageError>{allowed(&app,&window)?;crate::with_storage(app.clone(),move|m|m.store()?.agent_discard(&id,revision)).await?;changed(&app);Ok(())}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct FileInput{pub name:String,pub mime_type:String,pub bytes:Vec<u8>}
fn attachment_limit(path:&Path)->usize{match path.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase().as_str(){"png"|"jpg"|"jpeg"|"webp"|"gif"=>crate::pi_image_limits::MAX_IMAGE_BYTES,_=>16*1024*1024}}
#[tauri::command]
pub async fn agent_attach_file(app:tauri::AppHandle,window:tauri::WebviewWindow,input:FileInput)->Result<Value,StorageError>{
    allowed(&app,&window)?;
    if input.bytes.len()>attachment_limit(Path::new(&input.name))||input.bytes.is_empty()||input.name.len()>500||input.name.contains(['/', '\\', '\0']){return Err(StorageError::new("agent_attachment_invalid","附件名称或大小无效：图片不超过50MB，其余文件不超过16MiB，文件不能为空。"));}
    let extension=Path::new(&input.name).extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase();
    if !["pdf","xlsx","xls","csv","tsv","txt","md","json","png","jpg","jpeg","webp","gif"].contains(&extension.as_str()){return Err(StorageError::new("agent_attachment_type","支持PDF、Excel、文本及图片；原件保留。"));}
    crate::with_storage(app,move|m|{let store=m.store()?;let id=crate::agent_store::id(store)?;let directory=store.root.join("attachments/agent");crate::pi_launch_plan::no_link(&store.root.join("attachments")).map_err(|e|StorageError::new(e.code,e.message))?;crate::pi_launch_plan::no_link(&directory).map_err(|e|StorageError::new(e.code,e.message))?;fs::create_dir_all(&directory).map_err(io)?;
        let relative=format!("attachments/agent/{id}.{extension}");let path=store.root.join(&relative);let hash=format!("{:x}",Sha256::digest(&input.bytes));let mut candidate=tempfile::NamedTempFile::new_in(&directory).map_err(io)?;candidate.write_all(&input.bytes).map_err(io)?;candidate.as_file().sync_all().map_err(io)?;candidate.persist_noclobber(&path).map_err(|e|io(e.error))?;
        store.db.execute("INSERT INTO agent_attachments(id,name,relative_path,hash,bytes,mime_type,created_at) VALUES(?,?,?,?,?,?,?)",rusqlite::params![id,input.name,relative,hash,input.bytes.len() as i64,input.mime_type,chrono::Utc::now().to_rfc3339()]).map_err(|_|StorageError::new("agent_attachment_record","副本已保存但记录未完整写入；未报告成功，原件和副本保留。"))?;
        Ok(json!({"id":id,"name":input.name,"relativePath":relative,"hash":hash,"bytes":input.bytes.len(),"mimeType":input.mime_type}))
    }).await
}
#[tauri::command]
pub async fn agent_attachment_preview(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String)->Result<Vec<u8>,StorageError>{
    allowed(&app,&window)?;crate::with_storage(app,move|m|{
        let store=m.store()?;verify_attachments(store,std::slice::from_ref(&id))?;
        let (relative,hash,size):(String,String,i64)=store.db.query_row("SELECT relative_path,hash,bytes FROM agent_attachments WHERE id=?",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|StorageError::new("agent_attachment_missing","附件记录不存在。"))?;
        if size>crate::pi_image_limits::MAX_IMAGE_BYTES as i64{return Err(StorageError::new("agent_preview_size","图片超过50MB预览大小限制。"));}
        let mut bytes=Vec::new();fs::File::open(store.root.join(relative)).map_err(io)?.take((crate::pi_image_limits::MAX_IMAGE_BYTES+1) as u64).read_to_end(&mut bytes).map_err(io)?;
        let raster=bytes.starts_with(b"\x89PNG\r\n\x1a\n")||bytes.starts_with(b"\xff\xd8\xff")||bytes.starts_with(b"GIF87a")||bytes.starts_with(b"GIF89a")||(bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP"));
        if !raster||bytes.len() as i64!=size||format!("{:x}",Sha256::digest(&bytes))!=hash{return Err(StorageError::new("agent_preview_invalid","图片副本格式无效或已变化。"));}Ok(bytes)
    }).await
}
pub(crate) fn verify_attachments(store:&crate::storage::Store,ids:&[String])->Result<(),StorageError>{for id in ids{let (relative,hash,size):(String,String,i64)=store.db.query_row("SELECT relative_path,hash,bytes FROM agent_attachments WHERE id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|StorageError::new("agent_attachment_missing","附件副本不存在，输入保留。"))?;
    let path=store.root.join(&relative);if !relative.starts_with("attachments/agent/")||Path::new(&relative).components().any(|p|!matches!(p,std::path::Component::Normal(_))){return Err(StorageError::new("agent_attachment_invalid","附件副本路径无效。"));}
    for ancestor in [store.root.join("attachments"),store.root.join("attachments/agent")]{crate::pi_launch_plan::no_link(&ancestor).map_err(|e|StorageError::new(e.code,e.message))?;}
    crate::pi_launch_plan::no_link(&path).map_err(|e|StorageError::new(e.code,e.message))?;let file=fs::File::open(&path).map_err(io)?;if !file.metadata().map_err(io)?.is_file()||!(1..=attachment_limit(&path) as i64).contains(&size){return Err(StorageError::new("agent_attachment_invalid","附件副本类型或大小无效。"));}let mut bytes=Vec::new();file.take((size+1) as u64).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len() as i64!=size||format!("{:x}",Sha256::digest(&bytes))!=hash{return Err(StorageError::new("agent_attachment_changed","附件副本已变化，未按旧来源发送；原件和输入保留。"));}
}Ok(())}
