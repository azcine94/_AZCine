//! Personal calendar entries; project deliveries remain derived from projects.
use crate::storage::{Store,StorageError};
use serde::{Deserialize,Serialize};
use rusqlite::OptionalExtension;
#[derive(Clone,PartialEq,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Entry {pub id:String,pub title:String,pub date:String,pub time:String,pub note:String,pub done:bool,pub deleted:bool,pub revision:u64}
fn error()->StorageError{StorageError::new("calendar_storage","日历记录读取或保存失败，原记录和输入保留。")}
impl Store {
    fn calendar_entries(&self)->Result<Vec<Entry>,StorageError>{
        let value:Option<String>=self.db.query_row("SELECT value FROM app_meta WHERE key='calendar_entries_v1'",[],|r|r.get(0)).optional().map_err(|_|error())?;
        match value{Some(v)=>serde_json::from_str(&v).map_err(|_|error()),None=>Ok(vec![])}
    }
}
#[tauri::command]
pub async fn calendar_entries(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String)->Result<Vec<Entry>,StorageError>{
    crate::main_window(&window)?;crate::with_storage(app,move|m|{let s=m.store()?;if s.root.to_string_lossy()!=root{return Err(error());}s.calendar_entries()}).await
}
#[tauri::command]
pub async fn calendar_save(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,mut entry:Entry)->Result<Vec<Entry>,StorageError>{
    crate::main_window(&window)?;
    if entry.id.len()!=36||!entry.id.bytes().all(|b|b.is_ascii_hexdigit()||b==b'-')||entry.title.trim().is_empty()||entry.title.chars().count()>200||entry.note.chars().count()>10000||entry.date.len()!=10||chrono::NaiveDate::parse_from_str(&entry.date,"%Y-%m-%d").is_err()||(!entry.time.is_empty()&&(entry.time.len()!=5||chrono::NaiveTime::parse_from_str(&entry.time,"%H:%M").is_err())){return Err(StorageError::new("calendar_invalid","请填写标题、有效日期和时间；标题最多 200 字，备注最多 10000 字。"));}
    crate::with_storage(app,move|m|{let s=m.store()?;if s.root.to_string_lossy()!=root{return Err(error());}let mut rows=s.calendar_entries()?;let index=rows.iter().position(|r|r.id==entry.id);
        let expected=entry.revision;entry.revision=entry.revision.checked_add(1).ok_or_else(error)?;
        if let Some(index)=index{if rows[index]==entry{return Ok(rows);}if rows[index].revision!=expected{return Err(StorageError::new("calendar_conflict","安排已更新，请重新读取后核对；当前输入保留。"));}rows[index]=entry;}else{if expected!=0||rows.len()>=10000{return Err(error());}rows.push(entry);}
        let value=serde_json::to_string(&rows).map_err(|_|error())?;s.db.execute("INSERT INTO app_meta(key,value) VALUES('calendar_entries_v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[value]).map_err(|_|error())?;Ok(rows)
    }).await
}
