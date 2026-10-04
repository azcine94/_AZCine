// S02 retained, synthetic SQLite acceptance. No user roots, network or cleanup.
use super::*;
use crate::storage::CreateTodo;
use std::{fs, path::{Path, PathBuf}};

fn run() -> PathBuf {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
    fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new().prefix("s02-projects-").tempdir_in(base).unwrap().keep()
}
fn id(n: u64) -> String { format!("aabbccdd-1111-2222-3333-{n:012x}") }
fn content() -> ProjectContent {
    ProjectContent {
        id: id(1), name: "公司测试文档".into(),
        labels: vec![StageLabel { id: id(2), name: "ACOPY".into() }, StageLabel { id: id(3), name: "FINAL".into() }],
        blocks: vec![
            ProjectBlock::Text { id: id(4), title: "原始备注".into(), body: "<script>仅文字</script> 其他日期仍保留".into() },
            ProjectBlock::Checklist { id: id(5), title: "核对".into(), items: vec![ChecklistItem { id: id(6), text: "检查素材".into(), checked: false }] },
            ProjectBlock::List { id: id(7), title: "镜头".into(), included: true,
                columns: vec![
                    ListColumn { id: id(8), name: "镜头".into(), kind: ColumnKind::Shot, width: None },
                    ListColumn { id: id(9), name: "当前阶段".into(), kind: ColumnKind::Stage, width: None },
                    ListColumn { id: id(10), name: "当前交期".into(), kind: ColumnKind::Date, width: None },
                    ListColumn { id: id(11), name: "已交完".into(), kind: ColumnKind::Delivered, width: None },
                    ListColumn { id: id(12), name: "备注".into(), kind: ColumnKind::Text, width: None },
                ],
                rows: vec![ListRow { id: id(13), cells: BTreeMap::from([
                    (id(8), "SH-010".into()), (id(9), id(2)), (id(10), "2028-02-29".into()),
                    (id(11), "false".into()), (id(12), "其他来源交期 2029-01-03".into()),
                ]) }],
            },
        ],
    }
}
fn list(doc: &mut ProjectContent) -> (&mut Vec<ListColumn>, &mut Vec<ListRow>) {
    match &mut doc.blocks[2] { ProjectBlock::List { columns, rows, .. } => (columns, rows), _ => panic!("fixture list") }
}
fn save(request: u64, revision: Option<i64>, document: ProjectContent) -> SaveProject {
    SaveProject { request_id: id(request), expected_revision: revision, document }
}
fn snapshot(store: &Store) -> (Vec<ProjectDocument>, i64) {
    (store.projects().unwrap(), store.db.query_row("SELECT count(*) FROM project_requests", [], |r| r.get(0)).unwrap())
}
fn assert_invalid(doc: ProjectContent) { assert_eq!(validate_content(&doc).unwrap_err().code, "invalid_project_content"); }
fn legacy(root: &Path, linked: bool) {
    fs::create_dir_all(root.join("db")).unwrap();
    let db = Connection::open(root.join("db/azcine.sqlite3")).unwrap();
    db.pragma_update(None, "journal_mode", "PERSIST").unwrap();
    db.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        INSERT INTO app_meta VALUES('identity','0123456789abcdef0123456789abcdef');
        CREATE TABLE todos(id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500), due_date TEXT,
        project_id TEXT, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;").unwrap();
    db.execute("INSERT INTO todos(id,title,due_date,project_id,completed,revision,created_at) VALUES (?1,'原待办','2028-02-29',?2,1,7,'2026-10-01T00:00:00Z')", params![id(50), if linked { Some(id(1)) } else { None }]).unwrap();
    db.pragma_update(None, "application_id", 0x415A4349_i64).unwrap();
    db.pragma_update(None, "user_version", 1).unwrap();
}
fn schema_version(db: &Connection) -> i64 { db.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap() }
fn table_exists(db: &Connection, name: &str) -> bool {
    db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)", [name], |r| r.get(0)).unwrap()
}

