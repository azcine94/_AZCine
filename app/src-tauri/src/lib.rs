mod diagnostics;
mod storage;
mod native_paths;
mod projects;
#[path = "model-ranking.rs"] mod model_ranking;
#[path = "model-ranking-commands.rs"] mod model_ranking_commands;
use model_ranking_commands::*;
#[path = "news-types.rs"] mod news_types;
#[path = "news-scope.rs"] mod news_scope;
#[path = "news-reset.rs"] mod news_reset;
use news_reset::{news_reset_preview,news_reset_data};
#[path = "news-http.rs"] mod news_http;
#[path = "news-feed.rs"] mod news_feed;
#[path = "news-content.rs"] mod news_content;
#[path = "news-prompts.rs"] mod news_prompts;
#[path = "news-reader-types.rs"] mod news_reader_types;
#[cfg(test)] #[path = "news-reader-tests.rs"] mod news_reader_tests;
#[path = "news-reader-store.rs"] mod news_reader_store;
#[path = "news-pipeline.rs"] mod news_pipeline;
#[path = "news-reader-editions.rs"] mod news_reader_editions;
use news_reader_store::*;
use news_reader_editions::news_reader_period;
#[path = "news-reader-export.rs"] mod news_reader_export;
use news_reader_export::*;
#[path = "news-store.rs"] mod news_store;
#[path = "news-capture.rs"] mod news_capture;
#[path = "news-commands.rs"] mod news_commands;
use news_commands::*;
#[path = "news-editorial-types.rs"] mod news_editorial_types;
#[path = "news-editorial-store.rs"] mod news_editorial_store;
#[path = "news-editorial-commands.rs"] mod news_editorial_commands;
#[path = "news-ai.rs"] mod news_ai;
#[path = "news-processing.rs"] mod news_processing;
#[path = "news-schedule.rs"] mod news_schedule;
use news_editorial_commands::*;
#[path = "news-export.rs"] mod news_export;
use news_export::*;
mod ideas;
#[path = "pi-jsonl.rs"] mod pi_jsonl;
#[path = "pi-model-config.rs"] mod pi_model_config;
#[path = "pi-provider-config.rs"] mod pi_provider_config;
#[path = "pi-model-discovery.rs"] mod pi_model_discovery;
#[path = "pi-config-store.rs"] mod pi_config_store;
#[path = "pi-launch-plan.rs"] mod pi_launch_plan;
#[path = "pi-owned-process.rs"] mod pi_owned_process;
#[path = "pi-rpc.rs"] mod pi_rpc;
#[path = "pi-runtime.rs"] mod pi_runtime;
#[path = "pi-projection.rs"] mod pi_projection;
#[path = "pi-redactor.rs"] mod pi_redactor;
#[path = "pi-sessions.rs"] mod pi_sessions;
#[path = "pi-manager.rs"] mod pi_manager;
#[path = "pi-commands.rs"] mod pi_commands;
use pi_commands::*;

use tauri::Manager as _;
use storage::{CreateTodo, StorageError, StorageState, Todo, Workspace};

fn main_window(window: &tauri::WebviewWindow) -> Result<(), StorageError> {
    if window.label() != "main" { return Err(StorageError::new("window_denied", "此窗口不能修改业务数据。")); }
    Ok(())
}

