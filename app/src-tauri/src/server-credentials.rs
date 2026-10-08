use crate::storage::{StorageError, Store, valid_date};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashSet}, io::Write, path::PathBuf};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerRecord {
    id: String, name: String, provider: String, address: String, region: String,
    configuration: String, purpose: String, purchased: String, expires: String,
    price: String, currency: String, cycle: String, credential_id: String, notes: String,
    login_username: String, login_password: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CredentialRecord {
    id: String, name: String, kind: String, category: String, username: String,
    password: String, website: String, public_file: String, private_file: String,
    public_file_id: String, private_file_id: String, passphrase: String, notes: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Renewal {
    id: String, server_id: String, name: String, previous: String, next: String, date: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    revision: i64, servers: Vec<ServerRecord>, credentials: Vec<CredentialRecord>,
    renewals: Vec<Renewal>, read_reminders: BTreeMap<String, String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveInput { root: String, request_id: String, snapshot: Snapshot }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileInput { root: String, id: String, name: String, bytes: Vec<u8> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyFile { id: String, name: String }

fn error(message: &str) -> StorageError { StorageError::new("server_credentials", message) }
fn db_error(_: rusqlite::Error) -> StorageError { error("服务器和凭证数据操作失败，输入已保留，请重试。") }
fn file_error(_: std::io::Error) -> StorageError { error("密钥副本操作失败，请检查文件和数据目录；原件保留。") }
fn uuid(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() })
}
fn text_ok(value: &str, max: usize) -> bool { value.chars().count() <= max && !value.contains('\0') }
fn date_ok(value: &str) -> bool { value.is_empty() || valid_date(value) }
fn file_name_ok(name: &str) -> bool {
    !name.trim().is_empty() && text_ok(name, 180) && !name.ends_with('.') && !name.ends_with(' ')
        && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
}

impl Store {
    // Module-owned additive schema; do not reuse the independent task-panel/global versions.
    fn manager_schema(&mut self, root: &str) -> Result<(), StorageError> {
        if self.root.to_string_lossy() != root { return Err(error("数据目录已变化，请返回当前目录后重新打开模块。")); }
        let version: Option<String> = self.db.query_row("SELECT value FROM app_meta WHERE key='server_credentials_schema'", [], |r| r.get(0)).optional().map_err(db_error)?;
        match version.as_deref() {
            Some("1") => return Ok(()),
            Some(_) => return Err(error("服务器和凭证数据版本较新，请使用匹配版本的应用。")),
            None => (),
        }
        let tx = self.db.transaction().map_err(db_error)?;
        tx.execute_batch("CREATE TABLE server_credentials_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, content TEXT NOT NULL) STRICT;
            CREATE TABLE server_credentials_requests(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL) STRICT;
            CREATE TABLE server_credentials_files(id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL) STRICT;
            INSERT INTO app_meta(key,value) VALUES('server_credentials_schema','1');").map_err(db_error)?;
        let empty = serde_json::to_string(&Snapshot::default()).map_err(|_| error("无法初始化服务器和凭证记录。"))?;
        tx.execute("INSERT INTO server_credentials_state VALUES(1,0,?1)", [empty]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
    fn manager_snapshot(&self) -> Result<Snapshot, StorageError> {
        let (revision, content): (i64, String) = self.db.query_row("SELECT revision,content FROM server_credentials_state WHERE id=1", [], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_error)?;
        let snapshot: Snapshot = serde_json::from_str(&content).map_err(|_| error("服务器和凭证记录无法读取，未重置原数据。"))?;
        if snapshot.revision != revision { return Err(error("数据版本不一致，未覆盖原记录。")); }
        self.validate_snapshot(&snapshot).map_err(|_| error("服务器和凭证记录存在无效字段或关联，已停止读取；原数据保留，请检查记录或恢复备份。"))?;
        Ok(snapshot)
    }
    fn validate_snapshot(&self, value: &Snapshot) -> Result<(), StorageError> {
        if value.revision < 0 || value.servers.len() > 10000 || value.credentials.len() > 10000 || value.renewals.len() > 100000 { return Err(error("记录数量或版本超出支持范围。")); }
        let mut ids = HashSet::new();
        for row in &value.credentials {
            if !uuid(&row.id) || !ids.insert(row.id.as_str()) || row.name.trim().is_empty()
                || ![&row.name, &row.category, &row.username, &row.password, &row.website, &row.passphrase].iter().all(|v| text_ok(v, 1000)) || !text_ok(&row.notes, 20000)
                || !["password", "ssh"].contains(&row.kind.as_str()) || !["网站", "软件", "服务器", "其他"].contains(&row.category.as_str())
                || (row.kind == "password" && row.password.is_empty()) || (row.kind == "ssh" && row.public_file_id.is_empty() && row.private_file_id.is_empty()) {
                return Err(error("凭证名称、类型、密码或密钥文件无效，请检查输入。"));
            }
            for (id, name) in [(&row.public_file_id, &row.public_file), (&row.private_file_id, &row.private_file)] {
                if id.is_empty() && name.is_empty() { continue; }
                if !uuid(id) || !file_name_ok(name) { return Err(error("请重新选择密钥文件。")); }
                let stored: Option<String> = self.db.query_row("SELECT name FROM server_credentials_files WHERE id=?1", [id], |r| r.get(0)).optional().map_err(db_error)?;
                if stored.as_ref() != Some(name) { return Err(error("密钥文件尚未保存，请重新选择文件。")); }
            }
        }
        let mut servers = HashSet::new();
        for row in &value.servers {
            let amount = row.price.split('.').collect::<Vec<_>>();
            let price_ok = row.price.is_empty() || (amount.len() <= 2 && !amount[0].is_empty() && amount[0].len() <= 12 && amount.iter().all(|v| !v.is_empty() && v.bytes().all(|c| c.is_ascii_digit())) && (amount.len() == 1 || amount[1].len() <= 2));
            if !uuid(&row.id) || !servers.insert(row.id.as_str()) || row.name.trim().is_empty()
                || ![&row.name, &row.provider, &row.address, &row.region, &row.configuration, &row.purpose, &row.login_username, &row.login_password].iter().all(|v| text_ok(v, 1000)) || !text_ok(&row.notes, 20000)
                || !date_ok(&row.purchased) || !date_ok(&row.expires) || (!row.purchased.is_empty() && !row.expires.is_empty() && row.expires < row.purchased) || !price_ok
                || !["CNY", "USD", "HKD", "EUR"].contains(&row.currency.as_str()) || !["月付", "季付", "年付", "两年付", "三年付", "按量付费", "其他"].contains(&row.cycle.as_str())
                || (!row.credential_id.is_empty() && !ids.contains(row.credential_id.as_str())) {
                return Err(error("服务器资料、日期、金额或关联凭证无效，请检查输入。"));
            }
        }
        // Renewal history retains its server ID and name after that server is removed.
        let mut renewals = HashSet::new();
        for row in &value.renewals {
            if !uuid(&row.id) || !renewals.insert(row.id.as_str()) || !uuid(&row.server_id) || row.name.trim().is_empty() || !text_ok(&row.name, 1000)
                || !date_ok(&row.previous) || !valid_date(&row.next) || !valid_date(&row.date) || row.next <= row.previous || row.next <= row.date {
                return Err(error("续费记录无效，请检查新的到期日期。"));
            }
        }
        if value.read_reminders.len() > value.servers.len() || value.read_reminders.iter().any(|(id, date)| !servers.contains(id.as_str()) || !valid_date(date)) { return Err(error("提醒已读状态无效。")); }
        Ok(())
    }
    fn manager_save(&mut self, input: SaveInput) -> Result<Snapshot, StorageError> {
        self.manager_schema(&input.root)?;
        if !uuid(&input.request_id) { return Err(error("保存请求编号无效。")); }
        let serialized = serde_json::to_vec(&input.snapshot).map_err(|_| error("无法保存这些记录。"))?;
        if serialized.len() > 32 * 1024 * 1024 { return Err(error("记录内容过大，请缩短备注后重试。")); }
        let fingerprint = format!("{:x}", Sha256::digest(&serialized));
        let existing: Option<String> = self.db.query_row("SELECT fingerprint FROM server_credentials_requests WHERE id=?1", [&input.request_id], |r| r.get(0)).optional().map_err(db_error)?;
        if let Some(existing) = existing {
            if existing != fingerprint { return Err(error("保存请求内容已变化，未重复提交。")); }
            return self.manager_snapshot();
        }
        self.validate_snapshot(&input.snapshot)?;
        let mut next = input.snapshot;
        let previous = next.revision;
        next.revision = previous.checked_add(1).ok_or_else(|| error("记录版本超出范围。"))?;
        let content = serde_json::to_string(&next).map_err(|_| error("无法保存这些记录。"))?;
        let tx = self.db.transaction().map_err(db_error)?;
        if tx.execute("UPDATE server_credentials_state SET revision=?1,content=?2 WHERE id=1 AND revision=?3", params![next.revision, content, previous]).map_err(db_error)? != 1 {
            return Err(StorageError::new("manager_conflict", "记录版本已变化，草稿保留；请重新读取后核对再保存。"));
        }
        tx.execute("INSERT INTO server_credentials_requests VALUES(?1,?2)", params![input.request_id, fingerprint]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(next)
    }
    fn key_path(&self, id: &str, name: &str) -> Result<PathBuf, StorageError> {
        if !uuid(id) || !file_name_ok(name) { return Err(error("密钥文件编号或名称无效。")); }
        Ok(self.root.join("attachments/credentials").join(id).join(format!("key-{name}")))
    }
    fn checked_key(&self, id: &str, name: &str, size: i64, hash: &str) -> Result<PathBuf, StorageError> {
        let path = std::fs::canonicalize(self.key_path(id, name)?).map_err(file_error)?;
        let directory = std::fs::canonicalize(self.root.join("attachments/credentials")).map_err(file_error)?;
        if !directory.starts_with(&self.root) || !path.starts_with(&directory) || !path.is_file() || std::fs::metadata(&path).map_err(file_error)?.len() != size as u64 {
            return Err(error("密钥副本已移动或变化，未打开其他位置。"));
        }
        if size <= 0 || size > 1024 * 1024 || format!("{:x}", Sha256::digest(std::fs::read(&path).map_err(file_error)?)) != hash { return Err(error("密钥副本已变化，请核对原文件。")); }
        Ok(path)
    }
}

#[tauri::command]
pub async fn server_credentials_load(app: tauri::AppHandle, window: tauri::WebviewWindow, root: String) -> Result<Snapshot, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |m| { let s = m.store()?; s.manager_schema(&root)?; s.manager_snapshot() }).await
}
#[tauri::command]
pub async fn server_credentials_save(app: tauri::AppHandle, window: tauri::WebviewWindow, input: SaveInput) -> Result<Snapshot, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |m| m.store()?.manager_save(input)).await
}
#[tauri::command]
pub async fn server_credentials_receipt(app: tauri::AppHandle, window: tauri::WebviewWindow, root: String, request_id: String) -> Result<Option<Snapshot>, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |m| {
        let s = m.store()?; s.manager_schema(&root)?;
        let exists: bool = s.db.query_row("SELECT EXISTS(SELECT 1 FROM server_credentials_requests WHERE id=?1)", [request_id], |r| r.get(0)).map_err(db_error)?;
        if exists { Ok(Some(s.manager_snapshot()?)) } else { Ok(None) }
    }).await
}
#[tauri::command]
pub async fn server_credentials_add_file(app: tauri::AppHandle, window: tauri::WebviewWindow, input: FileInput) -> Result<KeyFile, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |m| {
        if input.bytes.is_empty() || input.bytes.len() > 1024 * 1024 { return Err(error("每份密钥文件大小需在 1 字节至 1 MB 之间。")); }
        let s = m.store()?; s.manager_schema(&input.root)?;
        let destination = s.key_path(&input.id, &input.name)?;
        let hash = format!("{:x}", Sha256::digest(&input.bytes));
        let old: Option<(String, i64, String)> = s.db.query_row("SELECT name,size,sha256 FROM server_credentials_files WHERE id=?1", [&input.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().map_err(db_error)?;
        if let Some((name, size, existing_hash)) = old {
            if name != input.name || size != input.bytes.len() as i64 || existing_hash != hash { return Err(error("文件编号已用于其他内容，未覆盖副本。")); }
            s.checked_key(&input.id, &name, size, &hash)?;
        } else {
            let directory = destination.parent().ok_or_else(|| error("密钥目录无效。"))?;
            // Validate each existing ancestor before creating descendants (including junctions).
            for part in [s.root.join("attachments"), s.root.join("attachments/credentials"), directory.to_path_buf()] {
                if part.exists() {
                    if !std::fs::canonicalize(&part).map_err(file_error)?.starts_with(&s.root) { return Err(error("密钥目录超出应用数据根，未保存。")); }
                } else { std::fs::create_dir(&part).map_err(file_error)?; }
            }
            if destination.try_exists().map_err(file_error)? {
                s.checked_key(&input.id, &input.name, input.bytes.len() as i64, &hash)?;
            } else {
                let mut pending = tempfile::Builder::new().prefix("key-pending-").tempfile_in(directory).map_err(file_error)?;
                pending.disable_cleanup(true);
                pending.write_all(&input.bytes).and_then(|_| pending.as_file().sync_all()).map_err(file_error)?;
                pending.persist_noclobber(&destination).map_err(|_| error("密钥副本未能保存，原件保留；请重试。"))?;
            }
            s.db.execute("INSERT INTO server_credentials_files VALUES(?1,?2,?3,?4)", params![input.id, input.name, input.bytes.len() as i64, hash]).map_err(db_error)?;
        }
        Ok(KeyFile { id: input.id, name: input.name })
    }).await
}
#[tauri::command]
pub async fn server_credentials_open_folder(app: tauri::AppHandle, window: tauri::WebviewWindow, root: String, id: String) -> Result<(), StorageError> {
    crate::main_window(&window)?;
    #[cfg(windows)] let owner = window.hwnd().map_err(|_| error("无法取得主窗口。"))?.0 as isize;
    #[cfg(not(windows))] let owner = 0;
    let folder = crate::with_storage(app, move |m| {
        let s = m.store()?; s.manager_schema(&root)?;
        let (name, size, hash): (String, i64, String) = s.db.query_row("SELECT name,size,sha256 FROM server_credentials_files WHERE id=?1", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().map_err(db_error)?.ok_or_else(|| error("没有找到已保存的密钥文件。"))?;
        let path = s.checked_key(&id, &name, size, &hash)?;
        Ok(path.parent().ok_or_else(|| error("密钥目录不存在。"))?.to_path_buf())
    }).await?;
    tauri::async_runtime::spawn_blocking(move || crate::native_paths::open_folder(owner, &folder)).await.map_err(|_| error("文件夹打开中断，请重试。"))?
}