#[test]
fn given_one_shot_when_stage_date_and_delivered_change_then_independent_fields_and_reopen_persist() {
    let out = run(); let root = out.join("data"); let mut store = Store::open(&root, true).unwrap();
    let first = store.save_project(save(100, None, content())).unwrap();
    let mut changed = first.content.clone(); list(&mut changed).1[0].cells.insert(id(9), id(3));
    let second = store.save_project(save(101, Some(1), changed.clone())).unwrap();
    assert_eq!(list(&mut changed).1.len(), 1); assert_eq!(list(&mut changed).1[0].id, id(13));
    assert_eq!(list(&mut changed).1[0].cells[&id(10)], "2028-02-29"); assert_eq!(list(&mut changed).1[0].cells[&id(11)], "false");
    list(&mut changed).1[0].cells.insert(id(10), "2029-01-03".into());
    list(&mut changed).1[0].cells.insert(id(11), "true".into());
    let third = store.save_project(save(102, Some(2), changed.clone())).unwrap();
    assert_eq!(list(&mut changed).1[0].cells[&id(9)], id(3));
    assert_eq!(first.created_at, second.created_at); assert_eq!(second.created_at, third.created_at);
    list(&mut changed).1[0].cells.insert(id(11), "false".into());
    let fourth = store.save_project(save(103, Some(3), changed)).unwrap();
    drop(store); let reopened = Store::open(&root, false).unwrap();
    assert_eq!(reopened.projects().unwrap(), vec![fourth.clone()]);
    assert_eq!(reopened.project(&id(1)).unwrap(), Some(fourth));
    assert_eq!(reopened.project_request(&id(100)).unwrap(), Some(first));
}

#[test]
fn given_saved_request_when_retried_after_new_revision_then_original_receipt_is_durable_not_latest() {
    let out = run(); let root = out.join("data"); let mut store = Store::open(&root, true).unwrap();
    let input = save(100, None, content()); let original = store.save_project(input.clone()).unwrap();
    assert_eq!(store.save_project(input.clone()).unwrap(), original);
    let mut next = original.content.clone(); next.name = "后续修改".into();
    let latest = store.save_project(save(101, Some(1), next)).unwrap();
    drop(store); let mut store = Store::open(&root, false).unwrap();
    assert_eq!(store.save_project(input).unwrap(), original);
    assert_eq!(store.project_request(&id(100)).unwrap(), Some(original));
    assert_eq!(store.project(&id(1)).unwrap(), Some(latest)); assert_eq!(snapshot(&store).1, 2);
    assert!(store.project_request(&id(999)).unwrap().is_none());
}

#[test]
fn given_duplicate_payload_conflict_or_stale_baseline_when_save_then_nothing_is_overwritten() {
    let out = run(); let mut store = Store::open(&out.join("data"), true).unwrap();
    let input = save(100, None, content()); store.save_project(input.clone()).unwrap(); let before = snapshot(&store);
    let mut conflict = input; conflict.document.name = "冲突名称".into();
    assert_eq!(store.save_project(conflict).unwrap_err().code, "request_conflict");
    for revision in [None, Some(2)] {
        assert_eq!(store.save_project(save(101, revision, content())).unwrap_err().code, "stale_record");
    }
    let mut missing = content(); missing.id = id(99);
    assert_eq!(store.save_project(save(102, Some(1), missing)).unwrap_err().code, "stale_record");
    for revision in [0, -1, MAX_REVISION, MAX_REVISION + 1] {
        assert_eq!(store.save_project(save(103, Some(revision), content())).unwrap_err().code, "invalid_project_content");
    }
    let mut bad = save(104, Some(1), content()); bad.request_id = "bad-request".into();
    assert_eq!(store.save_project(bad).unwrap_err().code, "invalid_id"); assert_eq!(snapshot(&store), before);
}

