mod diagnostics;
mod storage;
mod native_paths;
mod projects;
#[path = "pi-jsonl.rs"] mod pi_jsonl;
#[path = "pi-model-config.rs"] mod pi_model_config;
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
            // Explicit debug-test roots only; release never accepts environment path overrides.
            #[cfg(debug_assertions)]
            {
                if let Some(test_config) = std::env::var_os("AZCINE_TEST_CONFIG_DIR") { config = test_config.into(); }
                if let Some(test_default) = std::env::var_os("AZCINE_TEST_DEFAULT_ROOT") { default_root = test_default.into(); }
            }
            *guard = Some(storage::Manager::new(config, default_root)?);
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
        .manage(pi_manager::PiManager::default())
        .manage(pi_commands::PiExit::default())
        .invoke_handler(tauri::generate_handler![check_desktop, storage_workspace, select_data_root, create_todo, complete_todo, pick_data_root, open_data_root, list_projects, save_project, project_request, pi_snapshot, pi_connect, pi_disconnect, pi_send, pi_stop, pi_sessions, pi_new_session, pi_switch_session, pi_name_session, pi_select_model, pi_save_model])
        .build(tauri::generate_context!())
        .expect("AZCine desktop failed to start")
        .run(pi_commands::on_run_event);
}
