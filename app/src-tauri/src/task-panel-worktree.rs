use crate::{storage::StorageError, task_panel_store::{invalid, encode, request, receipt}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};


#[derive(Deserialize, Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct WorktreeInput {pub request_id:String,pub task_id:String,pub branch:String,pub label:String,pub approved:bool}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase")]
pub struct WorktreeResult {pub path:String,pub branch:String,pub base:String,pub creation:Value,pub session:String,pub error:String}

#[tauri::command]
pub async fn task_panel_worktree(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:WorktreeInput)->Result<WorktreeResult,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|store|{
        if !input.approved||input.branch.is_empty()||input.branch.len()>100||!input.branch.bytes().all(|b|b.is_ascii_alphanumeric()||b"/-_".contains(&b))||input.branch.starts_with('-')||input.label.len()>200 {return Err(invalid("请确认新分支名称和任务窗格名称。"));}
        let encoded=encode(&input)?;
        if let Some(previous)=request(&store.db,&input.request_id,&encoded)?{return Ok(previous);}
        let task=crate::task_panel_store::task(&store.db,&input.task_id)?;
        crate::task_panel_projects::require_task_active(&store.db,&task.id)?;
        if crate::task_panel_store::executions(&store.db)?.iter().any(|r|r.task_id==task.id){return Err(invalid("已有执行历史的任务不能更换执行目录，请创建新任务。"));}
        let root=store.task_workspace.as_ref().ok_or_else(||invalid("请先打开任务仓库"))?.clone();
        if crate::task_panel_locations::assigned(&store.db,&task.id)?.is_some(){return Err(invalid("任务已有分支执行位置，未创建第二个工作目录。"));}
        let repo=crate::task_panel_store::repository(&store.db,task.repository_id.as_deref().ok_or_else(||invalid("先为任务选择总仓库。"))?)?;
        if crate::task_panel_workspace::repository_root(std::path::Path::new(&repo.path))?!=root{return Err(invalid("任务不属于当前总仓库。"));}
        let git=crate::task_panel_monitor::git(&root);
        if !git.error.is_empty()||git.head.len()!=40{return Err(invalid("不能确认 Git 基线，未创建分支。"));}

        let intent=store.task_setting(&format!("task-panel:worktree-intent:{}",task.id))?.map(|raw|crate::task_panel_store::decode::<WorktreeInput>(&raw)).transpose()?;
        if intent.as_ref().is_some_and(|old|old.branch!=input.branch){return Err(invalid("原分支创建结果尚未核对，请先选择仅保留任务，再修改分支；不会重复创建。"));}
        let previous:Option<WorktreeResult>=if let Some(old)=&intent{use rusqlite::OptionalExtension;let raw:Option<String>=store.db.query_row("SELECT result FROM tp_requests WHERE id=?1",[&old.request_id],|r|r.get(0)).optional().map_err(crate::task_panel_store::db_error)?;raw.map(|s|crate::task_panel_store::decode(&s)).transpose()?}else{None};
        let parent=crate::task_panel_workspace::directory(&root,".azcine/worktrees")?;
        let path=previous.as_ref().map(|old|std::path::PathBuf::from(&old.path)).unwrap_or_else(||parent.join(format!("{}-{}",input.branch.replace('/',"-"),&crate::task_panel_paths::hash(input.request_id.as_bytes())[..8])));
        if !path.starts_with(&parent){return Err(invalid("原创建目录不在本仓库的执行目录中，未继续创建。"));}
        if path.exists()&&previous.is_none(){return Err(invalid("分支工作目录已存在，未覆盖。"));}
        let mut config=store.task_panel_herdr_config()?;
        if let Some(old)=&previous {config.session=old.session.clone();}
        let config=if path.exists(){config}else{crate::herdr_adapter::discover(config,Some(&root))?};
        let mut result=previous.unwrap_or(WorktreeResult{path:path.to_string_lossy().into_owned(),branch:input.branch.clone(),base:git.head,creation:Value::Null,session:config.session.clone(),error:"创建结果尚未核对；重试不会重复创建".into()});
        if !path.exists()&&crate::task_panel_snapshots::git(&root,&["show-ref","--verify",&format!("refs/heads/{}",input.branch)]).is_ok(){return Err(invalid("分支已存在，但原目录未核对，不能再创建或覆盖；请先恢复原位置。"));}
        store.save_task_setting(&format!("task-panel:worktree-intent:{}",task.id),&encoded)?;
        receipt(&store.db,&input.request_id,&encoded,&result)?;
        let created=if path.exists(){Ok(result.creation.clone())}else{crate::herdr_adapter::call(&config,"worktree.create",json!({"cwd":root,"branch":input.branch,"base":result.base,"path":result.path,"label":input.label}))};
        match created{
            Ok(created)=>{result.creation=created;let observed=crate::task_panel_monitor::git(&path);if observed.branch==result.branch&&observed.head==result.base {result.error.clear();let actual=crate::task_panel_workspace::repository_root(&path)?;
                if crate::task_panel_locations::owner(&actual)?!=root{return Err(invalid("新工作目录不属于当前总仓库，未关联。"));}
                let location=crate::task_panel_locations::ExecutionWorkspace{path:actual.to_string_lossy().into_owned(),branch:result.branch.clone(),base:result.base.clone()};
                let tx=store.db.transaction().map_err(crate::task_panel_store::db_error)?;
                tx.execute("INSERT INTO app_meta VALUES(?,?)",rusqlite::params![crate::task_panel_locations::key(&task.id),encode(&location)?]).map_err(crate::task_panel_store::db_error)?;
                tx.execute("INSERT INTO app_meta VALUES(?,?)",rusqlite::params![crate::task_panel_locations::prepared_key(&location.path),encode(&json!({"creation":result.creation,"session":result.session}))?]).map_err(crate::task_panel_store::db_error)?;
                tx.execute("DELETE FROM app_meta WHERE key=?",[format!("task-panel:worktree-intent:{}",task.id)]).map_err(crate::task_panel_store::db_error)?;
                tx.commit().map_err(crate::task_panel_store::db_error)?;}else{result.error="Herdr 已返回创建结果，但分支或基线尚未匹配；请核对保留的位置。".into();}},
            Err(error)=>result.error=error.message,
        }
        store.db.execute("UPDATE tp_requests SET result=?1 WHERE id=?2",rusqlite::params![encode(&result)?,input.request_id]).map_err(crate::task_panel_store::db_error)?;
        crate::task_panel_store::event(&store.db,&input.request_id,"workspace","worktree_created","user",&encode(&result)?)?;
        Ok(result)
    }).await
}
