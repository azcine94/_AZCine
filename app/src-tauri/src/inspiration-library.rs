//! Independent media library. Text ideas and their tables are not touched.
use crate::storage::{StorageError, Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub(crate) fn error(message: &str) -> StorageError { StorageError::new("inspiration_library", message) }
pub(crate) fn db_error(_: rusqlite::Error) -> StorageError { error("灵感库读写失败，原素材与当前输入保留。") }
pub(crate) fn valid_id(id: &str) -> bool { id.len() == 36 && id.bytes().enumerate().all(|(i,b)| if [8,13,18,23].contains(&i) { b==b'-' } else { b.is_ascii_hexdigit() }) }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Region { pub kind:String, pub x:f64, pub y:f64, pub w:f64, pub h:f64 }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Annotation { pub id:String, pub text:String, pub region:Option<Region> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Asset {
    pub id:String, pub name:String, pub filename:String, pub group_id:String, pub kind:String,
    pub mime:String, pub bytes:u64, pub hash:String, pub source:String, pub source_url:String,
    pub created_at:String, pub tags:Vec<String>, pub notes:Vec<Annotation>, pub revision:u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Group { pub id:String, pub name:String, pub revision:i64 }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Snapshot { pub assets:Vec<Asset>, pub groups:Vec<Group> }
#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ImportMeta { pub id:String, pub name:String, pub group_id:String, pub source:String, pub source_url:String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct MoveItem { pub id:String, pub revision:u64 }

pub(crate) fn ensure(store:&Store) -> Result<(),StorageError> {
    // Additive, module-owned tables; no alteration of the shared schema or legacy idea rows.
    let version:Option<String>=store.db.query_row("SELECT value FROM app_meta WHERE key='inspiration_schema'",[],|r|r.get(0)).optional().map_err(db_error)?;
    if version.as_deref().is_some_and(|v|v!="1"){return Err(error("灵感库版本不兼容，未修改原数据。"));}
    store.db.execute_batch("CREATE TABLE IF NOT EXISTS inspiration_groups(id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS inspiration_assets(id TEXT PRIMARY KEY, group_id TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS inspiration_assets_group ON inspiration_assets(group_id);").map_err(db_error)?;
    if version.is_none(){store.db.execute("INSERT INTO app_meta(key,value) VALUES('inspiration_schema','1')",[]).map_err(db_error)?;}
    Ok(())
}
pub(crate) fn directory(store:&Store) -> Result<PathBuf,StorageError> {
    let folder = store.root.join("attachments/inspiration");
    for p in [store.root.join("attachments"), folder.clone()] {
        crate::pi_launch_plan::no_link(&p).map_err(|_|error("素材目录不能是链接或重解析点。"))?;
    }
    std::fs::create_dir_all(&folder).map_err(|_|error("无法创建灵感库素材目录。"))?;
    Ok(folder)
}
pub(crate) fn media_path(store:&Store, id:&str) -> Result<PathBuf,StorageError> {
    if !valid_id(id) { return Err(error("素材编号无效。")); }
    let folder=directory(store)?;
    let legacy=folder.join(format!("{id}.media"));
    let path=if legacy.exists(){legacy}else if let Some(asset)=get_asset(store,id)?{folder.join(format!("{id}.{}",media_extension(&asset)?))}else{legacy};
    crate::pi_launch_plan::no_link(&path).map_err(|_|error("素材文件不能是链接。"))?;
    Ok(path)
}
pub(crate) fn root_matches(store:&Store, root:&str) -> Result<(),StorageError> {
    if store.root.to_string_lossy()!=root { return Err(error("数据目录已经改变，请重新打开灵感库。")); } Ok(())
}
pub(crate) fn get_asset(store:&Store,id:&str) -> Result<Option<Asset>,StorageError> {
    let row:Option<String>=store.db.query_row("SELECT payload FROM inspiration_assets WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
    row.map(|s|serde_json::from_str(&s).map_err(|_|error("素材记录无法读取，未覆盖原记录。"))).transpose()
}
pub(crate) fn snapshot(store:&Store) -> Result<Snapshot,StorageError> {
    ensure(store)?;
    let mut stmt=store.db.prepare("SELECT payload FROM inspiration_assets ORDER BY rowid DESC").map_err(db_error)?;
    let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?;
    let mut assets=Vec::new(); for row in rows { assets.push(serde_json::from_str(&row.map_err(db_error)?).map_err(|_|error("有素材记录无法读取，未显示为空库。"))?); }
    Ok(Snapshot{assets,groups:groups(store)?})
}
pub(crate) fn groups(store:&Store)->Result<Vec<Group>,StorageError>{
    let mut stmt=store.db.prepare("SELECT id,name,revision FROM inspiration_groups ORDER BY name COLLATE NOCASE").map_err(db_error)?;
    stmt.query_map([],|r|Ok(Group{id:r.get(0)?,name:r.get(1)?,revision:r.get(2)?})).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
pub(crate) fn check_group(store:&Store,id:&str)->Result<(),StorageError>{
    if id.is_empty(){return Ok(());}
    if !valid_id(id)||!store.db.query_row("SELECT EXISTS(SELECT 1 FROM inspiration_groups WHERE id=?1)",[id],|r|r.get::<_,bool>(0)).map_err(db_error)?{return Err(error("分组已经不存在，请重新选择。"));}Ok(())
}
pub(crate) fn check_meta(meta:&ImportMeta)->Result<(),StorageError>{
    if !valid_id(&meta.id)||meta.name.trim().is_empty()||meta.name.chars().count()>200||meta.source.chars().count()>200||meta.source_url.len()>4096{return Err(error("素材名称或来源无效。"));}
    if !meta.source_url.is_empty(){let url=url::Url::parse(&meta.source_url).map_err(|_|error("来源网址无效。"))?;if !matches!(url.scheme(),"http"|"https"){return Err(error("来源仅支持 HTTP/HTTPS 网址。"));}}
    Ok(())
}
pub(crate) fn detect(bytes:&[u8])->Option<(&'static str,&'static str)>{
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n"){Some(("image/png","image"))}
    else if bytes.starts_with(b"\xff\xd8\xff"){Some(("image/jpeg","image"))}
    else if bytes.starts_with(b"GIF87a")||bytes.starts_with(b"GIF89a"){Some(("image/gif","image"))}
    else if bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP"){Some(("image/webp","image"))}
    else if bytes.get(4..8)==Some(b"ftyp") { if bytes.get(8..12)==Some(b"avif")||bytes.get(8..12)==Some(b"avis"){Some(("image/avif","image"))}else{Some(("video/mp4","video"))} }
    else if bytes.starts_with(b"\x1a\x45\xdf\xa3"){Some(("video/webm","video"))}
    else {None}
}
pub(crate) fn finish_import(store:&Store,meta:ImportMeta, candidate:tempfile::NamedTempFile, mime:&str,kind:&str,bytes:u64,hash:String)->Result<Asset,StorageError>{
    ensure(store)?;check_meta(&meta)?;check_group(store,&meta.group_id)?;
    if let Some(old)=get_asset(store,&meta.id)?{if old.hash==hash{return Ok(old);}return Err(error("导入编号冲突，请重新选择文件。"));}
    let count:i64=store.db.query_row("SELECT COUNT(*) FROM inspiration_assets",[],|r|r.get(0)).map_err(db_error)?;
    if count>=10000{return Err(error("当前灵感库已达 10000 个素材上限。"));}
    let path=media_path(store,&meta.id)?;
    // A previous interrupted commit can leave an unreferenced copy. Keep it; verify before retry.
    if path.exists(){
        use sha2::{Digest,Sha256};use std::io::Read;
        let mut file=std::fs::File::open(&path).map_err(|_|error("无法核对先前的素材副本。"))?;
        if file.metadata().map_err(|_|error("无法读取素材大小。"))?.len()!=bytes{return Err(error("已有副本不匹配，未覆盖。"));}
        let mut hasher=Sha256::new();let mut buf=[0u8;65536];loop{let n=file.read(&mut buf).map_err(|_|error("无法核对已有副本。"))?;if n==0{break;}hasher.update(&buf[..n]);}
        if format!("{:x}",hasher.finalize())!=hash{return Err(error("已有副本不匹配，未覆盖。"));}
    }else{candidate.persist_noclobber(&path).map_err(|_|error("素材副本保存失败，原文件未修改。"))?;}
    let asset=Asset{id:meta.id,name:meta.name.clone(),filename:meta.name,group_id:meta.group_id,kind:kind.into(),mime:mime.into(),bytes,hash,source:meta.source,source_url:meta.source_url,created_at:chrono::Utc::now().to_rfc3339(),tags:vec![],notes:vec![],revision:1};
    let payload=serde_json::to_string(&asset).map_err(|_|error("素材记录编码失败。"))?;
    store.db.execute("INSERT INTO inspiration_assets(id,group_id,payload) VALUES(?1,?2,?3)",params![asset.id,asset.group_id,payload]).map_err(db_error)?;Ok(asset)
}
fn validate_edit(a:&Asset)->Result<(),StorageError>{
    if a.name.trim().is_empty()||a.name.chars().count()>200||a.tags.len()>50||a.tags.iter().any(|t|t.chars().count()>80)||a.notes.len()>500{return Err(error("名称最多200字、标签最多50个、批注最多500条。"));}
    let mut ids=std::collections::HashSet::new();
    for n in &a.notes{if !valid_id(&n.id)||!ids.insert(&n.id)||n.text.trim().is_empty()||n.text.chars().count()>2000{return Err(error("批注编号或内容无效，每条最多2000字。"));}
        if let Some(r)=&n.region{if ![r.x,r.y,r.w,r.h].iter().all(|v|v.is_finite()&&*v>=0.&&*v<=1.)||r.x+r.w>1.000001||r.y+r.h>1.000001||!matches!(r.kind.as_str(),"pin"|"box")||(r.kind=="box"&&(r.w<=0.||r.h<=0.)){return Err(error("批注位置无效。"));}}
    }Ok(())
}
#[tauri::command]
pub async fn inspiration_snapshot(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String)->Result<Snapshot,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|{let s=m.store()?;root_matches(s,&root)?;snapshot(s)}).await}
#[tauri::command]
pub async fn inspiration_save(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,mut asset:Asset)->Result<Asset,StorageError>{
    crate::main_window(&window)?;validate_edit(&asset)?;
    asset.name=asset.name.trim().to_owned();asset.tags=asset.tags.iter().map(|tag|tag.trim().to_owned()).filter(|tag|!tag.is_empty()).collect();
    crate::with_storage(app,move|m|{let s=m.store()?;root_matches(s,&root)?;ensure(s)?;check_group(s,&asset.group_id)?;
        let mut old=get_asset(s,&asset.id)?.ok_or_else(||error("素材不存在。"))?;
        if old.revision!=asset.revision{
            if old.name==asset.name&&old.group_id==asset.group_id&&old.tags==asset.tags&&old.notes==asset.notes{return Ok(old);}
            return Err(error("素材已更新，请核对最新内容后再保存；当前草稿保留。"));
        }
        old.name=asset.name.trim().into();old.group_id=asset.group_id;old.tags=asset.tags;old.notes=asset.notes;old.revision=old.revision.checked_add(1).ok_or_else(||error("素材版本超限。"))?;
        let payload=serde_json::to_string(&old).map_err(|_|error("素材编码失败。"))?;s.db.execute("UPDATE inspiration_assets SET group_id=?2,payload=?3 WHERE id=?1",params![old.id,old.group_id,payload]).map_err(db_error)?;Ok(old)
    }).await
}
#[tauri::command]
pub async fn inspiration_group(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,mut group:Group,remove:bool)->Result<Snapshot,StorageError>{
    crate::main_window(&window)?;if group.revision<0{return Err(error("分组版本无效。"));}if !valid_id(&group.id)||group.name.trim().is_empty()||group.name.chars().count()>80{return Err(error("分组名称需为1–80字。"));}
    crate::with_storage(app,move|m|{let s=m.store()?;root_matches(s,&root)?;ensure(s)?;let old:Option<(String,i64)>=s.db.query_row("SELECT name,revision FROM inspiration_groups WHERE id=?1",[&group.id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        if old.as_ref().map(|v|v.1).unwrap_or(0)!=group.revision{if !remove&&old.as_ref().is_some_and(|v|v.0==group.name.trim()){return snapshot(s);}return Err(error("分组已变化，请刷新后重试。"));}
        if remove{let count:i64=s.db.query_row("SELECT COUNT(*) FROM inspiration_assets WHERE group_id=?1",[&group.id],|r|r.get(0)).map_err(db_error)?;if count>0{return Err(error("请先移出组内素材，再删除空分组。"));}s.db.execute("DELETE FROM inspiration_groups WHERE id=?1",[&group.id]).map_err(db_error)?;}
        else{group.name=group.name.trim().into();let duplicate:bool=s.db.query_row("SELECT EXISTS(SELECT 1 FROM inspiration_groups WHERE lower(name)=lower(?1) AND id<>?2)",params![group.name,group.id],|r|r.get(0)).map_err(db_error)?;if duplicate{return Err(error("已有同名分组。"));}let next_revision=group.revision.checked_add(1).ok_or_else(||error("分组版本超限。"))?;s.db.execute("INSERT INTO inspiration_groups(id,name,revision) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=excluded.revision",params![group.id,group.name,next_revision]).map_err(db_error)?;}
        snapshot(s)
    }).await
}
#[tauri::command]
pub async fn inspiration_move(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,items:Vec<MoveItem>,group_id:String)->Result<Snapshot,StorageError>{
    crate::main_window(&window)?;if items.len()>10000{return Err(error("单次移动素材过多。"));}
    crate::with_storage(app,move|m|{let s=m.store()?;root_matches(s,&root)?;ensure(s)?;check_group(s,&group_id)?;
        let mut updates=vec![];for item in items{let mut a=get_asset(s,&item.id)?.ok_or_else(||error("素材已不存在。"))?;if a.group_id==group_id{continue;}if a.revision!=item.revision{return Err(error("部分素材已更新，未移动，请重新读取。"));}a.group_id=group_id.clone();a.revision+=1;updates.push(a);}
        let tx=s.db.unchecked_transaction().map_err(db_error)?;for a in updates{tx.execute("UPDATE inspiration_assets SET group_id=?2,payload=?3 WHERE id=?1",params![a.id,a.group_id,serde_json::to_string(&a).map_err(|_|error("素材编码失败。"))?]).map_err(db_error)?;}tx.commit().map_err(db_error)?;snapshot(s)
    }).await
}

fn media_extension(asset:&Asset)->Result<&'static str,StorageError>{
    match asset.mime.as_str(){"image/png"=>Ok("png"),"image/jpeg"=>Ok("jpg"),"image/gif"=>Ok("gif"),"image/webp"=>Ok("webp"),"image/avif"=>Ok("avif"),"video/mp4"=>Ok("mp4"),"video/webm"=>Ok("webm"),_=>Err(error("此素材格式无法在本地打开。"))}
}
#[tauri::command]
pub async fn inspiration_local(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,id:String,revision:u64,operation:String)->Result<(),StorageError>{
    crate::main_window(&window)?;
    crate::with_storage(app,move|m|{
        let s=m.store()?;root_matches(s,&root)?;ensure(s)?;
        let asset=get_asset(s,&id)?.ok_or_else(||error("素材已不存在，请刷新列表。"))?;
        let path=media_path(s,&id)?;
        if operation=="delete"{
            if asset.revision!=revision{return Err(error("素材已更新，请刷新并核对后再删除。"));}
            let tx=s.db.unchecked_transaction().map_err(db_error)?;
            tx.execute("DELETE FROM inspiration_assets WHERE id=?1",[&id]).map_err(db_error)?;
            // Stage the owned copy before committing; an unsuccessful transaction restores it.
            let staged=if path.exists(){
                let slot=tempfile::Builder::new().prefix(".delete-").tempdir_in(directory(s)?).map_err(|_|error("无法准备删除，素材保留。"))?;
                let backup=slot.path().join("material");
                std::fs::rename(&path,&backup).map_err(|_|error("素材正在被其他程序占用，未删除。"))?;
                Some((slot.keep(),backup))
            }else{None};
            if tx.commit().is_err(){
                if let Some((slot,backup))=staged{if std::fs::rename(&backup,&path).is_err(){return Err(error("记录提交失败，素材副本保留在库内 .delete- 目录，请勿清理。"));}let _=std::fs::remove_dir(slot);}
                return Err(error("删除未完成，素材保留。"));
            }
            if let Some((slot,backup))=staged{if std::fs::remove_file(&backup).is_ok(){let _=std::fs::remove_dir(slot);}}
            return Ok(());
        }
        if !matches!(operation.as_str(),"open"|"reveal"){return Err(error("不支持的素材操作。"));}
        if !path.is_file(){return Err(error("本地素材文件不存在。"));}
        // Original imports used .media; give the library copy its verified media extension
        // so Windows can select the proper default app. Source files are never touched.
        let file=directory(s)?.join(format!("{id}.{}",media_extension(&asset)?));
        crate::pi_launch_plan::no_link(&file).map_err(|_|error("素材文件不能是链接。"))?;
        if file!=path{if file.exists(){return Err(error("同名素材文件已存在，未覆盖。"));}std::fs::rename(&path,&file).map_err(|_|error("素材正在使用，暂时无法在本地打开。"))?;}
        #[cfg(windows)]{
            use std::os::windows::process::CommandExt;
            let display=file.to_string_lossy().trim_start_matches(r"\\?\").to_owned();
            let mut command=std::process::Command::new("explorer.exe");command.creation_flags(0x08000000);
            if operation=="reveal"{command.raw_arg(format!("/select,\"{display}\""));}else{command.arg(display);}
            command.spawn().map_err(|_|error("无法打开本地素材，请检查系统默认应用。"))?;
            Ok(())
        }
        #[cfg(not(windows))]{Err(error("本地打开当前仅支持 Windows。"))}
    }).await
}