async fn with_storage<T: Send + 'static>(app: tauri::AppHandle, work: impl FnOnce(&mut storage::Manager) -> Result<T, StorageError> + Send + 'static) -> Result<T, StorageError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<StorageState>();
        let mut guard = state.0.lock().map_err(|_| StorageError::new("storage_interrupted", "数据操作意外中断，请重启应用后重试。"))?;
        if guard.is_none() {
            let mut config = app.path().app_local_data_dir().map_err(|_| StorageError::new("config_path", "无法定位本机应用配置目录。"))?;
            let mut default_root = app.path().document_dir().map(|dir| dir.join("AZCineData")).unwrap_or_default();
            // Development and explicit validation roots only. Release never
            // accepts environment path overrides or initializes a default root.
            #[cfg(debug_assertions)]
            let mut initialize_dev_root = false;
            #[cfg(debug_assertions)]
            {
                if let Some(instance) = std::env::var_os("AZCINE_DEV_INSTANCE_DIR") {
                    let instance = std::path::PathBuf::from(instance);
                    if !instance.is_absolute() {
                        return Err(StorageError::new("config_path", "开发实例目录必须为绝对路径。"));
                    }
                    if std::env::var_os("AZCINE_DEV_USE_MAIN_DATA").as_deref() != Some(std::ffi::OsStr::new("1"))
                        || std::env::var_os("AZCINE_TEST_CONFIG_DIR").is_some()
                        || std::env::var_os("AZCINE_TEST_DEFAULT_ROOT").is_some() {
                        config = instance.join("config");
                        default_root = instance.join("data");
                        initialize_dev_root = true;
                    } else if !config.join("data-root.json").is_file() {
                        return Err(StorageError::new("main_data_required", "原 main 数据目录定位配置不存在，未创建分支空库。请先恢复原应用的数据目录配置。"));
                    }
                }
                // Existing explicitly isolated validation sessions retain their
                // manual first-selection behavior and supplied roots.
                if std::env::var_os("AZCINE_TEST_CONFIG_DIR").is_some()
                    || std::env::var_os("AZCINE_TEST_DEFAULT_ROOT").is_some() {
                    initialize_dev_root = false;
                }
                if let Some(test_config) = std::env::var_os("AZCINE_TEST_CONFIG_DIR") { config = test_config.into(); }
                if let Some(test_default) = std::env::var_os("AZCINE_TEST_DEFAULT_ROOT") { default_root = test_default.into(); }
            }
            let manager = storage::Manager::new(config, default_root.clone())?;
            #[cfg(debug_assertions)]
            let mut manager = manager;
            #[cfg(debug_assertions)]
            if initialize_dev_root && manager.workspace()?.root.is_none() {
                manager.select_root(&default_root)?;
            }
            *guard = Some(manager);
        }
        work(guard.as_mut().unwrap())
    }).await.map_err(|_| StorageError::new("storage_interrupted", "数据操作意外中断，未报告成功；请刷新后核对。"))?
}

#[tauri::command]
async fn storage_workspace(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Workspace, StorageError> {
    main_window(&window)?;
    with_storage(app, |manager| manager.workspace()).await
}
#[tauri::command]
async fn select_data_root(app: tauri::AppHandle, window: tauri::WebviewWindow, path: String) -> Result<Workspace, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.select_root(std::path::Path::new(&path))).await
}
#[tauri::command]
async fn create_todo(app: tauri::AppHandle, window: tauri::WebviewWindow, input: CreateTodo) -> Result<Todo, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.store()?.create_todo(input)).await
}
#[tauri::command]
async fn complete_todo(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, revision: i64, completed: bool) -> Result<Todo, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.store()?.complete_todo(&id, revision, completed)).await
}

#[tauri::command]
async fn list_projects(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Vec<projects::ProjectDocument>, StorageError> {
    main_window(&window)?;
    with_storage(app, |manager| manager.store()?.projects()).await
}
#[tauri::command]
async fn save_project(app: tauri::AppHandle, window: tauri::WebviewWindow, input: projects::SaveProject) -> Result<projects::ProjectDocument, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.store()?.save_project(input)).await
}
#[tauri::command]
async fn project_request(app: tauri::AppHandle, window: tauri::WebviewWindow, request_id: String) -> Result<Option<projects::ProjectDocument>, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.store()?.project_request(&request_id)).await
}

