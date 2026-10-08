use std::collections::HashMap;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{Emitter as _, Manager as _};
use crate::{main_window, with_storage};
use crate::news_http::FeedResponse;
use crate::news_store::RunWork;
use crate::news_types::*;
use crate::storage::StorageError;

#[derive(Default)]
pub struct NewsState {
    busy: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    // A failed disk write must not discard the fetched input while this app is still open.
    inputs: Mutex<HashMap<String, FeedResponse>>,
}
pub(crate) struct CollectionGuard(Arc<AtomicBool>);
impl NewsState{pub(crate) fn clear_inputs(&self){if let Ok(mut inputs)=self.inputs.lock(){inputs.clear();}}}
impl Drop for CollectionGuard { fn drop(&mut self) { self.0.store(false, Ordering::Release); } }
pub(crate) fn claim(app: &tauri::AppHandle) -> Result<CollectionGuard, StorageError> {
    let state = app.state::<NewsState>();
    if state.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err(StorageError::new("news_collection_busy", "已有一轮采集正在运行，请等待完成；没有重复启动。"));
    }
    state.cancel.store(false,Ordering::Release);
    Ok(CollectionGuard(state.busy.clone()))
}
async fn progress(app: &tauri::AppHandle) {
    let emitter = app.clone();
    // Emit while holding the short snapshot read lock so concurrent workers cannot reorder snapshots.
    let _ = with_storage(app.clone(), move |manager| {
        let snapshot = manager.store()?.news_snapshot()?;
        let _ = emitter.emit("news-progress", snapshot); Ok(())
    }).await;
}
async fn failed(app: &tauri::AppHandle, id: &str, status: RunStatus, message: &str) -> Result<(), StorageError> {
    let id = id.to_owned(); let message = message.to_owned();
    with_storage(app.clone(), move |manager| manager.store()?.news_run_failure(&id, status, &message)).await?;
    progress(app).await; Ok(())
}
async fn stage(app: &tauri::AppHandle, id: &str, status: RunStatus, retry: bool) -> Result<(), StorageError> {
    let id = id.to_owned();
    with_storage(app.clone(), move |manager| manager.store()?.news_run_stage(&id, status, retry)).await?;
    progress(app).await; Ok(())
}
async fn execute(app: tauri::AppHandle, work: RunWork, retry: Option<RetryStage>, proxy: Option<String>) -> Result<(), StorageError> {
    if stopped(&app) { return failed(&app,&work.id,RunStatus::Interrupted,"采集已取消或应用退出，未发布未完成结果；留存输入可重试。").await; }
    let root = with_storage(app.clone(), |manager| Ok(manager.store()?.root.clone())).await?;
    if retry == Some(RetryStage::Save) {
        let id = work.id.clone();
        let cached = with_storage(app.clone(), move |manager| manager.store()?.news_parsed(&id)).await;
        if let Err(error) = &cached { if error.code != "news_parsed_missing" { return failed(&app, &work.id, RunStatus::SaveFailed, &error.message).await; } }
        if let Ok((parsed, fetched_at)) = cached {
            stage(&app, &work.id, RunStatus::Saving, true).await?;
            if stopped(&app){return failed(&app,&work.id,RunStatus::Interrupted,"采集已取消，已解析输入保留，未报告成功。").await;}
            let save_work = work.clone();
            let control=app.clone();let result = with_storage(app.clone(), move |manager| {if stopped(&control){return Err(StorageError::new("news_capture_cancelled","采集已取消，已解析输入保留，未发布当前资料。"));}manager.store()?.save_news_materials(&save_work, &parsed, &fetched_at)}).await;
            if let Err(error) = result { return failed(&app, &work.id, if error.code=="news_capture_cancelled"{RunStatus::Interrupted}else{RunStatus::SaveFailed}, &error.message).await; }
            app.state::<NewsState>().inputs.lock().map_err(|_| invalid_data())?.remove(&work.id);
            progress(&app).await; let _=app.emit_to("main","news-editorial-changed",()); return Ok(());
        }
    }
    let response = if retry.is_some_and(|stage| matches!(stage, RetryStage::Parse | RetryStage::Save)) {
        let memory = app.state::<NewsState>().inputs.lock().map_err(|_| invalid_data())?.get(&work.id).cloned();
        if let Some(response) = memory { response } else {
            let root = root.clone(); let id = work.id.clone();
            match tauri::async_runtime::spawn_blocking(move || crate::news_capture::read(&root, &id)).await.map_err(|_| invalid_data())? {
                Ok(response) => response,
                Err(error) => return failed(&app, &work.id, RunStatus::SaveFailed, &format!("{} 没有重新联网抓取，请核对留存输入。", error.message)).await,
            }
        }
    } else {
        stage(&app, &work.id, RunStatus::Fetching, retry.is_some()).await?;
        let url = work.source.feed_url.clone();
        match tauri::async_runtime::spawn_blocking(move || crate::news_http::fetch_with_proxy(&url, proxy.as_deref())).await.map_err(|_| invalid_data())? {
            Ok(response) => response,
            Err(error) => return failed(&app, &work.id, RunStatus::FetchFailed, &error.message).await,
        }
    };
    app.state::<NewsState>().inputs.lock().map_err(|_| invalid_data())?.insert(work.id.clone(), response.clone());
    let capture_path = crate::news_capture::path(&root, &work.id)?;
    let has_capture = match capture_path.try_exists() {
        Ok(exists) => exists,
        Err(_) => return failed(&app, &work.id, RunStatus::SaveFailed, "无法检查订阅留存路径，输入暂存于当前应用内存；退出前请重试保存。").await,
    };
    if !has_capture {
        let input = response.clone(); let id = work.id.clone(); let capture_root = root.clone();
        if let Err(error) = tauri::async_runtime::spawn_blocking(move || crate::news_capture::write(&capture_root, &id, &input)).await.map_err(|_| invalid_data())? {
            return failed(&app, &work.id, RunStatus::SaveFailed, &format!("{} 输入暂存于当前应用内存，退出前请重试保存。", error.message)).await;
        }
    }
    // Durable input is now available for retries; do not accumulate feed bodies in memory.
    app.state::<NewsState>().inputs.lock().map_err(|_| invalid_data())?.remove(&work.id);
    if stopped(&app){return failed(&app,&work.id,RunStatus::Interrupted,"采集已取消，已取得的响应保留；未完成资料没有发布。").await;}
    stage(&app, &work.id, RunStatus::Parsing, retry.is_some()).await?;
    let parsed = match tauri::async_runtime::spawn_blocking(move || {
        crate::news_feed::parse(&response.body, &response.url).map(|parsed| (parsed, response.fetched_at))
    }).await.map_err(|_| invalid_data())? {
        Ok(parsed) => parsed,
        Err(error) => return failed(&app, &work.id, RunStatus::ParseFailed, &error.message).await,
    };
    let id = work.id.clone(); let cached = parsed.clone();
    if let Err(error) = with_storage(app.clone(), move |manager| manager.store()?.news_cache_parsed(&id, &cached.0, &cached.1)).await {
        return failed(&app, &work.id, RunStatus::SaveFailed, &error.message).await;
    }
    progress(&app).await;
    if stopped(&app){return failed(&app,&work.id,RunStatus::Interrupted,"采集已取消，已解析输入保留；未完成资料没有发布。").await;}
    let save_work = work.clone();
    let control=app.clone();if let Err(error) = with_storage(app.clone(), move |manager| {if stopped(&control){return Err(StorageError::new("news_capture_cancelled","采集已取消，已解析输入保留，未发布当前资料。"));}manager.store()?.save_news_materials(&save_work, &parsed.0, &parsed.1)}).await {
        return failed(&app, &work.id, if error.code=="news_capture_cancelled"{RunStatus::Interrupted}else{RunStatus::SaveFailed}, &error.message).await;
    }
    app.state::<NewsState>().inputs.lock().map_err(|_| invalid_data())?.remove(&work.id);
    progress(&app).await; let _=app.emit_to("main","news-editorial-changed",()); Ok(())
}

