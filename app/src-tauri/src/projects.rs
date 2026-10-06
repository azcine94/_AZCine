// S02 company documents; all writes run under the application storage mutex.
use std::collections::{BTreeMap, HashSet};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use crate::storage::{StorageError, Store, valid_date};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_REVISION: i64 = 9_007_199_254_740_991;

#[cfg(test)]
#[path = "projects-tests.rs"]
mod tests;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageLabel { pub id: String, pub name: String }
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ColumnKind { Text, Shot, Stage, Date, Delivered }
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListColumn {
    pub id: String, pub name: String, pub kind: ColumnKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u16>,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRow { pub id: String, pub cells: BTreeMap<String, String> }
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChecklistItem { pub id: String, pub text: String, pub checked: bool }
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProjectBlock {
    Text { id: String, title: String, body: String },
    Checklist { id: String, title: String, items: Vec<ChecklistItem> },
    List { id: String, title: String, included: bool, columns: Vec<ListColumn>, rows: Vec<ListRow> },
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectContent { pub id: String, pub name: String, pub labels: Vec<StageLabel>, pub blocks: Vec<ProjectBlock> }
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocument {
    #[serde(flatten)] pub content: ProjectContent,
    pub revision: i64,
    pub created_at: String,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveProject { pub request_id: String, pub expected_revision: Option<i64>, pub document: ProjectContent }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteProject { pub request_id: String, pub project_id: String, pub expected_revision: i64, pub deleted: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionReceipt { pub request_id: String, pub deleted: bool, pub project: ProjectDocument }
#[derive(Serialize)]
pub struct ProjectCatalog { pub projects: Vec<ProjectDocument>, pub removed: Vec<ProjectDocument> }

// Persist request responses in a nested internal envelope: the public document
// remains flat, while serde deny_unknown_fields stays useful for the content.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedResponse { content: ProjectContent, revision: i64, created_at: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedDeletion { request_id: String, deleted: bool, project: SavedResponse }
impl From<&ProjectDocument> for SavedResponse {
    fn from(doc: &ProjectDocument) -> Self { Self { content: doc.content.clone(), revision: doc.revision, created_at: doc.created_at.clone() } }
}
impl From<SavedResponse> for ProjectDocument {
    fn from(doc: SavedResponse) -> Self { Self { content: doc.content, revision: doc.revision, created_at: doc.created_at } }
}
fn database_error(_: rusqlite::Error) -> StorageError { StorageError::new("storage_database", "项目数据库操作失败，未报告保存成功；输入已保留，请核对后重试。") }
fn invalid(message: &str) -> StorageError { StorageError::new("invalid_project_content", message) }
fn corrupt() -> StorageError { StorageError::new("project_data_invalid", "项目记录不完整，未用空文档替代。请保留数据目录并核对有效备份。") }
fn uuid(value: &str) -> bool {
    value.len() == 36 && value.bytes().enumerate().all(|(i,c)| if [8,13,18,23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() })
}
fn request_id(id: &str) -> Result<(), StorageError> {
    if !uuid(id) { return Err(StorageError::new("invalid_id", "项目请求编号无效，请重新核对。")); }
    Ok(())
}
fn entity(id: &str, used: &mut HashSet<String>) -> Result<(), StorageError> {
    if !uuid(id) || !used.insert(id.to_ascii_lowercase()) { return Err(invalid("项目内编号必须是唯一的有效 UUID，不会覆盖重复对象。")); }
    Ok(())
}
fn named(value: &str, max: usize) -> bool { !value.trim().is_empty() && value.chars().count() <= max }
pub fn validate_content(doc: &ProjectContent) -> Result<(), StorageError> {
    if !named(&doc.name, 200) { return Err(invalid("请填写 1–200 字的项目名称。")); }
    if doc.labels.len() > 100 || doc.blocks.len() > 200 { return Err(invalid("每个项目最多 100 个阶段标签和 200 个内容块，未截断原输入。")); }
    let mut used = HashSet::new(); entity(&doc.id, &mut used)?;
    let mut label_names = HashSet::new(); let mut label_ids = HashSet::new();
    for label in &doc.labels {
        entity(&label.id, &mut used)?;
        if !named(&label.name, 80) || !label_names.insert(label.name.trim()) { return Err(invalid("标签名称需为 1–80 字且在本项目内不能重复。")); }
        label_ids.insert(label.id.as_str());
    }
    for block in &doc.blocks {
        let (id, title) = match block {
            ProjectBlock::Text { id, title, .. } | ProjectBlock::Checklist { id, title, .. } | ProjectBlock::List { id, title, .. } => (id, title),
        };
        entity(id, &mut used)?;
        if !named(title, 200) { return Err(invalid("内容块标题需为 1–200 字。")); }
        match block {
            ProjectBlock::Text { body, .. } => {
                if body.chars().count() > 100_000 { return Err(invalid("单个文字块最多 100000 字，未截断输入。")); }
            },
            ProjectBlock::Checklist { items, .. } => {
                if items.len() > 10_000 { return Err(invalid("单个勾选清单最多 10000 项。")); }
                for item in items {
                    entity(&item.id, &mut used)?;
                    if item.text.chars().count() > 10_000 { return Err(invalid("清单项内容最多 10000 字。")); }
                }
            },
            ProjectBlock::List { columns, rows, .. } => {
                if columns.len() > 64 || rows.len() > 10_000 { return Err(invalid("单个 list 最多 64 列、10000 行。")); }
                let mut kinds = HashSet::new(); let mut column_map = BTreeMap::new();
                for column in columns {
                    entity(&column.id, &mut used)?;
                    if !named(&column.name, 200) { return Err(invalid("列名称需为 1–200 字。")); }
                    if column.width.is_some_and(|width| !(112..=640).contains(&width)) { return Err(invalid("列宽需为 112–640 的整数。")); }
                    if column.kind != ColumnKind::Text && !kinds.insert(column.kind) { return Err(invalid("同一 list 的镜头、阶段、日期、交完列每种最多一个。")); }
                    column_map.insert(column.id.as_str(), column.kind);
                }
                for row in rows {
                    entity(&row.id, &mut used)?;
                    for (column_id, value) in &row.cells {
                        let kind = column_map.get(column_id.as_str()).ok_or_else(|| invalid("行包含不存在的列，未丢弃原值或保存。"))?;
                        let valid = match kind {
                            ColumnKind::Text => value.chars().count() <= 10_000,
                            ColumnKind::Shot => value.chars().count() <= 200,
                            ColumnKind::Stage => value.is_empty() || label_ids.contains(value.as_str()),
                            ColumnKind::Date => value.is_empty() || valid_date(value),
                            ColumnKind::Delivered => matches!(value.as_str(), "" | "true" | "false"),
                        };
                        if !valid { return Err(invalid("单元格无效：检查完整日期、本项目标签、镜头长度或交完值；不会推断缺失数据。")); }
                    }
                }
            },
        }
    }
    let bytes = serde_json::to_vec(doc).map_err(|_| invalid("无法编码项目文档。"))?;
    if bytes.len() > MAX_BYTES { return Err(invalid("单个项目文档最多 16 MiB，未截断输入。")); }
    Ok(())
}

// Called by the parent's single-writer v1 -> v2 transaction (or initial schema transaction).
pub(crate) fn create_schema(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ) STRICT;
    CREATE TABLE project_requests (id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL) STRICT;
    CREATE TRIGGER todos_project_insert BEFORE INSERT ON todos
      WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'invalid project'); END;
    CREATE TRIGGER todos_project_update BEFORE UPDATE OF project_id ON todos
      WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'invalid project'); END;").map_err(database_error)?;
    create_deletion_schema(db)
}
pub(crate) fn create_deletion_schema(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS project_deletions (
        project_id TEXT PRIMARY KEY REFERENCES projects(id), deleted INTEGER NOT NULL CHECK(deleted IN (0,1))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS project_deletion_requests (id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL) STRICT;").map_err(database_error)?;
    validate_deletion_schema(db)
}
pub(crate) fn validate_deletion_schema(db: &Connection) -> Result<(), StorageError> {
    db.prepare("SELECT project_id,deleted FROM project_deletions LIMIT 0").map_err(database_error)?;
    db.prepare("SELECT id,input,result FROM project_deletion_requests LIMIT 0").map_err(database_error)?;
    Ok(())
}
fn document_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, i64, String)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
}
fn decode_row((id, name, json, revision, created_at): (String, String, String, i64, String)) -> Result<ProjectDocument, StorageError> {
    let content: ProjectContent = serde_json::from_str(&json).map_err(|_| corrupt())?;
    validate_content(&content).map_err(|_| corrupt())?;
    if content.id != id || content.name != name || !(1..=MAX_REVISION).contains(&revision) || created_at.is_empty() { return Err(corrupt()); }
    Ok(ProjectDocument { content, revision, created_at })
}
fn decode_response(json: &str) -> Result<ProjectDocument, StorageError> {
    let result: SavedResponse = serde_json::from_str(json).map_err(|_| corrupt())?;
    validate_content(&result.content).map_err(|_| corrupt())?;
    if !(1..=MAX_REVISION).contains(&result.revision) || result.created_at.is_empty() { return Err(corrupt()); }
    Ok(result.into())
}
impl Store {
    pub fn projects(&self) -> Result<Vec<ProjectDocument>, StorageError> {
        let mut query = self.db.prepare("SELECT id,name,content,revision,created_at FROM projects WHERE NOT EXISTS (SELECT 1 FROM project_deletions d WHERE d.project_id=projects.id AND d.deleted=1) ORDER BY created_at,id").map_err(database_error)?;
        let rows = query.query_map([], document_row).map_err(database_error)?.collect::<Result<Vec<_>, _>>().map_err(database_error)?;
        rows.into_iter().map(decode_row).collect()
    }
    pub fn project_catalog(&self) -> Result<ProjectCatalog, StorageError> {
        let mut query = self.db.prepare("SELECT id,name,content,revision,created_at FROM projects WHERE EXISTS (SELECT 1 FROM project_deletions d WHERE d.project_id=projects.id AND d.deleted=1) ORDER BY created_at,id").map_err(database_error)?;
        let rows = query.query_map([], document_row).map_err(database_error)?.collect::<Result<Vec<_>, _>>().map_err(database_error)?;
        let removed = rows.into_iter().map(decode_row).collect::<Result<Vec<_>, _>>()?;
        Ok(ProjectCatalog { projects: self.projects()?, removed })
    }
    pub fn project_deletion_request(&self, id: &str) -> Result<Option<DeletionReceipt>, StorageError> {
        request_id(id)?;
        let raw: Option<String> = self.db.query_row("SELECT result FROM project_deletion_requests WHERE id=?1", [id], |r| r.get(0)).optional().map_err(database_error)?;
        raw.as_deref().map(decode_deletion).transpose()
    }
    pub fn set_project_deleted(&mut self, input: DeleteProject) -> Result<DeletionReceipt, StorageError> {
        request_id(&input.request_id)?; request_id(&input.project_id)?;
        if !(1..MAX_REVISION).contains(&input.expected_revision) { return Err(invalid("项目修订号无效，未删除或恢复。")); }
        let input_json = serde_json::to_string(&input).map_err(|_| corrupt())?;
        let tx = self.db.transaction().map_err(database_error)?;
        let previous: Option<(String, String)> = tx.query_row("SELECT input,result FROM project_deletion_requests WHERE id=?1", [&input.request_id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(database_error)?;
        if let Some((old, result)) = previous {
            if old != input_json { return Err(StorageError::new("request_conflict", "同一项目操作编号已有不同内容，未覆盖。")); }
            return decode_deletion(&result);
        }
        let raw = tx.query_row("SELECT id,name,content,revision,created_at FROM projects WHERE id=?1", [&input.project_id], document_row).optional().map_err(database_error)?
            .ok_or_else(|| StorageError::new("project_missing", "项目不存在，未删除或恢复。"))?;
        let mut project = decode_row(raw)?;
        let deleted: bool = tx.query_row("SELECT deleted FROM project_deletions WHERE project_id=?1", [&input.project_id], |r| r.get(0)).optional().map_err(database_error)?.unwrap_or(false);
        if project.revision != input.expected_revision || deleted == input.deleted { return Err(StorageError::new("stale_record", "项目内容或删除状态已变化，请重新核对后操作。")); }
        let changed = tx.execute("UPDATE projects SET revision=revision+1 WHERE id=?1 AND revision=?2", params![input.project_id, input.expected_revision]).map_err(database_error)?;
        if changed != 1 { return Err(StorageError::new("stale_record", "项目版本已变化，未删除或恢复。")); }
        project.revision += 1;
        tx.execute("INSERT INTO project_deletions(project_id,deleted) VALUES(?1,?2) ON CONFLICT(project_id) DO UPDATE SET deleted=excluded.deleted", params![input.project_id, input.deleted]).map_err(database_error)?;
        let saved = SavedDeletion { request_id: input.request_id.clone(), deleted: input.deleted, project: SavedResponse::from(&project) };
        let result_json = serde_json::to_string(&saved).map_err(|_| corrupt())?;
        tx.execute("INSERT INTO project_deletion_requests(id,input,result) VALUES(?1,?2,?3)", params![input.request_id, input_json, result_json]).map_err(database_error)?;
        tx.commit().map_err(database_error)?;
        Ok(DeletionReceipt { request_id: input.request_id, deleted: input.deleted, project })
    }
    pub fn project(&self, id: &str) -> Result<Option<ProjectDocument>, StorageError> {
        request_id(id)?;
        self.db.query_row("SELECT id,name,content,revision,created_at FROM projects WHERE id=?1", [id], document_row).optional().map_err(database_error)?.map(decode_row).transpose()
    }
    pub fn project_request(&self, id: &str) -> Result<Option<ProjectDocument>, StorageError> {
        request_id(id)?;
        let result: Option<String> = self.db.query_row("SELECT result FROM project_requests WHERE id=?1", [id], |row| row.get(0)).optional().map_err(database_error)?;
        result.as_deref().map(decode_response).transpose()
    }
    pub fn save_project(&mut self, input: SaveProject) -> Result<ProjectDocument, StorageError> {
        request_id(&input.request_id)?; validate_content(&input.document)?;
        if input.expected_revision.is_some_and(|r| !(1..MAX_REVISION).contains(&r)) { return Err(invalid("项目修订号无效，未覆盖正式记录。")); }
        let input_json = serde_json::to_string(&input).map_err(|_| invalid("无法编码保存请求。"))?;
        let content_json = serde_json::to_string(&input.document).map_err(|_| invalid("无法编码项目文档。"))?;
        let tx = self.db.transaction().map_err(database_error)?;
        let existing_request: Option<(String, String)> = tx.query_row("SELECT input,result FROM project_requests WHERE id=?1", [&input.request_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(database_error)?;
        if let Some((previous, result)) = existing_request {
            if previous != input_json { return Err(StorageError::new("request_conflict", "相同请求编号已有不同内容，未覆盖或重复创建。请核对保存结果。")); }
            return decode_response(&result);
        }
        let deleted: bool = tx.query_row("SELECT deleted FROM project_deletions WHERE project_id=?1", [&input.document.id], |r| r.get(0)).optional().map_err(database_error)?.unwrap_or(false);
        if deleted { return Err(StorageError::new("project_deleted", "项目已删除，草稿保留，请先恢复项目后核对保存。")); }
        let old: Option<(i64, String)> = tx.query_row("SELECT revision,created_at FROM projects WHERE id=?1", [&input.document.id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(database_error)?;
        let (revision, created_at) = match (old, input.expected_revision) {
            (None, None) => {
                tx.execute("INSERT INTO projects(id,name,content,revision) VALUES (?1,?2,?3,1)", params![input.document.id, input.document.name, content_json]).map_err(database_error)?;
                (1, tx.query_row("SELECT created_at FROM projects WHERE id=?1", [&input.document.id], |row| row.get(0)).map_err(database_error)?)
            },
            (Some((revision, created_at)), Some(expected)) if revision == expected => {
                tx.execute("UPDATE projects SET name=?1,content=?2,revision=revision+1 WHERE id=?3 AND revision=?4", params![input.document.name, content_json, input.document.id, expected]).map_err(database_error)?;
                (revision + 1, created_at)
            },
            _ => return Err(StorageError::new("stale_record", "此项目已改变，未覆盖或部分保存。草稿已保留，请重新核对正式记录。")),
        };
        let result = ProjectDocument { content: input.document, revision, created_at };
        let result_json = serde_json::to_string(&SavedResponse::from(&result)).map_err(|_| invalid("无法编码保存结果。"))?;
        tx.execute("INSERT INTO project_requests(id,input,result) VALUES (?1,?2,?3)", params![input.request_id, input_json, result_json]).map_err(database_error)?;
        tx.commit().map_err(database_error)?;
        Ok(result)
    }
}
fn decode_deletion(json: &str) -> Result<DeletionReceipt, StorageError> {
    let saved: SavedDeletion = serde_json::from_str(json).map_err(|_| corrupt())?;
    request_id(&saved.request_id)?;
    let project = decode_response(&serde_json::to_string(&saved.project).map_err(|_| corrupt())?)?;
    Ok(DeletionReceipt { request_id: saved.request_id, deleted: saved.deleted, project })
}