#[tauri::command]
async fn list_ideas(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Vec<ideas::Idea>, StorageError> {
    main_window(&window)?;
    with_storage(app, |manager| manager.store()?.ideas()).await
}
#[tauri::command]
async fn idea_request(app: tauri::AppHandle, window: tauri::WebviewWindow, request_id: String) -> Result<Option<ideas::Idea>, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.store()?.idea_request(&request_id)).await
}
#[tauri::command]
async fn save_idea(app: tauri::AppHandle, window: tauri::WebviewWindow, input: ideas::SaveIdea) -> Result<ideas::Idea, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.store()?.save_idea(input)).await
}
#[tauri::command]
async fn set_idea_deleted(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, revision: i64, deleted: bool) -> Result<ideas::Idea, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.store()?.set_idea_deleted(&id, revision, deleted)).await
}
#[tauri::command]
async fn convert_idea(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String, revision: i64) -> Result<ideas::Idea, StorageError> {
    main_window(&window)?;
    with_storage(app, move |manager| manager.store()?.convert_idea(&id, revision)).await
}

fn owner_handle(window: &tauri::WebviewWindow) -> Result<isize, StorageError> {
    main_window(window)?;
    #[cfg(windows)]
    { window.hwnd().map(|h| h.0 as isize).map_err(|_| StorageError::new("window_unavailable", "无法取得主窗口句柄，请重试。")) }
    #[cfg(not(windows))]
    { Ok(0) }
}
#[tauri::command]
async fn pick_data_root(window: tauri::WebviewWindow) -> Result<Option<String>, StorageError> {
    let owner = owner_handle(&window)?;
    let chosen = tauri::async_runtime::spawn_blocking(move || native_paths::choose_folder(owner)).await
        .map_err(|_| StorageError::new("native_worker_failed", "目录选择任务异常结束，请重试。"))??;
    chosen.map(|path| path.into_os_string().into_string().map_err(|_| StorageError::new("invalid_path", "目录名称含无法显示的字符，请选择其他目录。"))).transpose()
}
#[tauri::command]
async fn open_data_root(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), StorageError> {
    let owner = owner_handle(&window)?;
    let root = with_storage(app, |manager| Ok(manager.store()?.root.clone())).await?;
    tauri::async_runtime::spawn_blocking(move || native_paths::open_folder(owner, &root)).await
        .map_err(|_| StorageError::new("native_worker_failed", "目录打开任务异常结束，请重试。"))?
}

#[tauri::command]
async fn check_desktop(request_id: u32) -> Result<diagnostics::DesktopReport, diagnostics::ProbeError> {
    if request_id == 0 {
        return Err(diagnostics::ProbeError::invalid_request());
    }
    tauri::async_runtime::spawn_blocking(move || diagnostics::check(request_id))
        .await
        .map_err(|_| diagnostics::ProbeError::worker_failed())?
}

pub fn run() {
    tauri::Builder::default()
        .manage(StorageState::default())
        .manage(news_commands::NewsState::default())
        .manage(news_ai::AiControl::default())
        .manage(pi_manager::PiManager::default())
        .manage(pi_commands::PiExit::default())
        .invoke_handler(tauri::generate_handler![check_desktop, storage_workspace, select_data_root, create_todo, complete_todo, pick_data_root, open_data_root, list_projects, save_project, project_request, news_snapshot, news_materials, save_news_source, news_source_request, preview_news_source, collect_news, retry_news_run, open_news_url, cancel_news_capture, news_reader_snapshot, news_article_detail, news_reader_mark, news_reader_steps, news_reader_step_detail, news_reader_period, news_reader_image, news_reader_export, news_editorial_snapshot, news_pending_materials, news_dismiss_pending, news_reset_preview, news_reset_data, news_processing_snapshot, news_task_detail, save_news_preferences, news_preference_request, organize_news, retry_news_editorial, cancel_news_editorial, analyze_news_event, news_edition_text, export_news_edition, pi_snapshot, pi_connect, pi_disconnect, pi_send, pi_stop, pi_sessions, pi_new_session, pi_switch_session, pi_name_session, pi_select_model, pi_save_model, pi_providers, pi_save_provider, pi_fetch_models, model_ranking_workspace, model_ranking_update, model_ranking_attempt, model_ranking_open_source, list_ideas, idea_request, save_idea, set_idea_deleted, convert_idea])
        .setup(|app| { news_editorial_commands::start_automation(app.handle().clone()); Ok(()) })
        .build(tauri::generate_context!())
        .expect("AZCine desktop failed to start")
        .run(pi_commands::on_run_event);
}
