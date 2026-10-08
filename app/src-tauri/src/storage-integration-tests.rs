use super::*;

const TODO: &str = "aaaaaaaa-1111-2222-3333-444444444444";
const IDEA: &str = "bbbbbbbb-1111-2222-3333-444444444444";
const IDENTITY: &str = "0123456789abcdef0123456789abcdef";
#[test]fn given_real_v7_scope_database_when_opening_v8_then_existing_scopes_materials_and_identity_are_preserved(){let root=run().join("data");let db=legacy_database(&root,7,true,true,true);crate::news_reader_store::create_schema(&db).unwrap();crate::news_scope::create_schema(&db).unwrap();db.execute("INSERT INTO news_batches VALUES('aabbccdd-1111-2222-3333-000000000001','all','2026-10-05T00:00:00.000Z')",[]).unwrap();db.execute("INSERT INTO news_batch_ranges VALUES('aabbccdd-1111-2222-3333-000000000001','{\"explicit\":true}')",[]).unwrap();db.pragma_update(None,"application_id",APPLICATION_ID).unwrap();drop(db);let s=Store::open(&root,false).unwrap();assert_eq!(s.db.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),SCHEMA_VERSION);assert_eq!(s.db.query_row("SELECT count(*) FROM news_batch_ranges",[],|r|r.get::<_,i64>(0)).unwrap(),1);assert_eq!(s.db.query_row("SELECT title FROM news_materials WHERE id='retained-material'",[],|r|r.get::<_,String>(0)).unwrap(),"原资讯");assert_eq!(s.db.query_row("SELECT value FROM app_meta WHERE key='identity'",[],|r|r.get::<_,String>(0)).unwrap(),IDENTITY);assert_eq!(s.db.query_row("SELECT count(*) FROM news_reset_requests",[],|r|r.get::<_,i64>(0)).unwrap(),0);}

fn run() -> PathBuf {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
    fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new().prefix("integration-migration-").tempdir_in(base).unwrap().keep()
}

// Construct the actual legacy module layouts, not a current database with a
// lowered version marker. All records are explicit retained test fixtures.
pub(crate) fn legacy_database(root: &Path, version: i64, ideas: bool, news: bool, editorial: bool) -> Connection {
    fs::create_dir_all(root.join("db")).unwrap();
    let db = Connection::open(root.join(DATABASE)).unwrap();
    db.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
        INSERT INTO app_meta VALUES('identity','0123456789abcdef0123456789abcdef');
        INSERT INTO app_meta VALUES('ranking-auto:agent:fixture','retained-ranking-snapshot');
        CREATE TABLE todos(id TEXT PRIMARY KEY,title TEXT NOT NULL,due_date TEXT,project_id TEXT,
        completed INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL) STRICT;").unwrap();
    db.execute("INSERT INTO todos VALUES(?1,'原待办','2028-02-29',NULL,1,7,'2026-10-01T00:00:00Z')", [TODO]).unwrap();
    if version >= 2 { crate::projects::create_schema(&db).unwrap(); }
    if ideas {
        crate::ideas::create_schema(&db).unwrap();
        db.execute("INSERT INTO ideas(id,title,body,tags,revision,deleted,todo_id) VALUES(?1,'旧灵感','原文保留','[\"灯光\"]',4,0,?2)", params![IDEA, TODO]).unwrap();
        db.execute("INSERT INTO idea_requests VALUES('retained-request','original-input','original-receipt')", []).unwrap();
    }
    if news {
        crate::news_store::create_schema(&db).unwrap();
        db.execute("UPDATE news_sources SET revision=7", []).unwrap();
        db.execute("INSERT INTO news_materials(id,source_id,source_name,source_revision,title,url,discovered_at,summary,summary_truncated)
            SELECT 'retained-material',id,'测试信源',7,'原资讯','https://example.invalid/fixture','2026-10-01T00:00:00Z','原摘要',0 FROM news_sources ORDER BY id LIMIT 1", []).unwrap();
        db.execute("INSERT INTO news_source_requests VALUES('retained-request','original-input','original-receipt')", []).unwrap();
    }
    if editorial {
        crate::news_editorial_store::create_schema(&db).unwrap();
        db.execute("INSERT INTO news_editions VALUES('retained-edition','2026-10-01',2,'retained-edition-payload')", []).unwrap();
        db.execute("UPDATE news_preferences SET revision=9", []).unwrap();
    }
    db.pragma_update(None, "application_id", APPLICATION_ID).unwrap();
    db.pragma_update(None, "user_version", version).unwrap();
    db
}

fn value(db: &Connection, sql: &str) -> String { db.query_row(sql, [], |r| r.get(0)).unwrap() }
fn version(db: &Connection) -> i64 { db.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap() }
#[test]
fn given_v6_database_when_opening_scope_queue_then_reader_and_materials_are_preserved(){
    let root=run().join("data");let db=legacy_database(&root,6,true,true,true);crate::news_reader_store::create_schema(&db).unwrap();
    db.execute("INSERT INTO news_story_digests VALUES('retained-story','retained-digest')",[]).unwrap();drop(db);
    let s=Store::open(&root,false).unwrap();assert_eq!(version(&s.db),SCHEMA_VERSION);
    assert_eq!(value(&s.db,"SELECT title FROM news_materials WHERE id='retained-material'"),"原资讯");assert_eq!(value(&s.db,"SELECT payload FROM news_story_digests WHERE id='retained-story'"),"retained-digest");
    assert_eq!(s.db.query_row("SELECT COUNT(*) FROM news_pending_dismissals",[],|r|crate::news_store::row_count(r,0)).unwrap(),0);
    assert_eq!(s.db.query_row("SELECT COUNT(*) FROM news_material_batches",[],|r|crate::news_store::row_count(r,0)).unwrap(),0);
}
fn exists(db: &Connection, name: &str) -> bool {
    db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)", [name], |r| r.get(0)).unwrap()
}
fn preserves(root: &Path, old_version: i64, ideas: bool, news: bool, editorial: bool) {
    drop(legacy_database(root, old_version, ideas, news, editorial));
    for _ in 0..2 {
        let store = Store::open(root, false).unwrap();
        assert_eq!(version(&store.db), SCHEMA_VERSION);
        assert_eq!(value(&store.db,"SELECT value FROM app_meta WHERE key='identity'"), IDENTITY);
        assert_eq!(value(&store.db,"SELECT value FROM app_meta WHERE key='ranking-auto:agent:fixture'"), "retained-ranking-snapshot");
        let todos = store.todos().unwrap();
        assert_eq!(todos.len(), 1); assert_eq!(todos[0].id, TODO);
        assert_eq!(todos[0].title,"原待办"); assert_eq!(todos[0].revision,7);
        assert!(todos[0].completed); assert_eq!(todos[0].due_date.as_deref(),Some("2028-02-29"));
        for table in ["projects","ideas","news_materials","news_editions","news_articles","news_bodies","news_step_receipts","news_story_digests","news_reader_editions"] { assert!(exists(&store.db, table)); }
        if ideas {
            let cards = store.ideas().unwrap();
            assert_eq!(cards.len(),1); assert_eq!(cards[0].body,"原文保留");
            assert_eq!(cards[0].revision,4); assert_eq!(cards[0].todo_id.as_deref(),Some(TODO));
            assert_eq!(value(&store.db,"SELECT result FROM idea_requests WHERE id='retained-request'"),"original-receipt");
        }
        if news {
            assert_eq!(value(&store.db,"SELECT summary FROM news_materials WHERE id='retained-material'"),"原摘要");
            assert_eq!(value(&store.db,"SELECT result FROM news_source_requests WHERE id='retained-request'"),"original-receipt");
            assert_eq!(store.db.query_row("SELECT count(*) FROM news_sources WHERE revision=7", [], |r| r.get::<_,i64>(0)).unwrap(),18);
        }
        if editorial {
            assert_eq!(value(&store.db,"SELECT payload FROM news_editions WHERE id='retained-edition'"),"retained-edition-payload");
            assert_eq!(store.db.query_row("SELECT revision FROM news_preferences WHERE id=1", [], |r| r.get::<_,i64>(0)).unwrap(),9);
        }
    }
}

