use super::*;
use std::path::PathBuf;
fn run() -> PathBuf {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
    std::fs::create_dir_all(&base).unwrap();
    tempfile::Builder::new().prefix("ideas-storage-").tempdir_in(base).unwrap().keep()
}
fn input() -> SaveIdea { SaveIdea { request_id:"11111111-1111-1111-1111-111111111111".into(), expected_revision:None,
    content:IdeaContent { id:"22222222-2222-2222-2222-222222222222".into(), title:"雨夜港口".into(), body:"先看见反光，再显出船体轮廓。".into(), tags:vec!["画面".into(),"灯光".into()], project_id:None } } }
#[test]
fn given_legal_idea_when_save_edit_delete_undo_reopen_then_content_links_and_version_persist() {
    let root=run().join("data"); let mut store=Store::open(&root,true).unwrap();
    let a=store.save_idea(input()).unwrap();
    let mut update=input();update.request_id="33333333-3333-3333-3333-333333333333".into();update.expected_revision=Some(a.revision);update.content.title="".into();update.content.body="修改后的原文\n保留换行".into();
    let b=store.save_idea(update.clone()).unwrap(); assert_eq!(b.revision,2);
    assert_eq!(store.save_idea(update).unwrap(),b);
    let c=store.set_idea_deleted(&b.id,b.revision,true).unwrap(); assert!(c.deleted);
    assert_eq!(store.set_idea_deleted(&b.id,b.revision,true).unwrap(),c);
    drop(store); let mut store=Store::open(&root,false).unwrap(); assert_eq!(store.ideas().unwrap(),vec![c.clone()]);
    let d=store.set_idea_deleted(&c.id,c.revision,false).unwrap(); drop(store);
    let reopened=Store::open(&root,false).unwrap();assert_eq!(reopened.ideas().unwrap(),vec![d]);
}
#[test]
fn given_invalid_content_tags_company_or_stale_revision_when_save_then_no_overwrite() {
    let mut store=Store::open(&run().join("data"),true).unwrap();
    let mut bad=input();bad.content.body="  ".into();assert_eq!(store.save_idea(bad).unwrap_err().code,"invalid_idea");
    let mut bad=input();bad.content.tags=vec!["a".into(),"A".into()];assert!(store.save_idea(bad).is_err());
    let mut bad=input();bad.content.project_id=Some("99999999-9999-9999-9999-999999999999".into());assert!(store.save_idea(bad).is_err());
    let a=store.save_idea(input()).unwrap();
    let mut stale=input();stale.request_id="33333333-3333-3333-3333-333333333333".into();stale.expected_revision=Some(9);stale.content.body="不能覆盖".into();assert_eq!(store.save_idea(stale).unwrap_err().code,"stale_idea");
    let mut conflicting=input();conflicting.content.body="编号复用".into();assert_eq!(store.save_idea(conflicting).unwrap_err().code,"request_conflict");
    assert_eq!(store.ideas().unwrap(),vec![a]);
}
#[test]
fn given_idea_when_convert_twice_and_reopen_then_one_undated_todo_and_both_links_preserved() {
    let root=run().join("data");let mut store=Store::open(&root,true).unwrap();
    let a=store.save_idea(input()).unwrap();let b=store.convert_idea(&a.id,a.revision).unwrap();
    assert_eq!(store.convert_idea(&a.id,a.revision).unwrap(),b);
    let todos=store.todos().unwrap();assert_eq!(todos.len(),1);assert_eq!(todos[0].due_date,None);assert_eq!(todos[0].id,b.todo_id.clone().unwrap());
    drop(store);let mut store=Store::open(&root,false).unwrap();assert_eq!(store.convert_idea(&a.id,a.revision).unwrap(),b);assert_eq!(store.todos().unwrap().len(),1);
    let deleted=store.set_idea_deleted(&b.id,b.revision,true).unwrap();assert!(store.convert_idea(&deleted.id,deleted.revision).is_err());assert_eq!(store.todos().unwrap().len(),1);
}
#[test]
fn given_readonly_database_or_conversion_trigger_failure_when_write_then_no_partial_success() {
    let mut store=Store::open(&run().join("data"),true).unwrap();let a=store.save_idea(input()).unwrap();
    store.db.execute_batch("CREATE TRIGGER reject_idea_conversion BEFORE UPDATE OF todo_id ON ideas BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    assert!(store.convert_idea(&a.id,a.revision).is_err());assert!(store.todos().unwrap().is_empty());assert_eq!(store.ideas().unwrap()[0],a);
    store.db.pragma_update(None,"query_only",true).unwrap();assert!(store.set_idea_deleted(&a.id,a.revision,true).is_err());assert_eq!(store.ideas().unwrap()[0],a);
}
#[test]
fn given_existing_v2_database_when_open_then_migrate_without_replacing_todos_or_identity() {
    let root=run().join("data");let store=Store::open(&root,true).unwrap();
    store.db.execute_batch("DROP TABLE idea_requests; DROP TABLE ideas; PRAGMA user_version=2;").unwrap();drop(store);
    let mut store=Store::open(&root,false).unwrap();let a=store.save_idea(input()).unwrap();assert_eq!(store.ideas().unwrap(),vec![a]);
    let version:i64=store.db.pragma_query_value(None,"user_version",|r|r.get(0)).unwrap();assert_eq!(version,3);
}
#[test]
fn given_saved_request_when_record_changes_then_receipt_remains_original_and_latest_record_is_not_replaced() {
    let root=run().join("data");let mut store=Store::open(&root,true).unwrap();
    let first=input();let saved=store.save_idea(first.clone()).unwrap();
    let mut next=first.clone();next.request_id="33333333-3333-3333-3333-333333333333".into();next.expected_revision=Some(saved.revision);next.content.body="较新的正式内容".into();
    let latest=store.save_idea(next).unwrap();
    assert_eq!(store.idea_request(&first.request_id).unwrap(),Some(saved.clone()));
    assert_eq!(store.save_idea(first.clone()).unwrap(),saved);
    assert_eq!(store.ideas().unwrap(),vec![latest]);
    assert!(store.idea_request("44444444-4444-4444-4444-444444444444").unwrap().is_none());
}
