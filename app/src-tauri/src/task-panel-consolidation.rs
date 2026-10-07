//! Preserve old per-worktree stores and consolidate their history into the repository store.
use crate::{storage::{Store,StorageError},task_panel_store::{db_error,invalid,encode},task_panel_workspace::{directory,preserve},task_panel_locations::{self,ExecutionWorkspace}};
use rusqlite::{params,OptionalExtension};
use std::{fs,path::Path};

fn copy_tree(source:&Path,target:&Path)->Result<(),StorageError>{
    if !source.exists(){return Ok(());}
    let canonical=fs::canonicalize(source).map_err(|_|invalid("旧交付目录不可读。"))?;
    if canonical!=source{return Err(invalid("旧交付目录含重定向，原件保留，未复制。"));}
    for entry in fs::read_dir(source).map_err(|_|invalid("旧交付目录不可读。"))? {
        let entry=entry.map_err(|_|invalid("旧交付文件不可读。"))?;
        let name=entry.file_name();let name=name.to_string_lossy();
        if name=="access"{continue;} // Never duplicate a capability or its credential file.
        let path=entry.path();let actual=fs::canonicalize(&path).map_err(|_|invalid("旧交付原件不可读。"))?;
        if actual!=path{return Err(invalid("旧交付文件含重定向，未复制。"));}
        if actual.is_dir(){copy_tree(&actual,&directory(target,&name)?)?;}
        else{preserve(&target.join(name.as_ref()),&crate::task_panel_paths::protected_absolute(&actual,64_000_000)?)?;}
    }Ok(())
}