#[tauri::command]
pub async fn news_snapshot(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<NewsSnapshot, StorageError> {
    main_window(&window)?;let control=app.clone();with_storage(app,move|m|{let s=m.store()?;if !control.state::<NewsState>().busy.load(Ordering::Acquire){crate::news_store::recover_runs(&s.db,&s.root)?;}s.news_snapshot()}).await
}
#[tauri::command]
pub async fn news_materials(app: tauri::AppHandle, window: tauri::WebviewWindow, source_id: Option<String>, page: usize,range:Option<crate::news_scope::Range>) -> Result<MaterialPage, StorageError> {
    main_window(&window)?; with_storage(app, move |manager| {let s=manager.store()?;if let Some(range)=range{let scope=crate::news_scope::resolve(&s.db,&range,source_id,String::new(),false)?;Ok(s.materials_scoped(page,&scope,false,PAGE_SIZE)?.0)}else{s.news_materials(source_id.as_deref(),page)}}).await
}
#[tauri::command]
pub async fn save_news_source(app: tauri::AppHandle, window: tauri::WebviewWindow, input: SaveSource) -> Result<Source, StorageError> {
    main_window(&window)?;let emitter=app.clone();let result=with_storage(app, move |manager| manager.store()?.save_news_source(input)).await?;let _=emitter.emit_to("main","news-editorial-changed",());Ok(result)
}
#[tauri::command]
pub async fn news_source_request(app: tauri::AppHandle, window: tauri::WebviewWindow, request_id: String) -> Result<Option<Source>, StorageError> {
    main_window(&window)?; with_storage(app, move |manager| manager.store()?.news_source_request(&request_id)).await
}
#[tauri::command]
pub async fn preview_news_source(app: tauri::AppHandle, window: tauri::WebviewWindow, source: SourceConfig) -> Result<Preview, StorageError> {
    main_window(&window)?; validate_source(&source)?;
    let proxy = with_storage(app, |manager| Ok(manager.store()?.news_preferences()?.config.collection_proxy)).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let response = crate::news_http::fetch_with_proxy(&source.feed_url, proxy.as_deref())?;
        let parsed = crate::news_feed::parse(&response.body, &response.url)?;
        Ok(Preview { fetched_at: response.fetched_at, kind: parsed.kind, total: parsed.entries.len() + parsed.skipped,
            skipped: parsed.skipped, warning: parsed.warning, entries: parsed.entries.into_iter().take(20).collect() })
    }).await.map_err(|_| StorageError::new("news_preview_interrupted", "预览中断，表单保持不变，没有保存资料。"))?
}
#[tauri::command]
pub async fn collect_news(app: tauri::AppHandle, window: tauri::WebviewWindow, request_id: String, source_id: Option<String>,range:Option<crate::news_scope::Range>) -> Result<NewsSnapshot, StorageError> {
    main_window(&window)?; collect(app,request_id,source_id,false,range).await
}
pub async fn automatic_collect(app:tauri::AppHandle,source_id:Option<String>)->Result<NewsSnapshot,StorageError>{collect(app,crate::news_editorial_commands::uuid_value(),source_id,true,None).await}
async fn collect(app:tauri::AppHandle,request_id:String,source_id:Option<String>,automatic:bool,range:Option<crate::news_scope::Range>)->Result<NewsSnapshot,StorageError>{
    let _guard = claim(&app)?;
    // Freeze one saved network configuration for the whole collection batch.
    let (work, proxy) = with_storage(app.clone(), move |manager| {
        let store = manager.store()?;
        let proxy = store.news_preferences()?.config.collection_proxy;
        Ok((store.begin_news_batch_scoped(&request_id, source_id.as_deref(),&range.unwrap_or_default())?, proxy))
    }).await?;
    if let Some(work) = work {
        if automatic { let ids=work.iter().map(|w|w.source.id.clone()).collect::<Vec<_>>();with_storage(app.clone(),move|m|{for id in ids {m.store()?.mark_automatic_source(&id,&crate::news_store::now())?;}Ok(())}).await?; }
        progress(&app).await;
        let mut first_error = None;
        // One capture slot and one editorial slot: at most two news workers.
        for group in work.chunks(1) {
            let tasks = group.iter().cloned().map(|work| {
                let app = app.clone(); let id = work.id.clone(); let proxy = proxy.clone();
                (id, tauri::async_runtime::spawn(async move { execute(app, work, None, proxy).await }))
            }).collect::<Vec<_>>();
            for (id, task) in tasks {
                let result = task.await.map_err(|_| StorageError::new("news_worker_interrupted", "采集任务中断，未报告成功。已保存资料与输入保留，请重新读取。"));
                if let Err(error) = result.and_then(|value| value) {
                    let _ = failed(&app, &id, RunStatus::Interrupted, &error.message).await;
                    if first_error.is_none() { first_error = Some(error); }
                }
            }
        }
        if let Some(error) = first_error { return Err(error); }
    }
    with_storage(app, |manager| manager.store()?.news_snapshot()).await
}
fn stopped(app:&tauri::AppHandle)->bool{app.state::<NewsState>().cancel.load(Ordering::Acquire)||app.state::<crate::pi_commands::PiExit>().0.load(Ordering::Acquire)!=0}
#[tauri::command]pub async fn cancel_news_capture(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<(),StorageError>{main_window(&window)?;let control=app.clone();with_storage(app,move|_|{control.state::<NewsState>().cancel.store(true,Ordering::Release);Ok(())}).await}
#[tauri::command]
pub async fn retry_news_run(app: tauri::AppHandle, window: tauri::WebviewWindow, run_id: String) -> Result<NewsSnapshot, StorageError> {
    main_window(&window)?; crate::news_capture::path(std::path::Path::new("."), &run_id)?; let _guard = claim(&app)?;
    let id = run_id.clone();
    let (work, retry, proxy) = with_storage(app.clone(), move |manager| {
        let store = manager.store()?; Ok((store.news_run_work(&id)?, store.news_retry_stage(&id)?, store.news_preferences()?.config.collection_proxy))
    }).await?;
    if let Err(error) = execute(app.clone(), work, Some(retry), proxy).await {
        let _ = failed(&app, &run_id, RunStatus::Interrupted, &error.message).await;
        return Err(error);
    }
    with_storage(app, |manager| manager.store()?.news_snapshot()).await
}
#[tauri::command]
pub async fn open_news_url(window: tauri::WebviewWindow, url: String) -> Result<(), StorageError> {
    main_window(&window)?; let url = crate::news_http::public_url(&url)?.to_string();
    tauri::async_runtime::spawn_blocking(move || open_url(&url)).await.map_err(|_| StorageError::new("news_open_failed", "无法打开原文，请手动复制出处链接。"))?
}
#[cfg(windows)]
fn open_url(url: &str) -> Result<(), StorageError> {
    use windows::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    use windows::core::{PCWSTR, w};
    let url: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    let result = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(url.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    if result.0 as isize <= 32 { return Err(StorageError::new("news_open_failed", "Windows未接受打开原文的请求，请复制出处链接。")); }
    Ok(())
}
#[cfg(not(windows))]
fn open_url(_url: &str) -> Result<(), StorageError> { Err(StorageError::new("news_platform_unsupported", "原文打开目前仅接入Windows桌面版，请复制出处链接。")) }
