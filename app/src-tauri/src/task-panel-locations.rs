//! Repository identity is shared; each task may execute in a registered Git worktree.
use crate::{storage::StorageError, task_panel_store::{db_error, decode, invalid, repository}, task_panel_types::{Repository, Task}};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ExecutionWorkspace { pub path:String, pub branch:String, pub base:String }

pub fn key(task_id:&str)->String {format!("task-panel:execution-workspace:{task_id}")}
pub fn prepared_key(path:&str)->String {format!("task-panel:prepared-pane:{}",crate::task_panel_paths::hash(path.as_bytes()))}
pub fn assigned(db:&Connection,task_id:&str)->Result<Option<ExecutionWorkspace>,StorageError> {
    let raw:Option<String>=db.query_row("SELECT value FROM app_meta WHERE key=?",[key(task_id)],|r|r.get(0)).optional().map_err(db_error)?;
    raw.map(|s|decode(&s)).transpose()
}
pub fn worktrees(root:&Path)->Result<Vec<PathBuf>,StorageError> {
    let raw=crate::task_panel_snapshots::git(root,&["worktree","list","--porcelain","-z"])?;
    let mut result=Vec::new();
    for (index,path) in raw.split('\0').filter_map(|s|s.strip_prefix("worktree ")).enumerate(){
        // Git retains prunable entries from old machines. They do not prevent
        // opening the live repository, and are never removed by this application.
        if index>0&&!Path::new(path).is_dir(){continue;}
        result.push(crate::task_panel_workspace::repository_root(Path::new(path))?);
    }
    Ok(result)
}
pub fn owner(path:&Path)->Result<PathBuf,StorageError> {
    let root=crate::task_panel_workspace::repository_root(path)?;
    // A plain directory inside a repository is not a registered worktree.
    if crate::task_panel_snapshots::git(&root,&["rev-parse","--show-toplevel"]).ok().and_then(|s|std::fs::canonicalize(s.trim()).ok()).as_ref()!=Some(&root){
        if root.join(".git").is_file(){return Err(invalid("无法确认这个 Worktree 的总仓库，未打开独立任务库。"));}
        return Ok(root);
    }
    let trees=worktrees(&root)?;
    trees.first().cloned().ok_or_else(||invalid("Git 总仓库位置无法确认，未新建另一份任务库。"))
}
pub fn execution_repository(db:&Connection,task:&Task)->Result<Repository,StorageError> {
    let mut repo=repository(db,task.repository_id.as_deref().ok_or_else(||invalid("任务缺少仓库。"))?)?;
    if let Some(location)=assigned(db,&task.id)? {
        let actual=crate::task_panel_workspace::repository_root(Path::new(&location.path))?;
        let root=crate::task_panel_workspace::repository_root(Path::new(&repo.path))?;
        if actual!=root && (owner(&actual)?!=root || !worktrees(&root)?.contains(&actual)){return Err(invalid("任务执行目录已不属于这个总仓库，请恢复原 Worktree 后重试。"));}
        repo.path=actual.to_string_lossy().into_owned();
    }
    Ok(repo)
}
pub fn overlap(a:&str,b:&str)->bool {
    if !crate::task_panel_projects::workspaces_overlap(a,b){return false;}
    let roots=std::fs::canonicalize(a).ok().zip(std::fs::canonicalize(b).ok());
    if let Some((a,b))=roots {if a!=b && owner(&a).ok().zip(owner(&b).ok()).is_some_and(|(x,y)|x==y) && worktrees(&a).is_ok_and(|trees|trees.contains(&a)&&trees.contains(&b)){return false;}}
    true
}

// Paths are collected under the store lock; Git observation runs outside it.
pub fn paths(db:&Connection)->std::collections::BTreeSet<String>{
    let Ok(mut stmt)=db.prepare("SELECT value FROM app_meta WHERE key LIKE 'task-panel:execution-workspace:%'") else{return Default::default()};
    let Ok(rows)=stmt.query_map([],|r|r.get::<_,String>(0)) else{return Default::default()};
    rows.filter_map(|r|r.ok().and_then(|s|serde_json::from_str::<ExecutionWorkspace>(&s).ok()).map(|w|w.path)).collect()
}
