use super::*;
use serde_json::json;
use std::path::PathBuf;
fn fixture()->PiPaths{let base=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");fs::create_dir_all(&base).unwrap();let root=tempfile::Builder::new().prefix("s03-session-files-").tempdir_in(base).unwrap().keep();PiPaths::prepare(&root).unwrap()}
fn header(paths:&PiPaths)->String{json!({"type":"session","version":3,"id":"native-fixture","cwd":paths.default_cwd,"timestamp":"2026-10-03T00:00:00.000Z"}).to_string()+"\n"}
#[test]
fn given_real_owned_session_files_when_listing_then_valid_and_unreadable_stay_explicit(){
 let p=fixture();let good=p.sessions.join("good.jsonl");fs::write(&good,header(&p)).unwrap();fs::write(p.sessions.join("truncated.jsonl"),header(&p)+"{\"type\":").unwrap();fs::write(p.sessions.join("ignored.txt"),b"not a session").unwrap();
 let list=list_sessions(&p).unwrap();assert_eq!(list.sessions.len(),1);assert_eq!(list.unreadable,1);assert_eq!(list.sessions[0].message_count,0);assert_eq!(validate_session(&p,&good).unwrap().id,"native-fixture");
 // Runtime may return a DOS path rather than canonical extended prefix.
 #[cfg(windows)]{let dos=good.to_string_lossy().trim_start_matches(r"\\?\").to_owned();assert_eq!(validate_session(&p,Path::new(&dos)).unwrap().id,"native-fixture");}
}
#[test]
fn given_deep_subtree_and_foreign_file_when_listing_then_do_not_follow_or_open_beyond_limits(){
 let p=fixture();let deep=p.sessions.join("a/b/c/d/e");fs::create_dir_all(&deep).unwrap();fs::write(deep.join("too-deep.jsonl"),header(&p)).unwrap();let foreign=p.root.join("foreign.jsonl");fs::write(&foreign,header(&p)).unwrap();assert!(validate_session(&p,&foreign).is_err());assert!(validate_session(&p,&deep.join("too-deep.jsonl")).is_err());let l=list_sessions(&p).unwrap();assert_eq!(l.sessions.len(),0);assert_eq!(l.unreadable,1);
}
#[test]
fn given_stored_cwd_with_legacy_pi_resources_when_validating_then_refuse_migration_and_keep_original(){
 let p=fixture();let foreign=p.root.join("foreign-work");fs::create_dir_all(foreign.join(".pi/commands")).unwrap();let marker=foreign.join(".pi/commands/original.md");fs::write(&marker,b"keep").unwrap();let header=json!({"type":"session","version":3,"id":"foreign-cwd-fixture","cwd":foreign,"timestamp":"2026-10-03T00:00:00Z"});let file=p.sessions.join("migration-risk.jsonl");fs::write(&file,header.to_string()).unwrap();assert_eq!(validate_session(&p,&file).unwrap_err().code,"pi_cwd_migration");assert_eq!(fs::read(marker).unwrap(),b"keep");assert!(!foreign.join(".pi/prompts").exists());
}
