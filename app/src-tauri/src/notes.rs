use crate::storage::{StorageError, Store};
#[path = "notes-local.rs"] mod local;
pub use local::notes_local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::{self, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::{Component, Path, PathBuf}};

const NOTE_LIMIT:u64=16*1024*1024;
const MEDIA_LIMIT:u64=64*1024*1024;
fn error(code:&'static str,message:&str)->StorageError { StorageError::new(code,message) }
fn io_error(_:std::io::Error)->StorageError { error("notes_io","笔记文件操作失败，请检查目录、权限或文件占用；草稿仍保留。") }
fn notes_window(window:&tauri::WebviewWindow)->Result<(),StorageError>{if window.label()=="main"||window.label().strip_prefix("notes-").is_some_and(|s|!s.is_empty()&&s.bytes().all(|b|b.is_ascii_digit())){Ok(())}else{Err(error("window_denied","此窗口不能访问笔记库。"))}}
fn digest(bytes:&[u8])->String { format!("{:x}",Sha256::digest(bytes)) }
fn note(path:&Path)->bool { matches!(extension(path).as_str(),"md"|"markdown"|"base") }
fn extension(path:&Path)->String { path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase() }
fn media(path:&Path)->bool { matches!(extension(path).as_str(),"png"|"jpg"|"jpeg"|"gif"|"webp"|"svg"|"avif"|"bmp"|"ico"|"mp3"|"wav"|"ogg"|"oga"|"opus"|"flac"|"aac"|"m4a"|"mp4"|"webm"|"pdf") }
fn linked(meta:&fs::Metadata)->bool {
    // OneDrive cloud placeholders also have REPARSE_POINT. They are not path
    // links; rejecting that bit wholesale would hide the user's synced vault.
    meta.file_type().is_symlink()
}
fn display(path:&Path)->String {
    let text=path.to_string_lossy();
    if let Some(unc)=text.strip_prefix("\\\\?\\UNC\\"){format!("\\\\{unc}")}
    else {text.strip_prefix("\\\\?\\").unwrap_or(&text).to_owned()}
}
fn relative(path:&str)->Result<PathBuf,StorageError> {
    if path.is_empty()||path.contains(['\\',':','\0'])||path.split('/').any(|p|p.is_empty()||p.starts_with('.')||p.ends_with(['.',' '])) {
        return Err(error("notes_path","笔记路径不可用。"));
    }
    let value=PathBuf::from(path);
    if value.components().any(|p|!matches!(p,Component::Normal(_))) {return Err(error("notes_path","笔记路径必须位于所选库内。"));}
    Ok(value)
}
fn existing(root:&Path,path:&str)->Result<PathBuf,StorageError> {
    let relative=relative(path)?;
    let mut candidate=root.to_owned();
    for part in relative.components(){candidate.push(part.as_os_str());if linked(&fs::symlink_metadata(&candidate).map_err(io_error)?){return Err(error("notes_path","暂不读取链接或重解析目录中的笔记。"));}}
    let canonical=fs::canonicalize(candidate).map_err(io_error)?;
    if !canonical.starts_with(root)||canonical==root{return Err(error("notes_path","路径不在当前笔记库内。"));}
    Ok(canonical)
}
fn read_limited(path:&Path,limit:u64)->Result<Vec<u8>,StorageError> {
    let mut options=OpenOptions::new();options.read(true);
    #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;options.share_mode(1);}
    let file=options.open(path).map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.is_file(){return Err(error("notes_path","该路径不是文件。"));}
    let mut bytes=Vec::new();file.take(limit+1).read_to_end(&mut bytes).map_err(io_error)?;
    if bytes.len() as u64>limit{return Err(error("notes_size","文件过大，暂未加载；原文件未修改。"));}Ok(bytes)
}
#[derive(Serialize,Deserialize)]
struct Config { library:PathBuf }
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Entry { path:String,kind:String,size:u64,mtime:u64 }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Index { library:Option<String>,name:String,files:Vec<Entry>,directories:Vec<String> }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Document { pub path:String,pub body:String,pub version:String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Save { root:String,library:String,path:String,body:String,version:String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Attachment { root:String,library:String,path:String,bytes:Vec<u8> }
fn document(path:String,bytes:&[u8])->Result<Document,StorageError> {
    let text=std::str::from_utf8(bytes).map_err(|_|error("notes_encoding","这篇笔记不是 UTF-8，未启用编辑。"))?;
    Ok(Document{path,body:text.trim_start_matches('\u{feff}').replace("\r\n","\n"),version:digest(bytes)})
}
impl Store {
    fn notes_check(&self,root:&str)->Result<(),StorageError> {
        if Path::new(root)!=self.root{return Err(error("notes_workspace_changed","数据目录已切换，旧草稿仍保留；请回到原数据目录后保存。"));}Ok(())
    }
    fn notes_config(&self)->PathBuf { self.root.join("notes/library.json") }
    fn notes_library(&self,expected:Option<&str>)->Result<Option<PathBuf>,StorageError> {
        let path=self.notes_config();
        let bytes=match fs::read(path){Ok(bytes)=>bytes,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(e)=>return Err(io_error(e))};
        let config:Config=serde_json::from_slice(&bytes).map_err(|_|error("notes_config","笔记目录配置无法读取，请重新选择目录。"))?;
        let root=fs::canonicalize(config.library).map_err(|_|error("notes_library_missing","笔记库目录不可用，请检查 OneDrive 或磁盘，或重新选择目录。"))?;
        if !root.is_dir(){return Err(error("notes_library_missing","已选择的笔记库不再是目录。"));}
        if expected.is_some_and(|s|display(&root)!=s){return Err(error("notes_library_changed","笔记库已切换，旧草稿未写入其他目录。"));}Ok(Some(root))
    }
    fn notes_root(&self,root:&str,library:&str)->Result<PathBuf,StorageError> {
        self.notes_check(root)?;self.notes_library(Some(library))?.ok_or_else(||error("notes_no_library","请先选择笔记库目录。"))
    }
    fn notes_index_at(root:Option<PathBuf>)->Result<Index,StorageError> {
        let Some(root)=root else{return Ok(Index{library:None,name:String::new(),files:Vec::new(),directories:Vec::new()});};
        let mut result=Index{library:Some(display(&root)),name:root.file_name().unwrap_or_default().to_string_lossy().into_owned(),files:Vec::new(),directories:Vec::new()};
        fn walk(root:&Path,folder:&Path,out:&mut Index,depth:u32)->Result<(),StorageError> {
            if depth>64{return Err(error("notes_depth","笔记库目录层级过深，未完整加载。"));}
            for entry in fs::read_dir(folder).map_err(io_error)? {
                let entry=entry.map_err(io_error)?;let name=entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.')||name=="node_modules"{continue;}
                let path=entry.path();let meta=fs::symlink_metadata(&path).map_err(io_error)?;if linked(&meta){continue;}
                let relative=path.strip_prefix(root).map_err(|_|error("notes_path","目录越界，未继续加载。"))?.to_string_lossy().replace('\\',"/");
                if meta.is_dir(){out.directories.push(relative);walk(root,&path,out,depth+1)?;}
                else if meta.is_file(){
                    let mtime=meta.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_millis() as u64).unwrap_or(0);
                    out.files.push(Entry{path:relative,kind:(if extension(&path)=="base"{"base"}else if note(&path){"note"}else{"attachment"}).into(),size:meta.len(),mtime});
                }
                if out.files.len()+out.directories.len()>100_000{return Err(error("notes_count","库内文件过多，未完整加载。"));}
            }Ok(())
        }
        walk(&root,&root,&mut result,0)?;result.files.sort_by(|a,b|a.path.cmp(&b.path));result.directories.sort();Ok(result)
    }
    fn notes_index(&self,root:&str)->Result<Index,StorageError>{self.notes_check(root)?;Self::notes_index_at(self.notes_library(None)?)}
    fn notes_select(&self,root:&str,path:&str)->Result<Index,StorageError>{
        self.notes_check(root)?;let library=fs::canonicalize(path).map_err(io_error)?;
        if !library.is_dir(){return Err(error("notes_path","请选择现有笔记文件夹。"));}
        let index=Self::notes_index_at(Some(library.clone()))?;
        let config=self.notes_config();fs::create_dir_all(config.parent().unwrap()).map_err(io_error)?;
        let mut temp=tempfile::NamedTempFile::new_in(config.parent().unwrap()).map_err(io_error)?;
        temp.write_all(&serde_json::to_vec(&Config{library}).map_err(|_|error("notes_config","目录配置生成失败。"))?).map_err(io_error)?;
        temp.as_file().sync_all().map_err(io_error)?;temp.persist(config).map_err(|e|io_error(e.error))?;Ok(index)
    }
    fn notes_read(&self,root:&str,library:&str,path:&str)->Result<Document,StorageError>{
        let library=self.notes_root(root,library)?;let file=existing(&library,path)?;
        if !note(&file){return Err(error("notes_type","该文件不是 Markdown 笔记。"));}document(path.to_owned(),&read_limited(&file,NOTE_LIMIT)?)
    }
    fn notes_save(&self,input:Save)->Result<Document,StorageError>{
        let library=self.notes_root(&input.root,&input.library)?;let path=existing(&library,&input.path)?;
        if !note(&path)||input.body.len() as u64>NOTE_LIMIT{return Err(error("notes_size","笔记类型或大小不支持保存。"));}
        let mut options=OpenOptions::new();options.read(true).write(true);
        // Windows target handle excludes concurrent writers and replacement while
        // checking the version and updating it. Obsidian/OneDrive cannot swap it
        // between the conflict check and the write.
        #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt;options.share_mode(1); }
        let mut file=options.open(&path).map_err(io_error)?;
        let mut old=Vec::new();(&mut file).take(NOTE_LIMIT+1).read_to_end(&mut old).map_err(io_error)?;
        if old.len() as u64>NOTE_LIMIT{return Err(error("notes_size","原笔记过大，未写入。"));}
        let original=std::str::from_utf8(&old).map_err(|_|error("notes_encoding","原笔记不再是 UTF-8，未写入。"))?;
        let normalized=input.body.replace("\r\n","\n");
        if original.trim_start_matches('\u{feff}').replace("\r\n","\n")==normalized{return document(input.path,&old);}
        if digest(&old)!=input.version{return Err(error("notes_conflict","原文件已被 Obsidian 或其他程序修改，草稿保留，请先核对两份内容。"));}
        let mut text=if original.contains("\r\n"){normalized.replace('\n',"\r\n")}else{normalized};
        if original.starts_with('\u{feff}'){text.insert(0,'\u{feff}');}
        let bytes=text.as_bytes();if bytes==old{return document(input.path,&old);}
        // Retain an exact pre-save copy under AZCine's root, outside the vault.
        let backups=self.root.join("notes/backups");fs::create_dir_all(&backups).map_err(io_error)?;
        let backup=backups.join(format!("{}.md",digest(&old)));
        if !backup.exists(){let mut temp=tempfile::NamedTempFile::new_in(&backups).map_err(io_error)?;temp.write_all(&old).map_err(io_error)?;temp.as_file().sync_all().map_err(io_error)?;temp.persist_noclobber(&backup).map_err(|e|io_error(e.error))?;}
        local::record_version(self,&input.library,&input.path,&old)?;
        let write=(||->std::io::Result<()>{file.seek(SeekFrom::Start(0))?;file.write_all(bytes)?;file.set_len(bytes.len() as u64)?;file.sync_all()})();
        if write.is_err(){let _=(||->std::io::Result<()>{file.seek(SeekFrom::Start(0))?;file.write_all(&old)?;file.set_len(old.len() as u64)?;file.sync_all()})();return Err(error("notes_save_failed","保存失败，草稿保留；原文副本已保留在 AZCine 数据目录的 notes/backups。"));}
        document(input.path,bytes)
    }
    fn notes_binary(&self,root:&str,library:&str,path:&str)->Result<Vec<u8>,StorageError>{let library=self.notes_root(root,library)?;let file=existing(&library,path)?;read_limited(&file,MEDIA_LIMIT)}
    fn notes_attach(&self,input:Attachment)->Result<(),StorageError>{
        let library=self.notes_root(&input.root,&input.library)?;let relative=relative(&input.path)?;
        if note(&relative)||input.bytes.len() as u64>MEDIA_LIMIT{return Err(error("notes_type","请选择附件文件；单文件上限 64 MB。"));}
        let mut parent=library.clone();if let Some(folders)=relative.parent(){for part in folders.components(){parent.push(part.as_os_str());if !parent.exists(){fs::create_dir(&parent).map_err(io_error)?;}if linked(&fs::symlink_metadata(&parent).map_err(io_error)?){return Err(error("notes_path","附件目录不能是链接。"));}}}
        let canonical=fs::canonicalize(&parent).map_err(io_error)?;if !canonical.starts_with(&library){return Err(error("notes_path","附件路径不在笔记库内。"));}
        let mut temp=tempfile::NamedTempFile::new_in(&canonical).map_err(io_error)?;temp.write_all(&input.bytes).map_err(io_error)?;temp.as_file().sync_all().map_err(io_error)?;
        temp.persist_noclobber(canonical.join(relative.file_name().unwrap())).map_err(|e|if e.error.kind()==std::io::ErrorKind::AlreadyExists{error("notes_exists","同名附件已存在，未覆盖；请重试导入。 ")}else{io_error(e.error)})?;Ok(())
    }
}

#[tauri::command]
pub async fn notes_index(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String)->Result<Index,StorageError>{notes_window(&window)?;crate::with_storage(app,move|m|m.store()?.notes_index(&root)).await}
#[tauri::command]
pub async fn notes_select(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,path:String)->Result<Index,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|m.store()?.notes_select(&root,&path)).await}
#[tauri::command]
pub async fn notes_read(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,library:String,path:String)->Result<Document,StorageError>{notes_window(&window)?;crate::with_storage(app,move|m|m.store()?.notes_read(&root,&library,&path)).await}
#[tauri::command]
pub async fn notes_save(app:tauri::AppHandle,window:tauri::WebviewWindow,input:Save)->Result<Document,StorageError>{notes_window(&window)?;crate::with_storage(app,move|m|m.store()?.notes_save(input)).await}
#[tauri::command]
pub async fn notes_binary(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,library:String,path:String)->Result<Vec<u8>,StorageError>{notes_window(&window)?;crate::with_storage(app,move|m|m.store()?.notes_binary(&root,&library,&path)).await}
#[tauri::command]
pub async fn notes_attach(app:tauri::AppHandle,window:tauri::WebviewWindow,input:Attachment)->Result<(),StorageError>{notes_window(&window)?;crate::with_storage(app,move|m|m.store()?.notes_attach(input)).await}
