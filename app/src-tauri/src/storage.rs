use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions as FileOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const APPLICATION_ID: i64 = 0x415A4349;
const SCHEMA_VERSION: i64 = 3;
const DATABASE: &str = "db/azcine.sqlite3";
// An atomically created directory claims an unfinished first initialization before
// any lock/database file is created. Failed candidates stay here; never rebuild
// an arbitrary database found at the final DATABASE path.
const INITIALIZING: &str = ".azcine-initializing-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageError {
    pub code: &'static str,
    pub message: String,
}
impl StorageError {
    pub fn new(code: &'static str, message: &str) -> Self { Self { code, message: message.into() } }
}
fn io_error(_: std::io::Error) -> StorageError {
    StorageError::new("storage_io", "无法读写数据目录，请检查路径、磁盘空间与写入权限。原记录未被替换，输入已保留。")
}
fn db_error(_: rusqlite::Error) -> StorageError {
    StorageError::new("storage_database", "数据库操作失败，请检查磁盘空间、目录权限或占用情况。未报告保存成功，输入已保留。")
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub due_date: Option<String>,
    pub project_id: Option<String>,
    pub completed: bool,
    pub revision: i64,
    pub created_at: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTodo {
    pub id: String,
    pub title: String,
    pub due_date: Option<String>,
    pub project_id: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub root: Option<String>,
    pub default_root: String,
    pub todos: Vec<Todo>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Locator { version: u32, root: PathBuf, identity: String }

pub struct Store {
    pub root: PathBuf,
    pub db: Connection,
    identity: String,
    _lock: File,
}
pub struct Manager {
    locator: PathBuf,
    default_root: PathBuf,
    store: Option<Store>,
    // Lock the locating config too: two application instances cannot select different roots.
    _instance_lock: File,
}
#[derive(Default)]
pub struct StorageState(pub Mutex<Option<Manager>>);

fn lock_file(path: &Path) -> Result<File, StorageError> {
    let mut options = FileOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    { use std::os::windows::fs::OpenOptionsExt; options.share_mode(0x00000001 | 0x00000002); }
    let file = options.open(path).map_err(io_error)?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(std::fs::TryLockError::WouldBlock) => Err(StorageError::new("root_busy", "此数据目录已由另一个 AZCine 窗口使用，请先退出另一个窗口再重试。")),
        Err(std::fs::TryLockError::Error(error)) => Err(io_error(error)),
    }
}
fn configure_journal(db: &Connection) -> Result<(), StorageError> {
    if db.is_readonly("main").map_err(db_error)? { return Err(StorageError::new("storage_readonly", "数据库只能读取，未启用保存。请检查文件与目录权限。")); }
    let mode: String = db.pragma_update_and_check(Some("main"), "journal_mode", "PERSIST", |r| r.get(0)).map_err(db_error)?;
    if !mode.eq_ignore_ascii_case("persist") { return Err(StorageError::new("journal_mode_unavailable", "数据库日志模式未能切换，未启用保存。请关闭其他数据库使用者后重试。")); }
    db.pragma_update(Some("main"), "synchronous", "FULL").map_err(db_error)
}

impl Manager {
    pub fn new(config_dir: PathBuf, default_root: PathBuf) -> Result<Self, StorageError> {
        fs::create_dir_all(&config_dir).map_err(io_error)?;
        let lock = lock_file(&config_dir.join("instance.lock"))?;
        Ok(Self { locator: config_dir.join("data-root.json"), default_root, store: None, _instance_lock: lock })
    }
    pub fn workspace(&mut self) -> Result<Workspace, StorageError> {
        if self.store.is_none() && self.locator.try_exists().map_err(io_error)? {
            let locator: Locator = serde_json::from_slice(&fs::read(&self.locator).map_err(io_error)?)
                .map_err(|_| StorageError::new("locator_invalid", "数据目录定位文件损坏，未创建空库。请保留原文件并恢复正确的数据目录配置。"))?;
            if locator.version != 1 || !locator.root.is_absolute() {
                return Err(StorageError::new("locator_invalid", "数据目录配置不兼容，未创建空库。"));
            }
            let store = Store::open(&locator.root, false)?;
            if store.identity != locator.identity {
                return Err(StorageError::new("root_changed", "原位置已被另一套数据库替换，已停止打开；不会静默切换或合并。"));
            }
            self.store = Some(store);
        }
        Ok(Workspace {
            root: self.store.as_ref().map(|s| s.root.to_string_lossy().into_owned()),
            default_root: self.default_root.to_string_lossy().into_owned(),
            todos: match &self.store { Some(s) => s.todos()?, None => vec![] },
        })
    }
    pub fn select_root(&mut self, root: &Path) -> Result<Workspace, StorageError> {
        if self.store.is_some() || self.locator.try_exists().map_err(io_error)? {
            return Err(StorageError::new("root_already_selected", "已有数据目录；完整迁移与切换将在数据保障阶段接入，不会直接改为新空库。"));
        }
        let store = Store::open(root, true)?;
        let locator = Locator { version: 1, root: store.root.clone(), identity: store.identity.clone() };
        let bytes = serde_json::to_vec_pretty(&locator).map_err(|_| StorageError::new("locator_invalid", "无法生成数据目录配置。"))?;
        // S01 only creates a first locator. No overwrite or deletion, including failed writes.
        let mut pending = tempfile::Builder::new().prefix("data-root-pending-").suffix(".json")
            .tempfile_in(self.locator.parent().unwrap()).map_err(io_error)?;
        pending.disable_cleanup(true);
        pending.write_all(&bytes).map_err(io_error)?;
        pending.as_file().sync_all().map_err(io_error)?;
        pending.persist_noclobber(&self.locator).map_err(|_| StorageError::new("locator_save_failed", "数据目录配置未保存，未切换当前目录。请重试；已创建的目录和记录仍保留。"))?;
        self.store = Some(store);
        self.workspace()
    }
    pub fn store(&mut self) -> Result<&mut Store, StorageError> {
        self.workspace()?;
        self.store.as_mut().ok_or_else(|| StorageError::new("root_required", "请先选择数据目录。"))
    }
}

fn unfinished_root(root: &Path) -> Result<bool, StorageError> {
    let marker = root.join(INITIALIZING);
    if !marker.try_exists().map_err(io_error)? || !fs::symlink_metadata(&marker).map_err(io_error)?.file_type().is_dir() { return Ok(false); }
    for entry in fs::read_dir(root).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        if entry.file_name() == INITIALIZING || entry.file_name() == ".azcine.lock" { continue; }
        // The empty destination directory may remain after a failed publish.
        if entry.file_name() == "db" && entry.file_type().map_err(io_error)?.is_dir()
            && fs::read_dir(entry.path()).map_err(io_error)?.next().is_none() { continue; }
        return Ok(false);
    }
    Ok(true)
}
fn initialize_schema(db: &mut Connection) -> Result<(), StorageError> {
    let tx = db.transaction().map_err(db_error)?;
    tx.execute_batch("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        INSERT INTO app_meta VALUES ('identity', lower(hex(randomblob(16))));
        CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500), due_date TEXT,
            project_id TEXT, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), revision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;").map_err(db_error)?;
    crate::projects::create_schema(&tx)?;
    crate::ideas::create_schema(&tx)?;
    tx.pragma_update(None, "application_id", APPLICATION_ID).map_err(db_error)?;
    tx.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(db_error)?;
    tx.commit().map_err(db_error)
}

