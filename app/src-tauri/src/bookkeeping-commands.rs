use crate::bookkeeping::{self, Expense, Mutation, Receipt, Target};
use crate::storage::StorageError;
use serde::Deserialize;
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

#[tauri::command]
pub async fn bookkeeping_exchange_rate(window:tauri::WebviewWindow,currency:String,date:String)->Result<crate::bookkeeping_exchange::Rate,StorageError>{
    crate::main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move||crate::bookkeeping_exchange::fetch(currency,date)).await
        .map_err(|_|StorageError::new("exchange_interrupted","汇率读取中断，输入保留，请重试。"))?
}

#[tauri::command]
pub async fn bookkeeping_list(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Vec<Expense>,StorageError>{
    crate::main_window(&window)?;
    crate::with_storage(app,|m|m.store()?.bookkeeping_list()).await
}
#[tauri::command]
pub async fn bookkeeping_mutate(app:tauri::AppHandle,window:tauri::WebviewWindow,input:Mutation)->Result<Vec<Expense>,StorageError>{
    crate::main_window(&window)?;
    crate::with_storage(app,move|m|m.store()?.bookkeeping_mutate(input)).await
}
#[tauri::command]
pub async fn bookkeeping_request(app:tauri::AppHandle,window:tauri::WebviewWindow,request_id:String)->Result<Option<Vec<Expense>>,StorageError>{
    crate::main_window(&window)?;
    crate::with_storage(app,move|m|m.store()?.bookkeeping_request(&request_id)).await
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AddReceipt { id:String, expense_id:String, name:String, media_type:String, bytes:Vec<u8> }
fn io_error(_:std::io::Error)->StorageError{StorageError::new("bookkeeping_file","票据或导出文件操作失败，输入与原件保留，请重试。")}
fn extension(media:&str)->Result<&'static str,StorageError>{match media{"image/png"=>Ok("png"),"image/jpeg"=>Ok("jpg"),"image/webp"=>Ok("webp"),"application/pdf"=>Ok("pdf"),_=>Err(bookkeeping::error("票据支持 PNG、JPEG、WebP 图片或 PDF。"))}}
fn receipt_path(root:&Path,id:&str,media:&str)->Result<PathBuf,StorageError>{
    if !bookkeeping::uuid(id){return Err(bookkeeping::error("票据编号无效。"));}
    Ok(root.join("attachments/bookkeeping").join(format!("{id}.{}",extension(media)?)))
}
#[tauri::command]
pub async fn bookkeeping_add_receipt(app:tauri::AppHandle,window:tauri::WebviewWindow,input:AddReceipt)->Result<Receipt,StorageError>{
    crate::main_window(&window)?;
    crate::with_storage(app,move|m|{
        if !bookkeeping::uuid(&input.id)||!bookkeeping::uuid(&input.expense_id)||input.name.trim().is_empty()||input.name.chars().count()>200||input.name.chars().any(|c|c.is_control()||c=='/'||c=='\\'){
            return Err(bookkeeping::error("票据名称或编号无效。"));
        }
        if input.bytes.is_empty()||input.bytes.len()>5*1024*1024{return Err(bookkeeping::error("每份票据大小需在 1 字节至 5 MB 之间。"));}
        let b=&input.bytes;
        let signature=match input.media_type.as_str(){"image/png"=>b.starts_with(b"\x89PNG\r\n\x1a\n"),"image/jpeg"=>b.starts_with(&[0xff,0xd8,0xff]),"application/pdf"=>b.starts_with(b"%PDF-"),"image/webp"=>b.len()>=12&&&b[0..4]==b"RIFF"&&&b[8..12]==b"WEBP",_=>false};
        if !signature{return Err(bookkeeping::error("票据内容与文件类型不符，请选择有效图片或 PDF。"));}
        let s=m.store()?;
        let hash=format!("{:x}",Sha256::digest(b));
        let existing:Option<(String,String,String,i64,String)>=s.db.query_row("SELECT expense_id,name,media_type,size,sha256 FROM bookkeeping_receipts WHERE id=?1",[&input.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(bookkeeping::db_error)?;
        if let Some(old)=existing{
            if old!=(input.expense_id.clone(),input.name.clone(),input.media_type.clone(),b.len() as i64,hash.clone()){return Err(bookkeeping::error("票据编号已用于不同文件，未覆盖。"));}
            let path=std::fs::canonicalize(receipt_path(&s.root,&input.id,&input.media_type)?).map_err(io_error)?;
            if !path.starts_with(&s.root)||!path.is_file()||std::fs::metadata(&path).map_err(io_error)?.len()!=b.len() as u64{return Err(bookkeeping::error("原票据副本已变化，未报告保存成功，请核对。"));}
            if format!("{:x}",Sha256::digest(std::fs::read(&path).map_err(io_error)?))!=hash{return Err(bookkeeping::error("原票据副本已变化，请保留文件并核对。"));}
            return bookkeeping::receipt(&s.db,&input.expense_id,&input.id);
        }
        let directory=s.root.join("attachments/bookkeeping");
        std::fs::create_dir_all(&directory).map_err(io_error)?;
        let canonical=std::fs::canonicalize(&directory).map_err(io_error)?;
        if !canonical.starts_with(&s.root){return Err(bookkeeping::error("票据目录不在应用数据根中，未保存。"));}
        let destination=receipt_path(&s.root,&input.id,&input.media_type)?;
        if destination.try_exists().map_err(io_error)?{
            let existing=std::fs::read(&destination).map_err(io_error)?;
            if format!("{:x}",Sha256::digest(&existing))!=hash{return Err(bookkeeping::error("已有同名票据内容不同，未覆盖。"));}
        }else{
            let mut pending=tempfile::Builder::new().prefix("receipt-pending-").tempfile_in(&directory).map_err(io_error)?;
            pending.disable_cleanup(true);
            pending.write_all(b).and_then(|_|pending.as_file().sync_all()).map_err(io_error)?;
            pending.persist_noclobber(&destination).map_err(|_|bookkeeping::error("票据无法保存，未覆盖已有文件；原件与输入保留。"))?;
        }
        s.db.execute("INSERT INTO bookkeeping_receipts(id,expense_id,name,media_type,size,sha256) VALUES(?1,?2,?3,?4,?5,?6)",params![input.id,input.expense_id,input.name,input.media_type,b.len() as i64,hash]).map_err(bookkeeping::db_error)?;
        bookkeeping::receipt(&s.db,&input.expense_id,&input.id)
    }).await
}
#[tauri::command]
pub async fn bookkeeping_open_receipt(app:tauri::AppHandle,window:tauri::WebviewWindow,expense_id:String,id:String)->Result<(),StorageError>{
    crate::main_window(&window)?;
    #[cfg(windows)]let owner=window.hwnd().map_err(|_|bookkeeping::error("无法取得主窗口。"))?.0 as isize;
    #[cfg(not(windows))]let owner=0;
    let path=crate::with_storage(app,move|m|{
        let s=m.store()?;let receipt=bookkeeping::receipt(&s.db,&expense_id,&id)?;
        let path=std::fs::canonicalize(receipt_path(&s.root,&id,&receipt.media_type)?).map_err(io_error)?;
        let directory=std::fs::canonicalize(s.root.join("attachments/bookkeeping")).map_err(io_error)?;
        if !directory.starts_with(&s.root)||!path.starts_with(&directory)||!path.is_file(){return Err(bookkeeping::error("票据副本不存在或已移动，未打开其他文件。"));}
        let expected:String=s.db.query_row("SELECT sha256 FROM bookkeeping_receipts WHERE id=?1",[&id],|r|r.get(0)).map_err(bookkeeping::db_error)?;
        if std::fs::metadata(&path).map_err(io_error)?.len()!=receipt.size as u64{return Err(bookkeeping::error("票据副本大小已变化，请保留文件并核对。"));}
        let bytes=std::fs::read(&path).map_err(io_error)?;
        if format!("{:x}",Sha256::digest(bytes))!=expected{return Err(bookkeeping::error("票据副本已被改变，请保留文件并核对。"));}
        Ok(path)
    }).await?;
    tauri::async_runtime::spawn_blocking(move||crate::native_paths::open_bookkeeping_receipt(owner,&path)).await.map_err(|_|bookkeeping::error("票据打开中断，请重试。"))?
}
fn csv_cell(value:&str)->String{
    let first=value.trim_start().chars().next();
    let safe=if first.is_some_and(|c|matches!(c,'='|'+'|'-'|'@'))||value.chars().next().is_some_and(|c|matches!(c,'\t'|'\r'|'\n')){format!("'{value}")}else{value.to_owned()};
    format!("\"{}\"",safe.replace('"',"\"\""))
}
pub(crate) fn csv(rows:&[Expense])->String{
    let mut text="\u{feff}日期,用途,金额（元）,报销状态,备注,票据数量,原币种,原币金额,人民币汇率,汇率日期,汇率来源\r\n".to_owned();
    let mut sum=0i64;
    for row in rows{
        sum+=row.amount_fen;
        let fx=row.exchange.as_ref();
        let cells=[csv_cell(&row.date),csv_cell(&row.purpose),format!("{}.{:02}",row.amount_fen/100,row.amount_fen%100),csv_cell(row.status.label()),csv_cell(&row.note),row.receipts.len().to_string(),
            fx.map(|e|e.quote.currency.clone()).unwrap_or_default(),fx.map(|e|format!("{}.{:02}",e.original_minor/100,e.original_minor%100)).unwrap_or_default(),fx.map(|e|e.quote.rate.clone()).unwrap_or_default(),fx.map(|e|e.quote.rate_date.clone()).unwrap_or_default(),fx.map(|e|csv_cell(&e.quote.source)).unwrap_or_default()];
        text.push_str(&cells.join(","));text.push_str("\r\n");
    }
    text.push_str(&format!("合计,,{}.{:02},,,,,,,,\r\n",sum/100,sum%100));text
}
#[tauri::command]
pub async fn bookkeeping_export(app:tauri::AppHandle,window:tauri::WebviewWindow,targets:Vec<Target>)->Result<Option<String>,StorageError>{
    crate::main_window(&window)?;
    #[cfg(windows)]let owner=window.hwnd().map_err(|_|bookkeeping::error("无法取得主窗口。"))?.0 as isize;
    #[cfg(not(windows))]let owner=0;
    // Freeze the checked formal records; the native picker never holds the database mutex.
    let rows=crate::with_storage(app,move|m|m.store()?.bookkeeping_export_rows(&targets)).await?;
    let text=csv(&rows);
    tauri::async_runtime::spawn_blocking(move||{
        let name=format!("AZCine-expenses-{}.csv",chrono::Utc::now().format("%Y%m%d-%H%M%S"));
        let Some(path)=crate::native_paths::choose_bookkeeping_csv(owner,name)?else{return Ok(None);};
        if path.try_exists().map_err(io_error)?{return Err(bookkeeping::error("目标文件已存在，请选择新的文件名；未覆盖原文件。"));}
        let mut pending=tempfile::Builder::new().prefix("AZCine-expenses-pending-").suffix(".csv").tempfile_in(path.parent().ok_or_else(||bookkeeping::error("导出位置无效。"))?).map_err(io_error)?;
        pending.disable_cleanup(true);pending.write_all(text.as_bytes()).and_then(|_|pending.as_file().sync_all()).map_err(io_error)?;
        pending.persist_noclobber(&path).map_err(|_|bookkeeping::error("导出文件未能保存，未覆盖已有文件；开销记录保留。"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|_|bookkeeping::error("导出中断，未报告成功；请核对目标文件。"))?
}
