//! Compatibility with the observed feat/agent-dev schema16. Its schema13/14
//! numbers describe different tables from this branch's task-panel migrations.
//! Preserve its version and data; only add our own tables after validation.
use super::{Connection, OptionalExtension, StorageError, SCHEMA_VERSION, db_error};

pub(super) const AGENT_SCHEMA_VERSION: i64 = 16;

pub(super) struct BranchSchema {
    pub task_panel_version: i64,
    pub shared_agent: bool,
    pub needs_marker: bool,
}

fn incompatible() -> StorageError {
    StorageError::new("incompatible_database", "数据库版本与模块结构不一致，未迁移或覆盖。请保留原目录并核对来源版本。")
}

pub(super) fn supports(version: i64) -> bool {
    (1..=SCHEMA_VERSION).contains(&version) || version == AGENT_SCHEMA_VERSION
}

pub(super) fn inspect(db: &Connection, version: i64) -> Result<BranchSchema, StorageError> {
    let shared_agent = version == AGENT_SCHEMA_VERSION;
    let has_agent: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name GLOB 'agent_*')", [], |r| r.get(0),
    ).map_err(db_error)?;
    if shared_agent {
        validate_agent16(db)?;
    } else if has_agent {
        // Older Agent layouts reused schema13/14. Do not mistake those for
        // task-panel versions or advance an Agent migration on its behalf.
        return Err(incompatible());
    }

    let has_tasks: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name GLOB 'tp_*')", [], |r| r.get(0),
    ).map_err(db_error)?;
    let has_projects: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name IN ('tp_projects','tp_project_repositories','tp_task_plans','tp_memory_origins','tp_agent_grants'))",
        [], |r| r.get(0),
    ).map_err(db_error)?;
    let task_panel_version = if has_tasks {
        crate::task_panel_store::validate_schema(db).map_err(|_| incompatible())?;
        if has_projects {
            crate::task_panel_projects::validate_schema(db).map_err(|_| incompatible())?;
            14
        } else { 13 }
    } else { 0 };
    if !shared_agent {
        let expected = if version >= 13 { version } else { 0 };
        if task_panel_version != expected { return Err(incompatible()); }
    }
    let marker: Option<String> = db.query_row(
        "SELECT value FROM app_meta WHERE key='task_panel_schema'", [], |r| r.get(0),
    ).optional().map_err(db_error)?;
    if let Some(saved) = &marker {
        if saved != "14" || task_panel_version != 14 { return Err(incompatible()); }
    }
    Ok(BranchSchema { task_panel_version, shared_agent, needs_marker: shared_agent && marker.is_none() })
}

fn validate_agent16(db: &Connection) -> Result<(), StorageError> {
    // Schema-only reads: never load or change Agent conversations, drafts,
    // attachments or jobs. These columns come from feat/agent-dev's schema16.
    for sql in [
        "SELECT id,name,content,revision,created_at FROM projects LIMIT 0",
        "SELECT id,input,result FROM project_requests LIMIT 0",
        "SELECT id,source,session_path,native_session_id,cwd,title,updated_at,deleted_at FROM agent_conversations LIMIT 0",
        "SELECT source_key,conversation_id FROM agent_bindings LIMIT 0",
        "SELECT id,conversation_id,session_id,generation,message_count,context,status,created_at FROM agent_inputs LIMIT 0",
        "SELECT id,name,relative_path,hash,bytes,mime_type,created_at FROM agent_attachments LIMIT 0",
        "SELECT id,conversation_id,input_id,message_key,payload,validation,status,receipt,revision,created_at FROM agent_drafts LIMIT 0",
        "SELECT id,template,input,parent_id,status,output,error,context_objects,timeout_ms,ordinal,created_at,started_at,finished_at FROM agent_jobs LIMIT 0",
        "SELECT id,job_id,at,message FROM agent_job_logs LIMIT 0",
        "SELECT path,session_id,deleted_at FROM agent_deleted_sessions LIMIT 0",
        "SELECT deleted FROM todos LIMIT 0",
    ] {
        db.prepare(sql).map_err(|_| incompatible())?;
    }
    crate::projects::validate_deletion_schema(db).map_err(|_| incompatible())?;
    Ok(())
}

#[cfg(test)]
#[path = "storage-branch-schema-tests.rs"]
mod tests;
