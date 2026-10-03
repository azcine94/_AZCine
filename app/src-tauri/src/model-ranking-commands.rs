use crate::{model_ranking::{Board, BoardState, UpdateSnapshot}, storage::StorageError};

#[tauri::command]
pub async fn model_ranking_workspace(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Vec<BoardState>, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, |manager| Ok(manager.store()?.ranking_boards())).await
}

#[tauri::command]
pub async fn model_ranking_update(app: tauri::AppHandle, window: tauri::WebviewWindow, input: UpdateSnapshot) -> Result<BoardState, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |manager| manager.store()?.update_ranking(input)).await
}

#[tauri::command]
pub async fn model_ranking_attempt(app: tauri::AppHandle, window: tauri::WebviewWindow, board: Board, expected_root: String) -> Result<BoardState, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |manager| {
        let store = manager.store()?;
        store.ensure_ranking_root(&expected_root)?;
        store.record_ranking_attempt(board)
    }).await
}

#[tauri::command]
pub async fn model_ranking_open_source(window: tauri::WebviewWindow, board: Board) -> Result<(), StorageError> {
    let owner = crate::owner_handle(&window)?;
    tauri::async_runtime::spawn_blocking(move || crate::native_paths::open_ranking_source(owner, board)).await
        .map_err(|_| StorageError::new("ranking_browser_worker_failed", "打开官方页面的任务异常结束，请重试。"))?
}
