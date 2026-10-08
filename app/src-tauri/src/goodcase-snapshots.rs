//! Append-only GoodCase captures in the existing application metadata namespace.
//! Index and payload commit together; a failed capture never replaces history.
use crate::storage::StorageError;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const INDEX: &str = "goodcase_snapshot_index_v1";
const PREFIX: &str = "goodcase_snapshot_v1:";
fn failure() -> StorageError { StorageError::new("goodcase_snapshot_storage", "作品快照读取或保存失败，已有历史保留。") }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotEntry { id: String, captured_at: String, item_count: usize }

fn index(db: &rusqlite::Connection) -> Result<Vec<SnapshotEntry>, StorageError> {
    let value: Option<String> = db.query_row("SELECT value FROM app_meta WHERE key=?1", [INDEX], |r| r.get(0)).optional().map_err(|_| failure())?;
    value.map(|v| serde_json::from_str(&v).map_err(|_| failure())).unwrap_or(Ok(Vec::new()))
}

#[tauri::command]
pub async fn goodcase_snapshot_index(app: tauri::AppHandle, window: tauri::WebviewWindow, root: String) -> Result<Vec<SnapshotEntry>, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |m| {
        let store = m.store()?;
        if store.root.to_string_lossy() != root { return Err(failure()); }
        index(&store.db)
    }).await
}

#[tauri::command]
pub async fn goodcase_snapshot_read(app: tauri::AppHandle, window: tauri::WebviewWindow, root: String, id: String) -> Result<Value, StorageError> {
    crate::main_window(&window)?;
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) { return Err(failure()); }
    crate::with_storage(app, move |m| {
        let store = m.store()?;
        if store.root.to_string_lossy() != root { return Err(failure()); }
        let value: String = store.db.query_row("SELECT value FROM app_meta WHERE key=?1", [format!("{PREFIX}{id}")], |r| r.get(0)).map_err(|_| failure())?;
        serde_json::from_str(&value).map_err(|_| failure())
    }).await
}

#[tauri::command]
pub async fn goodcase_snapshot_save(app: tauri::AppHandle, window: tauri::WebviewWindow, root: String, snapshot: Value) -> Result<SnapshotEntry, StorageError> {
    crate::main_window(&window)?;
    let captured_at = snapshot.get("capturedAt").and_then(Value::as_str).filter(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok()).ok_or_else(failure)?.to_owned();
    for field in ["cases", "heat", "stability", "weekly", "models", "skills", "creators", "dailyCases"] {
        if !snapshot.get(field).is_some_and(Value::is_array) { return Err(failure()); }
    }
    for category in ["video", "image", "web", "hardware"] {
        for sort in ["heat", "stability", "latest"] {
            let page = &snapshot["rankings"][category][sort];
            if page["category"].as_str() != Some(category) || page["sort"].as_str() != Some(sort)
                || page["page"].as_u64() != Some(1) || !page["items"].is_array()
                || page["total"].as_u64().is_none() || !page["hasMore"].is_boolean() { return Err(failure()); }
        }
    }
    let item_count = snapshot["cases"].as_array().ok_or_else(failure)?.len();
    let body = serde_json::to_string(&snapshot).map_err(|_| failure())?;
    if body.len() > 64 * 1024 * 1024 { return Err(StorageError::new("goodcase_snapshot_size", "本次快照超过保存大小限制，已有历史保留。")); }
    crate::with_storage(app, move |m| {
        let store = m.store()?;
        if store.root.to_string_lossy() != root { return Err(failure()); }
        let tx = store.db.unchecked_transaction().map_err(|_| failure())?;
        let id: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0)).map_err(|_| failure())?;
        let entry = SnapshotEntry { id, captured_at, item_count };
        let mut entries = index(&tx)?;
        entries.insert(0, entry.clone());
        let encoded = serde_json::to_string(&entries).map_err(|_| failure())?;
        tx.execute("INSERT INTO app_meta(key,value) VALUES(?1,?2)", rusqlite::params![format!("{PREFIX}{}", entry.id), body]).map_err(|_| failure())?;
        tx.execute("INSERT INTO app_meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [INDEX, &encoded]).map_err(|_| failure())?;
        tx.commit().map_err(|_| failure())?;
        Ok(entry)
    }).await
}