pub fn consolidate(store:&mut Store,repository_id:&str,project_id:&str)->Result<usize,StorageError>{
    let root=store.task_workspace.as_ref().ok_or_else(||invalid("缺少总仓库位置。"))?.clone();
    // Non-Git task directories have no child worktrees.
    let trees=match task_panel_locations::worktrees(&root){Ok(v)=>v,Err(_)=>return Ok(0)};
    let mut count=0;
    for child in trees.into_iter().filter(|p|p!=&root){
        let panel=child.join(".azcine/task-panel");let source=panel.join("state.sqlite3");
        if !source.is_file(){continue;}
        let marker=format!("task-panel:consolidated:{}",crate::task_panel_paths::hash(child.to_string_lossy().as_bytes()));
        if store.task_setting(&marker)?.is_some(){continue;}
        if fs::canonicalize(&source).map_err(|_|invalid("分支任务库不可读。"))?!=source{return Err(invalid("分支任务库包含重定向，未合并。"));}
        let _lock=crate::task_panel_workspace::lock(&panel)?;
        let mut uri=url::Url::from_file_path(&source).map_err(|_|invalid("分支任务库路径无效。"))?;uri.query_pairs_mut().append_pair("mode","ro");
        store.db.execute("ATTACH DATABASE ? AS branch_history",[uri.as_str()]).map_err(db_error)?;
        let result=(||{
            let application:i64=store.db.query_row("PRAGMA branch_history.application_id",[],|r|r.get(0)).map_err(db_error)?;
            let version:i64=store.db.query_row("PRAGMA branch_history.user_version",[],|r|r.get(0)).map_err(db_error)?;
            if application!=0x415A5450||version!=1{return Err(invalid("分支任务库版本不兼容，原件保留。"));}
            let repos:Vec<(String,String)>=store.db.prepare("SELECT id,path FROM branch_history.tp_repositories").map_err(db_error)?.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?;
            if repos.len()!=1||fs::canonicalize(&repos[0].1).ok().as_ref()!=Some(&child){return Err(invalid("分支任务库含不同仓库归属，未自动混合。"));}
            let old_project:String=store.db.query_row("SELECT project_id FROM branch_history.tp_project_repositories WHERE repository_id=?",[&repos[0].0],|r|r.get(0)).map_err(db_error)?;
            let foreign_projects:i64=store.db.query_row("SELECT count(*) FROM branch_history.tp_projects WHERE id<>?",[&old_project],|r|r.get(0)).map_err(db_error)?;
            if foreign_projects>0{return Err(invalid("分支任务库包含多个项目，请保留原记录核对归属。"));}
            let live:bool=store.db.query_row("SELECT EXISTS(SELECT 1 FROM branch_history.tp_executions WHERE state IN ('sending','awaiting_receipt','accepted','running','blocked','uncertain','disconnected'))",[],|r|r.get(0)).map_err(db_error)?;
            if live{return Err(invalid("分支仍有未结束执行，记录保留；核对原执行后才能归入总仓库。"));}
            let tasks:Vec<(String,i64)>=store.db.prepare("SELECT id,number FROM branch_history.tp_tasks ORDER BY number").map_err(db_error)?.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?;
            if tasks.is_empty(){store.save_task_setting(&marker,"empty")?;return Ok(0);}
            let backup=directory(&store.root,"task-panel/backups")?.join(format!("before-consolidation-{}.sqlite3",crate::task_panel_store::new_id(&store.db,"backup")?));
            store.db.execute("VACUUM main INTO ?",[backup.to_string_lossy().as_ref()]).map_err(db_error)?;
            let git=crate::task_panel_monitor::git(&child);
            let location=ExecutionWorkspace{path:child.to_string_lossy().into_owned(),branch:git.branch,base:git.head};
            let own=store.root.clone();
            let tx=store.db.transaction().map_err(db_error)?;
            tx.pragma_update(None,"defer_foreign_keys",true).map_err(db_error)?;
            let first:i64=tx.query_row("SELECT coalesce(max(number),0) FROM tp_tasks",[],|r|r.get(0)).map_err(db_error)?;
            // Identifiers and frozen context/snapshot JSON are retained. Only ownership
            // columns and conflicting display numbers are remapped; conflicts roll back.
            for table in ["tp_tasks","tp_nodes","tp_relations","tp_memories","tp_bindings","tp_snapshots","tp_contexts","tp_executions","tp_evidence","tp_acceptances","tp_imports","tp_analysis_versions","tp_task_plans","tp_memory_origins","tp_events","tp_requests"]{
                let columns:Vec<String>=tx.prepare(&format!("PRAGMA main.table_info({table})")).map_err(db_error)?.query_map([],|r|r.get(1)).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?;
                let columns:Vec<_>=columns.into_iter().filter(|c|!(table=="tp_events"&&c=="sequence")).collect();
                let expressions:Vec<String>=columns.iter().map(|column|match column.as_str(){
                    "repository_id"=>"CASE WHEN repository_id IS NULL THEN NULL ELSE ?1 END".into(),
                    "project_id"=>"CASE WHEN project_id IS NULL THEN NULL ELSE ?2 END".into(),
                    "from_id"|"to_id"=>format!("CASE WHEN {column}=?3 THEN ?2 ELSE {column} END"),
                    "number" if table=="tp_tasks"=>format!("{first}+row_number() OVER (ORDER BY number)"),
                    _=>format!("\"{column}\"")
                }).collect();
                let filter=if table=="tp_nodes"{"id<>?3"}else{"1=1"};
                // A CTE binds all remapping parameters, including for tables without owner columns.
                let sql=format!("WITH mapping AS (SELECT ?1,?2,?3) INSERT INTO main.{table} ({}) SELECT {} FROM branch_history.{table} WHERE {filter}",columns.join(","),expressions.join(","));
                tx.execute(&sql,params![repository_id,project_id,old_project]).map_err(db_error)?;
            }
            // Imported repository-wide proposals remain references until explicitly
            // reviewed against the common project. Task-scoped facts retain their scope.
            tx.execute("UPDATE tp_memories SET status='draft' WHERE id IN (SELECT id FROM branch_history.tp_memories WHERE task_id IS NULL AND status='active')",[]).map_err(db_error)?;
            for (id,old_number) in &tasks {
                if !crate::task_panel_store::id_ok(id){return Err(invalid("旧任务标识无效。"));}
                tx.execute("INSERT INTO app_meta VALUES(?,?)",params![task_panel_locations::key(id),encode(&location)?]).map_err(db_error)?;
                let prefix=format!("task-panel:profile:{id}");
                let profile:Option<String>=tx.query_row("SELECT value FROM branch_history.app_meta WHERE key=?",[&prefix],|r|r.get(0)).optional().map_err(db_error)?;
                if let Some(value)=profile{tx.execute("INSERT INTO app_meta VALUES(?,?)",params![prefix,value]).map_err(db_error)?;}
                let target=directory(&own,&format!("task-panel/tasks/{id}"))?;
                copy_tree(&panel.join("tasks").join(id),&target)?;
                crate::task_panel_store::event(&tx,&marker,id,"workspace_consolidated","observed",&serde_json::json!({"source":child,"previousNumber":old_number,"executionWorkspace":location,"originalStorePreserved":true}).to_string())?;
            }
            let files:Vec<(String,String,String)>=tx.prepare("SELECT id,path,hash FROM branch_history.tp_evidence WHERE path<>''").map_err(db_error)?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?;
            for (id,path,digest) in files{
                if !crate::task_panel_store::id_ok(&id)||id.contains(':'){return Err(invalid("旧证据标识无效。"));}
                if !Path::new(&path).is_file(){continue;} // Missing originals remain visibly missing.
                let bytes=crate::task_panel_paths::protected_absolute(Path::new(&path),64_000_000)?;
                if crate::task_panel_paths::hash(&bytes)!=digest{return Err(invalid("旧交付原件哈希已改变，合并未提交。"));}
                let dest=directory(&own,"task-panel/consolidated-evidence")?.join(&id);preserve(&dest,&bytes)?;
                tx.execute("UPDATE tp_evidence SET path=? WHERE id=?",params![dest.to_string_lossy(),id]).map_err(db_error)?;
            }
            copy_tree(&panel.join("imports"),&directory(&own,"task-panel/imports")?)?;
            tx.execute("UPDATE tp_graph_meta SET revision=max(revision,(SELECT revision FROM branch_history.tp_graph_meta WHERE id=1))+1 WHERE id=1",[]).map_err(db_error)?;
            tx.execute("INSERT INTO app_meta VALUES(?,?)",params![marker,serde_json::json!({"source":source,"backup":backup,"tasks":tasks,"at":crate::task_panel_store::now()}).to_string()]).map_err(db_error)?;
            if tx.prepare("PRAGMA main.foreign_key_check").map_err(db_error)?.exists([]).map_err(db_error)?{return Err(invalid("任务历史存在缺失关联，合并未提交，原件保留。"));}
            tx.commit().map_err(db_error)?;Ok(tasks.len())
        })();
        let detached=store.db.execute_batch("DETACH DATABASE branch_history").map_err(db_error);
        count+=result?;detached?;
    }Ok(count)
}