#[test]
fn given_project_a_and_b_when_renaming_labels_or_referencing_foreign_label_then_isolated_or_rejected() {
    let out = run(); let mut store = Store::open(&out.join("data"), true).unwrap();
    let a = store.save_project(save(100, None, content())).unwrap();
    let mut b = ProjectContent { id: id(20), name: "公司B".into(), labels: vec![StageLabel { id: id(21), name: "B阶段".into() }], blocks: vec![] };
    let saved_b = store.save_project(save(101, None, b.clone())).unwrap();
    let mut edited_a = a.content.clone(); edited_a.labels[0].name = "客户预览".into();
    store.save_project(save(102, Some(1), edited_a.clone())).unwrap();
    assert_eq!(store.project(&b.id).unwrap(), Some(saved_b));
    list(&mut edited_a).1[0].cells.insert(id(9), id(21));
    assert_eq!(store.save_project(save(103, Some(2), edited_a)).unwrap_err().code, "invalid_project_content");
    b.labels[0].name = "FINAL".into(); assert!(store.save_project(save(104, Some(1), b)).is_ok());
    let mut referenced = a.content; referenced.labels.remove(0); assert_invalid(referenced);
}

#[test]
fn given_malformed_entities_or_cells_when_validate_then_no_guessing_or_dropped_values() {
    let mut d = content(); d.id = "not-uuid".into(); assert_invalid(d);
    let mut d = content(); d.labels[0].id = d.id.to_uppercase(); assert_invalid(d);
    let mut d = content(); d.labels[1].name = " ACOPY ".into(); assert_invalid(d);
    let mut d = content(); d.labels[0].name = " ".into(); assert_invalid(d);
    for date in ["10-14", "2026-02-29", "2028-02-", "0000-01-01", "2028-13-01"] {
        let mut d = content(); list(&mut d).1[0].cells.insert(id(10), date.into()); assert_invalid(d);
    }
    let mut d = content(); list(&mut d).1[0].cells.insert(id(11), "yes".into()); assert_invalid(d);
    let mut d = content(); list(&mut d).1[0].cells.insert(id(90), "unknown column retained in rejected input".into()); assert_invalid(d);
    let mut d = content(); list(&mut d).0.push(ListColumn { id: id(90), name: "另一日期".into(), kind: ColumnKind::Date, width: None }); assert_invalid(d);
    let mut d = content(); list(&mut d).1[0].cells.clear(); assert!(validate_content(&d).is_ok());
    list(&mut d).0.clear(); assert!(validate_content(&d).is_ok()); // Missing semantic columns remain missing, not inferred.
}

#[test]
fn given_unicode_lengths_and_field_limits_when_validate_then_exact_boundaries_are_enforced() {
    let mut d = content(); d.name = "🎬".repeat(200); d.labels[0].name = "阶".repeat(80);
    list(&mut d).1[0].cells.insert(id(8), "镜".repeat(200)); list(&mut d).1[0].cells.insert(id(12), "注".repeat(10_000));
    if let ProjectBlock::Text { body, .. } = &mut d.blocks[0] { *body = "文".repeat(100_000); }
    if let ProjectBlock::Checklist { items, .. } = &mut d.blocks[1] { items[0].text = "项".repeat(10_000); }
    assert!(validate_content(&d).is_ok());
    let mut bad = d.clone(); bad.name.push('字'); assert_invalid(bad);
    let mut bad = d.clone(); bad.labels[0].name.push('字'); assert_invalid(bad);
    let mut bad = d.clone(); list(&mut bad).1[0].cells.get_mut(&id(8)).unwrap().push('字'); assert_invalid(bad);
    let mut bad = d.clone(); list(&mut bad).1[0].cells.get_mut(&id(12)).unwrap().push('字'); assert_invalid(bad);
    let mut bad = d.clone(); if let ProjectBlock::Text { body, .. } = &mut bad.blocks[0] { body.push('字'); } assert_invalid(bad);
    if let ProjectBlock::Checklist { items, .. } = &mut d.blocks[1] { items[0].text.push('字'); } assert_invalid(d);
}

