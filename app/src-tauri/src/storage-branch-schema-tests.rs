use crate::storage::{Connection, CreateTodo, Store, integration_tests};
use crate::task_panel_types::{Mutation, MutationInput};
use rusqlite::types::Value;
use std::path::PathBuf;

const TODO: &str = "aaaaaaaa-1111-2222-3333-444444444444";
const VISIBLE_TODO: &str = "aaaaaaaa-1111-2222-3333-555555555555";
const AGENT_TABLES: [&str; 8] = ["agent_conversations", "agent_bindings", "agent_inputs", "agent_attachments", "agent_drafts", "agent_jobs", "agent_job_logs", "agent_deleted_sessions"];

// Explicit fictional schema16 fixture, copied from the Agent branch's DDL.
// Never open a locator, user data root, real Pi state or a Herdr session.
fn fixture() -> (PathBuf, Connection) {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
    std::fs::create_dir_all(&base).unwrap();
    let root = tempfile::Builder::new().prefix("shared-schema-fixture-").tempdir_in(base).unwrap().keep().join("data");
    let db = integration_tests::legacy_database(&root, 12, true, true, true);
    crate::news_reader_store::create_schema(&db).unwrap();
    crate::news_scope::create_schema(&db).unwrap();
    crate::news_reset::create_schema(&db).unwrap();
    crate::bookkeeping::create_schema(&db).unwrap();
    crate::projects::create_deletion_schema(&db).unwrap();
    db.execute_batch("
        CREATE TABLE agent_conversations(id TEXT PRIMARY KEY,source TEXT NOT NULL,session_path TEXT,native_session_id TEXT,cwd TEXT,title TEXT,updated_at TEXT NOT NULL) STRICT;
        CREATE TABLE agent_bindings(source_key TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES agent_conversations(id)) STRICT;
        CREATE TABLE agent_inputs(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),session_id TEXT NOT NULL,generation INTEGER NOT NULL,message_count INTEGER NOT NULL,context TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE agent_attachments(id TEXT PRIMARY KEY,name TEXT NOT NULL,relative_path TEXT NOT NULL,hash TEXT NOT NULL,bytes INTEGER NOT NULL,mime_type TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
        CREATE TABLE agent_drafts(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),input_id TEXT NOT NULL REFERENCES agent_inputs(id),message_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,validation TEXT NOT NULL,status TEXT NOT NULL,receipt TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL) STRICT;
        CREATE INDEX agent_drafts_status ON agent_drafts(status,created_at);
        CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,template TEXT NOT NULL,input TEXT NOT NULL,parent_id TEXT REFERENCES agent_jobs(id),status TEXT NOT NULL,output TEXT,error TEXT,context_objects TEXT NOT NULL DEFAULT '[]',timeout_ms INTEGER NOT NULL,ordinal INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT) STRICT;
        CREATE TABLE agent_job_logs(id INTEGER PRIMARY KEY,job_id TEXT NOT NULL REFERENCES agent_jobs(id),at TEXT NOT NULL,message TEXT NOT NULL) STRICT;
        ALTER TABLE agent_conversations ADD COLUMN deleted_at TEXT;
        CREATE TABLE agent_deleted_sessions(path TEXT PRIMARY KEY,session_id TEXT NOT NULL,deleted_at TEXT NOT NULL) STRICT;
        ALTER TABLE todos ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1));
        INSERT INTO agent_conversations(id,source,title,updated_at) VALUES('fixture-conversation','{}','explicit fixture','2026-10-07');
        INSERT INTO agent_bindings VALUES('fixture-source','fixture-conversation');
        INSERT INTO agent_inputs VALUES('fixture-input','fixture-conversation','fixture-session',1,1,'{}','prepared','2026-10-07');
        INSERT INTO agent_attachments VALUES('fixture-attachment','fixture.txt','fixture.txt','fixture-hash',7,'text/plain','2026-10-07');
        INSERT INTO agent_drafts VALUES('fixture-draft','fixture-conversation','fixture-input','fixture-message','{}','{}','review',NULL,3,'2026-10-07');
        INSERT INTO agent_jobs(id,template,input,status,timeout_ms,created_at) VALUES('fixture-job','fixture','{}','queued',1000,'2026-10-07');
        INSERT INTO agent_job_logs VALUES(1,'fixture-job','2026-10-07','retained fixture log');
        INSERT INTO agent_deleted_sessions VALUES('fixture-deleted.jsonl','fixture-deleted-session','2026-10-07');
        PRAGMA user_version=16;
    ").unwrap();
    (root, db)
}

fn version(db: &Connection) -> i64 { db.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap() }
fn text(db: &Connection, sql: &str) -> String { db.query_row(sql, [], |r| r.get(0)).unwrap() }
fn agent_rows(db: &Connection) -> Vec<Vec<Vec<Value>>> {
    AGENT_TABLES.iter().map(|table| {
        let mut query = db.prepare(&format!("SELECT * FROM {table} ORDER BY 1")).unwrap();
        let count = query.column_count();
        let rows = query.query_map([], |r| (0..count).map(|i| r.get::<_, Value>(i)).collect::<Result<Vec<_>, _>>()).unwrap()
            .collect::<Result<Vec<_>, _>>().unwrap();
        rows
    }).collect()
}
fn task_tables(db: &Connection) -> i64 {
    db.query_row("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name GLOB 'tp_*'", [], |r| r.get(0)).unwrap()
}

