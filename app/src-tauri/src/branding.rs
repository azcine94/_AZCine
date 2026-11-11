// Custom brand logo stored inside the data root (branding/), so it follows a
// root migration like other user data. Only the main window may change it.
use crate::storage::StorageError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

const DIRECTORY: &str = "branding";
const METADATA: &str = "logo.json";
const MAX_BYTES: usize = 1024 * 1024;

fn error(message: &str) -> StorageError { StorageError::new("branding", message) }
fn io_error(_: std::io::Error) -> StorageError { error("品牌 Logo 文件读写失败，原设置保留，请检查数据目录权限后重试。") }

/// Display options kept next to the file; `scale` is a percentage of the sidebar's 56px lockup height.
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Options { #[serde(default)] pub invert_dark: bool, #[serde(default)] pub invert_light: bool, #[serde(default = "default_scale")] pub scale: u32 }
fn default_scale() -> u32 { 100 }
const SCALES: [u32; 4] = [75, 100, 125, 150];

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Metadata { version: u32, file: String, media_type: String, name: String, size: u64, sha256: String, #[serde(flatten)] options: Options }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Logo { pub media_type: String, pub name: String, pub bytes: Vec<u8>, #[serde(flatten)] pub options: Options }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLogo { name: String, media_type: String, bytes: Vec<u8>, #[serde(flatten)] options: Options }

fn check_options(options: Options) -> Result<Options, StorageError> {
    if !SCALES.contains(&options.scale) { return Err(error("Logo 尺寸档位无效。")); }
    Ok(options)
}

fn extension(media: &str) -> Result<&'static str, StorageError> {
    match media { "image/png" => Ok("png"), "image/jpeg" => Ok("jpg"), "image/webp" => Ok("webp"), "image/svg+xml" => Ok("svg"), _ => Err(error("品牌 Logo 支持 PNG、JPEG、WebP 或 SVG。")) }
}
fn signature(media: &str, b: &[u8]) -> bool {
    match media {
        "image/png" => b.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => b.starts_with(&[0xff, 0xd8, 0xff]),
        "image/webp" => b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP",
        "image/svg+xml" => std::str::from_utf8(b).is_ok_and(|text| text.trim_start().starts_with('<') && text.contains("<svg")),
        _ => false,
    }
}
fn directory(root: &Path) -> Result<PathBuf, StorageError> {
    let directory = root.join(DIRECTORY);
    std::fs::create_dir_all(&directory).map_err(io_error)?;
    let canonical = std::fs::canonicalize(&directory).map_err(io_error)?;
    if !canonical.starts_with(root) { return Err(error("品牌目录不在应用数据根中，未保存。")); }
    Ok(canonical)
}
fn read_metadata(directory: &Path) -> Result<Option<Metadata>, StorageError> {
    let path = directory.join(METADATA);
    if !path.try_exists().map_err(io_error)? { return Ok(None); }
    let text = std::fs::read_to_string(&path).map_err(io_error)?;
    let metadata: Metadata = serde_json::from_str(&text).map_err(|_| error("品牌 Logo 设置文件无法读取，请重新选择图片或恢复默认。"))?;
    if metadata.version != 1 || metadata.file.contains(|c: char| c == '/' || c == '\\') || metadata.file.starts_with('.') { return Err(error("品牌 Logo 设置文件无效，请重新选择图片或恢复默认。")); }
    Ok(Some(metadata))
}
fn write_metadata(directory: &Path, metadata: &Metadata) -> Result<(), StorageError> {
    let text = serde_json::to_string_pretty(metadata).map_err(|_| error("品牌 Logo 设置无法编码。"))?;
    let mut pending = tempfile::Builder::new().prefix("logo-pending-").suffix(".json").tempfile_in(directory).map_err(io_error)?;
    pending.write_all(text.as_bytes()).and_then(|_| pending.as_file().sync_all()).map_err(io_error)?;
    pending.persist(directory.join(METADATA)).map_err(|_| error("品牌 Logo 设置未能保存，原设置保留。"))?;
    Ok(())
}
fn load(directory: &Path, metadata: &Metadata) -> Result<Logo, StorageError> {
    let path = directory.join(&metadata.file);
    let bytes = std::fs::read(&path).map_err(|_| error("品牌 Logo 图片文件缺失，请重新选择图片或恢复默认。"))?;
    if bytes.len() as u64 != metadata.size || format!("{:x}", Sha256::digest(&bytes)) != metadata.sha256 { return Err(error("品牌 Logo 图片文件已被改变，请重新选择图片或恢复默认。")); }
    Ok(Logo { media_type: metadata.media_type.clone(), name: metadata.name.clone(), bytes, options: metadata.options })
}
pub(crate) fn current(root: &Path) -> Result<Option<Logo>, StorageError> {
    let directory = directory(root)?;
    match read_metadata(&directory)? { Some(metadata) => load(&directory, &metadata).map(Some), None => Ok(None) }
}

#[tauri::command]
pub async fn branding_logo(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<Logo>, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, |m| current(&m.store()?.root)).await
}
#[tauri::command]
pub async fn branding_save_logo(app: tauri::AppHandle, window: tauri::WebviewWindow, input: SaveLogo) -> Result<Logo, StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, move |m| {
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 200 || name.chars().any(|c| c.is_control()) { return Err(error("图片文件名无效。")); }
        if input.bytes.is_empty() || input.bytes.len() > MAX_BYTES { return Err(error("品牌 Logo 大小需在 1 字节至 1 MB 之间。")); }
        let extension = extension(&input.media_type)?;
        let options = check_options(input.options)?;
        if !signature(&input.media_type, &input.bytes) { return Err(error("图片内容与文件类型不符，请选择有效的 PNG、JPEG、WebP 或 SVG。")); }
        let directory = directory(&m.store()?.root)?;
        let previous = read_metadata(&directory).ok().flatten();
        let hash = format!("{:x}", Sha256::digest(&input.bytes));
        let file = format!("logo-{}.{extension}", &hash[..16]);
        let destination = directory.join(&file);
        if !destination.try_exists().map_err(io_error)? {
            let mut pending = tempfile::Builder::new().prefix("logo-pending-").tempfile_in(&directory).map_err(io_error)?;
            pending.write_all(&input.bytes).and_then(|_| pending.as_file().sync_all()).map_err(io_error)?;
            pending.persist_noclobber(&destination).map_err(|_| error("品牌 Logo 图片未能保存，原设置保留。"))?;
        }
        let metadata = Metadata { version: 1, file: file.clone(), media_type: input.media_type.clone(), name: name.to_owned(), size: input.bytes.len() as u64, sha256: hash, options };
        write_metadata(&directory, &metadata)?;
        // The replaced copy is only removed after the new settings are durable.
        if let Some(previous) = previous { if previous.file != file { let _ = std::fs::remove_file(directory.join(previous.file)); } }
        Ok(Logo { media_type: input.media_type, name: name.to_owned(), bytes: input.bytes, options })
    }).await
}
#[tauri::command]
pub async fn branding_logo_options(app: tauri::AppHandle, window: tauri::WebviewWindow, options: Options) -> Result<Option<Logo>, StorageError> {
    crate::main_window(&window)?;
    let options = check_options(options)?;
    crate::with_storage(app, move |m| {
        let directory = directory(&m.store()?.root)?;
        let Some(mut metadata) = read_metadata(&directory)? else { return Ok(None); };
        let logo = load(&directory, &metadata)?;
        metadata.options = options;
        write_metadata(&directory, &metadata)?;
        Ok(Some(Logo { options, ..logo }))
    }).await
}
#[tauri::command]
pub async fn branding_clear_logo(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), StorageError> {
    crate::main_window(&window)?;
    crate::with_storage(app, |m| {
        let directory = directory(&m.store()?.root)?;
        let Some(metadata) = read_metadata(&directory).ok().flatten() else {
            let path = directory.join(METADATA);
            if path.try_exists().map_err(io_error)? { std::fs::remove_file(path).map_err(io_error)?; }
            return Ok(());
        };
        std::fs::remove_file(directory.join(METADATA)).map_err(io_error)?;
        let _ = std::fs::remove_file(directory.join(metadata.file));
        Ok(())
    }).await
}
