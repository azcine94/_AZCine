use super::*;

fn roots() -> (PathBuf, PathBuf, PathBuf) {
    let base = tempfile::Builder::new().prefix("azcine-task-workspace-").tempdir().unwrap().keep();
    let a = base.join("repository-a");
    let b = base.join("repository-b");
    fs::create_dir(&a).unwrap();
    fs::create_dir(&b).unwrap();
    (base, a, b)
}

#[test]
fn repositories_keep_separate_state_and_preserve_it_when_reopened() {
    let (_, a, b) = roots();
    let first = open_store(&a).unwrap();
    first.save_task_setting("example-decision", "confirmed-a").unwrap();
    let second = open_store(&b).unwrap();
    assert_eq!(second.task_setting("example-decision").unwrap(), None);
    assert!(a.join(".azcine/task-panel/state.sqlite3").is_file());
    assert!(b.join(".azcine/task-panel/state.sqlite3").is_file());
    assert!(open_store(&a).is_err());
    drop(first);
    let reopened = open_store(&a).unwrap();
    assert_eq!(reopened.task_setting("example-decision").unwrap().as_deref(), Some("confirmed-a"));
    assert!(reopened.db.prepare("SELECT * FROM todos").is_err());
}

#[test]
fn handoff_changes_do_not_invalidate_a_source_snapshot() {
    let (_, root, _) = roots();
    fs::write(root.join("source.rs"), "fn main() {}\n").unwrap();
    let store = open_store(&root).unwrap();
    let repository = crate::task_panel_types::Repository {
        id: "repository".into(), label: "isolated".into(), path: root.to_string_lossy().into_owned(),
        scope: vec![".".into()], revision: 1, created_at: crate::task_panel_store::now(),
    };
    let before = crate::task_panel_snapshots::sample(&repository, &repository.scope).unwrap();
    store.save_task_setting("example-decision", "updated").unwrap();
    let output = directory(&store.root, "task-panel/tasks/task-a/runs/run-a/output").unwrap();
    preserve(&output.join("result.json"), b"{\"fixture\":true}").unwrap();
    let after = crate::task_panel_snapshots::sample(&repository, &repository.scope).unwrap();
    assert_eq!(before.fingerprint, after.fingerprint);
    assert_eq!(after.files.len(), 1);
    fs::write(root.join("source.rs"), "fn changed() {}\n").unwrap();
    assert_ne!(after.fingerprint, crate::task_panel_snapshots::sample(&repository, &repository.scope).unwrap().fingerprint);
}

#[test]
fn incompatible_task_database_and_existing_artifact_are_preserved() {
    let (_, root, _) = roots();
    let store = open_store(&root).unwrap();
    store.db.pragma_update(None, "user_version", 999).unwrap();
    drop(store);
    let path = root.join(".azcine/task-panel/state.sqlite3");
    let original = fs::read(&path).unwrap();
    assert!(open_store(&root).is_err());
    assert_eq!(fs::read(path).unwrap(), original);
    let output = root.join("fixture.txt");
    preserve(&output, b"old").unwrap();
    assert!(preserve(&output, b"replacement").is_err());
    assert_eq!(fs::read(output).unwrap(), b"old");
    assert!(directory(&root, "../elsewhere").is_err());
}

#[test]
fn legacy_import_keeps_the_source_database_and_does_not_repeat() {
    use crate::task_panel_types::{Mutation, MutationInput};
    let (base, root, _) = roots();
    let old_root = base.join("old-data");
    let mut old = Store::open(&old_root, true).unwrap();
    old.task_panel_mutate(MutationInput {
        request_id: "old-repository".into(), expected_revision: None,
        action: Mutation::Repository { id: "repository-a".into(), label: "A".into(),
            path: root.to_string_lossy().into_owned(), scope: vec![".".into()], project_id: None },
    }).unwrap();
    old.task_panel_mutate(MutationInput {
        request_id: "old-task".into(), expected_revision: None,
        action: Mutation::SaveTask { id: "task-a".into(), title: "Preserve this task".into(),
            goal: "Keep the original record".into(), scope: vec![".".into()], criteria: vec!["Record preserved".into()],
            repository_id: Some("repository-a".into()), source: "isolated fixture".into(), plan: None },
    }).unwrap();
    let identity: String = old.db.query_row("SELECT value FROM app_meta WHERE key='identity'", [], |r| r.get(0)).unwrap();
    drop(old);
    let original = fs::read(old_root.join("db/azcine.sqlite3")).unwrap();
    let config = base.join("config");
    fs::create_dir(&config).unwrap();
    fs::write(config.join("data-root.json"), serde_json::json!({"version":1,"root":old_root,"identity":identity}).to_string()).unwrap();
    let mut local = open_store(&root).unwrap();
    assert!(!crate::task_panel_legacy::import(&mut local, &config).unwrap().is_empty());
    assert_eq!(crate::task_panel_store::task(&local.db, "task-a").unwrap().title, "Preserve this task");
    assert!(crate::task_panel_legacy::import(&mut local, &config).unwrap().is_empty());
    assert_eq!(fs::read(old_root.join("db/azcine.sqlite3")).unwrap(), original);
}