#[test]
fn given_agent16_without_task_tables_when_opened_then_agent_records_identity_and_global_version_survive_reopen() {
    let (root, db) = fixture();
    let retained = agent_rows(&db);
    let identity = text(&db, "SELECT value FROM app_meta WHERE key='identity'");
    drop(db);
    let mut store = Store::open(&root, false).unwrap();
    assert_eq!(version(&store.db), 16);
    assert_eq!(agent_rows(&store.db), retained);
    assert_eq!(text(&store.db, "SELECT value FROM app_meta WHERE key='identity'"), identity);
    assert_eq!(text(&store.db, "SELECT value FROM app_meta WHERE key='task_panel_schema'"), "14");
    assert!(store.task_panel_snapshot().unwrap().tasks.is_empty());
    store.task_panel_mutate(MutationInput { request_id: "fixture-task-save".into(), expected_revision: None,
        action: Mutation::SaveTask { plan: None, id: "fixture-task".into(), title: "隔离兼容任务".into(), goal: "保留两模块记录".into(), scope: vec![], criteria: vec!["重开后保留".into()], repository_id: None, source: "explicit fixture".into() },
    }).unwrap();
    drop(store);
    let store = Store::open(&root, false).unwrap();
    assert_eq!(version(&store.db), 16);
    assert_eq!(agent_rows(&store.db), retained);
    assert_eq!(store.task_panel_snapshot().unwrap().tasks[0].task.id, "fixture-task");
    assert_eq!(text(&store.db, "SELECT result FROM idea_requests WHERE id='retained-request'"), "original-receipt");
}

#[test]
fn given_agent16_with_legacy_task_tables_when_opened_then_task_receipts_survive_additive_project_migration() {
    let (root, db) = fixture();
    crate::task_panel_store::create_schema(&db).unwrap();
    db.execute_batch("INSERT INTO tp_requests VALUES('retained-task-request','original-input','original-result');
        INSERT INTO tp_tasks VALUES('fixture-task',1,'原任务','保留','[]','[]',NULL,'draft','','fixture','',1,'2026-10-07','2026-10-07');").unwrap();
    crate::task_panel_store::graph_object(&db, "fixture-task", None, "task", "原任务", "user_confirmed", &serde_json::json!({})).unwrap();
    let retained = agent_rows(&db);
    drop(db);
    let store = Store::open(&root, false).unwrap();
    assert_eq!(version(&store.db), 16);
    assert_eq!(agent_rows(&store.db), retained);
    assert_eq!(text(&store.db, "SELECT result FROM tp_requests WHERE id='retained-task-request'"), "original-result");
    assert_eq!(store.task_panel_snapshot().unwrap().tasks[0].task.title, "原任务");
    crate::task_panel_projects::validate_schema(&store.db).unwrap();
}

#[test]
fn given_agent_deleted_todo_when_opened_then_it_stays_hidden_and_cannot_be_completed_or_recreated() {
    let (root, db) = fixture();
    db.execute("UPDATE todos SET deleted=1 WHERE id=?", [TODO]).unwrap();
    db.execute("INSERT INTO todos(id,title,created_at) VALUES(?,'可见待办','2026-10-07')", [VISIBLE_TODO]).unwrap();
    drop(db);
    let mut store = Store::open(&root, false).unwrap();
    assert_eq!(store.todos().unwrap().len(), 1);
    assert_eq!(store.todos().unwrap()[0].id, VISIBLE_TODO);
    assert_eq!(store.complete_todo(TODO, 7, false).unwrap_err().code, "stale_record");
    assert_eq!(store.create_todo(CreateTodo { id: TODO.into(), title: "原待办".into(), due_date: Some("2028-02-29".into()), project_id: None }).unwrap_err().code, "record_deleted");
    assert!(store.complete_todo(VISIBLE_TODO, 1, true).unwrap().completed);
    let deleted: (bool, i64, bool) = store.db.query_row("SELECT deleted,revision,completed FROM todos WHERE id=?", [TODO], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!(deleted, (true, 7, true));
}

#[test]
fn given_unknown_or_partial_shared_schema_when_opened_then_database_bytes_are_unchanged() {
    for damage in [
        "DROP TABLE agent_job_logs;",
        "ALTER TABLE todos DROP COLUMN deleted;",
        "CREATE TABLE tp_requests(id TEXT PRIMARY KEY,input TEXT NOT NULL,result TEXT NOT NULL);",
        "INSERT INTO app_meta VALUES('task_panel_schema','14');",
        "INSERT INTO app_meta VALUES('task_panel_schema','99');",
        "PRAGMA user_version=99;",
        "PRAGMA user_version=15;",
        "PRAGMA user_version=14;",
    ] {
        let (root, db) = fixture();
        db.execute_batch(damage).unwrap();
        drop(db);
        let path = root.join("db/azcine.sqlite3");
        let before = crate::task_panel_paths::hash(&std::fs::read(&path).unwrap());
        assert_eq!(Store::open(&root, false).err().unwrap().code, "incompatible_database", "{damage}");
        assert_eq!(crate::task_panel_paths::hash(&std::fs::read(&path).unwrap()), before, "{damage}");
    }
}

#[test]
fn given_failure_while_stamping_task_schema_when_opened_then_added_tables_roll_back_with_the_marker() {
    let (root, db) = fixture();
    let retained = agent_rows(&db);
    db.execute_batch("CREATE TRIGGER fixture_marker_failure BEFORE INSERT ON app_meta WHEN NEW.key='task_panel_schema' BEGIN SELECT RAISE(ABORT,'explicit fixture'); END;").unwrap();
    drop(db);
    assert!(Store::open(&root, false).is_err());
    let db = Connection::open_with_flags(root.join("db/azcine.sqlite3"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(version(&db), 16);
    assert_eq!(task_tables(&db), 0);
    assert_eq!(agent_rows(&db), retained);
    assert_eq!(db.query_row("SELECT count(*) FROM app_meta WHERE key='task_panel_schema'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}
