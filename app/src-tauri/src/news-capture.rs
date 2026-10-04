// Retain fetched input separately from business records, including failed parse/save attempts.
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use crate::news_http::{FeedResponse, MAX_FEED_BYTES};
use crate::storage::StorageError;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header { version: u32, url: String, fetched_at: String }
fn capture_error() -> StorageError { StorageError::new("news_capture_failed", "订阅响应留存失败，未报告采集成功；已生成输入文件保留，请检查磁盘与权限。") }
pub fn path(root: &Path, run_id: &str) -> Result<PathBuf, StorageError> {
    if run_id.len() != 64 || !run_id.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) { return Err(crate::news_types::invalid_data()); }
    Ok(root.join("snapshots/news").join(format!("{run_id}.feed")))
}
pub fn write(root: &Path, run_id: &str, response: &FeedResponse) -> Result<(), StorageError> {
    let path = path(root, run_id)?;
    let parent = path.parent().ok_or_else(capture_error)?;
    fs::create_dir_all(parent).map_err(|_| capture_error())?;
    let mut pending = tempfile::Builder::new().prefix("feed-pending-").suffix(".feed").tempfile_in(parent).map_err(|_| capture_error())?;
    pending.disable_cleanup(true);
    let header = serde_json::to_vec(&Header { version: 1, url: response.url.clone(), fetched_at: response.fetched_at.clone() }).map_err(|_| capture_error())?;
    pending.write_all(&header).and_then(|_| pending.write_all(b"\n")).and_then(|_| pending.write_all(&response.body)).map_err(|_| capture_error())?;
    pending.as_file().sync_all().map_err(|_| capture_error())?;
    pending.persist_noclobber(path).map_err(|_| capture_error())?;
    Ok(())
}
pub fn read(root: &Path, run_id: &str) -> Result<FeedResponse, StorageError> {
    let path = path(root, run_id)?;
    let file = File::open(path).map_err(|_| capture_error())?;
    if file.metadata().map_err(|_| capture_error())?.len() > (MAX_FEED_BYTES + 8192) as u64 { return Err(capture_error()); }
    let mut reader = BufReader::new(file);
    let mut line = String::new(); reader.read_line(&mut line).map_err(|_| capture_error())?;
    if line.len() > 8192 { return Err(capture_error()); }
    let header: Header = serde_json::from_str(&line).map_err(|_| capture_error())?;
    if header.version != 1 || chrono::DateTime::parse_from_rfc3339(&header.fetched_at).is_err() { return Err(capture_error()); }
    crate::news_http::public_url(&header.url)?;
    let mut body = Vec::new(); reader.take((MAX_FEED_BYTES + 1) as u64).read_to_end(&mut body).map_err(|_| capture_error())?;
    if body.len() > MAX_FEED_BYTES { return Err(capture_error()); }
    Ok(FeedResponse { body, url: header.url, fetched_at: header.fetched_at })
}