#[test]
fn given_collection_and_encoded_size_limits_when_validate_then_complete_document_or_explicit_rejection() {
    let mut d = content(); list(&mut d).1.clear();
    list(&mut d).1.extend((1000..11000).map(|n| ListRow { id: id(n), cells: BTreeMap::new() }));
    assert!(validate_content(&d).is_ok()); list(&mut d).1.push(ListRow { id: id(12000), cells: BTreeMap::new() }); assert_invalid(d);
    let mut d = content(); list(&mut d).0.extend((100..159).map(|n| ListColumn { id: id(n), name: "普通列".into(), kind: ColumnKind::Text, width: None }));
    assert!(validate_content(&d).is_ok()); list(&mut d).0.push(ListColumn { id: id(159), name: "越界列".into(), kind: ColumnKind::Text, width: None }); assert_invalid(d);
    let mut d = content(); d.labels.extend((100..198).map(|n| StageLabel { id: id(n), name: format!("阶段{n}") }));
    assert!(validate_content(&d).is_ok()); d.labels.push(StageLabel { id: id(198), name: "越界标签".into() }); assert_invalid(d);
    let mut d = ProjectContent { id: id(1), name: "两个清单分别计数".into(), labels: vec![], blocks: (0..2).map(|b| ProjectBlock::Checklist {
        id: id(100 + b), title: "清单".into(), items: (0..10_000).map(|n| ChecklistItem { id: id(1000 + b * 10000 + n), text: String::new(), checked: false }).collect(),
    }).collect() };
    assert!(validate_content(&d).is_ok());
    if let ProjectBlock::Checklist { items, .. } = &mut d.blocks[0] { items.push(ChecklistItem { id: id(30000), text: String::new(), checked: false }); } assert_invalid(d);
    let mut d = ProjectContent { id: id(1), name: "字节上限".into(), labels: vec![], blocks: (0..160).map(|n| ProjectBlock::Text { id: id(1000 + n), title: "block".into(), body: "a".repeat(100_000) }).collect() };
    assert!(validate_content(&d).is_ok());
    d.blocks.extend((160..170).map(|n| ProjectBlock::Text { id: id(1000 + n), title: "block".into(), body: "a".repeat(100_000) }));
    assert!(serde_json::to_vec(&d).unwrap().len() > MAX_BYTES); assert_invalid(d);
    let mut d = content(); d.blocks = (0..200).map(|n| ProjectBlock::Text { id: id(1000+n), title: "block".into(), body: String::new() }).collect();
    assert!(validate_content(&d).is_ok()); d.blocks.push(ProjectBlock::Text { id: id(1200), title: "overflow".into(), body: String::new() }); assert_invalid(d);
}

#[test]
fn given_unknown_json_fields_when_decode_then_strict_domain_contract_rejects_them() {
    let source = serde_json::to_value(save(100, None, content())).unwrap();
    for pointer in ["", "/document", "/document/labels/0", "/document/blocks/0", "/document/blocks/1/items/0", "/document/blocks/2/columns/0", "/document/blocks/2/rows/0"] {
        let mut value = source.clone(); value.pointer_mut(pointer).unwrap().as_object_mut().unwrap().insert("unexpected".into(), true.into());
        assert!(serde_json::from_value::<SaveProject>(value).is_err(), "unknown at {pointer}");
    }
    assert!(serde_json::from_value::<SaveProject>(source).is_ok());
}

#[test]
fn given_receipt_insert_failure_when_create_or_update_then_entire_transaction_rolls_back() {
    let out = run(); let mut store = Store::open(&out.join("data"), true).unwrap();
    store.save_project(save(100, None, content())).unwrap(); let before = snapshot(&store);
    store.db.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON project_requests BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END;").unwrap();
    let mut changed = content(); changed.name = "不得部分保存".into();
    assert_eq!(store.save_project(save(101, Some(1), changed)).unwrap_err().code, "storage_database");
    let mut fresh = content(); fresh.id = id(90);
    assert_eq!(store.save_project(save(102, None, fresh)).unwrap_err().code, "storage_database");
    assert_eq!(snapshot(&store), before); assert!(store.project_request(&id(101)).unwrap().is_none());
}