#[test]
fn given_main_v1_or_v2_when_integrated_open_then_all_modules_added_and_original_records_preserved() {
    for v in [1,2] { preserves(&run().join("data"),v,false,false,false); }
}
#[test]
fn given_inspiration_v3_when_integrated_open_then_linked_idea_todo_and_receipt_survive() {
    preserves(&run().join("data"),3,true,false,false);
}
#[test]
fn given_news_capture_v3_when_integrated_open_then_sources_materials_and_receipts_survive() {
    preserves(&run().join("data"),3,false,true,false);
}
#[test]
fn given_news_editorial_v4_when_integrated_open_then_immutable_edition_and_source_edits_survive() {
    preserves(&run().join("data"),4,false,true,true);
}
#[test]
fn given_integrated_v5_when_open_then_reader_tables_added_without_replacing_old_modules() {
    preserves(&run().join("data"),5,true,true,true);
}
#[test]
fn given_partial_or_ambiguous_v3_when_open_then_reject_without_advancing_or_rebuilding() {
    for partial in [false,true] {
        let root=run().join("data");
        let db=legacy_database(&root,3,true,!partial,false);
        if partial { db.execute_batch("DROP TABLE idea_requests").unwrap(); }
        drop(db);
        assert_eq!(Store::open(&root,false).err().unwrap().code,"incompatible_database");
        let db=Connection::open(root.join(DATABASE)).unwrap();
        assert_eq!(version(&db),3); assert_eq!(exists(&db,"idea_requests"),!partial);
        assert!(!exists(&db,"news_preferences"));
        assert_eq!(value(&db,"SELECT body FROM ideas WHERE id='bbbbbbbb-1111-2222-3333-444444444444'"),"原文保留");
    }
}
#[test]
fn given_ddl_failure_mid_migration_when_open_then_every_addition_and_version_change_roll_back() {
    let root=run().join("data");let db=legacy_database(&root,2,false,false,false);
    db.execute_batch("CREATE INDEX ideas_recent ON todos(title)").unwrap();drop(db);
    assert!(Store::open(&root,false).is_err());
    let db=Connection::open(root.join(DATABASE)).unwrap();
    assert_eq!(version(&db),2); assert!(!exists(&db,"ideas")); assert!(!exists(&db,"news_sources"));
    assert!(exists(&db,"ideas_recent")); assert_eq!(value(&db,"SELECT title FROM todos"),"原待办");
}
