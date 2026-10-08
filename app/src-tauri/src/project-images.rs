use std::{fs, io::{Read, Write}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::storage::{StorageError, Store};

pub const MAX_BYTES: usize = 50 * 1024 * 1024;
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectImage { pub id: String, pub name: String, pub mime_type: String, pub bytes: u64, pub hash: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageInput { pub name: String, pub bytes: Vec<u8> }
fn error(message: &str) -> StorageError { StorageError::new("project_image_invalid", message) }
fn io(_: std::io::Error) -> StorageError { StorageError::new("project_image_io", "图片副本读写失败，原文件和单元格内容保留。") }
fn format(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { Some(("image/png", "png")) }
    else if bytes.starts_with(b"\xff\xd8\xff") { Some(("image/jpeg", "jpg")) }
    else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { Some(("image/gif", "gif")) }
    else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { Some(("image/webp", "webp")) }
    else { None }
}
impl ProjectImage {
    pub fn valid(&self) -> bool {
        self.id.len() == 36 && self.id.bytes().enumerate().all(|(i,c)| if [8,13,18,23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() }) && !self.name.trim().is_empty() && self.name.chars().count() <= 200
            && matches!(self.mime_type.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/gif")
            && (1..=MAX_BYTES as u64).contains(&self.bytes) && self.hash.len() == 64 && self.hash.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    }
    fn extension(&self) -> &'static str { match self.mime_type.as_str() { "image/png" => "png", "image/jpeg" => "jpg", "image/gif" => "gif", _ => "webp" } }
}
fn directory(store: &Store) -> Result<std::path::PathBuf, StorageError> {
    for folder in [store.root.join("attachments"), store.root.join("attachments/projects")] {
        crate::pi_launch_plan::no_link(&folder).map_err(|e| StorageError::new(e.code, e.message))?;
    }
    Ok(store.root.join("attachments/projects"))
}
impl Store {
    pub fn import_project_image(&self, input: ImageInput) -> Result<ProjectImage, StorageError> {
        if input.name.trim().is_empty() || input.name.chars().count() > 200 || input.bytes.is_empty() || input.bytes.len() > MAX_BYTES { return Err(error("图片名称需为1–200字，每张图片不超过50MiB。")); }
        let (mime, extension) = format(&input.bytes).ok_or_else(|| error("仅支持PNG、JPEG、WebP和GIF图片。"))?;
        let random: String = self.db.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0)).map_err(|_| error("无法生成图片副本编号，原输入保留。"))?;
        let id = format!("{}-{}-{}-{}-{}", &random[..8], &random[8..12], &random[12..16], &random[16..20], &random[20..]);
        let image = ProjectImage { id, name: input.name, mime_type: mime.into(), bytes: input.bytes.len() as u64, hash: format!("{:x}", Sha256::digest(&input.bytes)) };
        let folder = directory(self)?; fs::create_dir_all(&folder).map_err(io)?;
        let target = folder.join(format!("{}.{}", image.id, extension));
        let mut candidate = tempfile::NamedTempFile::new_in(&folder).map_err(io)?;
        candidate.write_all(&input.bytes).map_err(io)?; candidate.as_file().sync_all().map_err(io)?;
        candidate.persist_noclobber(target).map_err(|e| io(e.error))?;
        Ok(image)
    }
    pub fn preview_project_image(&self, image: &ProjectImage) -> Result<Vec<u8>, StorageError> {
        if !image.valid() { return Err(error("图片附件引用无效，未读取其他文件。")); }
        let path = directory(self)?.join(format!("{}.{}", image.id, image.extension()));
        crate::pi_launch_plan::no_link(&path).map_err(|e| StorageError::new(e.code, e.message))?;
        let file = fs::File::open(path).map_err(io)?;
        let metadata = file.metadata().map_err(io)?;
        if !metadata.is_file() || metadata.len() != image.bytes { return Err(error("图片副本已变化或无法读取。")); }
        let mut bytes = Vec::new(); file.take(image.bytes + 1).read_to_end(&mut bytes).map_err(io)?;
        if bytes.len() as u64 != image.bytes || format(&bytes).map(|v| v.0) != Some(image.mime_type.as_str()) || format!("{:x}", Sha256::digest(&bytes)) != image.hash { return Err(error("图片副本内容未能核对。")); }
        Ok(bytes)
    }
}
#[tauri::command]
pub async fn project_import_image(app: tauri::AppHandle, window: tauri::WebviewWindow, input: ImageInput) -> Result<ProjectImage, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |manager| manager.store()?.import_project_image(input)).await
}
#[tauri::command]
pub async fn project_image_preview(app: tauri::AppHandle, window: tauri::WebviewWindow, image: ProjectImage) -> Result<Vec<u8>, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |manager| manager.store()?.preview_project_image(&image)).await
}
