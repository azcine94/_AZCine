//! Rebase application-owned paths when a complete, closed data root is copied.
//! Native message entries and credentials are never rewritten. External paths
//! stay external. The root lock is held by Store throughout this operation.
use crate::storage::StorageError;
use rusqlite::{Connection, OptionalExtension, params};
use std::{fs, io::{BufRead, BufReader, Read, Write}, path::{Component, Path, PathBuf}};

const ROOT_KEY: &str = "portable_data_root_v1";
fn failed() -> StorageError { StorageError::new("data_relocation", "换机路径调整未完成，原记录及会话副本已保留。请确保完整目录已下载、旧电脑已退出且同步暂停，再重试。") }
fn normalized(path: &str) -> String {
    let path = path.replace('\\', "/");
    path.strip_prefix("//?/").unwrap_or(&path).trim_end_matches('/').to_owned()
}
fn rebase(value: &str, old: &str, root: &Path) -> Option<String> {
    let path = normalized(value);
    let old = normalized(old);
    let (key, prefix) = if cfg!(windows) { (path.to_lowercase(), old.to_lowercase()) } else { (path.clone(), old.clone()) };
    if key == prefix { return Some(root.to_string_lossy().into_owned()); }
    if !key.starts_with(&(prefix + "/")) { return None; }
    let relative = Path::new(&path[old.len()+1..]);
    if !relative.components().all(|part| matches!(part, Component::Normal(_))) { return None; }
    Some(root.join(relative).to_string_lossy().into_owned())
}
fn owned(path: &Path) -> Result<(), StorageError> {
    crate::pi_launch_plan::no_link(path).map_err(|_| failed())
}
fn sessions(directory: &Path, depth: usize, files: &mut Vec<PathBuf>) -> Result<(), StorageError> {
    owned(directory)?;
    if !directory.exists() { return Ok(()); }
    if depth > 4 { return Err(failed()); }
    for entry in fs::read_dir(directory).map_err(|_| failed())? {
        let path = entry.map_err(|_| failed())?.path();
        owned(&path)?;
        if path.is_dir() { sessions(&path, depth+1, files)?; }
        else if path.extension().is_some_and(|extension| extension == "jsonl") {
            if files.len() >= 5000 { return Err(failed()); }
            files.push(path);
        }
    }
    Ok(())
}
fn relocate_session(file: &Path, old: &str, root: &Path) -> Result<(), StorageError> {
    let original = fs::File::open(file).map_err(|_| failed())?;
    let before = original.metadata().map_err(|_| failed())?;
    let mut reader = BufReader::new(original);
    let mut header = Vec::new();
    (&mut reader).take(1024 * 1024 + 1).read_until(b'\n', &mut header).map_err(|_| failed())?;
    if header.is_empty() { return Ok(()); }
    if header.len() > 1024 * 1024 { return Err(failed()); }
    let mut value: serde_json::Value = serde_json::from_slice(&header).map_err(|_| failed())?;
    if value["type"] != "session" || value["version"] != 3 { return Err(failed()); }
    let mut changed = false;
    for field in ["cwd", "parentSession"] {
        if let Some(replacement) = value[field].as_str().and_then(|path| rebase(path, old, root)) {
            value[field] = replacement.into(); changed = true;
        }
    }
    if !changed { return Ok(()); }
    // Keep the exact original before atomically replacing only the header.
    let directory = root.join("config/relocated-sessions");
    owned(&root.join("config"))?; owned(&directory)?;
    fs::create_dir_all(&directory).map_err(|_| failed())?;
    let mut backup = tempfile::Builder::new().prefix("before-").suffix(".jsonl").tempfile_in(&directory).map_err(|_| failed())?;
    backup.disable_cleanup(true);
    let mut source = fs::File::open(file).map_err(|_| failed())?;
    std::io::copy(&mut source, &mut backup).map_err(|_| failed())?;
    backup.as_file().sync_all().map_err(|_| failed())?;
    drop(source);
    let mut pending = tempfile::Builder::new().prefix("relocating-").suffix(".tmp").tempfile_in(file.parent().ok_or_else(failed)?).map_err(|_| failed())?;
    pending.disable_cleanup(true);
    serde_json::to_writer(&mut pending, &value).map_err(|_| failed())?;
    pending.write_all(b"\n").map_err(|_| failed())?;
    std::io::copy(&mut reader, &mut pending).map_err(|_| failed())?;
    pending.as_file().sync_all().map_err(|_| failed())?;
    let after = fs::metadata(file).map_err(|_| failed())?;
    if before.len() != after.len() || before.modified().map_err(|_| failed())? != after.modified().map_err(|_| failed())? { return Err(failed()); }
    drop(reader);
    pending.persist(file).map_err(|_| failed())?;
    Ok(())
}
pub fn prepare(db: &mut Connection, root: &Path) -> Result<(), StorageError> {
    let previous: Option<String> = db.query_row("SELECT value FROM app_meta WHERE key=?", [ROOT_KEY], |row| row.get(0)).optional().map_err(|_| failed())?;
    let current = root.to_str().ok_or_else(failed)?;
    if previous.as_deref() == Some(current) { return Ok(()); }
    if let Some(old) = &previous {
        let mut files = Vec::new();
        owned(&root.join("pi"))?;
        sessions(&root.join("pi/sessions"), 0, &mut files)?;
        // Idempotent on interruption: already adjusted headers remain unchanged.
        // The old root marker is advanced only after every file and DB row succeeds.
        for file in files { relocate_session(&file, old, root)?; }
        let tx = db.transaction().map_err(|_| failed())?;
        let mut query = tx.prepare("SELECT id,session_path,cwd FROM agent_conversations").map_err(|_| failed())?;
        let rows = query.query_map([], |row| Ok((row.get::<_,String>(0)?, row.get::<_,Option<String>>(1)?, row.get::<_,Option<String>>(2)?)))
            .map_err(|_| failed())?.collect::<Result<Vec<_>,_>>().map_err(|_| failed())?;
        drop(query);
        for (id, session, cwd) in rows {
            let session = session.map(|path| rebase(&path, old, root).unwrap_or(path));
            let cwd = cwd.map(|path| rebase(&path, old, root).unwrap_or(path));
            tx.execute("UPDATE agent_conversations SET session_path=?,cwd=? WHERE id=?", params![session,cwd,id]).map_err(|_| failed())?;
        }
        let mut query = tx.prepare("SELECT path FROM agent_deleted_sessions").map_err(|_| failed())?;
        let hidden = query.query_map([], |row| row.get::<_,String>(0)).map_err(|_| failed())?.collect::<Result<Vec<_>,_>>().map_err(|_| failed())?;
        drop(query);
        for path in hidden {
            if let Some(replacement) = rebase(&path, old, root) {
                tx.execute("UPDATE agent_deleted_sessions SET path=? WHERE path=?", params![crate::agent_store::session_path_key(&replacement),path]).map_err(|_| failed())?;
            }
        }
        tx.execute("UPDATE app_meta SET value=? WHERE key=?", params![current,ROOT_KEY]).map_err(|_| failed())?;
        tx.commit().map_err(|_| failed())?;
    } else {
        db.execute("INSERT INTO app_meta(key,value) VALUES(?,?)", params![ROOT_KEY,current]).map_err(|_| failed())?;
    }
    Ok(())
}
