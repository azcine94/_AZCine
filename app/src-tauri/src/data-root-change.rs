use crate::storage::StorageError;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};

fn failure() -> StorageError { StorageError::new("root_copy_failed", "数据目录复制或校验未完成，仍使用原目录；目标中的副本已保留，请选择新的空目录重试。") }
fn hash(path: &Path) -> Result<Vec<u8>, StorageError> {
    let mut file = fs::File::open(path).map_err(|_| failure())?;
    let mut hash = Sha256::new(); let mut buffer = [0u8; 65536];
    loop { let count = file.read(&mut buffer).map_err(|_| failure())?; if count == 0 { break; } hash.update(&buffer[..count]); }
    Ok(hash.finalize().to_vec())
}
pub fn target(source: &Path, destination: &Path, migrate: bool) -> Result<std::path::PathBuf, StorageError> {
    if !destination.is_absolute() || destination.parent().is_none() || destination.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err(StorageError::new("invalid_path", "请选择专用的绝对目录，不要使用磁盘根目录。"));
    }
    let parent = destination.parent().ok_or_else(failure)?;
    let actual = if destination.exists() { fs::canonicalize(destination).map_err(|_| failure())? }
        else { fs::canonicalize(parent).map_err(|_| failure())?.join(destination.file_name().ok_or_else(failure)?) };
    if actual.starts_with(source) || source.starts_with(&actual) {
        return Err(StorageError::new("root_overlap", "新旧目录不能相同，也不能互相包含；原目录未改变。"));
    }
    if migrate {
        if actual.exists() && (!actual.is_dir() || fs::read_dir(&actual).map_err(|_| failure())?.next().is_some()) {
            return Err(StorageError::new("root_not_empty", "迁移目标必须是新的空目录。已有数据不会覆盖或合并。"));
        }
    } else if !actual.join("db/azcine.sqlite3").is_file() {
        return Err(StorageError::new("root_not_existing", "请选择完整的已有 AZCine 数据目录；不会创建空库。"));
    }
    Ok(actual)
}
pub fn copy(source: &Path, destination: &Path, db: &Connection) -> Result<(), StorageError> {
    fs::create_dir_all(destination).map_err(|_| failure())?;
    copy_directory(source, source, destination)?;
    fs::create_dir_all(destination.join("db")).map_err(|_| failure())?;
    // SQLite creates a coherent snapshot, not a copy of a live journal.
    let file = destination.join("db/azcine.sqlite3");
    db.execute("VACUUM main INTO ?", [file.to_str().ok_or_else(failure)?]).map_err(|_| failure())?;
    Ok(())
}
fn copy_directory(base: &Path, source: &Path, destination: &Path) -> Result<(), StorageError> {
    crate::pi_launch_plan::no_link(source).map_err(|_| failure())?;
    for entry in fs::read_dir(source).map_err(|_| failure())? {
        let path = entry.map_err(|_| failure())?.path();
        let relative = path.strip_prefix(base).map_err(|_| failure())?;
        if relative == Path::new(".azcine.lock") || relative == Path::new("pi/session-locks") ||
            ["db/azcine.sqlite3", "db/azcine.sqlite3-journal", "db/azcine.sqlite3-wal", "db/azcine.sqlite3-shm"].iter().any(|skip| relative == Path::new(skip)) { continue; }
        crate::pi_launch_plan::no_link(&path).map_err(|_| failure())?;
        let output = destination.join(path.file_name().ok_or_else(failure)?);
        if path.is_dir() { fs::create_dir(&output).map_err(|_| failure())?; copy_directory(base, &path, &output)?; }
        else if path.is_file() {
            let mut input = fs::File::open(&path).map_err(|_| failure())?;
            let mut target = fs::OpenOptions::new().create_new(true).write(true).open(&output).map_err(|_| failure())?;
            std::io::copy(&mut input, &mut target).map_err(|_| failure())?;
            target.sync_all().map_err(|_| failure())?; drop(target);
            if hash(&path)? != hash(&output)? { return Err(failure()); }
        } else { return Err(failure()); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{Manager, CreateTodo};
    fn fixture() -> std::path::PathBuf {
        let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
        fs::create_dir_all(&base).unwrap();
        tempfile::Builder::new().prefix("data-root-change-").tempdir_in(fs::canonicalize(base).unwrap()).unwrap().keep()
    }
    fn manager(base: &Path) -> Manager { Manager::new(base.join("local-config"), base.join("original")).unwrap() }
    fn record(manager: &mut Manager) {
        manager.store().unwrap().create_todo(CreateTodo { id:"00112233-4455-6677-8899-aabbccddeeff".into(), title:"隔离换机测试".into(), due_date:None, project_id:None }).unwrap();
    }
    #[test]
    fn migrate_after_restart_preserves_source_and_rebases_native_session_without_changing_messages() {
        let base=fixture();let mut first=manager(&base);first.select_root(&base.join("original")).unwrap();record(&mut first);
        let original=first.store().unwrap().root.clone();
        let paths=crate::pi_launch_plan::PiPaths::prepare(&original).unwrap();
        let file=paths.sessions.join("fixture.jsonl");
        let header=serde_json::json!({"type":"session","version":3,"id":"fixture-session","timestamp":"2026-10-08T00:00:00Z","cwd":paths.default_cwd});
        let body="{\"type\":\"message\",\"id\":\"a1\",\"parentId\":null,\"timestamp\":\"2026-10-08T00:00:01Z\",\"message\":{\"role\":\"user\",\"content\":\"explicit fixture\",\"timestamp\":1791417601000}}\n";
        let content=format!("{header}\n{body}");fs::write(&file,&content).unwrap();
        fs::write(paths.agent.join("auth.json"),b"{\"fixture\":{\"type\":\"api_key\",\"key\":\"not-a-real-key\"}}").unwrap();
        first.store().unwrap().db.execute("INSERT INTO agent_conversations(id,source,session_path,cwd,updated_at) VALUES('fixture','{}',?,?,'fixture')",rusqlite::params![file.to_string_lossy(),paths.default_cwd.to_string_lossy()]).unwrap();
        first.schedule_root_change(&base.join("migrated"),"migrate").unwrap();
        assert_eq!(first.workspace().unwrap().root.as_deref(),original.to_str());assert!(!base.join("migrated").exists());drop(first);
        let mut second=manager(&base);let workspace=second.workspace().unwrap();assert_eq!(workspace.todos.len(),1);assert!(workspace.root_change_notice.unwrap().contains("已更改"));
        let moved=second.store().unwrap().root.clone();assert_eq!(moved,fs::canonicalize(base.join("migrated")).unwrap());
        let new_paths=crate::pi_launch_plan::PiPaths::prepare(&moved).unwrap();
        let restored=fs::read_to_string(new_paths.sessions.join("fixture.jsonl")).unwrap();
        assert_eq!(restored.split_once('\n').unwrap().1,body);assert_eq!(fs::read_to_string(&file).unwrap(),content);
        assert_eq!(serde_json::from_str::<serde_json::Value>(restored.lines().next().unwrap()).unwrap()["cwd"],new_paths.default_cwd.to_string_lossy().as_ref());
        assert_eq!(fs::read(paths.agent.join("auth.json")).unwrap(),fs::read(new_paths.agent.join("auth.json")).unwrap());
        assert!(fs::read_dir(moved.join("config/relocated-sessions")).unwrap().next().is_some());
        let session:String=second.store().unwrap().db.query_row("SELECT session_path FROM agent_conversations WHERE id='fixture'",[],|r|r.get(0)).unwrap();assert!(Path::new(&session).starts_with(&moved));
        assert_eq!(crate::pi_sessions::list_sessions(&new_paths).unwrap().sessions.len(),1);
        drop(second);
        // New computer: a new local config selects the copied existing root.
        let mut third=Manager::new(base.join("new-computer-config"),base.join("unused")).unwrap();
        assert!(third.workspace().unwrap().root.is_none());assert_eq!(third.select_root(&moved).unwrap().todos.len(),1);
    }
    #[test]
    fn switch_does_not_merge_cancel_preserves_root_and_invalid_targets_are_rejected() {
        let base=fixture();let mut first=manager(&base);first.select_root(&base.join("original")).unwrap();record(&mut first);
        let mut other=Manager::new(base.join("other-config"),base.join("other")).unwrap();other.select_root(&base.join("other")).unwrap();drop(other);
        assert!(first.schedule_root_change(&base.join("original/nested"),"migrate").is_err());
        assert!(first.schedule_root_change(&base.join("other"),"migrate").is_err());
        first.schedule_root_change(&base.join("other"),"switch").unwrap();first.cancel_root_change().unwrap();drop(first);
        let mut first=manager(&base);assert_eq!(first.workspace().unwrap().todos.len(),1);
        first.schedule_root_change(&base.join("other"),"switch").unwrap();drop(first);
        let mut switched=manager(&base);assert!(switched.workspace().unwrap().todos.is_empty());
        assert!(base.join("original/db/azcine.sqlite3").exists());
    }
    #[test]
    fn failed_migration_keeps_original_locator_and_reports_failure() {
        let base=fixture();let mut first=manager(&base);first.select_root(&base.join("original")).unwrap();record(&mut first);
        first.schedule_root_change(&base.join("destination"),"migrate").unwrap();drop(first);
        fs::create_dir(base.join("destination")).unwrap();fs::write(base.join("destination/user-file.txt"),b"preserve me").unwrap();
        let mut second=manager(&base);let workspace=second.workspace().unwrap();assert_eq!(workspace.todos.len(),1);assert!(workspace.root_change_notice.unwrap().contains("仍使用原目录"));
        assert_eq!(fs::read(base.join("destination/user-file.txt")).unwrap(),b"preserve me");
    }
}
