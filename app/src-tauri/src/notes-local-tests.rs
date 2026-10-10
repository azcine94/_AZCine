use super::*;
#[test]
#[cfg(windows)]
fn explorer_path_preserves_unicode_spaces_and_commas(){
 assert_eq!(explorer_selection(Path::new(r"\\?\C:\Notes folder\中文, 一.md")),r#"/select,"C:\Notes folder\中文, 一.md""#);
 assert_eq!(explorer_selection(Path::new(r"\\?\UNC\server\notes\中文 一.md")),r#"/select,"\\server\notes\中文 一.md""#);
}

#[test]
#[ignore = "Explicit isolated Windows Explorer UI check only"]
#[cfg(windows)]
fn reveal_fixture_in_explorer(){
 let evidence=PathBuf::from(std::env::var_os("AZCINE_NOTES_TEST_ROOT").expect("Isolated evidence root required"));
 let f=Fixture::new("reveal");f.call("mkdir",json!({"path":"显示位置 folder"})).unwrap();f.create("显示位置 folder/中文 笔记,一.md","# Isolated reveal check");
 fs::write(evidence.join("reveal-target.txt"),format!("{}\\显示位置 folder\\中文 笔记,一.md",f.library)).unwrap();
 f.call("reveal",json!({"path":"显示位置 folder"})).unwrap();
 f.call("reveal",json!({"path":"显示位置 folder/中文 笔记,一.md"})).unwrap();
}
struct Fixture { store:Store, root:String, library:String }
impl Fixture {
 fn new(name:&str)->Self {
  let base=std::env::var_os("AZCINE_NOTES_TEST_ROOT").map(PathBuf::from).unwrap_or_else(||std::env::temp_dir().join("azcine-notes-tests")).join(format!("{}-{}",name,now()));
  fs::create_dir_all(&base).unwrap();let vault=base.join("vault");fs::create_dir(&vault).unwrap();
  let store=Store::open(&base.join("data"),true).unwrap();let root=store.root.to_string_lossy().into_owned();let library=store.notes_select(&root,&display(&vault)).unwrap().library.unwrap();Self{store,root,library}
 }
 fn call(&self,operation:&str,args:Value)->Result<Value,StorageError>{self.store.notes_local(LocalRequest{root:self.root.clone(),library:self.library.clone(),operation:operation.into(),args})}
 fn create(&self,path:&str,body:&str){self.call("create",json!({"path":path,"body":body})).unwrap();}
 fn doc(&self,path:&str)->Document{self.store.notes_read(&self.root,&self.library,path).unwrap()}
 fn mutate(&self,operation:&str,path:&str,target:&str)->Value{let version=self.call("inspect",json!({"path":path})).unwrap()["version"].clone();self.call(operation,json!({"path":path,"target":target,"version":version})).unwrap()}
 fn save(&self,doc:Document,body:&str)->Result<Document,StorageError>{self.store.notes_save(Save{root:self.root.clone(),library:self.library.clone(),path:doc.path,version:doc.version,body:body.into()})}
}
#[test] fn files_move_copy_trash_restore_without_overwrite(){
 let f=Fixture::new("files");f.call("mkdir",json!({"path":"Folder/Sub"})).unwrap();f.create("Folder/Sub/笔记.md","# Original");f.create("view.base","views: []");
 assert_eq!(f.call("create",json!({"path":"Folder/Sub/笔记.md","body":"lost"})).unwrap_err().code,"notes_exists");
 f.mutate("copy","Folder/Sub/笔记.md","Folder/copy.md");f.mutate("rename","Folder/Sub","Folder/Renamed");assert_eq!(f.doc("Folder/Renamed/笔记.md").body,"# Original");
 let receipt=f.mutate("trash","Folder/Renamed","");assert!(!f.call("exists",json!({"path":"Folder/Renamed"})).unwrap().as_bool().unwrap());
 assert_eq!(f.call("trash-list",json!({})).unwrap().as_array().unwrap().len(),1);
 f.call("trash-restore",json!({"id":receipt["id"],"target":"Restored"})).unwrap();assert_eq!(f.doc("Restored/笔记.md").body,"# Original");
 let index=f.store.notes_index(&f.root).unwrap();assert!(index.files.iter().any(|e|e.kind=="base"));assert!(index.files.iter().any(|e|e.path=="Folder/copy.md"));
}
#[test] fn save_conflict_history_rename_and_encoding(){
 let f=Fixture::new("save");fs::write(Path::new(&f.library).join("note.md"),"\u{feff}# Old\r\n").unwrap();let first=f.doc("note.md");let stale=f.doc("note.md");let saved=f.save(first,"# New\n").unwrap();assert_eq!(saved.body,"# New\n");
 assert_eq!(f.save(stale,"# Stale").err().unwrap().code,"notes_conflict");let bytes=fs::read(Path::new(&f.library).join("note.md")).unwrap();assert!(bytes.starts_with(&[0xef,0xbb,0xbf]));assert!(String::from_utf8(bytes).unwrap().ends_with("\r\n"));
 let history=f.call("history",json!({"path":"note.md"})).unwrap();assert_eq!(history.as_array().unwrap().len(),1);let old=f.call("history-read",json!({"path":"note.md","version":history[0]["version"]})).unwrap();assert!(old["body"].as_str().unwrap().contains("# Old"));
 f.mutate("rename","note.md","renamed.md");assert_eq!(f.call("history",json!({"path":"renamed.md"})).unwrap().as_array().unwrap().len(),1);
}
#[test] fn catalog_state_and_monotonic_drafts(){
 let f=Fixture::new("state");f.create("a.md","# Search\n#tag");f.create("b.base","views: []");assert_eq!(f.call("catalog",json!({})).unwrap().as_array().unwrap().len(),2);
 let db=rusqlite::Connection::open(state_dir(&f.store,&f.library).join("index.sqlite")).unwrap();let count:i64=db.query_row("SELECT COUNT(*) FROM search WHERE search MATCH 'Search'",[],|r|r.get(0)).unwrap();assert_eq!(count,1);
 f.call("state-put",json!({"key":"bookmarks","revision":0,"value":["a.md"]})).unwrap();assert_eq!(f.call("state-put",json!({"key":"bookmarks","revision":0,"value":[]})).unwrap_err().code,"notes_state_conflict");assert_eq!(f.call("state-get",json!({"key":"bookmarks"})).unwrap()["value"][0],"a.md");
 f.call("draft-put",json!({"path":"a.md","session":"one","revision":2,"body":"new"})).unwrap();f.call("draft-put",json!({"path":"a.md","session":"one","revision":1,"body":"old"})).unwrap();assert_eq!(f.call("drafts",json!({})).unwrap()[0]["body"],"new");
 f.call("draft-clear",json!({"path":"a.md","session":"one","revision":3})).unwrap();f.call("draft-put",json!({"path":"a.md","session":"one","revision":2,"body":"late"})).unwrap();assert_eq!(f.call("drafts",json!({})).unwrap()[0]["cleared"],true);
}
#[test] fn attachments_import_backup_and_path_boundaries(){
 let f=Fixture::new("import");f.call("mkdir",json!({"path":"Empty"})).unwrap();f.call("import-file",json!({"path":"import.md","bytes":b"# Imported".to_vec()})).unwrap();
 f.store.notes_attach(Attachment{root:f.root.clone(),library:f.library.clone(),path:"Attachments/example.txt".into(),bytes:b"attachment".to_vec()}).unwrap();assert_eq!(f.store.notes_binary(&f.root,&f.library,"Attachments/example.txt").unwrap(),b"attachment");
 assert!(f.call("import-file",json!({"path":"import.md","bytes":[]})).is_err());assert!(f.call("create",json!({"path":"../escape.md","body":"no"})).is_err());assert!(f.call("create",json!({"path":"CON.md","body":"no"})).is_err());assert!(f.call("external",json!({"url":"file:///C:/Windows"})).is_err());
 let backup=f.call("backup",json!({})).unwrap();assert_eq!(backup["count"],2);let bytes=fs::read(backup["path"].as_str().unwrap()).unwrap();assert_eq!(&bytes[..4],b"PK\x03\x04");assert!(bytes.windows(6).any(|w|w==b"Empty/"));assert!(bytes.windows(10).any(|w|w==b"# Imported"));
 f.call("file-times",json!({"path":"import.md","modifiedMs":1700000000000u64})).unwrap();assert_eq!(f.call("window",json!({"path":"import.md"})).unwrap()["path"],"import.md");
}
