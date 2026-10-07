use crate::storage::{StorageError, Store};
use crate::task_panel_types::*;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use std::collections::HashSet;

pub(crate) fn db_error(_: rusqlite::Error) -> StorageError {
    StorageError::new("task_panel_database", "任务记录操作失败，原记录和输入已保留。请核对后重试。")
}
pub(crate) fn invalid(message: &str) -> StorageError { StorageError::new("invalid_task_panel", message) }
pub(crate) fn conflict() -> StorageError { StorageError::new("task_panel_conflict", "记录已改变，请重新读取后核对；未覆盖新记录，编辑草稿保留。") }
pub(crate) fn encode<T: Serialize + ?Sized>(value: &T) -> Result<String, StorageError> {
    serde_json::to_string(value).map_err(|_| invalid("无法保存任务内容。"))
}
pub(crate) fn decode<T: DeserializeOwned>(raw: &str) -> Result<T, StorageError> {
    serde_json::from_str(raw).map_err(|_| invalid("任务记录格式不兼容，请保留原件并核对。"))
}
pub(crate) fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 160 && id.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_:".contains(&c))
}
pub(crate) fn new_id(db: &Connection, prefix: &str) -> Result<String, StorageError> {
    let value: String = db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0)).map_err(db_error)?;
    Ok(format!("{prefix}-{value}"))
}
pub(crate) fn now() -> String { chrono::Utc::now().to_rfc3339() }
pub(crate) fn graph_revision(db: &Connection) -> Result<i64, StorageError> {
    db.query_row("SELECT revision FROM tp_graph_meta WHERE id=1", [], |r| r.get(0)).map_err(db_error)
}
pub(crate) fn bump_graph(db: &Connection) -> Result<i64, StorageError> {
    db.execute("UPDATE tp_graph_meta SET revision=revision+1 WHERE id=1", []).map_err(db_error)?;
    graph_revision(db)
}
pub(crate) fn event(db: &Connection, request: &str, object: &str, kind: &str, actor: &str, detail: &str) -> Result<i64, StorageError> {
    db.execute("INSERT INTO tp_events(request_id,object_id,kind,actor,detail,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
        params![request,object,kind,actor,detail,now()]).map_err(db_error)?;
    Ok(db.last_insert_rowid())
}
pub(crate) fn graph_object(db:&Connection,id:&str,repo:Option<&str>,kind:&str,label:&str,level:&str,sources:&serde_json::Value)->Result<(),StorageError>{
    db.execute("INSERT INTO tp_nodes VALUES(?1,?2,?3,?4,'','',?5,?6,0) ON CONFLICT(id) DO NOTHING",params![id,repo,kind,label,level,encode(sources)?]).map_err(db_error)?;Ok(())
}
pub(crate) fn graph_link(db:&Connection,from:&str,to:&str,kind:&str,level:&str,source:&str)->Result<(),StorageError>{
    db.execute("INSERT INTO tp_relations VALUES(?1,?2,?3,?4,'none',?5,?6,1,1) ON CONFLICT DO NOTHING",params![new_id(db,"rel")?,from,to,kind,source,level]).map_err(db_error)?;Ok(())
}