impl Store {
    pub fn open(root: &Path, allow_create: bool) -> Result<Self, StorageError> {
        Self::open_with_initializer(root, allow_create, initialize_schema)
    }
    fn open_with_initializer(root: &Path, allow_create: bool, initialize: impl FnOnce(&mut Connection) -> Result<(), StorageError>) -> Result<Self, StorageError> {
        if !root.is_absolute() || root.parent().is_none() || root.as_os_str().is_empty() {
            return Err(StorageError::new("invalid_path", "请选择专用的绝对目录，不要使用磁盘根目录。"));
        }
        let exists = root.try_exists().map_err(io_error)?;
        if !exists && !allow_create { return Err(StorageError::new("root_missing", "原数据目录不存在或尚未挂载，未创建空库。请接回原目录后重试。")); }
        if exists && !root.is_dir() { return Err(StorageError::new("invalid_path", "此位置不是目录，请选择可写的文件夹。")); }
        let db_path = root.join(DATABASE);
        let has_db = db_path.try_exists().map_err(io_error)?;
        if !has_db {
            if !allow_create { return Err(StorageError::new("database_missing", "原数据目录的数据库缺失，未创建空库。请恢复原数据库后重试。")); }
            if exists && fs::read_dir(root).map_err(io_error)?.next().is_some() && !unfinished_root(root)? {
                return Err(StorageError::new("unknown_root", "所选目录不是空目录，也不是 AZCine 数据目录。请选一个空的专用目录，不会覆盖已有文件。"));
            }
        }
        fs::create_dir_all(root).map_err(io_error)?;
        let root = fs::canonicalize(root).map_err(io_error)?;
        if root.to_str().is_none() { return Err(StorageError::new("invalid_path", "目录名称含无法在界面表示的字符，请选择其他目录。")); }
        if root.parent().is_none() { return Err(StorageError::new("invalid_path", "请选择专用目录，不要使用磁盘根目录。")); }
        if !has_db {
            // Directory creation is atomic, unlike a partially written marker file.
            // If interrupted before this point the root is still empty and retryable.
            match fs::create_dir(root.join(INITIALIZING)) {
                Ok(()) => {},
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists && unfinished_root(&root)? => {},
                Err(error) => return Err(io_error(error)),
            }
        }
        let lock = lock_file(&root.join(".azcine.lock"))?;
        // Recheck under the OS lock: a concurrent first opener may have just initialized it.
        let has_db_now = root.join(DATABASE).try_exists().map_err(io_error)?;
        if has_db && !has_db_now {
            return Err(StorageError::new("database_missing", "数据库在打开时已移动或缺失，未创建空库。请恢复原文件后重试。"));
        }
        if !has_db_now {
            let mut pending = tempfile::Builder::new().prefix("database-").suffix(".sqlite3")
                .tempfile_in(root.join(INITIALIZING)).map_err(io_error)?;
            pending.disable_cleanup(true);
            let mut candidate = Connection::open_with_flags(pending.path(), OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(db_error)?;
            configure_journal(&candidate)?;
            initialize(&mut candidate)?;
            candidate.close().map_err(|(_, error)| db_error(error))?;
            pending.as_file().sync_all().map_err(io_error)?;
            fs::create_dir_all(root.join("db")).map_err(io_error)?;
            // Never overwrite a destination that appeared since the checks. The
            // fully committed candidate is moved to its final name, not deleted.
            pending.persist_noclobber(root.join(DATABASE)).map_err(|_| StorageError::new("database_publish_failed", "数据库初始化未能完成，未替换现有文件。请修复目录空间或权限后重试同一目录。"))?;
        }
        let mut db = Connection::open_with_flags(root.join(DATABASE), OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(db_error)?;
        db.busy_timeout(Duration::from_secs(5)).map_err(db_error)?;
        let id: i64 = db.pragma_query_value(None, "application_id", |r| r.get(0)).map_err(db_error)?;
        let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(db_error)?;
        if id != APPLICATION_ID || !(1..=SCHEMA_VERSION).contains(&version) { return Err(StorageError::new("incompatible_database", "所选数据库不是受支持的 AZCine 数据版本，未迁移或覆盖。")); }
        let integrity: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(db_error)?;
        if integrity != "ok" { return Err(StorageError::new("damaged_database", "数据库完整性检查失败，请保留原目录并使用有效备份恢复。")); }
        let identity: String = db.query_row("SELECT value FROM app_meta WHERE key='identity'", [], |r| r.get(0)).map_err(db_error)?;
        if identity.len() != 32 || !identity.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(StorageError::new("damaged_database", "数据库身份无效，未选用或覆盖此目录。"));
        }
        // Validate required schema before a first selection can persist its locator.
        db.prepare("SELECT id,title,due_date,project_id,completed,revision,created_at FROM todos LIMIT 0").map_err(db_error)?;
        // Retain the journal file instead of deleting test artifacts after each commit.
        // S13 exports a consistent snapshot, not a copy of an active journal.
        configure_journal(&db)?;
        db.pragma_update(None, "foreign_keys", true).map_err(db_error)?;
        if version == 1 {
            // Only the recognized S01 version is upgraded. DDL, triggers and version
            // advance atomically; existing identity/todos are never rebuilt.
            let tx = db.transaction().map_err(db_error)?;
            let invalid_links: i64 = tx.query_row("SELECT count(*) FROM todos WHERE project_id IS NOT NULL", [], |row| row.get(0)).map_err(db_error)?;
            if invalid_links != 0 { return Err(StorageError::new("incompatible_database", "旧数据库已有未知项目关联，未迁移或丢弃记录，请先核对。")); }
            crate::projects::create_schema(&tx)?;
            tx.pragma_update(None, "user_version", 2).map_err(db_error)?;
            tx.commit().map_err(db_error)?;
        }
        db.prepare("SELECT id,name,content,revision,created_at FROM projects LIMIT 0").map_err(db_error)?;
        db.prepare("SELECT id,input,result FROM project_requests LIMIT 0").map_err(db_error)?;
        if version < 3 {
            let tx = db.transaction().map_err(db_error)?;
            crate::ideas::create_schema(&tx)?;
            tx.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(db_error)?;
            tx.commit().map_err(db_error)?;
        }
        db.prepare("SELECT id,title,body,tags,project_id,revision,created_at,updated_at,deleted,todo_id FROM ideas LIMIT 0").map_err(db_error)?;
        db.prepare("SELECT id,input,result FROM idea_requests LIMIT 0").map_err(db_error)?;
        for dir in ["attachments", "snapshots", "pi/agent", "pi/sessions", "config", "logs", "backups"] { fs::create_dir_all(root.join(dir)).map_err(io_error)?; }
        Ok(Self { root, db, identity, _lock: lock })
    }
    pub fn todos(&self) -> Result<Vec<Todo>, StorageError> {
        let mut query = self.db.prepare("SELECT id,title,due_date,project_id,completed,revision,created_at FROM todos ORDER BY completed, due_date IS NULL, due_date,created_at,id").map_err(db_error)?;
        query.query_map([], todo_row).map_err(db_error)?.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }
    fn todo(&self, id: &str) -> Result<Option<Todo>, StorageError> {
        self.db.query_row("SELECT id,title,due_date,project_id,completed,revision,created_at FROM todos WHERE id=?1", [id], todo_row).optional().map_err(db_error)
    }
    pub fn create_todo(&mut self, input: CreateTodo) -> Result<Todo, StorageError> {
        let title = input.title.trim();
        if title.is_empty() || title.chars().count() > 500 { return Err(StorageError::new("invalid_title", "请填写 1–500 字的待办标题。")); }
        validate_id(&input.id)?;
        if let Some(date) = &input.due_date { if !valid_date(date) { return Err(StorageError::new("invalid_date", "日期需为有效的完整年月日（YYYY-MM-DD）；也可不填。")); } }
        if let Some(project_id) = &input.project_id {
            if validate_id(project_id).is_err() || !self.db.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)", [project_id], |row| row.get::<_, bool>(0)).map_err(db_error)? {
                return Err(StorageError::new("invalid_project", "关联的公司项目不存在，请重新选择；不会创建虚构项目。"));
            }
        }
        if let Some(existing) = self.todo(&input.id)? {
            if existing.title == title && existing.due_date == input.due_date && existing.project_id == input.project_id { return Ok(existing); }
            return Err(StorageError::new("request_conflict", "此保存请求已经用于另一条记录，请重新核对，不会重复创建或覆盖。"));
        }
        self.db.execute("INSERT INTO todos(id,title,due_date,project_id) VALUES (?1,?2,?3,?4)", params![input.id, title, input.due_date, input.project_id]).map_err(db_error)?;
        self.todo(&input.id)?.ok_or_else(|| StorageError::new("save_uncertain", "保存结果尚未确认，请重试同一请求，不会重复建项。"))
    }
    pub fn complete_todo(&mut self, id: &str, revision: i64, completed: bool) -> Result<Todo, StorageError> {
        validate_id(id)?;
        let changed = self.db.execute("UPDATE todos SET completed=?1,revision=revision+1 WHERE id=?2 AND revision=?3", params![completed, id, revision]).map_err(db_error)?;
        if changed != 1 { return Err(StorageError::new("stale_record", "这条待办已改变，请刷新列表后再操作；没有覆盖新状态。")); }
        self.todo(id)?.ok_or_else(|| StorageError::new("record_missing", "待办不存在，请刷新列表。"))
    }
}
fn todo_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Todo> {
    Ok(Todo { id: row.get(0)?, title: row.get(1)?, due_date: row.get(2)?, project_id: row.get(3)?, completed: row.get(4)?, revision: row.get(5)?, created_at: row.get(6)? })
}
fn validate_id(id: &str) -> Result<(), StorageError> {
    if id.len() != 36 || !id.bytes().enumerate().all(|(i,c)| if [8,13,18,23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() }) {
        return Err(StorageError::new("invalid_id", "待办编号无效，请重新创建。"));
    }
    Ok(())
}
pub fn valid_date(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len()!=10 || b[4]!=b'-' || b[7]!=b'-' || !b.iter().enumerate().all(|(i,c)| i==4 || i==7 || c.is_ascii_digit()) { return false; }
    let year = value[..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..].parse::<u32>().unwrap_or(0);
    let max = match month { 1|3|5|7|8|10|12=>31,4|6|9|11=>30,2=>if year%4==0 && (year%100!=0 || year%400==0) {29} else {28},_=>0 };
    year>0 && day>0 && day<=max
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run() -> PathBuf {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
        fs::create_dir_all(&base).unwrap();
        tempfile::Builder::new().prefix("s01-storage-").tempdir_in(base).unwrap().keep()
    }
    fn input() -> CreateTodo { CreateTodo { id: "aabbccdd-1111-2222-3333-aabbccddeeff".into(), title: "灯光检查".into(), due_date: None, project_id: None } }
    #[test]
    fn given_new_root_when_save_complete_undo_reopen_then_record_and_identity_persist() {
        let out=run(); let config=out.join("locator"); let root=out.join("data");
        let mut manager=Manager::new(config.clone(), root.clone()).unwrap();
        assert!(manager.workspace().unwrap().root.is_none()); assert!(!root.exists());
        manager.select_root(&root).unwrap();
        let todo=manager.store().unwrap().create_todo(input()).unwrap();
        let done=manager.store().unwrap().complete_todo(&todo.id,todo.revision,true).unwrap();
        manager.store().unwrap().complete_todo(&done.id,done.revision,false).unwrap();
        drop(manager);
        let mut reopened=Manager::new(config,root).unwrap(); let saved=reopened.workspace().unwrap();
        assert_eq!(saved.todos.len(),1); assert!(!saved.todos[0].completed); assert_eq!(saved.todos[0].due_date,None);
    }
    #[test]
    fn given_empty_title_invalid_date_or_unknown_project_when_save_then_no_insert() {
        let out=run(); let mut store=Store::open(&out.join("data"),true).unwrap();
        let mut item=input(); item.title=" ".into(); assert_eq!(store.create_todo(item).unwrap_err().code,"invalid_title");
        for date in ["2025-02-29","2026-13-01","10-14","0000-01-01","2026-04-31"] { let mut item=input();item.due_date=Some(date.into());assert_eq!(store.create_todo(item).unwrap_err().code,"invalid_date"); }
        let mut item=input();item.project_id=Some("unknown".into()); assert_eq!(store.create_todo(item).unwrap_err().code,"invalid_project");
        assert!(store.todos().unwrap().is_empty()); assert!(valid_date("2028-02-29"));
    }
    #[test]
    fn given_duplicate_request_and_stale_completion_when_retried_then_no_duplicate_or_overwrite() {
        let out=run(); let mut store=Store::open(&out.join("data"),true).unwrap();
        let a=store.create_todo(input()).unwrap(); let b=store.create_todo(input()).unwrap();assert_eq!(a.id,b.id);
        store.complete_todo(&a.id,a.revision,true).unwrap();
        assert_eq!(store.complete_todo(&a.id,a.revision,false).unwrap_err().code,"stale_record");
        assert_eq!(store.todos().unwrap().len(),1);assert!(store.todos().unwrap()[0].completed);
    }
    #[test]
    fn given_readonly_connection_when_save_then_error_and_existing_records_unchanged() {
        let out=run();let mut store=Store::open(&out.join("data"),true).unwrap();
        store.db.pragma_update(None,"query_only",true).unwrap();
        assert_eq!(store.create_todo(input()).unwrap_err().code,"storage_database");assert!(store.todos().unwrap().is_empty());
    }
    #[test]
    fn given_missing_or_incompatible_or_foreign_root_when_open_then_no_empty_fallback() {
        let out=run();let missing=out.join("missing"); assert!(Store::open(&missing,false).is_err());assert!(!missing.exists());
        let foreign=out.join("foreign");fs::create_dir_all(&foreign).unwrap();fs::write(foreign.join("original.txt"),"keep").unwrap();
        assert_eq!(Store::open(&foreign,true).err().unwrap().code,"unknown_root");assert!(!foreign.join("db").exists());
        let root=out.join("old");{let s=Store::open(&root,true).unwrap();s.db.pragma_update(None,"user_version",99).unwrap();}
        assert_eq!(Store::open(&root,true).err().unwrap().code,"incompatible_database");
        assert_eq!(fs::read_to_string(foreign.join("original.txt")).unwrap(),"keep");
    }
    #[test]
    fn given_root_in_use_when_second_writer_opens_then_rejected_until_owner_exits() {
        let out=run();let root=out.join("data");let first=Store::open(&root,true).unwrap();
        assert_eq!(Store::open(&root,false).err().unwrap().code,"root_busy");drop(first);assert!(Store::open(&root,false).is_ok());
    }
    #[test]
    fn given_initialization_disk_full_when_retry_same_root_then_failed_candidate_retained_and_root_usable() {
        let out=run();let root=out.join("data");
        let failure=Store::open_with_initializer(&root,true,|db| {
            db.pragma_update(None,"max_page_count",1).map_err(db_error)?;
            initialize_schema(db)
        });
        assert_eq!(failure.err().unwrap().code,"storage_database");assert!(!root.join(DATABASE).exists());
        let retained:Vec<_>=fs::read_dir(root.join(INITIALIZING)).unwrap().map(|e|e.unwrap().path()).collect();
        assert!(!retained.is_empty());
        let mut store=Store::open(&root,true).unwrap();store.create_todo(input()).unwrap();
        assert_eq!(store.todos().unwrap().len(),1);assert!(retained.iter().all(|file|file.exists()));
    }
    #[test]
    fn given_interrupt_after_commit_before_publish_when_retry_then_no_empty_final_database_or_overwrite() {
        let out=run();let root=out.join("data");
        assert!(Store::open_with_initializer(&root,true,|db| {initialize_schema(db)?;Err(StorageError::new("test_interrupt","explicit test interruption"))}).is_err());
        assert!(!root.join(DATABASE).exists());assert!(Store::open(&root,true).is_ok());
        let unknown=out.join("unknown");fs::create_dir_all(unknown.join("db")).unwrap();fs::write(unknown.join(DATABASE),[]).unwrap();
        assert_eq!(Store::open(&unknown,true).err().unwrap().code,"incompatible_database");
        assert_eq!(fs::metadata(unknown.join(DATABASE)).unwrap().len(),0);
        let marker_only=out.join("marker-only");fs::create_dir_all(marker_only.join(INITIALIZING)).unwrap();
        assert!(Store::open(&marker_only,true).is_ok());
    }
    #[test]
    fn given_locator_save_failure_when_selecting_then_no_success_and_created_data_retained() {
        let out=run();let mut manager=Manager::new(out.join("local"),out.join("data")).unwrap();
        // Missing locating parent fails only after the data root has been initialized.
        manager.locator=out.join("unavailable-local/root.json");
        assert!(manager.select_root(&out.join("data")).is_err());assert!(manager.store.is_none());
        assert!(out.join("data").join(DATABASE).exists());
        fs::create_dir_all(out.join("unavailable-local")).unwrap();
        assert!(manager.select_root(&out.join("data")).unwrap().root.is_some());
    }
    #[test]
    fn given_sqlite_page_limit_when_storage_fills_then_failed_write_is_not_committed() {
        let out=run();let mut store=Store::open(&out.join("data"),true).unwrap();
        let page_count:i64=store.db.pragma_query_value(None,"page_count",|r| r.get(0)).unwrap();
        store.db.pragma_update(None,"max_page_count",page_count).unwrap();
        let mut rejected=false;
        for i in 0..100 {
            let mut item=input();item.id=format!("aabbccdd-1111-2222-3333-{i:012x}");item.title="长".repeat(500);
            let before=store.todos().unwrap().len();
            if let Err(error)=store.create_todo(item) {
                assert_eq!(error.code,"storage_database");assert_eq!(store.todos().unwrap().len(),before);rejected=true;break;
            }
        }
        assert!(rejected,"real SQLite SQLITE_FULL path should be exercised");
    }
    #[test]
    fn given_non_directory_root_when_open_then_no_write_or_false_success() {
        let out=run();let file=out.join("original.txt");fs::write(&file,"retained").unwrap();
        assert_eq!(Store::open(&file,true).err().unwrap().code,"invalid_path");
        assert_eq!(fs::read_to_string(file).unwrap(),"retained");
        assert_eq!(Store::open(Path::new("relative-data"),true).err().unwrap().code,"invalid_path");
    }
    #[test]
    fn given_database_without_valid_schema_when_open_then_never_reinitialized() {
        let out=run();let root=out.join("data");fs::create_dir_all(root.join("db")).unwrap();
        let file=root.join(DATABASE);fs::write(&file,"not a sqlite file").unwrap();
        assert!(Store::open(&root,true).is_err());
        assert_eq!(fs::read_to_string(file).unwrap(),"not a sqlite file");
    }
    #[test]
    fn given_schema_marker_but_missing_table_when_selecting_then_locator_not_saved() {
        let out=run();let root=out.join("data");fs::create_dir_all(root.join("db")).unwrap();
        let db=Connection::open(root.join(DATABASE)).unwrap();
        db.pragma_update(None,"journal_mode","PERSIST").unwrap();
        db.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO app_meta VALUES('identity','0123456789abcdef0123456789abcdef');").unwrap();
        db.pragma_update(None,"application_id",APPLICATION_ID).unwrap();db.pragma_update(None,"user_version",SCHEMA_VERSION).unwrap();drop(db);
        let local=out.join("local");let mut manager=Manager::new(local.clone(),root.clone()).unwrap();
        assert!(manager.select_root(&root).is_err());assert!(!local.join("data-root.json").exists());
    }
    #[test]
    fn given_locator_lock_or_corruption_when_start_then_no_second_writer_or_empty_fallback() {
        let out=run();let local=out.join("local");let root=out.join("data");
        let first=Manager::new(local.clone(),root.clone()).unwrap();
        assert_eq!(Manager::new(local.clone(),root.clone()).err().unwrap().code,"root_busy");drop(first);
        fs::write(local.join("data-root.json"),"broken config retained").unwrap();
        let mut manager=Manager::new(local.clone(),root.clone()).unwrap();
        assert_eq!(manager.workspace().unwrap_err().code,"locator_invalid");assert!(!root.exists());
        assert_eq!(fs::read_to_string(local.join("data-root.json")).unwrap(),"broken config retained");
    }
    #[test]
    fn given_documents_unavailable_when_custom_root_selected_then_custom_root_opens_normally() {
        let out=run();let local=out.join("local");let root=out.join("custom");
        {let mut m=Manager::new(local.clone(),PathBuf::new()).unwrap();assert_eq!(m.workspace().unwrap().default_root,"");m.select_root(&root).unwrap();}
        let mut m=Manager::new(local,PathBuf::new()).unwrap();assert!(m.workspace().unwrap().root.is_some());
    }
    #[test]
    fn given_saved_locator_but_moved_root_when_start_then_missing_error_without_recreating() {
        let out=run();let root=out.join("data");let local=out.join("local");
        {let mut m=Manager::new(local.clone(),root.clone()).unwrap();m.select_root(&root).unwrap();}
        fs::rename(&root,out.join("retained-moved-data")).unwrap();
        let mut m=Manager::new(local,root.clone()).unwrap();assert_eq!(m.workspace().unwrap_err().code,"root_missing");assert!(!root.exists());
    }
}