#[test]
fn given_sqlite_readonly_or_full_when_save_then_no_false_success_or_partial_receipt() {
    let out = run(); let mut store = Store::open(&out.join("readonly"), true).unwrap();
    store.save_project(save(100, None, content())).unwrap(); let before = snapshot(&store);
    store.db.pragma_update(None, "query_only", true).unwrap();
    assert_eq!(store.save_project(save(101, Some(1), content())).unwrap_err().code, "storage_database"); assert_eq!(snapshot(&store), before);
    let mut store = Store::open(&out.join("full"), true).unwrap(); store.save_project(save(100, None, content())).unwrap(); let before = snapshot(&store);
    let count: i64 = store.db.pragma_query_value(None, "page_count", |r| r.get(0)).unwrap(); store.db.pragma_update(None, "max_page_count", count).unwrap();
    let mut changed = content(); if let ProjectBlock::Text { body, .. } = &mut changed.blocks[0] { *body = "a".repeat(100_000); }
    assert_eq!(store.save_project(save(101, Some(1), changed)).unwrap_err().code, "storage_database"); assert_eq!(snapshot(&store), before);
}

#[test]
fn given_valid_v1_when_open_then_current_migration_preserves_identity_and_all_todo_fields() {
    let out = run(); let root = out.join("legacy"); legacy(&root, false);
    let mut store = Store::open(&root, false).unwrap();
    assert_eq!(schema_version(&store.db), 3); assert!(table_exists(&store.db, "projects")); assert!(table_exists(&store.db, "project_requests")); assert!(table_exists(&store.db, "ideas"));
    let identity: String = store.db.query_row("SELECT value FROM app_meta WHERE key='identity'", [], |r| r.get(0)).unwrap(); assert_eq!(identity, "0123456789abcdef0123456789abcdef");
    let todos = store.todos().unwrap(); assert_eq!(todos.len(), 1); let t = &todos[0];
    assert_eq!(t.id, id(50)); assert_eq!(t.title, "原待办"); assert_eq!(t.due_date.as_deref(), Some("2028-02-29"));
    assert!(t.project_id.is_none()); assert!(t.completed); assert_eq!(t.revision, 7); assert_eq!(t.created_at, "2026-10-01T00:00:00Z");
    let saved = store.save_project(save(100, None, content())).unwrap(); drop(store);
    let store = Store::open(&root, false).unwrap(); assert_eq!(store.projects().unwrap(), vec![saved]);
    assert_eq!(serde_json::to_value(store.todos().unwrap()).unwrap(), serde_json::to_value(todos).unwrap());
}

#[test]
fn given_v1_with_unknown_company_link_or_ddl_conflict_when_open_then_migration_rolls_back() {
    let out = run(); let linked = out.join("linked"); legacy(&linked, true);
    assert_eq!(Store::open(&linked, false).err().unwrap().code, "incompatible_database");
    let db = Connection::open(linked.join("db/azcine.sqlite3")).unwrap(); assert_eq!(schema_version(&db), 1); assert!(!table_exists(&db, "projects"));
    let link: String = db.query_row("SELECT project_id FROM todos", [], |r| r.get(0)).unwrap(); assert_eq!(link, id(1));
    let conflict = out.join("conflict"); legacy(&conflict, false);
    { let db = Connection::open(conflict.join("db/azcine.sqlite3")).unwrap(); db.execute_batch("CREATE TABLE project_requests(original TEXT); INSERT INTO project_requests VALUES('retained');").unwrap(); }
    assert_eq!(Store::open(&conflict, false).err().unwrap().code, "storage_database");
    let db = Connection::open(conflict.join("db/azcine.sqlite3")).unwrap(); assert_eq!(schema_version(&db), 1); assert!(!table_exists(&db, "projects"));
    assert_eq!(db.query_row("SELECT original FROM project_requests", [], |r| r.get::<_, String>(0)).unwrap(), "retained");
    assert_eq!(db.query_row("SELECT revision FROM todos", [], |r| r.get::<_, i64>(0)).unwrap(), 7);
}

