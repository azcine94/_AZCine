//! Finite main-window IPC, no raw shell or generic RPC command forwarding.
use crate::{pi_manager::{PiManager,PiError,Notify,SendInput,SendReceipt},pi_model_config::ModelSettingsInput};
use serde_json::{Value,json};
use std::{path::PathBuf,sync::{Arc,atomic::{AtomicU8,Ordering}}};
use tauri::{Manager as _,Emitter as _};
#[derive(Default)]
pub struct PiExit(pub AtomicU8);
fn allowed(app:&tauri::AppHandle,window:&tauri::WebviewWindow)->Result<(),PiError>{
    crate::main_window(window).map_err(|e|PiError::new(e.code,&e.message))?;
    if app.state::<PiExit>().0.load(Ordering::Acquire)!=0{return Err(PiError::new("pi_app_exiting","应用正在退出，未接受新操作；输入保留。"));}Ok(())
}
pub(crate) fn notify_for(app:&tauri::AppHandle,key:&str)->Notify{let app=app.clone();let key=key.to_owned();let previous=std::sync::Mutex::new(None::<Value>);Arc::new(move||{
    if app.state::<PiExit>().0.load(Ordering::Acquire)!=0{let _=app.emit_to("main","azcine-pi-changed",json!({"conversationKey":key}));return;}
    let runtime=app.state::<crate::agent_runtime::AgentRuntime>();
    let mut metadata=true;
    if let Ok(manager)=runtime.manager(&key){if let Ok(summary)=manager.summary(){
        let signature=json!([summary["generation"],summary["sessionId"],summary["sessionFile"],summary["name"],summary["connection"],summary["active"],summary["waiting"],summary["outcome"]]);
        if let Ok(mut before)=previous.lock(){metadata=before.as_ref()!=Some(&signature);*before=Some(signature);}
        let _=app.emit_to("main","azcine-pi-changed",json!({"conversationKey":key,"metadata":metadata}));
        if summary["connection"]=="ready"&&summary["active"]==false&&matches!(summary["outcome"].as_str(),Some("success"|"none")){
            if let Ok(snapshot)=manager.snapshot(){crate::agent_commands::persist_settled(&app,&key,snapshot);}
        }
        return;
    }}
    let _=app.emit_to("main","azcine-pi-changed",json!({"conversationKey":key,"metadata":metadata}));
})}
fn notify(app:&tauri::AppHandle)->Notify{notify_for(app,"default")}
async fn root(app:tauri::AppHandle)->Result<PathBuf,PiError>{crate::with_storage(app,|m|Ok(m.store()?.root.clone())).await.map_err(|e|PiError::new(e.code,&e.message))}
async fn work<T:Send+'static>(app:tauri::AppHandle,conversation_key:Option<String>,f:impl FnOnce(&PiManager,Notify)->Result<T,PiError>+Send+'static)->Result<T,PiError>{
    tauri::async_runtime::spawn_blocking(move||{let key=conversation_key.as_deref().unwrap_or("default");let notice=notify_for(&app,key);let manager=app.state::<crate::agent_runtime::AgentRuntime>().manager(key)?;f(&manager,notice)}).await.map_err(|_|PiError::new("pi_worker_interrupted","Pi 操作意外中断，未报告成功；请核对会话，输入保留。"))?
}
#[tauri::command]
pub async fn pi_snapshot(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;work(app,conversation_key,|m,_|m.snapshot()).await}
#[tauri::command]
pub async fn pi_connect(app:tauri::AppHandle,window:tauri::WebviewWindow,cwd:Option<String>,session_path:Option<String>,reconnect:Option<bool>,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let check_key=conversation_key.clone().unwrap_or_else(||"default".into());let check_path=session_path.clone();
    let root=crate::with_storage(app.clone(),move|m|{let store=m.store()?;store.agent_check_open(&check_key,check_path.as_deref())?;Ok(store.root.clone())}).await.map_err(|e|PiError::new(e.code,&e.message))?;
    let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位本应用运行资源。"))?;
    tauri::async_runtime::spawn_blocking(move||{let key=conversation_key.as_deref().unwrap_or("default");let manager=app.state::<crate::agent_runtime::AgentRuntime>().manager(key)?;let weak=Arc::downgrade(&manager);let handle=app.clone();let owner_key=key.to_owned();let owner_root=root.clone();manager.business_environment(Arc::new(move|generation,paths,runtime|handle.state::<crate::agent_mcp::BusinessMcp>().conversation(&handle,weak.clone(),generation,owner_key.clone(),owner_root.clone(),paths,runtime)))?;app.state::<crate::agent_runtime::AgentRuntime>().connect(key,&root,&resources,cwd.as_ref().map(std::path::Path::new),session_path.as_ref().map(std::path::Path::new),reconnect.unwrap_or(false),notify_for(&app,key))}).await.map_err(|_|PiError::new("pi_worker_interrupted","会话连接中断，输入保留。"))?
}
#[tauri::command]
pub async fn pi_disconnect(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;work(app,conversation_key,|m,n|m.disconnect(n)).await}
#[tauri::command]
pub async fn pi_send(app:tauri::AppHandle,window:tauri::WebviewWindow,input:SendInput,conversation_key:Option<String>)->Result<SendReceipt,PiError>{allowed(&app,&window)?;tauri::async_runtime::spawn_blocking(move||{let key=conversation_key.as_deref().unwrap_or("default");app.state::<crate::agent_runtime::AgentRuntime>().send(key,input,notify_for(&app,key))}).await.map_err(|_|PiError::new("pi_worker_interrupted","发送中断，输入保留。"))?}
#[tauri::command]
pub async fn pi_stop(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;work(app,conversation_key,move|m,n|m.stop(generation,&session_id,n)).await}
#[tauri::command]
pub async fn pi_sessions(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;let mut sessions=work(app.clone(),conversation_key,move|m,_|m.sessions(&root)).await?;
    let deleted=crate::with_storage(app,|m|m.store()?.agent_deleted_paths()).await.map_err(|e|PiError::new(e.code,&e.message))?;
    if let Some(rows)=sessions["sessions"].as_array_mut(){rows.retain(|row|!row["path"].as_str().is_some_and(|path|deleted.iter().any(|hidden|crate::agent_store::session_path_key(path)==*hidden)));}Ok(sessions)
}
#[tauri::command]
pub async fn pi_resources(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位本应用运行资源。"))?;
    work(app,conversation_key,move|m,_|m.resources(&root,&resources)).await
}
#[tauri::command]
pub async fn pi_save_resource(app:tauri::AppHandle,window:tauri::WebviewWindow,input:crate::pi_resources::ResourceUpdate,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位本应用运行资源。"))?;
    work(app,conversation_key,move|m,_|m.save_resource(&root,&resources,input)).await
}
#[tauri::command]
pub async fn pi_new_session(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;work(app,conversation_key,move|m,n|m.session_action(generation,&session_id,"new_session",json!({}),n)).await}
#[tauri::command]
pub async fn pi_switch_session(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,path:String,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let check_key=conversation_key.clone().unwrap_or_else(||"default".into());let check_path=path.clone();
    crate::with_storage(app.clone(),move|m|m.store()?.agent_check_open(&check_key,Some(&check_path))).await.map_err(|e|PiError::new(e.code,&e.message))?;
    work(app,conversation_key,move|m,n|m.session_action(generation,&session_id,"switch_session",json!({"sessionPath":path}),n)).await
}
#[tauri::command]
pub async fn pi_name_session(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,name:String,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;work(app,conversation_key,move|m,n|m.session_action(generation,&session_id,"set_session_name",json!({"name":name}),n)).await}
#[tauri::command]
pub async fn pi_select_model(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,provider:String,id:String,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位运行资源。"))?;
    tauri::async_runtime::spawn_blocking(move||{let key=conversation_key.as_deref().unwrap_or("default");let runtime=app.state::<crate::agent_runtime::AgentRuntime>();let manager=runtime.manager(key)?;let before=manager.summary()?;
        if before["generation"]!=generation||before["sessionId"]!=session_id{return Err(PiError::new("pi_stale_session","会话已变化，请重新选择模型。"));}
        if before["active"]==true||before["waiting"]==true{return Err(PiError::new("pi_busy","请等待当前任务结束后切换模型。"));}
        let catalog=manager.model_catalog(&root,&resources)?;if !catalog.as_array().is_some_and(|rows|rows.iter().any(|m|m["provider"]==provider&&m["id"]==id)){return Err(PiError::new("pi_model_unavailable","模型已移除或不可用，请重新选择。"));}
        let snapshot=runtime.connect(key,&root,&resources,None,None,true,notify_for(&app,key))?;
        manager.session_action(snapshot["generation"].as_u64().ok_or_else(||PiError::new("pi_state_invalid","会话状态不完整。"))?,snapshot["state"]["sessionId"].as_str().ok_or_else(||PiError::new("pi_state_invalid","会话状态不完整。"))?,"set_model",json!({"provider":provider,"modelId":id}),notify_for(&app,key))
    }).await.map_err(|_|PiError::new("pi_worker_interrupted","模型切换中断，输入保留。"))?}
