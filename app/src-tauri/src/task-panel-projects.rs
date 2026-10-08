use crate::storage::{StorageError, Store};
use crate::task_panel_store::{db_error, encode, expected, graph_link, graph_object, id_ok, invalid, now, repository, task};
use crate::task_panel_types::{TaskPlan, TaskProject};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use std::collections::HashSet;

// Additive migration: original tasks, events, receipts and graph identifiers stay intact.
pub fn create_schema(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("CREATE TABLE tp_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,summary TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_project_repositories(repository_id TEXT PRIMARY KEY REFERENCES tp_repositories(id),project_id TEXT NOT NULL REFERENCES tp_projects(id)) STRICT;
        CREATE TABLE tp_task_plans(task_id TEXT PRIMARY KEY REFERENCES tp_tasks(id),project_id TEXT REFERENCES tp_projects(id),goal_id TEXT REFERENCES tp_tasks(id),phase TEXT NOT NULL) STRICT;
        CREATE INDEX tp_plans_project ON tp_task_plans(project_id);
        CREATE TABLE tp_memory_origins(memory_id TEXT PRIMARY KEY REFERENCES tp_memories(id),category TEXT NOT NULL CHECK(category IN ('decision','reference')),level TEXT NOT NULL CHECK(level IN ('claim','user_confirmed')),source_refs TEXT NOT NULL,project_id TEXT REFERENCES tp_projects(id)) STRICT;
        CREATE TABLE tp_agent_grants(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tp_tasks(id),project_id TEXT NOT NULL REFERENCES tp_projects(id),task_revision INTEGER NOT NULL,token_hash TEXT NOT NULL,session_id TEXT NOT NULL,directory TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL) STRICT;").map_err(db_error)?;
    let repos: Vec<(String,String)> = db.prepare("SELECT id,label FROM tp_repositories ORDER BY id").map_err(db_error)?
        .query_map([], |r| Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?;
    for (repo,name) in repos {
        let id = format!("project-{}",crate::task_panel_paths::hash(repo.as_bytes()));
        db.execute("INSERT INTO tp_projects VALUES(?1,?2,'由已有仓库引用保留的项目归属',1,?3)",params![id,name,now()]).map_err(db_error)?;
        db.execute("INSERT INTO tp_project_repositories VALUES(?1,?2)",params![repo,id]).map_err(db_error)?;
        graph_object(db,&id,None,"project",&name,"observed",&json!({"migration":"repository_identity","repositoryId":repo}))?;
    }
    db.execute("INSERT INTO tp_task_plans SELECT t.id,p.project_id,NULL,'' FROM tp_tasks t LEFT JOIN tp_project_repositories p ON p.repository_id=t.repository_id",[]).map_err(db_error)?;
    // Historical goal links are retained; infer ownership only when all children agree.
    db.execute("UPDATE tp_task_plans SET goal_id=(SELECT r.to_id FROM tp_relations r JOIN tp_nodes n ON n.id=r.to_id JOIN tp_tasks g ON g.id=n.id WHERE r.from_id=task_id AND r.kind='related_to' AND r.active=1 AND n.kind='goal' ORDER BY r.id LIMIT 1)",[]).map_err(db_error)?;
    db.execute("UPDATE tp_task_plans AS p SET project_id=(SELECT min(c.project_id) FROM tp_task_plans c WHERE c.goal_id=p.task_id) WHERE p.project_id IS NULL AND (SELECT count(DISTINCT c.project_id) FROM tp_task_plans c WHERE c.goal_id=p.task_id)=1",[]).map_err(db_error)?;
    db.execute("UPDATE tp_task_plans SET goal_id=NULL WHERE goal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tp_task_plans g WHERE g.task_id=tp_task_plans.goal_id AND g.project_id IS tp_task_plans.project_id)",[]).map_err(db_error)?;
    let existing:Vec<(String,Option<String>,Option<String>)>=db.prepare("SELECT task_id,project_id,goal_id FROM tp_task_plans ORDER BY task_id").map_err(db_error)?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?;
    for (task_id,project,goal) in existing {if let Some(project)=project {
        let parent=goal.filter(|g|plan(db,g).ok().is_some_and(|p|p.project_id.as_ref()==Some(&project))).unwrap_or(project);
        graph_link(db,&parent,&task_id,"contains","observed","task_plan_membership")?;
    }}
    Ok(())
}

pub fn validate_schema(db: &Connection) -> Result<(), StorageError> {
    for sql in ["SELECT id,name,summary,revision,created_at FROM tp_projects LIMIT 0", "SELECT repository_id,project_id FROM tp_project_repositories LIMIT 0", "SELECT task_id,project_id,goal_id,phase FROM tp_task_plans LIMIT 0", "SELECT memory_id,category,level,source_refs,project_id FROM tp_memory_origins LIMIT 0", "SELECT id,task_id,project_id,task_revision,token_hash,session_id,directory,revoked,created_at FROM tp_agent_grants LIMIT 0"] { db.prepare(sql).map_err(db_error)?; }
    Ok(())
}

pub(crate) fn repository_project(db:&Connection,id:&str)->Result<Option<String>,StorageError>{
    db.query_row("SELECT project_id FROM tp_project_repositories WHERE repository_id=?1",[id],|r|r.get(0)).optional().map_err(db_error)
}
pub(crate) fn plan(db:&Connection,id:&str)->Result<TaskPlan,StorageError>{
    Ok(db.query_row("SELECT project_id,goal_id,phase FROM tp_task_plans WHERE task_id=?1",[id],|r|Ok(TaskPlan{project_id:r.get(0)?,goal_id:r.get(1)?,phase:r.get(2)?})).optional().map_err(db_error)?.unwrap_or_default())
}
pub(crate) fn projects(db:&Connection)->Result<Vec<TaskProject>,StorageError>{
    let mut result = db.prepare("SELECT id,name,summary,revision,created_at,EXISTS(SELECT 1 FROM app_meta m WHERE m.key='task-panel:project-deleted:'||p.id) FROM tp_projects p ORDER BY name,id").map_err(db_error)?
        .query_map([],|r|Ok(TaskProject{id:r.get(0)?,name:r.get(1)?,summary:r.get(2)?,revision:r.get(3)?,created_at:r.get(4)?,deleted:r.get(5)?,repository_ids:Vec::new()})).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    for p in &mut result { p.repository_ids=db.prepare("SELECT repository_id FROM tp_project_repositories WHERE project_id=?1 ORDER BY repository_id").map_err(db_error)?.query_map([&p.id],|r|r.get(0)).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?; }
    Ok(result)
}
pub(crate) fn require_active(db:&Connection,id:&str)->Result<(),StorageError>{
    let deleted:Option<bool>=db.query_row("SELECT EXISTS(SELECT 1 FROM app_meta WHERE key='task-panel:project-deleted:'||p.id) FROM tp_projects p WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
    match deleted {Some(false)=>Ok(()),Some(true)=>Err(invalid("项目已删除，原内容保留；请先在项目管理中恢复。")),None=>Err(invalid("项目不存在。"))}
}
pub(crate) fn require_task_active(db:&Connection,id:&str)->Result<(),StorageError>{
    if let Some(project)=plan(db,id)?.project_id {require_active(db,&project)?;}
    Ok(())
}
// A tombstone in the existing repository metadata keeps all ownership and
// foreign-key history intact, without rewriting or migrating user records.
pub(crate) fn set_deleted(db:&Connection,id:&str,deleted:bool,approved:bool,revision:Option<i64>)->Result<i64,StorageError>{
    if !approved||!id_ok(id){return Err(invalid("请核对并确认本次项目删除或恢复。"));}
    let old:i64=db.query_row("SELECT revision FROM tp_projects WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?.ok_or_else(||invalid("项目不存在。"))?;
    expected(old,revision)?;
    if deleted {
        let tasks:Vec<String>=db.prepare("SELECT task_id FROM tp_task_plans WHERE project_id=?1").map_err(db_error)?.query_map([id],|r|r.get(0)).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?;
        if crate::task_panel_store::executions(db)?.iter().any(|run|tasks.contains(&run.task_id)&&crate::task_panel_store::is_live(&run.state)) {
            return Err(invalid("项目还有未结束执行，请先停止并核对执行，再删除项目。"));
        }
        for task_id in tasks {if task(db,&task_id)?.lifecycle!="cancelled"&&crate::task_panel_execution::pending_creation(db,&task_id)?.is_some(){return Err(invalid("项目还有窗格创建待核对，请先处理对应任务，再删除项目。"));}}
        db.execute("INSERT INTO app_meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![format!("task-panel:project-deleted:{id}"),now()]).map_err(db_error)?;
    }else{db.execute("DELETE FROM app_meta WHERE key=?1",[format!("task-panel:project-deleted:{id}")]).map_err(db_error)?;}
    db.execute("UPDATE tp_projects SET revision=revision+1 WHERE id=?1",[id]).map_err(db_error)?;
    Ok(old+1)
}
pub(crate) fn save_project(db:&Connection,id:&str,name:&str,summary:&str,repos:&[String],revision:Option<i64>)->Result<i64,StorageError>{
    if !id_ok(id)||name.trim().is_empty()||name.chars().count()>200||summary.chars().count()>10000||repos.len()>100||repos.iter().collect::<HashSet<_>>().len()!=repos.len(){return Err(invalid("请填写项目名称和明确的工作区归属。"));}
    let old:Option<i64>=db.query_row("SELECT revision FROM tp_projects WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
    if let Some(v)=old{require_active(db,id)?;expected(v,revision)?;}else if revision.is_some(){return Err(crate::task_panel_store::conflict());}
    for repo in repos { repository(db,repo)?;if repository_project(db,repo)?.is_some_and(|p|p!=id){return Err(invalid("工作区已有项目归属；请保留原项目，并为独立执行登记不同目录或 Worktree。"));} }
    let previous:Vec<String>=db.prepare("SELECT repository_id FROM tp_project_repositories WHERE project_id=?1").map_err(db_error)?.query_map([id],|r|r.get(0)).map_err(db_error)?.collect::<Result<_,_>>().map_err(db_error)?;
    if previous.iter().any(|r|!repos.contains(r)){return Err(invalid("已有工作区归属保留；本次可以增加工作区，不隐式迁移历史任务。"));}
    let next=old.unwrap_or(0)+1;
    db.execute("INSERT INTO tp_projects VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,summary=excluded.summary,revision=excluded.revision",params![id,name.trim(),summary.trim(),next,now()]).map_err(db_error)?;
    for repo in repos {db.execute("INSERT INTO tp_project_repositories VALUES(?1,?2) ON CONFLICT(repository_id) DO NOTHING",params![repo,id]).map_err(db_error)?;}
    graph_object(db,id,None,"project",name,"user_confirmed",&json!({"summary":summary}))?;
    db.execute("UPDATE tp_nodes SET label=?1,sources=?2 WHERE id=?3",params![name.trim(),encode(&json!({"summary":summary}))?,id]).map_err(db_error)?;
    Ok(next)
}

pub(crate) fn save_plan(db:&Connection,id:&str,value:&TaskPlan)->Result<(),StorageError>{
    let t=task(db,id)?;
    if value.phase.chars().count()>100||value.goal_id.as_deref()==Some(id){return Err(invalid("阶段名称过长或目标不能指向自身。"));}
    if let Some(p)=&value.project_id {
        require_active(db,p)?;
        if let Some(repo)=&t.repository_id {if repository_project(db,repo)?.as_ref()!=Some(p){return Err(invalid("任务工作区与项目归属不一致，请先将工作区登记到该项目。"));}}
    }else if t.repository_id.is_some()||value.goal_id.is_some()||!value.phase.is_empty(){return Err(invalid("请先选择项目，再指定目标与阶段。"));}
    if let Some(g)=&value.goal_id {
        let kind:Option<String>=db.query_row("SELECT kind FROM tp_nodes WHERE id=?1",[g],|r|r.get(0)).optional().map_err(db_error)?;
        if kind.as_deref()!=Some("goal")||plan(db,g)?.project_id!=value.project_id{return Err(invalid("目标必须属于同一个项目。"));}
    }
    let old=plan(db,id)?;
    let established:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM tp_task_plans WHERE task_id=?1)",[id],|r|r.get(0)).map_err(db_error)?;
    if established&&old.project_id!=value.project_id {
        let has_children:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM tp_task_plans WHERE goal_id=?1)",[id],|r|r.get(0)).map_err(db_error)?;
        let dependent:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM tp_relations WHERE active=1 AND kind='depends_on' AND (from_id=?1 OR to_id=?1))",[id],|r|r.get(0)).map_err(db_error)?;
        if has_children||dependent{return Err(invalid("该对象仍关联目标下任务或前置依赖，请先核对这些关系，再调整项目归属。"));}
    }
    if old!=*value&&crate::task_panel_store::executions(db)?.iter().any(|r|r.task_id==id&&crate::task_panel_store::is_live(&r.state)){return Err(invalid("该任务仍有执行，归属保持不变；先核对原执行再调整项目。"));}
    db.execute("INSERT INTO tp_task_plans VALUES(?1,?2,?3,?4) ON CONFLICT(task_id) DO UPDATE SET project_id=excluded.project_id,goal_id=excluded.goal_id,phase=excluded.phase",params![id,value.project_id,value.goal_id,value.phase.trim()]).map_err(db_error)?;
    // Only ownership links created here are replaced; imported/user relations stay intact.
    db.execute("UPDATE tp_relations SET active=0,revision=revision+1 WHERE to_id=?1 AND source='task_plan_membership' AND active=1",[id]).map_err(db_error)?;
    if let Some(p)=&value.project_id {
        let parent=if !value.phase.trim().is_empty(){
            let phase_id=format!("phase-{}",crate::task_panel_paths::hash(encode(&(p,&value.goal_id,value.phase.trim()))?.as_bytes()));
            graph_object(db,&phase_id,None,"phase",value.phase.trim(),"user_confirmed",&json!({"projectId":p,"goalId":value.goal_id}))?;
            graph_link(db,value.goal_id.as_deref().unwrap_or(p),&phase_id,"contains","user_confirmed","task_plan_membership")?;phase_id
        }else{value.goal_id.clone().unwrap_or_else(||p.clone())};
        graph_link(db,&parent,id,"contains","user_confirmed","task_plan_membership")?;
    }
    Ok(())
}

pub(crate) fn node_project(db:&Connection,id:&str)->Result<Option<String>,StorageError>{
    let direct:Option<Option<String>>=db.query_row("SELECT project_id FROM tp_task_plans WHERE task_id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
    if let Some(project)=direct{return Ok(project);}
    let node:Option<(Option<String>,String,String)>=db.query_row("SELECT repository_id,kind,sources FROM tp_nodes WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_error)?;
    let Some((repo,kind,sources))=node else{return Ok(None)};
    if kind=="project"{return Ok(Some(id.into()));}
    if let Some(repo)=repo{return repository_project(db,&repo);}
    let source:serde_json::Value=serde_json::from_str(&sources).unwrap_or_default();
    if let Some(p)=source["projectId"].as_str(){return Ok(Some(p.into()));}
    let owner:Option<String>=db.query_row("SELECT task_id FROM tp_memories WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?.flatten();
    if let Some(owner)=owner{return Ok(plan(db,&owner)?.project_id);}
    let parent:Option<String>=db.query_row("SELECT p.project_id FROM tp_relations r JOIN tp_task_plans p ON p.task_id=r.from_id WHERE r.to_id=?1 AND r.active=1 AND r.kind IN ('related_to','governed_by','contains') AND p.project_id IS NOT NULL ORDER BY r.id LIMIT 1",[id],|r|r.get(0)).optional().map_err(db_error)?;
    Ok(parent)
}

pub(crate) fn workspaces_overlap(a:&str,b:&str)->bool {
    let normalize=|p:&str|{let p=std::fs::canonicalize(p).unwrap_or_else(|_|p.into()).to_string_lossy().replace('\\',"/");if cfg!(windows){p.to_lowercase()}else{p}};
    let a=normalize(a).trim_end_matches('/').to_string();let b=normalize(b).trim_end_matches('/').to_string();
    a==b||a.starts_with(&(b.clone()+"/"))||b.starts_with(&(a+"/"))
}

impl Store {
    pub fn task_panel_projects(&self)->Result<Vec<TaskProject>,StorageError>{projects(&self.db)}
}