#[test]
fn given_company_link_when_create_complete_restore_and_reopen_then_valid_reference_is_kept() {
    let out = run(); let root = out.join("data"); let mut store = Store::open(&root, true).unwrap();
    store.save_project(save(100, None, content())).unwrap();
    let input = |project| CreateTodo { id: id(50), title: "公司关联任务".into(), due_date: None, project_id: Some(project) };
    assert_eq!(store.create_todo(input(id(99))).unwrap_err().code, "invalid_project");
    let todo = store.create_todo(input(id(1))).unwrap(); let done = store.complete_todo(&todo.id, todo.revision, true).unwrap();
    let restored = store.complete_todo(&done.id, done.revision, false).unwrap(); assert_eq!(restored.project_id, Some(id(1)));
    assert!(store.db.execute("INSERT INTO todos(id,title,project_id) VALUES (?1,'bad direct insert',?2)", params![id(51), id(99)]).is_err());
    assert!(store.db.execute("UPDATE todos SET project_id=?1 WHERE id=?2", params![id(99), id(50)]).is_err());
    drop(store); let store = Store::open(&root, false).unwrap(); let todos = store.todos().unwrap();
    assert_eq!(todos.len(), 1); assert_eq!(todos[0].project_id, Some(id(1))); assert!(!todos[0].completed);
}

#[test]
fn given_legacy_columns_and_resized_reordered_list_when_save_reopen_then_ids_cells_and_width_persist() {
    let out = run(); let root = out.join("data"); let mut store = Store::open(&root, true).unwrap();
    let legacy = content();
    let json = serde_json::to_string(&legacy).unwrap(); assert!(!json.contains("\"width\""));
    assert_eq!(serde_json::from_str::<ProjectContent>(&json).unwrap(), legacy);
    let first = store.save_project(save(200, None, legacy)).unwrap();
    let mut next = first.content.clone();
    let (columns, rows) = list(&mut next);
    columns[0].width = Some(320); columns.swap(0, 2);
    rows.push(ListRow { id: id(90), cells: BTreeMap::from([(id(8), "SH-020".into())]) }); rows.swap(0, 1);
    let second = store.save_project(save(201, Some(first.revision), next.clone())).unwrap();
    assert_eq!(second.content, next);
    for width in [111, 641] { let mut invalid_doc = next.clone(); list(&mut invalid_doc).0[0].width = Some(width); assert_invalid(invalid_doc); }
    for width in [112, 640] { let mut valid_doc = next.clone(); list(&mut valid_doc).0[0].width = Some(width); assert!(validate_content(&valid_doc).is_ok()); }
    drop(store); let reopened = Store::open(&root, false).unwrap();
    assert_eq!(reopened.project(&id(1)).unwrap().unwrap(), second);
    assert_eq!(reopened.project_request(&id(201)).unwrap().unwrap(), second);
}

#[test]
fn given_corrupt_project_or_receipt_when_read_then_error_instead_of_empty_document() {
    let out = run(); let mut store = Store::open(&out.join("data"), true).unwrap(); store.save_project(save(100, None, content())).unwrap();
    store.db.execute("UPDATE projects SET name='mismatched' WHERE id=?1", [id(1)]).unwrap();
    assert_eq!(store.projects().unwrap_err().code, "project_data_invalid");
    store.db.execute("UPDATE project_requests SET result='{}' WHERE id=?1", [id(100)]).unwrap();
    assert_eq!(store.project_request(&id(100)).unwrap_err().code, "project_data_invalid");
    assert_eq!(store.project_request("bad-id").unwrap_err().code, "invalid_id");
}