#[tauri::command]
pub async fn pi_save_model(app:tauri::AppHandle,window:tauri::WebviewWindow,input:ModelSettingsInput,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位本应用运行资源。"))?;work(app,conversation_key,move|m,n|m.save_model(&root,&resources,input,n)).await}

#[tauri::command]
pub async fn pi_providers(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位运行资源。"))?;work(app,conversation_key,move|m,_|m.providers(&root,&resources)).await
}
#[tauri::command]
pub async fn pi_save_provider(app:tauri::AppHandle,window:tauri::WebviewWindow,input:crate::pi_provider_config::ProviderSettingsInput,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位本应用运行资源。"))?;
    work(app,conversation_key,move|m,n|m.save_provider(&root,&resources,input,n)).await
}
#[tauri::command]
pub async fn pi_fetch_models(app:tauri::AppHandle,window:tauri::WebviewWindow,mut input:crate::pi_model_discovery::ModelListInput,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;
    crate::pi_model_config::validate_connection(&input.base_url,&input.api,input.api_key.as_deref())?;
    let root=root(app.clone()).await?;
    if input.api_key.as_ref().is_none_or(|s|s.is_empty()) {
        let provider=input.provider.clone();let address=input.base_url.clone();let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位运行资源。"))?;
        input.api_key=work(app.clone(),conversation_key.clone(),move|m,_|m.model_list_key(&root,&resources,&provider,&address)).await?;
    }
    // The network GET owns no RPC lock and cannot send a prompt or execute native auth commands.
    work(app,conversation_key,move|_,_|Ok(crate::pi_model_discovery::fetch(input)?)).await
}

#[tauri::command]
pub async fn pi_runtime_summary(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Value,PiError>{allowed(&app,&window)?;let root=root(app.clone()).await?;tauri::async_runtime::spawn_blocking(move||{let runtime=app.state::<crate::agent_runtime::AgentRuntime>();runtime.load(&root)?;runtime.summary()}).await.map_err(|_|PiError::new("pi_worker_interrupted","调度状态读取中断。"))?}
#[tauri::command]
pub async fn pi_save_runtime(app:tauri::AppHandle,window:tauri::WebviewWindow,reply_limit:usize,revision:u64)->Result<Value,PiError>{allowed(&app,&window)?;let root=root(app.clone()).await?;tauri::async_runtime::spawn_blocking(move||app.state::<crate::agent_runtime::AgentRuntime>().save_limit(&root,reply_limit,revision)).await.map_err(|_|PiError::new("pi_worker_interrupted","并行设置保存中断。"))?}
#[tauri::command]
pub async fn pi_respond_ui(app:tauri::AppHandle,window:tauri::WebviewWindow,input:crate::pi_extension_ui::UiResponse,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;work(app,conversation_key,move|m,n|m.respond_ui(input,n)).await}
#[tauri::command]
pub async fn pi_thinking(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,level:String,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;work(app,conversation_key,move|m,n|m.session_action(generation,&session_id,"set_thinking_level",json!({"level":level}),n)).await}
#[tauri::command]
pub async fn pi_stats(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,conversation_key:Option<String>)->Result<Value,PiError>{allowed(&app,&window)?;work(app,conversation_key,move|m,_|m.stats(generation,&session_id)).await}

pub fn start_reaper(app:tauri::AppHandle){let _=std::thread::Builder::new().name("azcine-agent-idle".into()).spawn(move||{loop{let _=app.state::<crate::agent_runtime::AgentRuntime>().tick(|key|notify_for(&app,key));if app.state::<PiExit>().0.load(Ordering::Acquire)==2{break;}std::thread::sleep(std::time::Duration::from_secs(1));}});}

/// S03 closes the whole app, not a tray transition. S11 will add explicit tray
/// ownership; the final exit must continue to call this same owned cleanup.
pub fn stop_for_update(app:&tauri::AppHandle)->Result<(),PiError>{
    app.state::<crate::agent_runtime::AgentRuntime>().set_exiting(true);
    app.state::<crate::news_ai::AiControl>().cancel.store(true,Ordering::Release);
    let active=app.state::<crate::news_ai::AiControl>().active.lock().map(|v|v.iter().filter_map(std::sync::Weak::upgrade).collect::<Vec<_>>()).unwrap_or_default();
    for active in active{active.shutdown(std::time::Duration::ZERO)?;}
    crate::agent_jobs::shutdown(app).map_err(|e|PiError::new(e.code,&e.message))?;
    app.state::<crate::agent_runtime::AgentRuntime>().shutdown(notify(app))?;
    app.state::<crate::agent_mcp::BusinessMcp>().shutdown();
    Ok(())
}
pub fn resume_after_update_failure(app:&tauri::AppHandle){
    app.state::<crate::agent_runtime::AgentRuntime>().set_exiting(false);
    app.state::<crate::agent_jobs::BackgroundSlots>().set_exiting(false);
    let _=app.emit_to("main","azcine-pi-changed",());
}
fn begin_exit(app:&tauri::AppHandle){
    if app.state::<PiExit>().0.compare_exchange(0,1,Ordering::AcqRel,Ordering::Acquire).is_err(){return;}
    app.state::<crate::agent_runtime::AgentRuntime>().set_exiting(true);
    app.state::<crate::news_ai::AiControl>().cancel.store(true,Ordering::Release);
    let app=app.clone();tauri::async_runtime::spawn_blocking(move||{
        let active=app.state::<crate::news_ai::AiControl>().active.lock().map(|v|v.iter().filter_map(std::sync::Weak::upgrade).collect::<Vec<_>>()).unwrap_or_default();
        for active in active { if active.shutdown(std::time::Duration::ZERO).is_err(){app.state::<crate::agent_runtime::AgentRuntime>().set_exiting(false);app.state::<crate::agent_jobs::BackgroundSlots>().set_exiting(false);app.state::<PiExit>().0.store(0,Ordering::Release);return;} }
        let result=crate::agent_jobs::shutdown(&app).map_err(|e|PiError::new(e.code,&e.message)).and_then(|_|app.state::<crate::agent_runtime::AgentRuntime>().shutdown(notify(&app)));
        match result{
            Ok(())=>{app.state::<crate::agent_mcp::BusinessMcp>().shutdown();app.state::<PiExit>().0.store(2,Ordering::Release);app.exit(0);},
            Err(_)=>{app.state::<crate::agent_runtime::AgentRuntime>().set_exiting(false);app.state::<crate::agent_jobs::BackgroundSlots>().set_exiting(false);app.state::<PiExit>().0.store(0,Ordering::Release);if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.set_focus();}let _=app.emit_to("main","azcine-pi-changed",());},
        }
    });
}
pub fn on_run_event(app:&tauri::AppHandle,event:tauri::RunEvent){
    match event {
        tauri::RunEvent::WindowEvent{label,event:tauri::WindowEvent::CloseRequested{api,..},..} if label=="main"=>{
            if app.state::<PiExit>().0.load(Ordering::Acquire)!=2{api.prevent_close();begin_exit(app);}
        },
        tauri::RunEvent::ExitRequested{api,..}=>{
            if app.state::<PiExit>().0.load(Ordering::Acquire)!=2{api.prevent_exit();begin_exit(app);}
        },
        _=>{},
    }
}

#[tauri::command]
pub async fn pi_model_catalog(app:tauri::AppHandle,window:tauri::WebviewWindow,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位运行资源。"))?;
    work(app,conversation_key,move|m,_|m.model_catalog(&root,&resources)).await
}
#[tauri::command]
pub async fn pi_delete_provider(app:tauri::AppHandle,window:tauri::WebviewWindow,input:crate::pi_provider_config::ProviderDeleteInput,conversation_key:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;
    let check=input.clone();let root=crate::with_storage(app.clone(),move|m|{let s=m.store()?;if crate::agent_queue::references(s,&check.provider,check.model_id.as_deref())?{return Err(crate::storage::StorageError::new("pi_model_referenced","待发送消息仍引用此模型，请先处理或移除相关队列消息。"));}let prefs=s.news_preferences()?.config;
        if prefs.model.iter().chain(prefs.pipeline.models.values()).any(|model|model.provider==check.provider&&check.model_id.as_ref().is_none_or(|id|id==&model.id)){return Err(crate::storage::StorageError::new("pi_model_referenced","资讯默认模型或处理阶段仍在使用此配置，请先在资讯设置中更换模型。"));}Ok(s.root.clone())
    }).await.map_err(|e|PiError::new(e.code,&e.message))?;
    let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位运行资源。"))?;
    work(app,conversation_key,move|m,n|m.delete_provider(&root,&resources,input,n)).await
}
