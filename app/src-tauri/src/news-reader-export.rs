use serde_json::{Value,json};
use crate::{storage::StorageError,news_editorial_types::invalid_reply,news_reader_store::{decode,db_error}};
#[tauri::command]
pub async fn news_reader_image(app:tauri::AppHandle,window:tauri::WebviewWindow,url:String)->Result<Value,StorageError>{crate::main_window(&window)?;let proxy=crate::with_storage(app,|m|Ok(m.store()?.news_preferences()?.config.collection_proxy)).await?;tauri::async_runtime::spawn_blocking(move||{let response=crate::news_http::fetch_with_proxy(&url,proxy.as_deref())?;let b=&response.body;let mime=if b.starts_with(b"\x89PNG\r\n\x1a\n"){"image/png"}else if b.starts_with(b"\xff\xd8\xff"){"image/jpeg"}else if b.starts_with(b"GIF87a")||b.starts_with(b"GIF89a"){"image/gif"}else if b.len()>12&&&b[..4]==b"RIFF"&&&b[8..12]==b"WEBP"{"image/webp"}else{return Err(StorageError::new("news_image_unsupported","配图不是受支持的图片格式，保留原文链接。"));};Ok(json!({"mime":mime,"bytes":b}))}).await.map_err(|_|invalid_reply())?}
fn edition_time(value:&Value)->String {
    let raw=value.as_str().unwrap_or_default();
    chrono::DateTime::parse_from_rfc3339(raw).map(|at|(at.with_timezone(&chrono::Utc)+chrono::Duration::hours(8)).format("%Y/%m/%d %H:%M").to_string()).unwrap_or_else(|_|raw.into())
}
pub(crate) fn saved_edition_text(store:&crate::storage::Store,id:&str)->Result<Option<String>,StorageError> {
    use rusqlite::OptionalExtension;
    let raw:Option<String>=store.db.query_row("SELECT payload FROM news_reader_editions WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
    let Some(raw)=raw else{return Ok(None);};let v:Value=decode(&raw)?;
    let version:i64=store.db.query_row("SELECT count(*) FROM news_reader_editions WHERE date=?1 AND kind=?2 AND (json_extract(payload,'$.generatedAt')<?3 OR (json_extract(payload,'$.generatedAt')=?3 AND id<=?4))",rusqlite::params![v["date"].as_str(),v["kind"].as_str(),v["generatedAt"].as_str(),id],|r|r.get(0)).map_err(db_error)?;
    let label=match v["kind"].as_str(){Some("weekly")=>"周报",Some("monthly")=>"月报",_=>"日报"};
    let mut lines=vec![format!("# {} {} · 第 {} 版",v["date"].as_str().unwrap_or_default(),label,version),format!("收录窗口：{} — {}（北京时间）",edition_time(&v["windowStart"]),edition_time(&v["windowEnd"]))];
    if let Some(overview)=v["overview"].as_str().filter(|s|!s.is_empty()){lines.push(overview.into());}
    for key in ["main","flashes"]{if let Some(entries)=v[key].as_array(){if key=="flashes"&&!entries.is_empty(){lines.push("## 快讯".into());}for a in entries{let title=a["titleZh"].as_str().unwrap_or_default();let source=a["sourceName"].as_str().unwrap_or_default();let url=a["url"].as_str().unwrap_or_default();if key=="main"{lines.push(format!("## {}\n\n{}\n\n来源：{} {}",title,a["summaryZh"].as_str().unwrap_or_default(),source,url));}else{lines.push(format!("- {}（{}）{}",title,source,url));}}}}
    if let Some(gaps)=v["gaps"].as_array().filter(|g|!g.is_empty()){lines.push("## 来源覆盖".into());lines.extend(gaps.iter().filter_map(|g|g.as_str().map(String::from)));}
    lines.push(format!("{} 生成",edition_time(&v["generatedAt"])));Ok(Some(lines.join("\n\n")))
}
#[tauri::command]
pub async fn news_reader_export(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String,kind:String)->Result<Option<String>,StorageError>{
    crate::main_window(&window)?;if !["article","edition"].contains(&kind.as_str()){return Err(invalid_reply());}let owner=crate::owner_handle(&window)?;let label=id.clone();
    let text=crate::with_storage(app,move|m|{let s=m.store()?;if kind=="article"{let a=s.reader_article(&id)?;Ok(format!("# {}\n\n{}\n\n{}\n\n原文：[{}]({})\n",a.title_zh,a.summary_zh,if a.display_body{a.translated_body.as_ref().unwrap_or(&a.original_body)}else{""},a.material.source_name,a.material.url))}else{saved_edition_text(s,&id)?.ok_or_else(||StorageError::new("news_edition_unavailable","未找到这个固定刊期，未导出其他版本。"))}}).await?;
    tauri::async_runtime::spawn_blocking(move||{use std::io::Write;let name=format!("AZCine-news-{}.md",label.chars().filter(|c|c.is_ascii_alphanumeric()||*c=='-').take(64).collect::<String>());let Some(destination)=crate::native_paths::choose_news_markdown(owner,name)?else{return Ok(None);};if destination.try_exists().map_err(|_|invalid_reply())?{return Err(StorageError::new("news_export_exists","目标文件已存在，未覆盖；请使用新的文件名。"));}let mut file=tempfile::Builder::new().prefix("AZCine-news-pending-").suffix(".md").tempfile_in(destination.parent().ok_or_else(invalid_reply)?).map_err(|_|invalid_reply())?;file.disable_cleanup(true);file.write_all(text.as_bytes()).and_then(|_|file.as_file().sync_all()).map_err(|_|StorageError::new("news_export_failed","导出文件保存失败，资讯记录保留。"))?;file.persist_noclobber(&destination).map_err(|_|StorageError::new("news_export_exists","目标文件无法保存，未覆盖已有文件。"))?;Ok(Some(destination.to_string_lossy().into_owned()))}).await.map_err(|_|invalid_reply())?
}
