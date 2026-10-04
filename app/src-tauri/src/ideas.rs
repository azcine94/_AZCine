use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use crate::storage::{StorageError, Store};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdeaContent { pub id: String, pub title: String, pub body: String, pub tags: Vec<String>, pub project_id: Option<String> }
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Idea {
    pub id: String, pub title: String, pub body: String, pub tags: Vec<String>, pub project_id: Option<String>,
    pub revision: i64, pub created_at: String, pub updated_at: String, pub deleted: bool, pub todo_id: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveIdea { pub request_id: String, pub expected_revision: Option<i64>, pub content: IdeaContent }
fn db_error(_: rusqlite::Error) -> StorageError { StorageError::new("ideas_database", "灵感操作失败，输入和原记录已保留。请核对后重试。") }
fn invalid(message: &str) -> StorageError { StorageError::new("invalid_idea", message) }
fn uuid(id: &str) -> bool { id.len() == 36 && id.bytes().enumerate().all(|(i,c)| if [8,13,18,23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() }) }
fn validate(input: &SaveIdea) -> Result<(), StorageError> {
    if !uuid(&input.request_id) || !uuid(&input.content.id) { return Err(invalid("灵感请求编号无效。")); }
    if input.expected_revision.is_some_and(|r| r < 1 || r >= 9_007_199_254_740_991) { return Err(invalid("灵感版本无效。")); }
    let c = &input.content;
    if c.body.trim().is_empty() || c.body.chars().count() > 20_000 { return Err(invalid("请填写 1–20000 字的灵感内容。")); }
    if c.title.chars().count() > 200 { return Err(invalid("标题最多 200 字，也可以不填。")); }
    let mut tags = std::collections::HashSet::new();
    if c.tags.len() > 20 || c.tags.iter().any(|t| t.trim().is_empty() || t != t.trim() || t.chars().count() > 40 || !tags.insert(t.to_lowercase())) { return Err(invalid("最多 20 个标签，每个 1–40 字，不能重复。")); }
    if c.project_id.as_ref().is_some_and(|id| !uuid(id)) { return Err(invalid("公司关联编号无效。")); }
    Ok(())
}
pub fn create_schema(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("CREATE TABLE ideas (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL CHECK(length(trim(body))>0), tags TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id), revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), todo_id TEXT UNIQUE REFERENCES todos(id)) STRICT;
        CREATE INDEX ideas_recent ON ideas(deleted,updated_at);
        CREATE TABLE idea_requests (id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL) STRICT;").map_err(db_error)
}
pub(crate) fn validate_schema(db: &Connection) -> Result<(), StorageError> {
    db.prepare("SELECT id,title,body,tags,project_id,revision,created_at,updated_at,deleted,todo_id FROM ideas LIMIT 0").map_err(db_error)?;
    db.prepare("SELECT id,input,result FROM idea_requests LIMIT 0").map_err(db_error)?;
    Ok(())
}
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Idea> {
    let raw: String = r.get(3)?;
    let tags = serde_json::from_str(&raw).map_err(|e| rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e)))?;
    Ok(Idea { id:r.get(0)?, title:r.get(1)?, body:r.get(2)?, tags, project_id:r.get(4)?, revision:r.get(5)?, created_at:r.get(6)?, updated_at:r.get(7)?, deleted:r.get(8)?, todo_id:r.get(9)? })
}
const COLUMNS: &str = "id,title,body,tags,project_id,revision,created_at,updated_at,deleted,todo_id";
fn get(db: &Connection, id: &str) -> Result<Option<Idea>, StorageError> {
    db.query_row(&format!("SELECT {COLUMNS} FROM ideas WHERE id=?1"), [id], row).optional().map_err(db_error)
}
fn conflict() -> StorageError { StorageError::new("stale_idea", "这张灵感已改变，请重新读取核对。未覆盖新的记录，编辑草稿保留。") }
impl Store {
    pub fn idea_request(&self, request_id: &str) -> Result<Option<Idea>, StorageError> {
        if !uuid(request_id) { return Err(invalid("保存请求编号无效。")); }
        let raw: Option<String> = self.db.query_row("SELECT result FROM idea_requests WHERE id=?1", [request_id], |r| r.get(0)).optional().map_err(db_error)?;
        raw.map(|value| serde_json::from_str(&value).map_err(|_| invalid("保存回执损坏，请保留原库并核对。"))).transpose()
    }
    pub fn ideas(&self) -> Result<Vec<Idea>, StorageError> {
        self.db.prepare(&format!("SELECT {COLUMNS} FROM ideas ORDER BY updated_at DESC,created_at DESC,id"))
            .map_err(db_error)?.query_map([], row).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
    }
    pub fn save_idea(&mut self, input: SaveIdea) -> Result<Idea, StorageError> {
        validate(&input)?;
        let encoded = serde_json::to_string(&input).map_err(|_| invalid("无法保存灵感输入。"))?;
        let tx = self.db.transaction().map_err(db_error)?;
        let prior: Option<(String,String)> = tx.query_row("SELECT input,result FROM idea_requests WHERE id=?1", [&input.request_id], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        if let Some((old, result)) = prior {
            if old != encoded { return Err(StorageError::new("request_conflict", "此请求编号已有其他输入，未覆盖。")); }
            return serde_json::from_str(&result).map_err(|_| invalid("保存回执不完整，请保留原库并核对。"));
        }
        let c = &input.content;
        if let Some(id) = &c.project_id {
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)", [id], |r| r.get(0)).map_err(db_error)?;
            if !exists { return Err(invalid("关联公司不存在，请重新选择。")); }
        }
        let tags = serde_json::to_string(&c.tags).map_err(|_| invalid("无法保存标签。"))?;
        match input.expected_revision {
            None => {
                if get(&tx, &c.id)?.is_some() { return Err(conflict()); }
                tx.execute("INSERT INTO ideas(id,title,body,tags,project_id) VALUES (?1,?2,?3,?4,?5)", params![c.id,c.title.trim(),c.body.trim(),tags,c.project_id]).map_err(db_error)?;
            },
            Some(revision) => {
                if tx.execute("UPDATE ideas SET title=?1,body=?2,tags=?3,project_id=?4,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?5 AND revision=?6 AND deleted=0", params![c.title.trim(),c.body.trim(),tags,c.project_id,c.id,revision]).map_err(db_error)? != 1 { return Err(conflict()); }
            }
        }
        let saved = get(&tx, &c.id)?.ok_or_else(conflict)?;
        let result = serde_json::to_string(&saved).map_err(|_| invalid("无法生成保存回执。"))?;
        tx.execute("INSERT INTO idea_requests(id,input,result) VALUES (?1,?2,?3)", params![input.request_id,encoded,result]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(saved)
    }
    pub fn set_idea_deleted(&mut self, id: &str, revision: i64, deleted: bool) -> Result<Idea, StorageError> {
        if !uuid(id) || !(1..9_007_199_254_740_991).contains(&revision) { return Err(invalid("灵感编号或版本无效。")); }
        let tx = self.db.transaction().map_err(db_error)?;
        let prior = get(&tx,id)?.ok_or_else(conflict)?;
        if prior.deleted == deleted && prior.revision == revision + 1 { return Ok(prior); }
        if prior.revision != revision || prior.deleted == deleted { return Err(conflict()); }
        if tx.execute("UPDATE ideas SET deleted=?1,revision=revision+1 WHERE id=?2 AND revision=?3", params![deleted,id,revision]).map_err(db_error)? != 1 { return Err(conflict()); }
        let saved = get(&tx,id)?.ok_or_else(conflict)?;
        tx.commit().map_err(db_error)?; Ok(saved)
    }
    pub fn convert_idea(&mut self, id: &str, revision: i64) -> Result<Idea, StorageError> {
        if !uuid(id) || !(1..9_007_199_254_740_991).contains(&revision) { return Err(invalid("灵感编号或版本无效。")); }
        let tx = self.db.transaction().map_err(db_error)?;
        let idea = get(&tx,id)?.ok_or_else(conflict)?;
        if idea.deleted { return Err(conflict()); }
        if idea.todo_id.is_some() { return Ok(idea); }
        if idea.revision != revision { return Err(conflict()); }
        let todo_id: String = tx.query_row("SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6)))", [], |r| r.get(0)).map_err(db_error)?;
        let title: String = if idea.title.is_empty() { idea.body.lines().next().unwrap_or(&idea.body).chars().take(200).collect() } else { idea.title.clone() };
        tx.execute("INSERT INTO todos(id,title,project_id) VALUES (?1,?2,?3)", params![todo_id,title,idea.project_id]).map_err(db_error)?;
        tx.execute("UPDATE ideas SET todo_id=?1,revision=revision+1 WHERE id=?2 AND revision=?3", params![todo_id,id,revision]).map_err(db_error)?;
        let saved = get(&tx,id)?.ok_or_else(conflict)?;
        tx.commit().map_err(db_error)?; Ok(saved)
    }
}

#[cfg(test)]
#[path = "ideas-tests.rs"] mod tests;
