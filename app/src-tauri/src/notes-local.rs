//! Local vault operations. Invoked only through the owned desktop window and Store lock.
use super::*;
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct LocalRequest { root:String, library:String, operation:String, #[serde(default)] args:Value }
fn now()->u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos() }
fn arg<'a>(v:&'a Value,key:&str)->Result<&'a str,StorageError>{v.get(key).and_then(Value::as_str).ok_or_else(||error("notes_input","操作参数不完整。"))}
fn state_dir(store:&Store,library:&str)->PathBuf{store.root.join("notes/libraries").join(digest(library.as_bytes()))}
fn json_read(path:&Path)->Result<Value,StorageError>{match fs::read(path){Ok(b)=>serde_json::from_slice(&b).map_err(|_|error("notes_state","笔记状态记录损坏，原文件保留。")),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(Value::Null),Err(e)=>Err(io_error(e))}}
fn json_write(path:&Path,value:&Value)->Result<(),StorageError>{let parent=path.parent().unwrap();fs::create_dir_all(parent).map_err(io_error)?;let mut temp=tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;serde_json::to_writer(&mut temp,value).map_err(|_|error("notes_state","状态写入失败。"))?;temp.as_file().sync_all().map_err(io_error)?;temp.persist(path).map_err(|e|io_error(e.error))?;Ok(())}
fn destination(root:&Path,path:&str)->Result<PathBuf,StorageError>{
    let rel=relative(path)?;
    for part in path.split('/') {
        let stem=part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.contains(['<','>','"','|','?','*'])||part.chars().any(char::is_control)||matches!(stem.as_str(),"CON"|"PRN"|"AUX"|"NUL")||(stem.len()==4&&(stem.starts_with("COM")||stem.starts_with("LPT"))&&matches!(stem.as_bytes()[3],b'1'..=b'9')){return Err(error("notes_name","名称包含 Windows 不支持的字符或保留名称。"));}
    }
    let parent=match rel.parent().filter(|p|!p.as_os_str().is_empty()){Some(p)=>existing(root,&p.to_string_lossy().replace('\\',"/"))?,None=>root.to_owned()};
    if !parent.is_dir(){return Err(error("notes_path","目标文件夹不存在。"));}
    let dest=parent.join(rel.file_name().unwrap());
    if dest.exists(){return Err(error("notes_exists","目标名称已存在，未覆盖。"));}Ok(dest)
}
fn write_new(path:&Path,bytes:&[u8])->Result<(),StorageError>{let mut temp=tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(io_error)?;temp.write_all(bytes).map_err(io_error)?;temp.as_file().sync_all().map_err(io_error)?;temp.persist_noclobber(path).map_err(|e|if e.error.kind()==std::io::ErrorKind::AlreadyExists{error("notes_exists","同名文件已存在，未覆盖。")}else{io_error(e.error)})?;Ok(())}
fn tree_digest(path:&Path)->Result<String,StorageError>{
    fn walk(path:&Path,hash:&mut Sha256,depth:usize)->Result<(),StorageError>{
        if depth>64{return Err(error("notes_depth","目录过深。"));}
        let meta=fs::symlink_metadata(path).map_err(io_error)?;if linked(&meta){return Err(error("notes_path","操作范围含链接，未修改。"));}
        if meta.is_dir(){let mut entries=fs::read_dir(path).map_err(io_error)?.collect::<Result<Vec<_>,_>>().map_err(io_error)?;entries.sort_by_key(|e|e.file_name());for e in entries{hash.update(e.file_name().to_string_lossy().as_bytes());walk(&e.path(),hash,depth+1)?;}}
        else{hash.update(meta.len().to_le_bytes());let mut f=fs::File::open(path).map_err(io_error)?;let mut buf=[0u8;65536];loop{let n=f.read(&mut buf).map_err(io_error)?;if n==0{break;}hash.update(&buf[..n]);}}Ok(())
    }
    let mut hash=Sha256::new();walk(path,&mut hash,0)?;Ok(format!("{:x}",hash.finalize()))
}
pub(super) fn record_version(store:&Store,library:&str,path:&str,bytes:&[u8])->Result<(),StorageError>{
    let dir=state_dir(store,library).join("history").join(digest(path.as_bytes()));fs::create_dir_all(&dir).map_err(io_error)?;
    let hash=digest(bytes);let blob=dir.join(format!("{hash}.bin"));if !blob.exists(){write_new(&blob,bytes)?;}
    let manifest=dir.join("index.json");let value=json_read(&manifest)?;let mut rows=value.as_array().cloned().unwrap_or_default();
    if rows.last().and_then(|v|v.get("version")).and_then(Value::as_str)!=Some(&hash){rows.push(json!({"id":now().to_string(),"path":path,"version":hash,"size":bytes.len(),"time":(now()/1_000_000).to_string()}));json_write(&manifest,&json!(rows))?;}Ok(())
}
fn copy_tree(from:&Path,to:&Path,depth:usize)->Result<(),StorageError>{
    if depth>64{return Err(error("notes_depth","目录过深，复制未完成，已复制内容保留。"));}
    let meta=fs::symlink_metadata(from).map_err(io_error)?;if linked(&meta){return Err(error("notes_path","复制范围含链接，未继续。"));}
    if meta.is_dir(){fs::create_dir(to).map_err(io_error)?;for e in fs::read_dir(from).map_err(io_error)?{let e=e.map_err(io_error)?;copy_tree(&e.path(),&to.join(e.file_name()),depth+1)?;}}
    else{let mut input=fs::File::open(from).map_err(io_error)?;let mut output=OpenOptions::new().write(true).create_new(true).open(to).map_err(io_error)?;std::io::copy(&mut input,&mut output).map_err(io_error)?;output.sync_all().map_err(io_error)?;}Ok(())
}
fn retarget_history(store:&Store,library:&str,from:&str,to:&str)->Result<(),StorageError>{
    let history=state_dir(store,library).join("history");if !history.exists(){return Ok(());}
    let folders=fs::read_dir(&history).map_err(io_error)?.collect::<Result<Vec<_>,_>>().map_err(io_error)?;
    for folder in folders{let source=folder.path();if !source.is_dir(){continue;}let records=json_read(&source.join("index.json"))?;let Some(rows)=records.as_array()else{continue;};let Some(path)=rows.last().and_then(|r|r.get("path")).and_then(Value::as_str)else{continue;};if path!=from&&!path.starts_with(&format!("{from}/")){continue;}
        let target_path=format!("{}{}",to,&path[from.len()..]);let destination=history.join(digest(target_path.as_bytes()));fs::create_dir_all(&destination).map_err(io_error)?;
        let previous=json_read(&destination.join("index.json"))?;let mut merged=previous.as_array().cloned().unwrap_or_default();
        for row in rows{let version=arg(row,"version")?;if version.len()!=64||!version.bytes().all(|b|b.is_ascii_hexdigit()){return Err(error("notes_history","版本记录不可用。"));}let dest=destination.join(format!("{version}.bin"));if !dest.exists(){write_new(&dest,&read_limited(&source.join(format!("{version}.bin")),NOTE_LIMIT)?)?;}let mut row=row.clone();row["path"]=json!(target_path);if !merged.iter().any(|v|v.get("id")==row.get("id")){merged.push(row);}}
        merged.sort_by_key(|r|r.get("time").and_then(Value::as_str).unwrap_or("").to_owned());json_write(&destination.join("index.json"),&json!(merged))?;
    }Ok(())
}
fn backup_vault(store:&Store,root:&Path)->Result<Value,StorageError>{
    // ZIP stored entries: streamed to a new local artifact, never over an old backup.
    fn collect(root:&Path,dir:&Path,files:&mut Vec<(String,PathBuf)>,skipped:&mut Vec<String>,depth:u32)->Result<(),StorageError>{
        if depth>64{return Err(error("notes_depth","备份目录过深。"));}
        for e in fs::read_dir(dir).map_err(io_error)?{let e=e.map_err(io_error)?;let p=e.path();let name=p.strip_prefix(root).unwrap().to_string_lossy().replace('\\',"/");let m=fs::symlink_metadata(&p).map_err(io_error)?;
            if linked(&m)||e.file_name()=="node_modules"{skipped.push(name);continue;}
            if m.is_dir(){files.push((format!("{name}/"),p.clone()));collect(root,&p,files,skipped,depth+1)?;}else if m.is_file(){files.push((name,p));}
            if files.len()>60000{return Err(error("notes_count","文件数量超过本次ZIP备份上限60000。"));}
        }Ok(())
    }
    let folder=store.root.join("notes/vault-backups");fs::create_dir_all(&folder).map_err(io_error)?;
    if fs::canonicalize(&folder).map_err(io_error)?.starts_with(root){return Err(error("notes_backup_path","AZCine数据目录位于笔记库内，请先将数据根与笔记库分开，避免递归备份。"));}
    let mut files=Vec::new();let mut skipped=Vec::new();collect(root,root,&mut files,&mut skipped,0)?;
    let mut temp=tempfile::NamedTempFile::new_in(&folder).map_err(io_error)?;let mut central=Vec::<u8>::new();let mut count=0u16;let mut file_count=0u32;
    fn u16le(out:&mut Vec<u8>,v:u16){out.extend(v.to_le_bytes());}fn u32le(out:&mut Vec<u8>,v:u32){out.extend(v.to_le_bytes());}
    for (name,path) in files{
        let directory=name.ends_with('/');let bytes=if directory{Vec::new()}else{file_count+=1;read_limited(&path,512*1024*1024)?};let size=bytes.len() as u32;let offset=temp.stream_position().map_err(io_error)?;
        if offset+bytes.len() as u64>3_500_000_000||name.len()>65535{return Err(error("notes_backup_size","ZIP备份超过3.5GB，请分库备份；未生成不完整备份。"));}
        let mut crc=0xffff_ffffu32;for b in &bytes{crc^=*b as u32;for _ in 0..8{crc=(crc>>1)^(0xedb8_8320u32.wrapping_mul(crc&1));}}crc=!crc;
        let mut header=Vec::new();u32le(&mut header,0x04034b50);for v in [20,0x0800,0,0,33]{u16le(&mut header,v);}for v in [crc,size,size]{u32le(&mut header,v);}u16le(&mut header,name.len() as u16);u16le(&mut header,0);header.extend(name.as_bytes());temp.write_all(&header).map_err(io_error)?;temp.write_all(&bytes).map_err(io_error)?;
        u32le(&mut central,0x02014b50);for v in [20,20,0x0800,0,0,33]{u16le(&mut central,v);}for v in [crc,size,size]{u32le(&mut central,v);}u16le(&mut central,name.len() as u16);for _ in 0..4{u16le(&mut central,0);}u32le(&mut central,0);u32le(&mut central,offset as u32);central.extend(name.as_bytes());count+=1;
    }
    let offset=temp.stream_position().map_err(io_error)? as u32;temp.write_all(&central).map_err(io_error)?;let mut end=Vec::new();u32le(&mut end,0x06054b50);for v in [0,0,count,count]{u16le(&mut end,v);}u32le(&mut end,central.len() as u32);u32le(&mut end,offset);u16le(&mut end,0);temp.write_all(&end).map_err(io_error)?;temp.as_file().sync_all().map_err(io_error)?;
    let id=now().to_string();let path=folder.join(format!("{id}.zip"));temp.persist_noclobber(&path).map_err(|e|io_error(e.error))?;
    Ok(json!({"id":id,"path":display(&path),"count":file_count,"entries":count,"skipped":skipped}))
}
impl Store {
    fn notes_local(&self,input:LocalRequest)->Result<Value,StorageError>{
        let root=self.notes_root(&input.root,&input.library)?;let args=&input.args;let dir=state_dir(self,&input.library);
        match input.operation.as_str(){
            "window"=>{let path=arg(args,"path")?;let file=existing(&root,path)?;if !note(&file){return Err(error("notes_type","只在笔记窗口打开笔记或数据库。"));}Ok(json!({"root":input.root,"path":path}))},
            "external"=>{let url=arg(args,"url")?;let parsed=tauri::Url::parse(url).map_err(|_|error("notes_url","链接不可用。"))?;if !["https","http"].contains(&parsed.scheme())||parsed.host_str().is_none(){return Err(error("notes_url","只支持HTTP或HTTPS链接。"));}
                #[cfg(windows)]{use std::os::windows::process::CommandExt;std::process::Command::new("explorer.exe").arg(parsed.as_str()).creation_flags(0x08000000).spawn().map_err(io_error)?;}Ok(Value::Null)},
            "backup"=>backup_vault(self,&root),
            "mkdir"=>{let path=arg(args,"path")?;relative(path)?;let mut part=String::new();for name in path.split('/'){if !part.is_empty(){part.push('/');}part.push_str(name);let p=root.join(&part);if p.exists(){if !existing(&root,&part)?.is_dir(){return Err(error("notes_exists","导入文件夹名称已被文件占用。"));}}else{fs::create_dir(destination(&root,&part)?).map_err(io_error)?;}}Ok(Value::Null)},
            "exists"=>{let path=arg(args,"path")?;relative(path)?;Ok(json!(root.join(path).exists()))},
            "file-times"=>{let path=arg(args,"path")?;let file=existing(&root,path)?;let mut times=fs::FileTimes::new();if let Some(ms)=args.get("modifiedMs").and_then(Value::as_u64){times=times.set_modified(UNIX_EPOCH+std::time::Duration::from_millis(ms));}fs::File::options().write(true).open(file).map_err(io_error)?.set_times(times).map_err(io_error)?;Ok(Value::Null)},
            "catalog"=>{
                let index=Self::notes_index_at(Some(root.clone()))?;let mut docs=Vec::new();let mut total=0u64;
                for entry in index.files.iter().filter(|e|e.kind=="note"||e.kind=="base"){
                    total+=entry.size;if total>128*1024*1024{return Err(error("notes_catalog_size","本地分析内容超过128MB，请缩小笔记库范围；未返回不完整统计。"));}
                    let file=existing(&root,&entry.path)?;let doc=document(entry.path.clone(),&read_limited(&file,NOTE_LIMIT)?)?;docs.push(json!({"path":doc.path,"body":doc.body,"version":doc.version,"mtime":entry.mtime}));
                }
                // Derived, per-vault index. Rust owns its SQLite writer as it does
                // the business store; no renderer gets arbitrary SQL access.
                fs::create_dir_all(&dir).map_err(io_error)?;
                let mut db=rusqlite::Connection::open(dir.join("index.sqlite")).map_err(|_|error("notes_index","本地全文索引无法打开。"))?;
                db.execute_batch("CREATE TABLE IF NOT EXISTS documents(path TEXT PRIMARY KEY,body TEXT NOT NULL,version TEXT NOT NULL,mtime INTEGER NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(path,body,tokenize='unicode61');").map_err(|_|error("notes_index","本地全文索引初始化失败。"))?;
                let tx=db.transaction().map_err(|_|error("notes_index","索引事务不可用。"))?;
                let changed:bool={let old:i64=tx.query_row("SELECT COUNT(*) FROM documents",[],|r|r.get(0)).map_err(|_|error("notes_index","索引读取失败。"))?;let mut changed=old!=docs.len() as i64;for doc in &docs{let hash:Option<String>=tx.query_row("SELECT version FROM documents WHERE path=?1",[arg(doc,"path")?],|r|r.get(0)).ok();if hash.as_deref()!=Some(arg(doc,"version")?){changed=true;}}changed};
                if changed{tx.execute("DELETE FROM documents",[]).map_err(|_|error("notes_index","索引刷新失败。"))?;tx.execute("DELETE FROM search",[]).map_err(|_|error("notes_index","索引刷新失败。"))?;for doc in &docs{tx.execute("INSERT INTO documents(path,body,version,mtime) VALUES(?1,?2,?3,?4)",rusqlite::params![arg(doc,"path")?,arg(doc,"body")?,arg(doc,"version")?,doc.get("mtime").and_then(Value::as_u64).unwrap_or(0) as i64]).map_err(|_|error("notes_index","索引写入失败。"))?;tx.execute("INSERT INTO search(path,body) VALUES(?1,?2)",rusqlite::params![arg(doc,"path")?,arg(doc,"body")?]).map_err(|_|error("notes_index","全文索引写入失败。"))?;}}
                tx.commit().map_err(|_|error("notes_index","索引提交失败。"))?;Ok(json!(docs))
            },
            "inspect"=>{let path=arg(args,"path")?;let file=existing(&root,path)?;Ok(json!({"path":path,"version":tree_digest(&file)?,"folder":file.is_dir()}))},
            "create"=>{
                let path=arg(args,"path")?;let dest=destination(&root,path)?;
                if args.get("folder").and_then(Value::as_bool)==Some(true){fs::create_dir(dest).map_err(io_error)?;}
                else{if !note(&dest)&&extension(&dest)!="base"{return Err(error("notes_type","只能创建Markdown笔记或.base文件。"));}let body=arg(args,"body")?;if body.len() as u64>NOTE_LIMIT{return Err(error("notes_size","内容过大。"));}write_new(&dest,body.as_bytes())?;}Ok(json!({"path":path}))
            },
            "rename"|"copy"|"trash"=>{
                let path=arg(args,"path")?;let source=existing(&root,path)?;
                if tree_digest(&source)?!=arg(args,"version")?{return Err(error("notes_conflict","操作对象已被修改，请刷新后重新核对。"));}
                if input.operation=="trash"{
                    let trash=root.join(".azcine-trash");if trash.exists()&&linked(&fs::symlink_metadata(&trash).map_err(io_error)?){return Err(error("notes_path","恢复目录不能是链接。"));}fs::create_dir_all(&trash).map_err(io_error)?;
                    let id=now().to_string();let slot=trash.join(&id);fs::create_dir(&slot).map_err(io_error)?;
                    json_write(&slot.join("metadata.json"),&json!({"id":id,"path":path,"time":(now()/1_000_000).to_string(),"folder":source.is_dir()}))?;
                    fs::rename(source,slot.join("content")).map_err(io_error)?;Ok(json!({"id":id,"path":path}))
                }else{
                    let target=arg(args,"target")?;if target.starts_with(&format!("{path}/")){return Err(error("notes_path","不能移动或复制到自身子目录。"));}
                    let dest=destination(&root,target)?;
                    let mut warning=Value::Null;if input.operation=="copy"{copy_tree(&source,&dest,0)?;}else{fs::rename(source,dest).map_err(io_error)?;if retarget_history(self,&input.library,path,target).is_err(){warning=json!("文件已改名或移动，但历史清单未能转接；旧历史记录保留在原路径下。");}}
                    Ok(json!({"path":path,"target":target,"warning":warning}))
                }
            },
            "trash-list"=>{let trash=root.join(".azcine-trash");let mut rows=Vec::new();if trash.exists(){if linked(&fs::symlink_metadata(&trash).map_err(io_error)?){return Err(error("notes_path","恢复目录不能是链接。"));}for e in fs::read_dir(trash).map_err(io_error)?{let p=e.map_err(io_error)?.path();if !linked(&fs::symlink_metadata(&p).map_err(io_error)?)&&p.join("content").exists(){rows.push(json_read(&p.join("metadata.json"))?);}}}Ok(json!(rows))},
            "trash-restore"=>{
                let id=arg(args,"id")?;if id.is_empty()||!id.bytes().all(|b|b.is_ascii_digit()){return Err(error("notes_input","恢复记录不可用。"));}
                let trash=root.join(".azcine-trash");let slot=trash.join(id);for p in [&trash,&slot]{if linked(&fs::symlink_metadata(p).map_err(io_error)?){return Err(error("notes_path","恢复目录不能是链接。"));}}
                let meta=json_read(&slot.join("metadata.json"))?;let path=args.get("target").and_then(Value::as_str).unwrap_or(arg(&meta,"path")?);let dest=destination(&root,path)?;
                fs::rename(slot.join("content"),dest).map_err(io_error)?;Ok(json!({"path":path}))
            },
            "state-get"=>{let key=arg(args,"key")?;if !["settings","workspace","bookmarks","recent"].contains(&key){return Err(error("notes_input","状态类型不可用。"));}json_read(&dir.join(format!("{key}.json")))},
            "state-put"=>{let key=arg(args,"key")?;if !["settings","workspace","bookmarks","recent"].contains(&key){return Err(error("notes_input","状态类型不可用。"));}let value=args.get("value").ok_or_else(||error("notes_input","状态内容缺失。"))?;if value.to_string().len()>2*1024*1024{return Err(error("notes_size","状态内容过大。"));}let path=dir.join(format!("{key}.json"));let old=json_read(&path)?;let rev=old.get("revision").and_then(Value::as_u64).unwrap_or(0);if args.get("revision").and_then(Value::as_u64).unwrap_or(0)!=rev{return Err(error("notes_state_conflict","另一个编辑区已更新设置，请重新读取。"));}let next=json!({"revision":rev+1,"value":value});json_write(&path,&next)?;Ok(next)},
            "drafts"=>{let folder=dir.join("drafts");let mut rows=Vec::new();if folder.exists(){for e in fs::read_dir(folder).map_err(io_error)?{let p=e.map_err(io_error)?.path();if p.extension().is_some_and(|x|x=="json"){let v=json_read(&p)?;if !v.is_null(){rows.push(v);}}}}Ok(json!(rows))},
            "draft-put"|"draft-clear"=>{
                let path=arg(args,"path")?;relative(path)?;let session=arg(args,"session")?;if session.len()>100{return Err(error("notes_input","编辑会话标识不可用。"));}let rev=args.get("revision").and_then(Value::as_u64).ok_or_else(||error("notes_input","草稿版本缺失。"))?;
                let file=dir.join("drafts").join(format!("{}.json",digest(format!("{path}\0{session}").as_bytes())));let old=json_read(&file)?;
                if old.get("revision").and_then(Value::as_u64).unwrap_or(0)>rev{return Ok(old);}
                if input.operation=="draft-clear"{json_write(&file,&json!({"path":path,"session":session,"revision":rev,"cleared":true}))?;Ok(Value::Null)}else{if arg(args,"body")?.len() as u64>NOTE_LIMIT{return Err(error("notes_size","草稿过大。"));}let mut value=args.clone();value["time"]=json!((now()/1_000_000).to_string());json_write(&file,&value)?;Ok(value)}
            },
            "history"=>{let path=arg(args,"path")?;relative(path)?;let rows=json_read(&dir.join("history").join(digest(path.as_bytes())).join("index.json"))?;Ok(if rows.is_null(){json!([])}else{rows})},
            "history-read"=>{let path=arg(args,"path")?;let version=arg(args,"version")?;if version.len()!=64||!version.bytes().all(|b|b.is_ascii_hexdigit()){return Err(error("notes_input","历史版本标识不可用。"));}let file=dir.join("history").join(digest(path.as_bytes())).join(format!("{version}.bin"));let body=String::from_utf8(read_limited(&file,NOTE_LIMIT)?).map_err(|_|error("notes_encoding","历史版本不是UTF-8。"))?;Ok(json!({"path":path,"body":body,"version":version}))},
            "import-file"=>{let path=arg(args,"path")?;let dest=destination(&root,path)?;let bytes:Vec<u8>=serde_json::from_value(args.get("bytes").cloned().unwrap_or(Value::Null)).map_err(|_|error("notes_input","导入内容不可用。"))?;if bytes.len() as u64>MEDIA_LIMIT{return Err(error("notes_size","单文件超过64MB。"));}write_new(&dest,&bytes)?;Ok(json!({"path":path}))},
            "open"|"reveal"=>{let path=arg(args,"path")?;let file=existing(&root,path)?;
                #[cfg(windows)] { use std::os::windows::process::CommandExt;let mut cmd=std::process::Command::new("explorer.exe");cmd.creation_flags(0x08000000);if input.operation=="reveal"{if file.is_dir(){cmd.arg(display(&file));}else{cmd.raw_arg(explorer_selection(&file));}}else{if !note(&file)&&!media(&file)&&!matches!(extension(&file).as_str(),"txt"|"csv"|"json"|"yaml"|"yml"|"docx"|"xlsx"|"pptx"|"odt"|"ods"|"odp"|"rtf"|"zip"|"7z"|"blend"|"psd"|"exr"|"tif"|"tiff"|"fbx"|"obj"|"mov"|"avi"){return Err(error("notes_type","此类型不能直接启动，请使用文件定位或另存附件。"));}cmd.arg(display(&file));}cmd.spawn().map_err(io_error)?; }
                #[cfg(not(windows))] {let _=file;return Err(error("notes_platform","此操作只支持Windows。"));}
                Ok(Value::Null)
            },
            _=>Err(error("notes_operation","未知笔记操作。"))
        }
    }
}
#[tauri::command]
pub async fn notes_local(app:tauri::AppHandle,window:tauri::WebviewWindow,input:LocalRequest)->Result<Value,StorageError>{
    notes_window(&window)?;let new_window=input.operation=="window";
    let result=crate::with_storage(app.clone(),move|m|m.store()?.notes_local(input)).await?;
    if new_window{let label=format!("notes-{}",now());let mut builder=tauri::WebviewWindowBuilder::new(&app,label,tauri::WebviewUrl::App("index.html".into())).title("AZCine · 笔记").inner_size(1100.0,800.0).disable_drag_drop_handler().initialization_script(format!("window.__AZCINE_NOTE_WINDOW__ = {};",result));
        if let Some(folder)=app.config().app.windows.iter().find(|w|w.label=="main").and_then(|w|w.data_directory.clone()){builder=builder.data_directory(folder);}
        builder.build().map_err(|_|error("notes_window","独立窗口创建失败，当前笔记仍保留。"))?;}
    Ok(result)
}

#[cfg(test)]
#[path="notes-local-tests.rs"]
mod tests;

// Explorer parses /select separately from its quoted path, unlike normal argv.
#[cfg(windows)]
fn explorer_selection(path:&Path)->String {format!("/select,\"{}\"",display(path))}
