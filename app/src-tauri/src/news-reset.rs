//! Confirmed news-only resets; sources, preferences and other modules remain intact.
use std::{fs,path::{Path,PathBuf}};
use rusqlite::{Connection,OptionalExtension,params};
use serde::{Serialize,Deserialize};
use tauri::{Manager as _,Emitter as _};
use crate::{storage::{Store,StorageError},news_store::row_count,news_reader_store::{encode,decode}};
use sha2::{Digest,Sha256};
const RESULTS:&[&str]=&["news_articles","news_processed","news_event_versions","news_events","news_editions","news_reader_editions","news_story_digests","news_step_receipts","news_editorial_runs","news_pending_dismissals","news_queue_requests"];
const COLLECTION:&[&str]=&["news_bodies","news_material_batches","news_material_keys","news_materials","news_batch_ranges","news_runs","news_batches"];
fn invalid()->StorageError{StorageError::new("news_reset_invalid","清空范围或确认信息无效，没有清空资料。")}
fn db_error(_:rusqlite::Error)->StorageError{StorageError::new("news_reset_failed","资讯清空未完成，数据库事务已回滚；请保留记录并重试同一请求。")}
fn file_error()->StorageError{StorageError::new("news_reset_files_failed","资讯任务文件无法安全清理，未清空数据库；请检查目录、权限或占用。")}
fn mode_valid(mode:&str)->bool{matches!(mode,"results"|"all")}
fn tables(mode:&str)->Vec<&'static str>{let mut all=RESULTS.to_vec();if mode=="all"{all.extend_from_slice(COLLECTION);}all}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Preview{pub mode:String,pub token:String,pub materials:usize,pub articles:usize,pub tasks:usize,pub editions:usize}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ResultInfo{pub removed:Preview,pub warning:Option<String>}
pub fn create_schema(db:&Connection)->Result<(),StorageError>{db.execute_batch("CREATE TABLE news_reset_requests(id TEXT PRIMARY KEY,mode TEXT NOT NULL,token TEXT NOT NULL,result TEXT NOT NULL) STRICT;").map_err(db_error)}
pub fn validate_schema(db:&Connection)->Result<(),StorageError>{db.prepare("SELECT id,mode,token,result FROM news_reset_requests LIMIT 0").map_err(db_error)?;Ok(())}
fn count(db:&Connection,table:&str)->Result<usize,StorageError>{db.query_row(&format!("SELECT count(*) FROM {table}"),[],|r|row_count(r,0)).map_err(db_error)}
fn preview(db:&Connection,mode:&str)->Result<Preview,StorageError>{
    if !mode_valid(mode){return Err(invalid());}
    // Confirmation binds the affected records, including changes with identical counts.
    let mut fingerprint=Sha256::new();fingerprint.update(mode.as_bytes());
    for table in tables(mode){
        fingerprint.update(table.as_bytes());let mut q=db.prepare(&format!("SELECT * FROM {table} ORDER BY rowid")).map_err(db_error)?;
        let width=q.column_count();let mut rows=q.query([]).map_err(db_error)?;
        while let Some(row)=rows.next().map_err(db_error)?{for i in 0..width{use rusqlite::types::ValueRef;match row.get_ref(i).map_err(db_error)?{
            ValueRef::Null=>fingerprint.update(b"N"),ValueRef::Integer(n)=>{fingerprint.update(b"I");fingerprint.update(n.to_be_bytes());},ValueRef::Real(n)=>{fingerprint.update(b"R");fingerprint.update(n.to_bits().to_be_bytes());},ValueRef::Text(v)|ValueRef::Blob(v)=>{fingerprint.update(b"S");fingerprint.update((v.len() as u64).to_be_bytes());fingerprint.update(v);}
        }}}
    }
    Ok(Preview{mode:mode.into(),token:format!("{:x}",fingerprint.finalize()),materials:count(db,"news_materials")?,articles:count(db,"news_articles")?,tasks:count(db,"news_editorial_runs")?,editions:count(db,"news_editions")?+count(db,"news_reader_editions")?})
}
fn no_links(path:&Path)->Result<(),StorageError>{
    crate::pi_launch_plan::no_link(path).map_err(|_|file_error())?;
    if path.is_dir(){for entry in fs::read_dir(path).map_err(|_|file_error())?{no_links(&entry.map_err(|_|file_error())?.path())?;}}Ok(())
}
fn restore(staged:&[(PathBuf,PathBuf)])->Result<(),StorageError>{for (from,to) in staged.iter().rev(){fs::rename(to,from).map_err(|_|StorageError::new("news_reset_restore_failed","数据库未清空，但任务文件恢复原位置失败；请保留 snapshots 下的 news-reset 文件夹用于恢复。"))?;}Ok(())}
fn stage_files(root:&Path,id:&str,mode:&str)->Result<Vec<(PathBuf,PathBuf)>,StorageError>{
    let parent=root.join("snapshots");crate::pi_launch_plan::no_link(&parent).map_err(|_|file_error())?;let mut plans=Vec::new();
    for name in if mode=="all"{vec!["news-editorial","news"]}else{vec!["news-editorial"]}{
        let original=parent.join(name);let target=parent.join(format!("news-reset-{id}-{name}"));
        if !original.try_exists().map_err(|_|file_error())?{continue;}
        if target.try_exists().map_err(|_|file_error())?||!original.is_dir()||no_links(&original).is_err(){return Err(file_error());}plans.push((original,target));
    }
    let mut staged=Vec::new();for (original,target) in plans{if fs::rename(&original,&target).is_err(){restore(&staged)?;return Err(file_error());}staged.push((original,target));}Ok(staged)
}
pub fn recover_files(root:&Path,db:&Connection)->Result<(),StorageError>{
    let parent=root.join("snapshots");crate::pi_launch_plan::no_link(&parent).map_err(|_|file_error())?;
    if !parent.try_exists().map_err(|_|file_error())?{return Ok(());}
    for entry in fs::read_dir(&parent).map_err(|_|file_error())?{
        let path=entry.map_err(|_|file_error())?.path();let name=path.file_name().and_then(|s|s.to_str()).unwrap_or("");
        let Some(rest)=name.strip_prefix("news-reset-")else{continue;};
        let Some((id,original))=rest.split_once("-news")else{continue;};
        let original=format!("news{original}");if !crate::news_types::uuid(id)||!matches!(original.as_str(),"news"|"news-editorial"){continue;}
        no_links(&path)?;
        let committed:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM news_reset_requests WHERE id=?1)",[id],|r|r.get(0)).map_err(db_error)?;
        if committed {if fs::remove_dir_all(&path).is_err(){continue;}}
        else {let destination=parent.join(original);if destination.try_exists().map_err(|_|file_error())?{return Err(StorageError::new("news_reset_restore_failed","上次清空未提交，资讯快照需要恢复，但原位置已有文件；两个目录均保留，请核对后恢复。"));}fs::rename(path,destination).map_err(|_|file_error())?;}
    }Ok(())
}
impl Store{
    pub fn news_reset_preview(&self,mode:&str)->Result<Preview,StorageError>{preview(&self.db,mode)}
    pub fn reset_news(&mut self,id:&str,mode:&str,token:&str)->Result<ResultInfo,StorageError>{
        if !crate::news_types::uuid(id)||!mode_valid(mode)||token.len()!=64{return Err(invalid());}
        let saved:Option<(String,String,String)>=self.db.query_row("SELECT mode,token,result FROM news_reset_requests WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_error)?;
        if let Some((m,t,result))=saved{if m!=mode||t!=token{return Err(StorageError::new("request_conflict","此清空请求已用于其他范围，未再次清空。"));}return decode(&result);}
        let tx=self.db.transaction().map_err(db_error)?;let current=preview(&tx,mode)?;
        if current.token!=token{return Err(StorageError::new("news_reset_changed","确认后资讯数据已有变化，没有清空；请重新查看条数并确认。"));}
        let staged=stage_files(&self.root,id,mode)?;let mut result=ResultInfo{removed:current,warning:None};
        let saved:Result<(),StorageError>=(||{
            for table in tables(mode){tx.execute(&format!("DELETE FROM {table}"),[]).map_err(db_error)?;}
            tx.execute("INSERT INTO news_reset_requests(id,mode,token,result) VALUES(?1,?2,?3,?4)",params![id,mode,token,encode(&result)?]).map_err(db_error)?;
            tx.commit().map_err(db_error)?;Ok(())
        })();
        if let Err(error)=saved{restore(&staged)?;return Err(error);}
        for (_,target) in &staged{
            // Remove only the directory staged by this request inside this data root.
            if target.parent()!=Some(self.root.join("snapshots").as_path())||no_links(target).is_err()||fs::remove_dir_all(target).is_err(){result.warning=Some("数据库已清空，部分旧任务文件仍保留在 snapshots/news-reset-*，未删除其他目录；请保留记录核对文件占用。".into());}
        }
        if result.warning.is_some(){self.db.execute("UPDATE news_reset_requests SET result=?1 WHERE id=?2",params![encode(&result)?,id]).map_err(|_|StorageError::new("news_reset_cleanup_uncertain","数据库已清空，但旧任务文件清理状态未能记录；请重新读取核对，不要换请求编号再次清空。"))?;}
        Ok(result)
    }
}
#[tauri::command]pub async fn news_reset_preview(app:tauri::AppHandle,window:tauri::WebviewWindow,mode:String)->Result<Preview,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|m.store()?.news_reset_preview(&mode)).await}
#[tauri::command]pub async fn news_reset_data(app:tauri::AppHandle,window:tauri::WebviewWindow,request_id:String,mode:String,token:String)->Result<ResultInfo,StorageError>{
    crate::main_window(&window)?;let _capture=crate::news_commands::claim(&app)?;let _editorial=crate::news_editorial_commands::claim(&app)?;
    let result=crate::with_storage(app.clone(),move|m|m.store()?.reset_news(&request_id,&mode,&token)).await?;
    let control=app.state::<crate::news_ai::AiControl>();if let Ok(mut value)=control.progress.lock(){*value=None;}if let Ok(mut value)=control.replies.lock(){value.clear();}
    if result.removed.mode=="all"{app.state::<crate::news_commands::NewsState>().clear_inputs();}
    for event in ["news-data-reset","news-editorial-changed","news-processing-changed"]{let _=app.emit_to("main",event,());}
    let snapshot=crate::with_storage(app.clone(),|m|m.store()?.news_snapshot()).await?;let _=app.emit_to("main","news-progress",snapshot);Ok(result)
}
#[cfg(test)]#[path="news-reset-tests.rs"]mod tests;
