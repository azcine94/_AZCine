//! Repository-owned task state. The desktop only remembers repository paths;
//! tasks, relationships, decisions, grants and receipts live under .azcine.
use crate::storage::{StorageError, Store};
use crate::task_panel_store::{db_error, invalid};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs::{self, File, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::Mutex, time::Duration};
use tauri::Manager;

const APPLICATION_ID: i64 = 0x415A5450;
const VERSION: i64 = 1;
pub const DEFAULT_ARCHIFY: &str = "E:\\skills-manager\\archify";

#[derive(Default)]
pub struct TaskWorkspaceState(pub Mutex<HashMap<PathBuf, Store>>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct WorkspaceEntry { pub path: String, pub label: String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct OpenedWorkspace { pub path:String, pub label:String, pub repository_id:String, pub project_id:Option<String>, pub data_directory:String, pub skill_path:String, pub scope:Vec<String>, pub migration:String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct OpenWorkspaceInput { pub path:String, pub label:String, pub scope:Vec<String>, #[serde(default)] pub configure:bool }

fn io(_:std::io::Error)->StorageError { invalid("仓库内 .azcine 目录无法读写；原记录保留，请检查目录权限或占用。") }

pub fn repository_root(path:&Path)->Result<PathBuf,StorageError> {
    if !path.is_absolute() || !path.is_dir() { return Err(invalid("请选择已存在的仓库绝对目录。")); }
    let root=fs::canonicalize(path).map_err(io)?;
    if root.parent().is_none() || crate::task_panel_paths::sensitive(&root.to_string_lossy()) { return Err(invalid("请选择工作仓库，不能使用磁盘根目录或工具、认证目录。")); }
    Ok(root)
}

// Walk one component at a time so an existing junction cannot redirect writes
// to a different repository, shared database or user configuration directory.
pub fn directory(base:&Path,relative:&str)->Result<PathBuf,StorageError> {
    if !crate::task_panel_paths::portable_relative(relative) {return Err(invalid("交接目录名称无效。"));}
    let base=fs::canonicalize(base).map_err(io)?;
    let mut current=base.clone();
    for component in relative.split('/') {
        current.push(component);
        if current.try_exists().map_err(io)? {
            let actual=fs::canonicalize(&current).map_err(io)?;
            if !actual.starts_with(&base) || actual!=current || !actual.is_dir() {return Err(invalid(".azcine 目录含重定向或文件冲突，未写入其他位置。"));}
        } else { fs::create_dir(&current).map_err(io)?; }
    }
    Ok(current)
}

pub fn preserve(path:&Path,bytes:&[u8])->Result<(),StorageError> {
    if path.try_exists().map_err(io)? {
        if fs::read(path).map_err(io)?==bytes { return Ok(()); }
        return Err(invalid("交接文件已存在且内容不同，未覆盖原文件。"));
    }
    let mut file=OpenOptions::new().write(true).create_new(true).open(path).map_err(io)?;
    file.write_all(bytes).and_then(|_|file.sync_all()).map_err(io)
}

pub(crate) fn lock(root:&Path)->Result<File,StorageError> {
    let file=OpenOptions::new().read(true).write(true).create(true).truncate(false).open(root.join(".lock")).map_err(io)?;
    file.try_lock().map_err(|_|invalid("这个仓库的任务面板正在另一个桌面进程中使用，请先关闭原窗口。"))?;
    Ok(file)
}

pub fn open_store(workspace:&Path)->Result<Store,StorageError> {
    let workspace=repository_root(workspace)?;
    let root=directory(&workspace,".azcine")?;
    // This ignore file applies only to the application's own directory.
    let ignore=root.join(".gitignore");
    if !ignore.exists() {preserve(&ignore,b"# AZCine local task state and handoff material\n*\n")?;}
    let directory=directory(&root,"task-panel")?;
    let owned_ignore=directory.join(".gitignore");
    if !owned_ignore.exists(){preserve(&owned_ignore,b"# Local task records and access files\n*\n")?;}
    let owned_lock=lock(&directory)?;
    let path=directory.join("state.sqlite3");
    if !path.exists() {
        let mut pending=tempfile::Builder::new().prefix("state-pending-").suffix(".sqlite3").tempfile_in(&directory).map_err(io)?;
        pending.disable_cleanup(true);
        let mut db=Connection::open_with_flags(pending.path(),OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI).map_err(db_error)?;
        let tx=db.transaction().map_err(db_error)?;
        tx.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT; INSERT INTO app_meta VALUES('identity',lower(hex(randomblob(16))));").map_err(db_error)?;
        crate::task_panel_store::create_schema(&tx)?;
        crate::task_panel_projects::create_schema(&tx)?;
        tx.pragma_update(None,"application_id",APPLICATION_ID).map_err(db_error)?;
        tx.pragma_update(None,"user_version",VERSION).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        db.close().map_err(|( _,e)|db_error(e))?;
        pending.as_file().sync_all().map_err(io)?;
        pending.persist_noclobber(&path).map_err(|_|invalid("任务库发布失败，原文件和待完成文件均已保留。"))?;
    }
    let actual=fs::canonicalize(&path).map_err(io)?;
    if actual!=path {return Err(invalid("任务数据库存在目录重定向，未打开。"));}
    let db=Connection::open_with_flags(&path,OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI).map_err(db_error)?;
    db.busy_timeout(Duration::from_secs(5)).map_err(db_error)?;
    let application:i64=db.pragma_query_value(None,"application_id",|r|r.get(0)).map_err(db_error)?;
    let version:i64=db.pragma_query_value(None,"user_version",|r|r.get(0)).map_err(db_error)?;
    if application!=APPLICATION_ID || version!=VERSION {return Err(invalid(".azcine 中的任务库版本不兼容，未重建或覆盖。"));}
    let integrity:String=db.query_row("PRAGMA quick_check",[],|r|r.get(0)).map_err(db_error)?;
    if integrity!="ok" {return Err(invalid("仓库任务数据库完整性检查失败，原件已保留。"));}
    crate::task_panel_store::validate_schema(&db)?;
    crate::task_panel_projects::validate_schema(&db)?;
    db.pragma_update(None,"foreign_keys",true).map_err(db_error)?;
    db.pragma_update(None,"journal_mode","PERSIST").map_err(db_error)?;
    let identity:String=db.query_row("SELECT value FROM app_meta WHERE key='identity'",[],|r|r.get(0)).map_err(db_error)?;
    Ok(Store::from_task_workspace(root,db,identity,owned_lock,workspace))
}

impl Store {
    pub fn task_directory(&self,task_id:&str)->Result<PathBuf,StorageError> {
        if !crate::task_panel_store::id_ok(task_id) {return Err(invalid("任务目录标识无效。"));}
        let task=crate::task_panel_store::task(&self.db,task_id)?;
        if let Some(workspace)=self.task_workspace.as_ref() {
            if let Some(repo)=task.repository_id.as_ref() {
                let repo=crate::task_panel_store::repository(&self.db,repo)?;
                if repository_root(Path::new(&repo.path))?!=*workspace {return Err(invalid("任务仓库与当前 .azcine 存储不一致。"));}
            }
        }
        directory(&self.root,&format!("task-panel/tasks/{task_id}"))
    }
    pub fn run_directory(&self,task_id:&str,run_id:&str)->Result<PathBuf,StorageError> {
        if !crate::task_panel_store::id_ok(run_id) {return Err(invalid("执行目录标识无效。"));}
        directory(&self.task_directory(task_id)?,&format!("runs/{run_id}"))
    }
    pub fn task_setting(&self,key:&str)->Result<Option<String>,StorageError> {
        self.db.query_row("SELECT value FROM app_meta WHERE key=?",[key],|r|r.get(0)).optional().map_err(db_error)
    }
    pub fn save_task_setting(&self,key:&str,value:&str)->Result<(),StorageError> {
        self.db.execute("INSERT INTO app_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(db_error)?;Ok(())
    }
}

fn config_directory(app:&tauri::AppHandle)->Result<PathBuf,StorageError> {
    #[cfg(debug_assertions)] if let Some(path)=std::env::var_os("AZCINE_TEST_CONFIG_DIR") {return Ok(path.into());}
    app.path().app_local_data_dir().map_err(|_|invalid("无法定位本机仓库列表。"))
}
fn catalog_path(app:&tauri::AppHandle)->Result<PathBuf,StorageError> {Ok(config_directory(app)?.join("task-panel-workspaces.json"))}
fn catalog(app:&tauri::AppHandle)->Result<Vec<WorkspaceEntry>,StorageError> {
    let file=catalog_path(app)?;
    if !file.exists() {return Ok(vec![]);}
    serde_json::from_slice(&fs::read(file).map_err(io)?).map_err(|_|invalid("仓库快捷入口列表无法解析，未覆盖。"))
}
fn register(app:&tauri::AppHandle,entry:WorkspaceEntry)->Result<(),StorageError> {
    let mut entries=catalog(app)?;
    entries.retain(|old|crate::task_panel_locations::owner(Path::new(&old.path)).ok().as_ref()!=Some(&PathBuf::from(&entry.path)));entries.push(entry);
    let file=catalog_path(app)?;fs::create_dir_all(file.parent().unwrap()).map_err(io)?;
    let mut pending=tempfile::NamedTempFile::new_in(file.parent().unwrap()).map_err(io)?;
    pending.write_all(&serde_json::to_vec_pretty(&entries).map_err(|_|invalid("仓库列表无法编码。"))?).map_err(io)?;
    pending.as_file().sync_all().map_err(io)?;
    pending.persist(file).map_err(|_|invalid("仓库已打开，但快捷入口未能保存。"))?;Ok(())
}

pub async fn with_store<T:Send+'static>(app:tauri::AppHandle,workspace:String,work:impl FnOnce(&mut Store)->Result<T,StorageError>+Send+'static)->Result<T,StorageError> {
    with_selected_store(app,workspace,false,work).await
}
pub async fn with_dispatch_store<T:Send+'static>(app:tauri::AppHandle,workspace:String,work:impl FnOnce(&mut Store)->Result<T,StorageError>+Send+'static)->Result<T,StorageError> {
    with_selected_store(app,workspace,true,work).await
}
async fn with_selected_store<T:Send+'static>(app:tauri::AppHandle,workspace:String,dispatch:bool,work:impl FnOnce(&mut Store)->Result<T,StorageError>+Send+'static)->Result<T,StorageError> {
    tauri::async_runtime::spawn_blocking(move||{
        let root=crate::task_panel_locations::owner(Path::new(&workspace))?;
        let state=app.state::<TaskWorkspaceState>();
        let mut guard=state.0.lock().map_err(|_|invalid("仓库任务状态不可用。"))?;
        if dispatch {
            for (other,store) in guard.iter().filter(|(other,_)|**other!=root) {
                if (root.starts_with(other)||other.starts_with(&root)) && crate::task_panel_store::executions(&store.db)?.iter().any(|r|crate::task_panel_store::is_live(&r.state)) {return Err(invalid("相互包含的仓库目录中仍有执行待结束或核对；独立仓库可分别推进。"));}
            }
        }
        let store=guard.get_mut(&root).ok_or_else(||invalid("请先打开此仓库的任务面板，未改用其他仓库。"))?;
        work(store)
    }).await.map_err(|_|invalid("仓库任务操作中断，原记录保留。"))?
}

#[tauri::command]
pub async fn task_panel_workspaces(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Vec<WorkspaceEntry>,StorageError> {
    crate::main_window(&window)?;catalog(&app)
}

#[tauri::command]
pub async fn task_panel_workspace_open(app:tauri::AppHandle,window:tauri::WebviewWindow,input:OpenWorkspaceInput)->Result<OpenedWorkspace,StorageError> {
    crate::main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move||{
        let root=crate::task_panel_locations::owner(Path::new(&input.path))?;
        let mut label=if input.label.trim().is_empty(){root.file_name().unwrap_or_default().to_string_lossy().into_owned()}else{input.label.trim().into()};
        if label.chars().count()>200 || !crate::task_panel_store::valid_scope(&input.scope) || input.scope.is_empty() {return Err(invalid("请检查仓库名称和读取范围。"));}
        let state=app.state::<TaskWorkspaceState>();let mut guard=state.0.lock().map_err(|_|invalid("仓库任务状态不可用。"))?;
        let mut migration=String::new();
        if !guard.contains_key(&root) {
            let mut store=open_store(&root)?;
            migration=crate::task_panel_legacy::import(&mut store,&config_directory(&app)?)?;
            guard.insert(root.clone(),store);
        }
        let store=guard.get_mut(&root).unwrap();
        let existing=crate::task_panel_store::repositories(&store.db)?.into_iter().find(|r|repository_root(Path::new(&r.path)).ok().as_ref()==Some(&root));
        let id=existing.as_ref().map(|r|r.id.clone()).unwrap_or_else(||format!("repo-{}",crate::task_panel_paths::hash(root.to_string_lossy().as_bytes())));
        if existing.is_none() || input.configure && existing.as_ref().is_some_and(|r|r.label!=label||r.scope!=input.scope) {
            store.task_panel_mutate(crate::task_panel_types::MutationInput{request_id:crate::task_panel_store::new_id(&store.db,"workspace-open")?,expected_revision:existing.as_ref().map(|r|r.revision),action:crate::task_panel_types::Mutation::Repository{id:id.clone(),label:label.clone(),path:root.to_string_lossy().into_owned(),scope:input.scope.clone(),project_id:None}})?;
        }
        let record=crate::task_panel_store::repository(&store.db,&id)?;label=record.label;
        let project=crate::task_panel_projects::repository_project(&store.db,&id)?;
        if let Some(project_id)=project.as_deref(){let imported=crate::task_panel_consolidation::consolidate(store,&id,project_id)?;if imported>0{migration=format!("已将 {imported} 个分支任务归入总仓库；任务 ID、窗格和原始记录保留，显示编号按总看板重新排列。");}}
        register(&app,WorkspaceEntry{path:root.to_string_lossy().into_owned(),label:label.clone()})?;
        Ok(OpenedWorkspace{path:root.to_string_lossy().into_owned(),label,repository_id:id,project_id:project,data_directory:store.root.join("task-panel").to_string_lossy().into_owned(),skill_path:store.task_setting("task-panel:archify")?.unwrap_or_else(||DEFAULT_ARCHIFY.into()),scope:record.scope,migration})
    }).await.map_err(|_|invalid("打开仓库任务面板时中断，原件保留。"))?
}

#[cfg(test)]
#[path = "task-panel-workspace-tests.rs"]
mod tests;

/// Forget only the launcher registration. Repository files and task history stay.
#[tauri::command]
pub async fn task_panel_workspace_forget(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String)->Result<(),StorageError>{
    crate::main_window(&window)?;
    let root=crate::task_panel_locations::owner(Path::new(&workspace))?;
    let state=app.state::<TaskWorkspaceState>();let mut guard=state.0.lock().map_err(|_|invalid("仓库状态不可用"))?;
    if let Some(store)=guard.get(&root){if crate::task_panel_store::executions(&store.db)?.iter().any(|r|crate::task_panel_store::is_live(&r.state)){return Err(invalid("仓库还有执行待核对，请先核对停止或交付。"));}}
    let mut entries=catalog(&app)?;entries.retain(|e|repository_root(Path::new(&e.path)).ok().as_ref()!=Some(&root));
    let file=catalog_path(&app)?;let mut pending=tempfile::NamedTempFile::new_in(file.parent().unwrap()).map_err(io)?;
    pending.write_all(&serde_json::to_vec_pretty(&entries).map_err(|_|invalid("仓库列表无法编码"))?).map_err(io)?;pending.as_file().sync_all().map_err(io)?;
    pending.persist(file).map_err(|_|invalid("移除仓库入口未完成，原数据保留。"))?;
    guard.remove(&root);Ok(())
}