pub fn create_schema(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("CREATE TABLE tp_graph_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision>=0)) STRICT;
        INSERT INTO tp_graph_meta VALUES(1,0);
        CREATE TABLE tp_repositories(id TEXT PRIMARY KEY,label TEXT NOT NULL,path TEXT NOT NULL UNIQUE,scope TEXT NOT NULL,
          revision INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_tasks(id TEXT PRIMARY KEY,number INTEGER NOT NULL UNIQUE,title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
          goal TEXT NOT NULL,scope TEXT NOT NULL,criteria TEXT NOT NULL,repository_id TEXT REFERENCES tp_repositories(id),
          lifecycle TEXT NOT NULL CHECK(lifecycle IN ('draft','active','paused','cancelled')),pause_reason TEXT NOT NULL,
          source TEXT NOT NULL,resume_summary TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_nodes(id TEXT PRIMARY KEY,repository_id TEXT REFERENCES tp_repositories(id),kind TEXT NOT NULL,label TEXT NOT NULL,
          path TEXT NOT NULL,symbol TEXT NOT NULL,evidence_level TEXT NOT NULL CHECK(evidence_level IN ('claim','observed','user_confirmed','fixture')),
          sources TEXT NOT NULL,stale INTEGER NOT NULL CHECK(stale IN (0,1))) STRICT;
        CREATE TABLE tp_relations(id TEXT PRIMARY KEY,from_id TEXT NOT NULL REFERENCES tp_nodes(id),to_id TEXT NOT NULL REFERENCES tp_nodes(id),
          kind TEXT NOT NULL CHECK(kind IN ('depends_on','related_to','governed_by','supported_by','executed_by','produced','checked_by','imports','calls','registers','reads','writes','contains','may_affect')),
          threshold TEXT NOT NULL CHECK(threshold IN ('acceptance','technical','none')),source TEXT NOT NULL,
          evidence_level TEXT NOT NULL CHECK(evidence_level IN ('claim','observed','user_confirmed','fixture')),active INTEGER NOT NULL CHECK(active IN (0,1)),
          revision INTEGER NOT NULL CHECK(revision>0)) STRICT;
        CREATE UNIQUE INDEX tp_relation_active ON tp_relations(from_id,to_id,kind) WHERE active=1;
        CREATE INDEX tp_relations_to ON tp_relations(to_id,active);
        CREATE TABLE tp_memories(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tp_tasks(id),repository_id TEXT REFERENCES tp_repositories(id),
          kind TEXT NOT NULL CHECK(kind IN ('decision','memory','pause','goal','requirement')),body TEXT NOT NULL,source TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('draft','active','superseded','cancelled')),supersedes TEXT REFERENCES tp_memories(id),
          base_task_revision INTEGER,revision INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL,object_id TEXT NOT NULL,kind TEXT NOT NULL,
          actor TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE INDEX tp_events_object ON tp_events(object_id,sequence);
        CREATE TABLE tp_requests(id TEXT PRIMARY KEY,input TEXT NOT NULL,result TEXT NOT NULL) STRICT;
        CREATE TABLE tp_bindings(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tp_tasks(id),server_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
          pane_id TEXT NOT NULL,agent_id TEXT NOT NULL,kind TEXT NOT NULL,cwd TEXT NOT NULL,generation INTEGER NOT NULL,state TEXT NOT NULL,checked_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_snapshots(id TEXT PRIMARY KEY,repository_id TEXT NOT NULL REFERENCES tp_repositories(id),head TEXT,content TEXT NOT NULL,
          fingerprint TEXT NOT NULL,consistent INTEGER NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_contexts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tp_tasks(id),task_revision INTEGER NOT NULL,graph_revision INTEGER NOT NULL,
          snapshot_id TEXT REFERENCES tp_snapshots(id),content TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_executions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tp_tasks(id),task_revision INTEGER NOT NULL,context_id TEXT NOT NULL REFERENCES tp_contexts(id),
          binding_id TEXT NOT NULL REFERENCES tp_bindings(id),binding_generation INTEGER NOT NULL,state TEXT NOT NULL,
          attempt INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,authorization TEXT NOT NULL,snapshot_id TEXT REFERENCES tp_snapshots(id),
          reason TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
        CREATE UNIQUE INDEX tp_execution_live ON tp_executions(task_id) WHERE state IN ('sending','awaiting_receipt','accepted','running','blocked','uncertain','disconnected');
        CREATE TABLE tp_evidence(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tp_tasks(id),execution_id TEXT NOT NULL REFERENCES tp_executions(id),
          task_revision INTEGER NOT NULL,kind TEXT NOT NULL,level TEXT NOT NULL CHECK(level IN ('claim','observed','user_confirmed','fixture')),
          status TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,detail TEXT NOT NULL,snapshot_id TEXT REFERENCES tp_snapshots(id),created_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_acceptances(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tp_tasks(id),task_revision INTEGER NOT NULL,
          execution_id TEXT NOT NULL REFERENCES tp_executions(id),snapshot_id TEXT REFERENCES tp_snapshots(id),accepted INTEGER NOT NULL CHECK(accepted IN (0,1)),
          reason TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_imports(id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL UNIQUE,repository_id TEXT NOT NULL REFERENCES tp_repositories(id),run_id TEXT REFERENCES tp_executions(id),
          base_graph_revision INTEGER NOT NULL,content TEXT NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE tp_analysis_versions(id TEXT PRIMARY KEY,import_id TEXT NOT NULL REFERENCES tp_imports(id),graph_revision INTEGER NOT NULL,
          artifacts TEXT NOT NULL,review TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;").map_err(db_error)
}
pub fn validate_schema(db: &Connection) -> Result<(), StorageError> {
    for sql in ["SELECT id,revision FROM tp_graph_meta LIMIT 0", "SELECT id,number,title,goal,scope,criteria,repository_id,lifecycle,pause_reason,source,resume_summary,revision,created_at,updated_at FROM tp_tasks LIMIT 0",
        "SELECT id,label,path,scope,revision,created_at FROM tp_repositories LIMIT 0", "SELECT id,from_id,to_id,kind,threshold,source,evidence_level,active,revision FROM tp_relations LIMIT 0",
        "SELECT id,task_id,repository_id,kind,body,source,status,supersedes,base_task_revision,revision,created_at FROM tp_memories LIMIT 0",
        "SELECT sequence,request_id,object_id,kind,actor,detail,created_at FROM tp_events LIMIT 0", "SELECT id,input,result FROM tp_requests LIMIT 0",
        "SELECT id,task_id,server_id,workspace_id,pane_id,agent_id,kind,cwd,generation,state,checked_at FROM tp_bindings LIMIT 0",
        "SELECT id,task_id,task_revision,context_id,binding_id,binding_generation,state,attempt,request_id,authorization,snapshot_id,reason,created_at,updated_at FROM tp_executions LIMIT 0",
        "SELECT id,repository_id,head,content,fingerprint,consistent,created_at FROM tp_snapshots LIMIT 0", "SELECT id,task_id,task_revision,graph_revision,snapshot_id,content,hash,created_at FROM tp_contexts LIMIT 0",
        "SELECT id,task_id,execution_id,task_revision,kind,level,status,path,hash,detail,snapshot_id,created_at FROM tp_evidence LIMIT 0",
        "SELECT id,task_id,task_revision,execution_id,snapshot_id,accepted,reason,created_at FROM tp_acceptances LIMIT 0",
        "SELECT id,analysis_id,repository_id,run_id,base_graph_revision,content,hash,status,source,created_at FROM tp_imports LIMIT 0",
        "SELECT id,import_id,graph_revision,artifacts,review,created_at FROM tp_analysis_versions LIMIT 0", "SELECT id,repository_id,kind,label,path,symbol,evidence_level,sources,stale FROM tp_nodes LIMIT 0"] {
        db.prepare(sql).map_err(db_error)?;
    }
    Ok(())
}
fn json_column<T: DeserializeOwned>(r: &rusqlite::Row<'_>, n: usize) -> rusqlite::Result<T> {
    let raw: String = r.get(n)?;
    serde_json::from_str(&raw).map_err(|e| rusqlite::Error::FromSqlConversionFailure(n,rusqlite::types::Type::Text,Box::new(e)))
}
pub(crate) fn task_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {id:r.get(0)?,number:r.get(1)?,title:r.get(2)?,goal:r.get(3)?,scope:json_column(r,4)?,criteria:json_column(r,5)?,repository_id:r.get(6)?,
        lifecycle:r.get(7)?,pause_reason:r.get(8)?,source:r.get(9)?,resume_summary:r.get(10)?,revision:r.get(11)?,created_at:r.get(12)?,updated_at:r.get(13)?})
}
pub(crate) const TASK_COLUMNS: &str = "id,number,title,goal,scope,criteria,repository_id,lifecycle,pause_reason,source,resume_summary,revision,created_at,updated_at";
pub(crate) fn task(db: &Connection, id: &str) -> Result<Task, StorageError> {
    db.query_row(&format!("SELECT {TASK_COLUMNS} FROM tp_tasks WHERE id=?1"),[id],task_row).optional().map_err(db_error)?.ok_or_else(||invalid("任务不存在。"))
}
pub(crate) fn repository(db: &Connection, id: &str) -> Result<Repository, StorageError> {
    db.query_row("SELECT id,label,path,scope,revision,created_at FROM tp_repositories WHERE id=?1",[id],repository_row).optional().map_err(db_error)?.ok_or_else(||invalid("仓库引用不存在。"))
}
pub(crate) fn repositories(db:&Connection)->Result<Vec<Repository>,StorageError>{
    db.prepare("SELECT id,label,path,scope,revision,created_at FROM tp_repositories ORDER BY label").map_err(db_error)?.query_map([],repository_row).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
fn repository_row(r:&rusqlite::Row<'_>) -> rusqlite::Result<Repository> {
    Ok(Repository{id:r.get(0)?,label:r.get(1)?,path:r.get(2)?,scope:json_column(r,3)?,revision:r.get(4)?,created_at:r.get(5)?})
}
fn relation_row(r:&rusqlite::Row<'_>) -> rusqlite::Result<Relation> {
    Ok(Relation{id:r.get(0)?,from_id:r.get(1)?,to_id:r.get(2)?,kind:r.get(3)?,threshold:r.get(4)?,source:r.get(5)?,evidence_level:r.get(6)?,active:r.get(7)?,revision:r.get(8)?})
}
pub(crate) fn relations(db:&Connection) -> Result<Vec<Relation>,StorageError> {
    db.prepare("SELECT id,from_id,to_id,kind,threshold,source,evidence_level,active,revision FROM tp_relations ORDER BY id").map_err(db_error)?
        .query_map([],relation_row).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
fn memory_row(r:&rusqlite::Row<'_>) -> rusqlite::Result<Memory> {
    Ok(Memory{id:r.get(0)?,task_id:r.get(1)?,repository_id:r.get(2)?,kind:r.get(3)?,body:r.get(4)?,source:r.get(5)?,status:r.get(6)?,supersedes:r.get(7)?,base_task_revision:r.get(8)?,revision:r.get(9)?,created_at:r.get(10)?,project_id:None,category:String::new(),origin_level:String::new(),source_refs:serde_json::Value::Null,stale:false})
}
pub(crate) fn memories(db:&Connection) -> Result<Vec<Memory>,StorageError> { memories_scoped(db,None) }
pub(crate) fn memories_scoped(db:&Connection,project:Option<&str>) -> Result<Vec<Memory>,StorageError> {
    let mut rows=db.prepare("SELECT id,task_id,repository_id,kind,body,source,status,supersedes,base_task_revision,revision,created_at FROM tp_memories m WHERE (?1 IS NULL OR coalesce((SELECT project_id FROM tp_memory_origins WHERE memory_id=m.id),CASE WHEN m.task_id IS NOT NULL THEN (SELECT project_id FROM tp_task_plans WHERE task_id=m.task_id) ELSE (SELECT project_id FROM tp_project_repositories WHERE repository_id=m.repository_id) END)=?1) ORDER BY created_at,id").map_err(db_error)?
        .query_map([project],memory_row).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    let mut current_snapshots:std::collections::HashMap<String,Option<crate::task_panel_snapshots::WorkspaceSnapshot>>=std::collections::HashMap::new();
    for m in &mut rows {
        m.project_id=if let Some(t)=&m.task_id{crate::task_panel_projects::plan(db,t)?.project_id}else if let Some(r)=&m.repository_id{crate::task_panel_projects::repository_project(db,r)?}else{None};
        let origin:Option<(String,String,String,Option<String>)>=db.query_row("SELECT category,level,source_refs,project_id FROM tp_memory_origins WHERE memory_id=?1",[&m.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(db_error)?;
        if let Some((category,level,refs,project))=origin{m.category=category;m.origin_level=level;m.source_refs=decode(&refs)?;if project.is_some(){m.project_id=project;}}
        else{let claim=m.source.starts_with("回执 ");m.category=if ["memory","pause"].contains(&m.kind.as_str()){"reference"}else{"decision"}.into();m.origin_level=if claim{"claim"}else{"user_confirmed"}.into();m.source_refs=serde_json::json!([{"description":m.source}]);}
        if m.status=="draft"{if let Some(t)=&m.task_id{m.stale=m.base_task_revision!=Some(task(db,t)?.revision);}}
        if m.category=="reference"&&["draft","active"].contains(&m.status.as_str())&&!m.stale {
            let mut stack=vec![&m.source_refs];let mut file_versions=Vec::new();let mut snapshot_ids=Vec::new();let mut count=0;
            while let Some(value)=stack.pop(){count+=1;if count>512{m.stale=true;break;}
                if let Some(items)=value.as_array(){stack.extend(items.iter());}
                if let Some(object)=value.as_object(){
                    if let (Some(path),Some(digest))=(value["path"].as_str(),value["sha256"].as_str()){file_versions.push((path,digest));}
                    if let Some(id)=value["snapshotId"].as_str(){snapshot_ids.push(id);}
                    stack.extend(object.values().filter(|v|v.is_array()||v.is_object()));
                }
            }
            if !file_versions.is_empty()||!snapshot_ids.is_empty(){if let Some(task_id)=&m.task_id {
                let current=current_snapshots.entry(task_id.clone()).or_insert_with(||task(db,task_id).ok().and_then(|t|t.repository_id.as_ref().and_then(|_|crate::task_panel_locations::execution_repository(db,&t).ok()).and_then(|r|crate::task_panel_snapshots::sample(&r,&t.scope).ok())));
                m.stale|=current.as_ref().is_none_or(|now|file_versions.iter().any(|(path,wanted)|!now.files.iter().any(|f|f.path==*path&&f.hash==*wanted))||snapshot_ids.iter().any(|id|!crate::task_panel_evidence::snapshot(db,id).is_ok_and(|old|old.fingerprint==now.fingerprint)));
            }}
        }
    }
    Ok(rows)
}

pub(crate) fn memory_candidate(db:&Connection,t:&Task,kind:&str,body:&str,source:&str,refs:&serde_json::Value)->Result<String,StorageError>{
    if !["memory","pause","decision","goal","requirement"].contains(&kind)||body.trim().is_empty()||body.chars().count()>20000||source.len()>2000||encode(refs)?.len()>16000{return Err(invalid("记忆候选需正文、明确分类和有限来源。"));}
    let prior:Option<String>=db.query_row("SELECT id FROM tp_memories WHERE task_id=?1 AND kind=?2 AND body=?3 AND status='draft' AND base_task_revision=?4 ORDER BY created_at DESC LIMIT 1",params![t.id,kind,body.trim(),t.revision],|r|r.get(0)).optional().map_err(db_error)?;
    if let Some(id)=prior{return Ok(id);}
    let id=new_id(db,"memory")?;
    db.execute("INSERT INTO tp_memories VALUES(?1,?2,?3,?4,?5,?6,'draft',NULL,?7,1,?8)",params![id,t.id,t.repository_id,kind,body.trim(),source,t.revision,now()]).map_err(db_error)?;
    db.execute("INSERT INTO tp_memory_origins VALUES(?1,?2,'claim',?3,NULL)",params![id,if ["memory","pause"].contains(&kind){"reference"}else{"decision"},encode(refs)?]).map_err(db_error)?;
    Ok(id)
}
pub(crate) fn bindings(db:&Connection) -> Result<Vec<Binding>,StorageError> {
    db.prepare("SELECT id,task_id,server_id,workspace_id,pane_id,agent_id,kind,cwd,generation,state,checked_at FROM tp_bindings ORDER BY generation DESC").map_err(db_error)?.query_map([], |r|
        Ok(Binding{id:r.get(0)?,task_id:r.get(1)?,server_id:r.get(2)?,workspace_id:r.get(3)?,pane_id:r.get(4)?,agent_id:r.get(5)?,kind:r.get(6)?,cwd:r.get(7)?,generation:r.get(8)?,state:r.get(9)?,checked_at:r.get(10)?}))
        .map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
pub(crate) fn executions(db:&Connection) -> Result<Vec<Execution>,StorageError> {
    db.prepare("SELECT id,task_id,task_revision,context_id,binding_id,binding_generation,state,attempt,request_id,authorization,snapshot_id,reason,created_at,updated_at FROM tp_executions ORDER BY created_at DESC,id").map_err(db_error)?.query_map([], |r|
        Ok(Execution{id:r.get(0)?,task_id:r.get(1)?,task_revision:r.get(2)?,context_id:r.get(3)?,binding_id:r.get(4)?,binding_generation:r.get(5)?,state:r.get(6)?,attempt:r.get(7)?,request_id:r.get(8)?,authorization:json_column(r,9)?,snapshot_id:r.get(10)?,reason:r.get(11)?,created_at:r.get(12)?,updated_at:r.get(13)?}))
        .map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
pub(crate) fn evidence(db:&Connection) -> Result<Vec<Evidence>,StorageError> {
    db.prepare("SELECT id,task_id,execution_id,task_revision,kind,level,status,path,hash,detail,snapshot_id,created_at FROM tp_evidence ORDER BY created_at DESC,id").map_err(db_error)?.query_map([], |r|
        Ok(Evidence{id:r.get(0)?,task_id:r.get(1)?,execution_id:r.get(2)?,task_revision:r.get(3)?,kind:r.get(4)?,level:r.get(5)?,status:r.get(6)?,path:r.get(7)?,hash:r.get(8)?,detail:json_column(r,9)?,snapshot_id:r.get(10)?,created_at:r.get(11)?}))
        .map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
pub(crate) fn events(db:&Connection, after:i64, limit:usize) -> Result<Vec<Event>,StorageError> {
    db.prepare("SELECT sequence,request_id,object_id,kind,actor,detail,created_at FROM tp_events WHERE sequence>?1 ORDER BY sequence LIMIT ?2").map_err(db_error)?.query_map(params![after,limit.min(1000) as i64], |r|
        Ok(Event{sequence:r.get(0)?,request_id:r.get(1)?,object_id:r.get(2)?,kind:r.get(3)?,actor:r.get(4)?,detail:r.get(5)?,created_at:r.get(6)?}))
        .map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
pub(crate) fn expected(actual:i64,wanted:Option<i64>) -> Result<(),StorageError> { if wanted!=Some(actual){Err(conflict())}else{Ok(())} }
pub(crate) fn request<T:DeserializeOwned>(db:&Connection,id:&str,input:&str) -> Result<Option<T>,StorageError> {
    if !id_ok(id){return Err(invalid("请求编号无效。"));}
    let prior:Option<(String,String)>=db.query_row("SELECT input,result FROM tp_requests WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
    match prior {Some((old,result)) if old==input=>Ok(Some(decode(&result)?)),Some(_)=>Err(StorageError::new("request_conflict","此请求编号对应其他内容，未重复操作。")),None=>Ok(None)}
}
pub(crate) fn receipt<T:Serialize>(db:&Connection,id:&str,input:&str,result:&T) -> Result<(),StorageError> {
    db.execute("INSERT INTO tp_requests VALUES(?1,?2,?3)",params![id,input,encode(result)?]).map_err(db_error)?; Ok(())
}
pub(crate) fn valid_scope(scope:&[String]) -> bool {
    scope.len()<=200 && scope.iter().all(|p| !p.trim().is_empty() && p.len()<=1024 && (p=="." ||
        !std::path::Path::new(p).is_absolute() && !p.contains(':') && !p.replace('\\',"/").split('/').any(|s|s==".."||s.is_empty())))
}
fn strings_ok(items:&[String],count:usize,len:usize) -> bool {items.len()<=count && items.iter().all(|s|!s.trim().is_empty()&&s.chars().count()<=len)}

impl Store {
    pub fn task_panel_snapshot(&self) -> Result<PanelSnapshot,StorageError> {
        self.task_panel_snapshot_scoped(None)
    }
    pub(crate) fn task_panel_snapshot_scoped(&self,project:Option<&str>) -> Result<PanelSnapshot,StorageError> {
        let tasks=self.db.prepare(&format!("SELECT {TASK_COLUMNS} FROM tp_tasks WHERE (?1 IS NULL OR id IN (SELECT task_id FROM tp_task_plans WHERE project_id=?1)) ORDER BY number")).map_err(db_error)?.query_map([project],task_row).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
        let task_ids:HashSet<_>=tasks.iter().map(|t|t.id.clone()).collect();
        let repositories=self.db.prepare("SELECT id,label,path,scope,revision,created_at FROM tp_repositories WHERE (?1 IS NULL OR id IN (SELECT repository_id FROM tp_project_repositories WHERE project_id=?1)) ORDER BY label,id").map_err(db_error)?.query_map([project],repository_row).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
        let relations=relations(&self.db)?;let executions=executions(&self.db)?;let evidence=evidence(&self.db)?;
        let mut accepted=HashSet::new();let mut technical=HashSet::new();
        for t in &tasks {
            let prior:Option<(bool,Option<String>)>=self.db.query_row("SELECT accepted,snapshot_id FROM tp_acceptances WHERE task_id=?1 AND task_revision=?2 ORDER BY rowid DESC LIMIT 1",params![t.id,t.revision],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
            let candidate=prior.as_ref().is_some_and(|(a,_)|*a)||evidence.iter().any(|e|e.task_id==t.id&&e.task_revision==t.revision&&e.kind=="check"&&["observed","user_confirmed"].contains(&e.level.as_str()));
            if !candidate{continue;}
            let current=t.repository_id.as_ref().and_then(|_|crate::task_panel_locations::execution_repository(&self.db,t).ok()).and_then(|r|crate::task_panel_snapshots::sample(&r,&t.scope).ok());
            let matches=|sid:&str|current.as_ref().is_some_and(|c|crate::task_panel_evidence::snapshot(&self.db,sid).is_ok_and(|s|s.fingerprint==c.fingerprint));
            if prior.is_some_and(|(a,sid)|a&&sid.as_ref().is_some_and(|s|matches(s))){accepted.insert(t.id.clone());}
            if evidence.iter().find(|e|e.task_id==t.id&&e.task_revision==t.revision&&e.kind=="check"&&["observed","user_confirmed"].contains(&e.level.as_str())&&e.snapshot_id.as_ref().is_some_and(|s|matches(s))).is_some_and(|e|e.status=="passed"&&(e.path.is_empty()||crate::task_panel_paths::protected_absolute(std::path::Path::new(&e.path),8_000_000).is_ok_and(|b|crate::task_panel_paths::hash(&b)==e.hash))){technical.insert(t.id.clone());}
        }
        let monitor=crate::task_panel_monitor::read(self);
        let views=tasks.into_iter().map(|t| -> Result<TaskView,StorageError> {
            let plan=crate::task_panel_projects::plan(&self.db,&t.id)?;
            let object_kind:String=self.db.query_row("SELECT kind FROM tp_nodes WHERE id=?1",[&t.id],|r|r.get(0)).map_err(db_error)?;
            let dependencies:Vec<_>=relations.iter().filter(|r|r.active&&r.kind=="depends_on"&&r.from_id==t.id).collect();
            let mut blockers:Vec<_>=dependencies.iter().filter(|r|if r.threshold=="technical"{!technical.contains(&r.to_id)}else{!accepted.contains(&r.to_id)}).map(|r|r.to_id.clone()).collect();
            let latest=executions.iter().find(|r|r.task_id==t.id&&r.task_revision==t.revision);
            let live=executions.iter().find(|r|r.task_id==t.id&&is_live(&r.state));
            let pending_creation=crate::task_panel_execution::pending_creation(&self.db,&t.id)?.map(|(input,result)|crate::task_panel_execution::PendingCreation{kind:input.kind,pane_name:input.pane_name,result});
            let stop_pending=if let Some(run)=live{self.db.query_row("SELECT EXISTS(SELECT 1 FROM tp_events WHERE kind='interrupt_intent' AND object_id=?1)",[&run.id],|r|r.get::<_,bool>(0)).map_err(db_error)?}else{false};
            let observation=live.and_then(|r|monitor.runs.get(&r.id)).cloned();
            let observed_attention=observation.as_ref().is_some_and(|o|["blocked","disconnected"].contains(&o.state.as_str()));
            let execution_profile=self.task_setting(&format!("task-panel:profile:{}",t.id))?.unwrap_or_else(||if t.id.starts_with("analysis-task-"){"architecture"}else{"code"}.into());
            let recommended_actions=if execution_profile=="architecture"{vec!["read_scoped_files".into(),"write_delivery_artifacts".into(),"render_architecture".into()]}else{executions.iter().find(|r|r.task_id==t.id).map(|r|r.authorization.clone()).unwrap_or_else(||vec!["read_scoped_files".into(),"edit_task_files".into(),"write_delivery_artifacts".into()])};
            let mut reasons=Vec::new();
            if observed_attention{reasons.push(if observation.as_ref().is_some_and(|o|o.state=="blocked"){"awaiting_answer"}else{"monitor_disconnected"}.into());}
            if pending_creation.is_some(){reasons.push("creation_pending".into());}
            if latest.is_some_and(|r|r.state=="failed"){reasons.push("execution_failed".into());}
            if stop_pending{reasons.push("stop_pending".into());}
            if self.task_setting(&format!("task-panel:worktree-intent:{}",t.id))?.is_some(){reasons.push("worktree_pending".into());}
            if t.goal.trim().is_empty(){reasons.push("missing_goal".into());}
            if t.scope.is_empty(){reasons.push("missing_scope".into());}
            if t.repository_id.is_none()&&object_kind!="goal"{reasons.push("missing_workspace".into());}
            if t.criteria.is_empty(){reasons.push("missing_criteria".into());}
            if t.lifecycle=="draft"{reasons.push("draft".into());}
            if t.lifecycle=="paused"{reasons.push("paused".into());}
            if t.lifecycle=="cancelled"{reasons.push("cancelled".into());}
            if !blockers.is_empty(){reasons.push("prerequisites".into());}
            if let Some(run)=live {
                if run.task_revision!=t.revision{reasons.push("execution_revision_changed".into());}
                if ["uncertain","disconnected","blocked"].contains(&run.state.as_str()){reasons.push(run.state.clone());}
            }
            if t.repository_id.is_some(){
                for run in &executions {if run.task_id!=t.id&&is_live(&run.state){
                    let other_repo:Option<String>=self.db.query_row("SELECT repository_id FROM tp_tasks WHERE id=?1",[&run.task_id],|r|r.get(0)).ok().flatten();
                    if other_repo.is_some() {if crate::task_panel_locations::overlap(&crate::task_panel_locations::execution_repository(&self.db,&t)?.path,&crate::task_panel_locations::execution_repository(&self.db,&task(&self.db,&run.task_id)?)?.path){blockers.push(run.task_id.clone());reasons.push("workspace_busy".into());}}
                }}
            }
            let accepted_task=accepted.contains(&t.id);
            if !accepted.contains(&t.id)&&self.db.query_row("SELECT EXISTS(SELECT 1 FROM tp_acceptances WHERE task_id=?1 AND accepted=1)",[&t.id],|r|r.get::<_,bool>(0)).unwrap_or(false){reasons.push("evidence_stale".into());}
            let lane=if observed_attention{"human"}else if live.is_some_and(|r|["sending","awaiting_receipt","accepted","running"].contains(&r.state.as_str())){"running"}
                else if live.is_some_and(|r|["blocked","uncertain","disconnected"].contains(&r.state.as_str()))||reasons.iter().any(|r|["missing_goal","missing_scope","missing_workspace","missing_criteria","draft","paused","cancelled","creation_pending","worktree_pending","execution_failed"].contains(&r.as_str())){"human"}
                else if accepted_task{"done"}else if latest.is_some_and(|r|r.state=="reported_finished"){"verify"}
                else if !blockers.is_empty(){"blocked"}else{"ready"};
            let retry_ready=lane=="human"&&live.is_none()&&blockers.is_empty()&&reasons.iter().all(|r|["creation_pending","execution_failed","evidence_stale"].contains(&r.as_str()));
            let allowed=if object_kind=="goal"{vec!["edit","context"]}else if lane=="ready"||retry_ready{vec!["edit","context","bind","dispatch"]}else if lane=="verify"{vec!["edit","evidence","accept"]}else{vec!["edit","context"]};
            let satisfied=dependencies.iter().filter(|r|if r.threshold=="technical"{technical.contains(&r.to_id)}else{accepted.contains(&r.to_id)}).count();
            let check_state=if technical.contains(&t.id){"passed"}else if evidence.iter().any(|e|e.task_id==t.id&&e.task_revision==t.revision&&e.kind=="check"&&e.status=="failed"){"failed"}else{"not_run"};
            Ok(TaskView{execution_workspace:crate::task_panel_locations::assigned(&self.db,&t.id)?,execution_profile,recommended_actions,observation,task:t,plan,object_kind,pending_creation,stop_pending,lane:lane.into(),reason_codes:reasons,blockers,allowed_actions:allowed.into_iter().map(String::from).collect(),prerequisites_total:dependencies.len(),prerequisites_satisfied:satisfied,execution_state:live.or(latest).map(|r|r.state.clone()),check_state:check_state.into(),acceptance_state:if accepted_task{"accepted"}else{"not_accepted"}.into()})
        }).collect::<Result<Vec<_>,StorageError>>()?;
        let last_sequence:i64=self.db.query_row("SELECT coalesce(max(sequence),0) FROM tp_events",[],|r|r.get(0)).map_err(db_error)?;
        let memories:Vec<_>=memories_scoped(&self.db,project)?.into_iter().filter(|m|project.is_none_or(|p|m.project_id.as_deref()==Some(p))).collect();
        let executions:Vec<_>=executions.into_iter().filter(|r|task_ids.contains(&r.task_id)).collect();
        let evidence=evidence.into_iter().filter(|e|task_ids.contains(&e.task_id)).collect();
        let mut scoped_relations=Vec::new();for relation in relations {if project.is_none()||crate::task_panel_projects::node_project(&self.db,&relation.from_id)?.as_deref()==project&&crate::task_panel_projects::node_project(&self.db,&relation.to_id)?.as_deref()==project{scoped_relations.push(relation);}}
        let events=events(&self.db,(last_sequence-250).max(0),250)?.into_iter().filter(|e|project.is_none()||task_ids.contains(&e.object_id)||executions.iter().any(|r|r.id==e.object_id)||memories.iter().any(|m|m.id==e.object_id)||project==Some(e.object_id.as_str())).collect();
        Ok(PanelSnapshot{monitor,projects:crate::task_panel_projects::projects(&self.db)?.into_iter().filter(|p|project.is_none_or(|id|p.id==id)).collect(),graph_revision:graph_revision(&self.db)?,tasks:views,repositories,relations:scoped_relations,memories,executions,bindings:bindings(&self.db)?.into_iter().filter(|b|task_ids.contains(&b.task_id)).collect(),evidence,events,last_sequence})
    }

    pub fn task_panel_mutate(&mut self,input:MutationInput) -> Result<MutationReceipt,StorageError> {
        let encoded=encode(&input)?;
        let tx=self.db.transaction().map_err(db_error)?;
        if let Some(prior)=request(&tx,&input.request_id,&encoded)?{return Ok(prior);}
        let (object_id,revision,detail):(String,i64,String)=match &input.action {
            Mutation::Project{id,name,summary,repository_ids}=>{
                let revision=crate::task_panel_projects::save_project(&tx,id,name,summary,repository_ids,input.expected_revision)?;
                (id.clone(),revision,"项目已保存；多个项目分别维护任务、记忆与执行位置".into())
            },
            Mutation::Repository{id,label,path,scope,project_id}=>{
                if let Some(workspace)=self.task_workspace.as_ref(){if crate::task_panel_workspace::repository_root(std::path::Path::new(path))?!=*workspace{return Err(invalid("请切换到目标仓库再登记；每个仓库的任务保存在自己的 .azcine。"));}}
                if !id_ok(id)||label.trim().is_empty()||label.chars().count()>200||!valid_scope(scope)||scope.is_empty(){return Err(invalid("请填写仓库名称和有效的相对读取范围。"));}
                let p=std::path::Path::new(path);
                if !p.is_absolute()||!p.is_dir(){return Err(invalid("仓库目录不存在；新目标可先保存任务，初始化需单独授权。"));}
                let canonical=std::fs::canonicalize(p).map_err(|_|invalid("无法读取仓库目录。"))?;
                let canonical=canonical.to_string_lossy().into_owned();
                let previous:Option<i64>=tx.query_row("SELECT revision FROM tp_repositories WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
                if previous.is_some(){let old_repo=repository(&tx,id)?;if (old_repo.path!=canonical||old_repo.scope!=*scope)&&executions(&tx)?.iter().any(|r|is_live(&r.state)&&task(&tx,&r.task_id).ok().and_then(|t|t.repository_id).as_ref()==Some(id)){return Err(invalid("该工作区仍有执行，先核对原执行再调整目录或读取范围。"));}}
                match previous {
                    Some(r)=>{expected(r,input.expected_revision)?;tx.execute("UPDATE tp_repositories SET label=?1,path=?2,scope=?3,revision=revision+1 WHERE id=?4",params![label.trim(),canonical,encode(scope)?,id]).map_err(db_error)?;},
                    None=>{if input.expected_revision.is_some(){return Err(conflict());}tx.execute("INSERT INTO tp_repositories VALUES(?1,?2,?3,?4,1,?5)",params![id,label.trim(),canonical,encode(scope)?,now()]).map_err(db_error)?;}
                }
                let existing=crate::task_panel_projects::repository_project(&tx,id)?;
                if project_id.is_some()&&existing.is_some()&&project_id!=&existing{return Err(invalid("工作区已有项目归属，未静默移动历史记录。"));}
                if existing.is_none(){
                    if let Some(project)=project_id {
                        let p=crate::task_panel_projects::projects(&tx)?.into_iter().find(|p|&p.id==project).ok_or_else(||invalid("所属项目不存在。"))?;
                        let mut repos=p.repository_ids;repos.push(id.clone());crate::task_panel_projects::save_project(&tx,project,&p.name,&p.summary,&repos,Some(p.revision))?;
                    }else{
                        let project=format!("project-{}",crate::task_panel_paths::hash(id.as_bytes()));crate::task_panel_projects::save_project(&tx,&project,label,"",&[id.clone()],None)?;
                    }
                }
                (id.clone(),previous.unwrap_or(0)+1,"仓库引用和项目归属已保存；未修改仓库文件".into())
            },
            Mutation::SaveTask{id,title,goal,scope,criteria,repository_id,source,plan}=>{
                if !id_ok(id)||title.trim().is_empty()||title.chars().count()>500||goal.chars().count()>20000||source.chars().count()>2000||!valid_scope(scope)||!strings_ok(criteria,100,2000){return Err(invalid("请检查标题、目标、范围及完成条件。范围使用仓库相对路径。"));}
                if let Some(repo)=repository_id{repository(&tx,repo)?;}
                let old:Option<i64>=tx.query_row("SELECT revision FROM tp_tasks WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
                if old.is_some()&&task(&tx,id)?.repository_id!=*repository_id&&crate::task_panel_locations::assigned(&tx,id)?.is_some(){return Err(invalid("任务已有分支执行位置，请保留总仓库归属；其他仓库工作请新建任务。"));}
                if old.is_some()&&task(&tx,id)?.repository_id!=*repository_id&&executions(&tx)?.iter().any(|r|r.task_id==*id&&is_live(&r.state)){return Err(invalid("原工作区仍有执行，先核对原执行再更换目录。"));}
                if let Some(r)=old{expected(r,input.expected_revision)?;tx.execute("UPDATE tp_tasks SET title=?1,goal=?2,scope=?3,criteria=?4,repository_id=?5,source=?6,revision=revision+1,updated_at=?7 WHERE id=?8",params![title.trim(),goal.trim(),encode(scope)?,encode(criteria)?,repository_id,source,now(),id]).map_err(db_error)?;}
                else{if input.expected_revision.is_some(){return Err(conflict());}tx.execute("INSERT INTO tp_tasks SELECT ?1,coalesce(max(number),0)+1,?2,?3,?4,?5,?6,'active','',?7,'',1,?8,?8 FROM tp_tasks",params![id,title.trim(),goal.trim(),encode(scope)?,encode(criteria)?,repository_id,source,now()]).map_err(db_error)?;}
                tx.execute("INSERT INTO tp_nodes VALUES(?1,?2,'task',?3,'','','user_confirmed','[]',0) ON CONFLICT(id) DO UPDATE SET label=excluded.label,repository_id=excluded.repository_id",params![id,repository_id,title.trim()]).map_err(db_error)?;
                let mut value=plan.clone().unwrap_or(crate::task_panel_projects::plan(&tx,id)?);
                if value.project_id.is_none(){value.project_id=repository_id.as_ref().map(|r|crate::task_panel_projects::repository_project(&tx,r)).transpose()?.flatten();}
                crate::task_panel_projects::save_plan(&tx,id,&value)?;
                (id.clone(),old.unwrap_or(0)+1,"任务内容已保存；旧执行与证据保留".into())
            },
            Mutation::CancelStoppedExecution{id,execution_id,reason,approved}=>{
                let current=task(&tx,id)?;expected(current.revision,input.expected_revision)?;
                if !approved||reason.trim().is_empty()||reason.chars().count()>5000{return Err(invalid("请先核对原执行已停止，并明确确认取消。"));}
                let runs=executions(&tx)?;
                let run=runs.iter().find(|r|r.id==*execution_id&&r.task_id==*id&&is_live(&r.state)).ok_or_else(||invalid("原执行状态已改变，请刷新后核对；未取消其他执行。"))?;
                if runs.iter().any(|r|r.task_id==*id&&r.id!=run.id&&is_live(&r.state)){return Err(invalid("此任务还有其他未结束执行，请分别核对。"));}
                let detail=format!("本人确认原执行已停止并取消任务：{reason}");
                tx.execute("UPDATE tp_executions SET state='cancelled',reason=?1,updated_at=?2 WHERE id=?3",params![detail,now(),run.id]).map_err(db_error)?;
                tx.execute("UPDATE tp_tasks SET lifecycle='cancelled',pause_reason=?1,revision=revision+1,updated_at=?2 WHERE id=?3",params![reason,now(),id]).map_err(db_error)?;
                event(&tx,&format!("{}-stopped",input.request_id),&run.id,"execution_stop_confirmed","user",&detail)?;
                (id.clone(),current.revision+1,"本人确认原执行已停止，任务已取消；物料与历史保留".into())
            },
            Mutation::Lifecycle{id,lifecycle,reason}=>{
                let current=task(&tx,id)?;expected(current.revision,input.expected_revision)?;
                if !["draft","active","paused","cancelled"].contains(&lifecycle.as_str())||reason.chars().count()>5000{return Err(invalid("任务状态或原因无效。"));}
                if lifecycle=="cancelled"&&executions(&tx)?.iter().any(|r|r.task_id==*id&&is_live(&r.state)){return Err(invalid("原执行尚未结束或结果待核对，请先停止执行并确认，再取消任务。"));}
                tx.execute("UPDATE tp_tasks SET lifecycle=?1,pause_reason=?2,revision=revision+1,updated_at=?3 WHERE id=?4",params![lifecycle,reason,now(),id]).map_err(db_error)?;
                (id.clone(),current.revision+1,match lifecycle.as_str(){"cancelled"=>"任务已取消，交接物料和历史记录保留", "paused"=>"任务已暂停，恢复后可继续", "active"=>"任务已恢复，尚未自动派发", _=>"任务已保存为草案"}.into())
            },
            Mutation::ResumeSummary{id,summary}=>{
                let current=task(&tx,id)?;expected(current.revision,input.expected_revision)?;
                if summary.chars().count()>20000{return Err(invalid("暂停点最多 20000 字。"));}
                tx.execute("UPDATE tp_tasks SET resume_summary=?1,revision=revision+1,updated_at=?2 WHERE id=?3",params![summary,now(),id]).map_err(db_error)?;
                (id.clone(),current.revision+1,"接续摘要已保存".into())
            },
            Mutation::Relation{from_id,to_id,kind,threshold,source}=>{
                expected(graph_revision(&tx)?,input.expected_revision)?;
                if from_id==to_id||!RELATION_KINDS.contains(&kind.as_str())||!["acceptance","technical","none"].contains(&threshold.as_str())||source.trim().is_empty()||source.chars().count()>2000{return Err(invalid("关系类型、来源或门槛无效。"));}
                for id in [from_id,to_id]{let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM tp_nodes WHERE id=?1)",[id],|r|r.get(0)).map_err(db_error)?;if !exists{return Err(invalid("关系引用的对象不存在。"));}}
                let from_project=crate::task_panel_projects::node_project(&tx,from_id)?;let to_project=crate::task_panel_projects::node_project(&tx,to_id)?;
                if from_project!=to_project{return Err(invalid("关系两端须属于同一项目；请先核对归属。"));}
                if kind=="depends_on" {
                    if threshold=="none" {return Err(invalid("前置必须指定本人验收或技术检查门槛。"));}
                    task(&tx,from_id)?;task(&tx,to_id)?;
                    let all=relations(&tx)?;let mut todo=vec![to_id.as_str()];let mut seen=HashSet::new();
                    while let Some(id)=todo.pop(){if id==from_id{return Err(StorageError::new("dependency_cycle","这些前置会形成循环，未保存任何改动。"));}if seen.insert(id){todo.extend(all.iter().filter(|r|r.active&&r.kind=="depends_on"&&r.from_id==id).map(|r|r.to_id.as_str()));}}
                }
                let id=new_id(&tx,"rel")?;
                tx.execute("INSERT INTO tp_relations VALUES(?1,?2,?3,?4,?5,?6,'user_confirmed',1,1)",params![id,from_id,to_id,kind,if kind=="depends_on"{threshold.as_str()}else{"none"},source]).map_err(db_error)?;
                (id,1,"明确关系已保存；普通关联不改变调度前置".into())
            },
            Mutation::InvalidateRelation{id}=>{
                expected(graph_revision(&tx)?,input.expected_revision)?;
                if tx.execute("UPDATE tp_relations SET active=0,revision=revision+1 WHERE id=?1 AND active=1",[id]).map_err(db_error)?!=1{return Err(conflict());}
                (id.clone(),graph_revision(&tx)?+1,"关系已失效；来源与历史保留".into())
            },
            Mutation::ReviewRelation{id,reason}=>{
                expected(graph_revision(&tx)?,input.expected_revision)?;
                if reason.trim().is_empty()||reason.chars().count()>5000{return Err(invalid("请填写实际语义查证的结论和限制。"));}
                let edge=relations(&tx)?.into_iter().find(|r|r.id==*id&&r.active).ok_or_else(conflict)?;
                if !["imports","calls","registers","reads","writes","contains","may_affect","supported_by"].contains(&edge.kind.as_str()){return Err(invalid("这里只复核代码关系；业务前置请在任务中核对。"));}
                let source:serde_json::Value=decode(&edge.source)?;
                let refs=source.as_array().cloned().unwrap_or_else(||vec![source]);
                let repo_id=nodes(&tx)?.into_iter().find(|n|n.id==edge.from_id).and_then(|n|n.repository_id).ok_or_else(||invalid("关系缺少仓库定位。"))?;
                let repo=repository(&tx,&repo_id)?;
                if refs.is_empty(){return Err(invalid("来源缺失，不能提升语义等级。"));}
                for s in &refs{
                    let path=s["path"].as_str().ok_or_else(||invalid("来源缺少文件路径。"))?;
                    let wanted=s["sha256"].as_str().ok_or_else(||invalid("来源缺少内容哈希，请重新分析后查证。"))?;
                    let file=crate::task_panel_paths::scoped_file(std::path::Path::new(&repo.path),path,&repo.scope)?;
                    if crate::task_panel_paths::hash(&crate::task_panel_paths::read_limited(&file,8_000_000)?)!=wanted{return Err(invalid("关系出处已改变，不能将旧语义核对用于当前代码。"));}
                }
                tx.execute("UPDATE tp_relations SET evidence_level='user_confirmed',revision=revision+1 WHERE id=?1",[id]).map_err(db_error)?;
                (id.clone(),edge.revision+1,encode(&serde_json::json!({"previous":edge,"semanticReview":reason,"level":"user_confirmed","sourcesChecked":true}))?)
            },
            Mutation::UpdateMemoryDraft{id,body,source,kind}=>{
                let m=memories(&tx)?.into_iter().find(|m|m.id==*id).ok_or_else(||invalid("记忆不存在。"))?;expected(m.revision,input.expected_revision)?;
                if m.status!="draft"||body.trim().is_empty()||body.chars().count()>20000||source.trim().is_empty()||source.chars().count()>2000||!["decision","memory","pause","goal","requirement"].contains(&kind.as_str()){return Err(invalid("只能编辑待核对草案；请保留正文、分类和出处。"));}
                let base=m.task_id.as_ref().map(|t|task(&tx,t).map(|t|t.revision)).transpose()?;
                tx.execute("UPDATE tp_memories SET body=?1,source=?2,kind=?3,revision=revision+1,base_task_revision=?4 WHERE id=?5",params![body.trim(),source,kind,base,id]).map_err(db_error)?;
                tx.execute("UPDATE tp_memory_origins SET category=?1 WHERE memory_id=?2",params![if ["memory","pause"].contains(&kind.as_str()){"reference"}else{"decision"},id]).map_err(db_error)?;
                (id.clone(),m.revision+1,encode(&serde_json::json!({"action":"memory_draft_edited","before":m,"after":{"body":body,"source":source,"kind":kind,"baseTaskRevision":base},"meaning":"本人修订草案；尚未应用为有效决定"}))?)
            },
            Mutation::MemoryDraft{id,task_id,repository_id,kind,body,source,supersedes,project_id}=>{
                if !id_ok(id)||body.trim().is_empty()||body.chars().count()>20000||source.trim().is_empty()||source.chars().count()>2000||!["decision","memory","pause","goal","requirement"].contains(&kind.as_str())||task_id.is_none()&&repository_id.is_none()&&project_id.is_none(){return Err(invalid("请填写记忆正文、出处和所属项目、任务或仓库。"));}
                if let Some(p)=project_id {if task_id.is_some()||repository_id.is_some()||!crate::task_panel_projects::projects(&tx)?.iter().any(|project|&project.id==p){return Err(invalid("项目级记忆需选择存在的项目，并与任务级范围分别保存。"));}}
                let base=task_id.as_ref().map(|id|task(&tx,id).map(|t|t.revision)).transpose()?;
                if let Some(repo)=repository_id{repository(&tx,repo)?;if let Some(t)=task_id{if task(&tx,t)?.repository_id.as_ref()!=Some(repo){return Err(invalid("记忆工作区与任务归属不一致。"));}}}
                if input.expected_revision!=base{return Err(conflict());}
                if let Some(old)=supersedes{let scope:Option<(Option<String>,Option<String>,String)>=tx.query_row("SELECT task_id,repository_id,status FROM tp_memories WHERE id=?1",[old],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_error)?;
                    if scope.as_ref().is_none_or(|(old_task,old_repo,status)|old_task!=task_id||status!="active"||task_id.is_none()&&old_repo!=repository_id){return Err(invalid("只能替代同一范围内的当前有效记忆。"));}
                    if project_id.is_some()&&memories(&tx)?.iter().find(|m|&m.id==old).and_then(|m|m.project_id.as_ref())!=project_id.as_ref(){return Err(invalid("不能替代另一个项目的记忆。"));}}
                tx.execute("INSERT INTO tp_memories VALUES(?1,?2,?3,?4,?5,?6,'draft',?7,?8,1,?9)",params![id,task_id,repository_id,kind,body.trim(),source,supersedes,base,now()]).map_err(db_error)?;
                tx.execute("INSERT INTO tp_memory_origins VALUES(?1,?2,'user_confirmed',?3,?4)",params![id,if ["memory","pause"].contains(&kind.as_str()){"reference"}else{"decision"},encode(&serde_json::json!([{"description":source}]))?,project_id]).map_err(db_error)?;
                (id.clone(),1,"记忆草案已保存，核对后才生效".into())
            },
            Mutation::ApplyMemory{id}|Mutation::CancelMemory{id}=>{
                let m=memories(&tx)?.into_iter().find(|m|m.id==*id).ok_or_else(||invalid("记忆草案不存在。"))?;
                expected(m.revision,input.expected_revision)?;
                if m.status!="draft"{return Err(conflict());}
                let apply=matches!(&input.action,Mutation::ApplyMemory{..});
                if apply {
                    if let Some(t)=&m.task_id{if Some(task(&tx,t)?.revision)!=m.base_task_revision{return Err(conflict());}}
                    if let Some(old)=&m.supersedes{if tx.execute("UPDATE tp_memories SET status='superseded',revision=revision+1 WHERE id=?1 AND status='active'",[old]).map_err(db_error)?!=1{return Err(conflict());}}
                }
                tx.execute("UPDATE tp_memories SET status=?1,revision=revision+1 WHERE id=?2",params![if apply{"active"}else{"cancelled"},id]).map_err(db_error)?;
                if apply {
                    tx.execute("INSERT INTO tp_nodes VALUES(?1,?2,?3,?4,'','',?5,?6,0) ON CONFLICT(id) DO NOTHING",params![m.id,m.repository_id,m.kind,m.body.chars().take(100).collect::<String>(),m.origin_level,encode(&serde_json::json!({"body":m.body,"source":m.source,"projectId":m.project_id,"adoption":"user_confirmed","originLevel":m.origin_level}))?]).map_err(db_error)?;
                    if let Some(t)=&m.task_id{tx.execute("INSERT INTO tp_relations VALUES(?1,?2,?3,?4,'none',?5,?6,1,1)",params![new_id(&tx,"rel")?,t,m.id,if ["memory","pause"].contains(&m.kind.as_str()){"related_to"}else{"governed_by"},m.source,m.origin_level]).map_err(db_error)?;}
                    if m.task_id.is_none(){if let Some(project)=&m.project_id{graph_link(&tx,project,&m.id,if m.category=="reference"{"related_to"}else{"governed_by"},&m.origin_level,"项目范围已采纳记录")?;}}
                    if let Some(old)=&m.supersedes{tx.execute("UPDATE tp_nodes SET stale=1 WHERE id=?1",[old]).map_err(db_error)?;tx.execute("UPDATE tp_relations SET active=0,revision=revision+1 WHERE to_id=?1 AND kind IN ('governed_by','related_to') AND active=1",[old]).map_err(db_error)?;}
                }
                (id.clone(),m.revision+1,if apply{"本人核对后应用记忆；未提升来源证据等级"}else{"草案已取消并保留原件"}.into())
            },
        };
        bump_graph(&tx)?;
        let sequence=event(&tx,&input.request_id,&object_id,"mutation","user",&detail)?;
        let result=MutationReceipt{object_id,revision,sequence};receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
    }
}
pub(crate) fn is_live(state:&str)->bool { ["sending","awaiting_receipt","accepted","running","blocked","uncertain","disconnected"].contains(&state) }

pub(crate) fn node_row(r:&rusqlite::Row<'_>)->rusqlite::Result<Node>{
    Ok(Node{id:r.get(0)?,repository_id:r.get(1)?,kind:r.get(2)?,label:r.get(3)?,path:r.get(4)?,symbol:r.get(5)?,evidence_level:r.get(6)?,sources:json_column(r,7)?,stale:r.get(8)?})
}
pub(crate) fn nodes(db:&Connection)->Result<Vec<Node>,StorageError>{
    db.prepare("SELECT id,repository_id,kind,label,path,symbol,evidence_level,sources,stale FROM tp_nodes ORDER BY kind,label,id").map_err(db_error)?.query_map([],node_row).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
