//! Fixed-channel signed updates. The renderer cannot supply URLs, keys or installers.
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use crate::storage::StorageError;

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Status {
    version: String, enabled: bool, stage: String, next_version: Option<String>,
    notes: Option<String>, downloaded: u64, total: Option<u64>, error: Option<String>,
}
impl Default for Status {
    fn default() -> Self { Self { version: env!("CARGO_PKG_VERSION").into(), enabled: cfg!(all(windows,not(debug_assertions))), stage:"idle".into(), next_version:None, notes:None, downloaded:0, total:None, error:None } }
}
#[derive(Default)]
struct Inner { status: Status, update: Option<Update>, bytes: Option<Vec<u8>> }
#[derive(Default)]
pub struct UpdateState(Mutex<Inner>);
fn failure(message: &str) -> StorageError { StorageError::new("app_update",message) }
fn mutate<T>(app: &tauri::AppHandle, work: impl FnOnce(&mut Inner)->Result<T,StorageError>) -> Result<T,StorageError> {
    let state=app.state::<UpdateState>();
    let mut inner=state.0.lock().map_err(|_|failure("更新状态无法读取，请重启应用。"))?;
    let result=work(&mut inner); let _=app.emit_to("main","azcine-update-changed",inner.status.clone()); result
}
fn available(inner: &Inner) -> Result<(),StorageError> {
    if !inner.status.enabled { return Err(failure("开发版不安装正式版更新，请使用正式安装版。")); }
    if matches!(inner.status.stage.as_str(),"checking"|"downloading"|"installing") { return Err(failure("已有更新操作正在进行。")); }
    Ok(())
}
#[tauri::command]
pub fn app_update_status(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Status,StorageError>{
    crate::main_window(&window)?; mutate(&app,|inner|{inner.status.version=app.package_info().version.to_string();Ok(inner.status.clone())})
}
#[tauri::command]
pub async fn app_update_check(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<(),StorageError>{
    crate::main_window(&window)?;
    mutate(&app,|inner|{available(inner)?;inner.status=Status{version:app.package_info().version.to_string(),stage:"checking".into(),..Status::default()};inner.update=None;inner.bytes=None;Ok(())})?;
    // We stop application-owned workers ourselves before install. Avoid the
    // plugin's pre-launch cleanup destroying the UI if Windows rejects launch.
    let result=match app.updater_builder().timeout(Duration::from_secs(30)).on_before_exit(||{}).build(){
        Ok(updater)=>updater.check().await,
        Err(error)=>Err(error),
    };
    mutate(&app,|inner|{
        match result {
            Ok(Some(mut update))=>{update.timeout=Some(Duration::from_secs(600));inner.status.stage="available".into();inner.status.next_version=Some(update.version.clone());inner.status.notes=update.body.clone();inner.update=Some(update);},
            Ok(None)=>inner.status.stage="current".into(),
            Err(_)=>{inner.status.stage="error".into();inner.status.error=Some("未能取得更新信息，请检查网络后重试。现有版本仍可使用。".into());},
        }
        Ok(())
    })
}
#[tauri::command]
pub async fn app_update_download(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<(),StorageError>{
    crate::main_window(&window)?;
    let update=mutate(&app,|inner|{available(inner)?;let update=inner.update.clone().ok_or_else(||failure("请先检查更新。"))?;inner.status.stage="downloading".into();inner.status.error=None;inner.status.downloaded=0;inner.status.total=None;inner.bytes=None;Ok(update)})?;
    let result=update.download(|length,total|{let _=mutate(&app,|inner|{inner.status.downloaded+=length as u64;inner.status.total=total;Ok(())});},||{}).await;
    mutate(&app,|inner|{match result{
        Ok(bytes)=>{inner.bytes=Some(bytes);inner.status.stage="ready".into();},
        Err(_)=>{inner.status.stage="available".into();inner.status.error=Some("下载或签名校验失败，未安装。请重试下载，现有数据与版本保持不变。".into());},
    }Ok(())})
}
#[tauri::command]
pub async fn app_update_install(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<(),StorageError>{
    crate::main_window(&window)?;
    let (update,bytes)=mutate(&app,|inner|{available(inner)?;let update=inner.update.clone().ok_or_else(||failure("请先检查更新。"))?;let bytes=inner.bytes.take().ok_or_else(||failure("请先完成下载和签名校验。"))?;inner.status.stage="installing".into();inner.status.error=None;Ok((update,bytes))})?;
    let handle=app.clone();
    tauri::async_runtime::spawn_blocking(move||{
        crate::task_panel_agent::shutdown(&handle);crate::dev_environment::shutdown(&handle);
        let result=crate::pi_commands::stop_for_update(&handle).map_err(|_|())
            .and_then(|_|update.install(&bytes).map_err(|_|()));
        // Successful Windows installation exits this process in the plugin.
        crate::pi_commands::resume_after_update_failure(&handle);
        mutate(&handle,|inner|{inner.bytes=Some(bytes);inner.status.stage="ready".into();inner.status.error=Some(if result.is_err(){"未能启动安装或停止运行任务。请核对任务后重试；已停止的 Agent 可重新连接。"}else{"安装未确认完成，请重新启动并检查版本。"}.into());Ok(())})
    }).await.map_err(|_|failure("安装任务意外结束，请重启应用后核对版本。"))?
}
