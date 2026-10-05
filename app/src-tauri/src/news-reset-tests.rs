use super::*;
use crate::news_reader_types::PipelineConfig;
use serde_json::{json,Value};
fn request(n:u32)->String{format!("aabbccdd-1111-2222-3333-{n:012x}")}
fn store()->Store{let base=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");fs::create_dir_all(&base).unwrap();let root=tempfile::Builder::new().prefix("news-reset-").tempdir_in(base).unwrap().keep().join("data");Store::open(&root,true).unwrap()}
fn seed(s:&mut Store)->String{
    let source=s.news_sources().unwrap().into_iter().find(|s|s.config.usage==crate::news_types::SourceUsage::Editorial).unwrap();
    let work=s.begin_news_batch(&request(1),Some(&source.config.id)).unwrap().unwrap().remove(0);
    let feed=crate::news_feed::parse(b"<rss><channel><item><guid>explicit-reset</guid><title>EXPLICIT reset news</title><link>https://example.org/reset</link><description>explicit synthetic summary</description></item></channel></rss>","https://example.org/feed").unwrap();s.save_news_materials(&work,&feed,&crate::news_store::now()).unwrap();
    let id=s.news_materials(Some(&source.config.id),0).unwrap().items[0].id.clone();
    let mut run=s.start_editorial_run(&request(2),"organize",None).unwrap().0;run.status="failed".into();s.save_editorial_run(&run).unwrap();
    s.db.execute("INSERT INTO news_articles(id,payload) VALUES(?1,'{}')",[&id]).unwrap();s.db.execute("INSERT INTO news_processed(material_id,run_id,decision) VALUES(?1,?2,'{}')",params![id,request(2)]).unwrap();
    let step=s.reader_start_step("explicit-reset-key",&request(2),&id,"structure",&json!({"provider":"explicit","id":"fixture"}),"hash","fixture",&PipelineConfig::default(),false).unwrap();s.reader_finish_step(step,Some("{bad"),&Value::Null,Some("EXPLICIT failure")).unwrap();
    s.create_todo(crate::storage::CreateTodo{id:request(3),title:"Other module must survive".into(),due_date:None,project_id:None}).unwrap();
    for name in ["news","news-editorial","other-module"]{let path=s.root.join("snapshots").join(name);fs::create_dir_all(&path).unwrap();fs::write(path.join("explicit-file.txt"),"retained fixture").unwrap();}id
}
#[test]fn given_saved_news_when_clear_results_then_materials_sources_preferences_and_other_modules_survive(){
    let mut s=store();let id=seed(&mut s);let prefs=encode(&s.news_preferences().unwrap()).unwrap();let sources=encode(&s.news_sources().unwrap()).unwrap();let p=s.news_reset_preview("results").unwrap();assert_eq!((p.materials,p.articles,p.tasks),(1,1,1));
    let result=s.reset_news(&request(4),"results",&p.token).unwrap();assert!(result.warning.is_none());
    for table in RESULTS{assert_eq!(count(&s.db,table).unwrap(),0, "{table}");}
    assert_eq!(count(&s.db,"news_materials").unwrap(),1);assert_eq!(count(&s.db,"news_material_keys").unwrap(),2);assert_eq!(s.scoped_pending_ids(&crate::news_scope::resolve(&s.db,&crate::news_scope::Range::default(),None,String::new(),false).unwrap()).unwrap(),vec![id]);
    assert_eq!(encode(&s.news_preferences().unwrap()).unwrap(),prefs);assert_eq!(encode(&s.news_sources().unwrap()).unwrap(),sources);assert!(s.todos().unwrap().iter().any(|t|t.id==request(3)&&t.title=="Other module must survive"));
    assert!(s.root.join("snapshots/news/explicit-file.txt").exists());assert!(!s.root.join("snapshots/news-editorial").exists());assert!(s.root.join("snapshots/other-module/explicit-file.txt").exists());
}
#[test]fn given_full_clear_when_recollect_same_feed_then_dedupe_is_reset_and_replaying_clear_does_not_delete_new_material(){
    let mut s=store();seed(&mut s);let p=s.news_reset_preview("all").unwrap();s.reset_news(&request(4),"all",&p.token).unwrap();
    for table in tables("all"){assert_eq!(count(&s.db,table).unwrap(),0,"{table}");}assert!(s.todos().unwrap().iter().any(|t|t.id==request(3)));assert_eq!(s.news_sources().unwrap().len(),18);
    assert!(!s.root.join("snapshots/news").exists());assert!(!s.root.join("snapshots/news-editorial").exists());assert!(s.root.join("snapshots/other-module/explicit-file.txt").exists());
    let source=s.news_sources().unwrap().remove(0);let work=s.begin_news_batch(&request(5),Some(&source.config.id)).unwrap().unwrap().remove(0);
    let feed=crate::news_feed::parse(b"<rss><channel><item><guid>explicit-reset</guid><title>EXPLICIT reset news</title><link>https://example.org/reset</link></item></channel></rss>","https://example.org/feed").unwrap();s.save_news_materials(&work,&feed,&crate::news_store::now()).unwrap();assert_eq!(count(&s.db,"news_materials").unwrap(),1);
    assert_eq!(s.reset_news(&request(4),"all",&p.token).unwrap().removed.materials,1);assert_eq!(count(&s.db,"news_materials").unwrap(),1);assert_eq!(s.reset_news(&request(4),"results",&p.token).unwrap_err().code,"request_conflict");
}
#[test]fn given_news_changed_with_same_counts_when_confirm_old_preview_then_nothing_is_deleted(){let mut s=store();seed(&mut s);let p=s.news_reset_preview("all").unwrap();s.db.execute("UPDATE news_articles SET payload='{\"updated\":true}'",[]).unwrap();assert_eq!(s.reset_news(&request(4),"all",&p.token).unwrap_err().code,"news_reset_changed");assert_eq!(count(&s.db,"news_articles").unwrap(),1);assert!(s.root.join("snapshots/news-editorial/explicit-file.txt").exists());}
#[test]fn given_delete_failure_when_clearing_then_transaction_rolls_back_and_staged_files_return_to_original_paths(){let mut s=store();seed(&mut s);let p=s.news_reset_preview("all").unwrap();s.db.execute_batch("CREATE TRIGGER explicit_reset_failure BEFORE DELETE ON news_materials BEGIN SELECT RAISE(ABORT,'explicit failure'); END;").unwrap();assert_eq!(s.reset_news(&request(4),"all",&p.token).unwrap_err().code,"news_reset_failed");assert_eq!(count(&s.db,"news_articles").unwrap(),1);assert_eq!(count(&s.db,"news_materials").unwrap(),1);assert_eq!(count(&s.db,"news_reset_requests").unwrap(),0);assert!(s.root.join("snapshots/news-editorial/explicit-file.txt").exists());assert!(s.root.join("snapshots/news/explicit-file.txt").exists());}
#[test]fn given_interrupted_clear_before_database_commit_when_reopening_then_original_news_files_are_restored(){let mut s=store();seed(&mut s);let root=s.root.clone();let staged=stage_files(&root,&request(4),"all").unwrap();assert_eq!(staged.len(),2);drop(s);let s=Store::open(&root,false).unwrap();assert_eq!(count(&s.db,"news_materials").unwrap(),1);assert!(root.join("snapshots/news/explicit-file.txt").exists());assert!(root.join("snapshots/news-editorial/explicit-file.txt").exists());}
