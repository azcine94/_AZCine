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
fn notify(app:&tauri::AppHandle)->Notify{let app=app.clone();Arc::new(move||{let _=app.emit_to("main","azcine-pi-changed",());})}
async fn root(app:tauri::AppHandle)->Result<PathBuf,PiError>{crate::with_storage(app,|m|Ok(m.store()?.root.clone())).await.map_err(|e|PiError::new(e.code,&e.message))}
async fn work<T:Send+'static>(app:tauri::AppHandle,f:impl FnOnce(&PiManager,Notify)->Result<T,PiError>+Send+'static)->Result<T,PiError>{
    tauri::async_runtime::spawn_blocking(move||{let notice=notify(&app);f(&app.state::<PiManager>(),notice)}).await.map_err(|_|PiError::new("pi_worker_interrupted","Pi 操作意外中断，未报告成功；请核对会话，输入保留。"))?
}
#[tauri::command]
pub async fn pi_snapshot(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Value,PiError>{allowed(&app,&window)?;work(app,|m,_|m.snapshot()).await}
#[tauri::command]
pub async fn pi_connect(app:tauri::AppHandle,window:tauri::WebviewWindow,cwd:Option<String>,session_path:Option<String>)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位本应用运行资源。"))?;
    work(app,move|m,n|m.connect(&root,&resources,cwd.as_ref().map(std::path::Path::new),session_path.as_ref().map(std::path::Path::new),n)).await
}
#[tauri::command]
pub async fn pi_disconnect(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Value,PiError>{allowed(&app,&window)?;work(app,|m,n|m.disconnect(n)).await}
#[tauri::command]
pub async fn pi_send(app:tauri::AppHandle,window:tauri::WebviewWindow,input:SendInput)->Result<SendReceipt,PiError>{allowed(&app,&window)?;work(app,move|m,n|m.send(input,n)).await}
#[tauri::command]
pub async fn pi_stop(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String)->Result<Value,PiError>{allowed(&app,&window)?;work(app,move|m,n|m.stop(generation,&session_id,n)).await}
#[tauri::command]
pub async fn pi_sessions(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Value,PiError>{allowed(&app,&window)?;let root=root(app.clone()).await?;work(app,move|m,_|m.sessions(&root)).await}
#[tauri::command]
pub async fn pi_new_session(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String)->Result<Value,PiError>{allowed(&app,&window)?;work(app,move|m,n|m.session_action(generation,&session_id,"new_session",json!({}),n)).await}
#[tauri::command]
pub async fn pi_switch_session(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,path:String)->Result<Value,PiError>{allowed(&app,&window)?;work(app,move|m,n|m.session_action(generation,&session_id,"switch_session",json!({"sessionPath":path}),n)).await}
#[tauri::command]
pub async fn pi_name_session(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,name:String)->Result<Value,PiError>{allowed(&app,&window)?;work(app,move|m,n|m.session_action(generation,&session_id,"set_session_name",json!({"name":name}),n)).await}
#[tauri::command]
pub async fn pi_select_model(app:tauri::AppHandle,window:tauri::WebviewWindow,generation:u64,session_id:String,provider:String,id:String)->Result<Value,PiError>{allowed(&app,&window)?;work(app,move|m,n|m.session_action(generation,&session_id,"set_model",json!({"provider":provider,"modelId":id}),n)).await}
#[tauri::command]
pub async fn pi_save_model(app:tauri::AppHandle,window:tauri::WebviewWindow,input:ModelSettingsInput)->Result<Value,PiError>{allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位本应用运行资源。"))?;work(app,move|m,n|m.save_model(&root,&resources,input,n)).await}

#[tauri::command]
pub async fn pi_providers(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;work(app,move|m,_|m.providers(&root)).await
}
#[tauri::command]
pub async fn pi_save_provider(app:tauri::AppHandle,window:tauri::WebviewWindow,input:crate::pi_provider_config::ProviderSettingsInput)->Result<Value,PiError>{
    allowed(&app,&window)?;let root=root(app.clone()).await?;let resources=app.path().resource_dir().map_err(|_|PiError::new("pi_resources_path","无法定位本应用运行资源。"))?;
    work(app,move|m,n|m.save_provider(&root,&resources,input,n)).await
}
#[tauri::command]
pub async fn pi_fetch_models(app:tauri::AppHandle,window:tauri::WebviewWindow,mut input:crate::pi_model_discovery::ModelListInput)->Result<Value,PiError>{
    allowed(&app,&window)?;
    crate::pi_model_config::validate_connection(&input.base_url,&input.api,input.api_key.as_deref())?;
    let root=root(app.clone()).await?;
    if input.api_key.as_ref().is_none_or(|s|s.is_empty()) {
        let provider=input.provider.clone();let address=input.base_url.clone();
        input.api_key=work(app.clone(),move|m,_|m.model_list_key(&root,&provider,&address)).await?;
    }
    // The network GET owns no RPC lock and cannot send a prompt or execute native auth commands.
    work(app,move|_,_|Ok(crate::pi_model_discovery::fetch(input)?)).await
}

/// S03 closes the whole app, not a tray transition. S11 will add explicit tray
/// ownership; the final exit must continue to call this same owned cleanup.
fn begin_exit(app:&tauri::AppHandle){
    if app.state::<PiExit>().0.compare_exchange(0,1,Ordering::AcqRel,Ordering::Acquire).is_err(){return;}
    app.state::<PiManager>().set_exiting(true);
    app.state::<crate::news_ai::AiControl>().cancel.store(true,Ordering::Release);
    let app=app.clone();tauri::async_runtime::spawn_blocking(move||{
        let active=app.state::<crate::news_ai::AiControl>().active.lock().ok().and_then(|v|v.clone());
        if let Some(active)=active { if active.shutdown(std::time::Duration::ZERO).is_err(){app.state::<PiManager>().set_exiting(false);app.state::<PiExit>().0.store(0,Ordering::Release);return;} }
        match app.state::<PiManager>().disconnect(notify(&app)){
            Ok(_)=>{app.state::<PiExit>().0.store(2,Ordering::Release);app.exit(0);},
            Err(_)=>{app.state::<PiManager>().set_exiting(false);app.state::<PiExit>().0.store(0,Ordering::Release);if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.set_focus();}let _=app.emit_to("main","azcine-pi-changed",());},
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
