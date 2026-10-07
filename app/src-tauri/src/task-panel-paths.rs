use crate::storage::StorageError;
use crate::task_panel_store::invalid;
use sha2::{Digest, Sha256};
use std::{fs, path::{Component, Path, PathBuf}};

pub(crate) fn hash(bytes:&[u8])->String { format!("{:x}",Sha256::digest(bytes)) }
pub(crate) fn portable_relative(value:&str)->bool {
    !value.is_empty() && value.len()<2048 && !value.contains(':') && !value.starts_with(['/', '\\']) &&
    value.replace('\\',"/").split('/').all(|p|!p.is_empty()&&p!=".."&&p!=".")
}
pub(crate) fn sensitive(value:&str)->bool {
    value.replace('\\',"/").split('/').any(|part| {
        let p=part.to_ascii_lowercase();
        [".git",".ssh",".aws","node_modules","target","dist",".tooling"].contains(&p.as_str()) || p==".env" || p.starts_with(".env.") ||
        ["auth.json","credentials","credentials.json","id_rsa","id_ed25519"].contains(&p.as_str()) || p.ends_with(".pem") || p.ends_with(".key")
    })
}
pub(crate) fn source_path(value:&str)->bool {
    !value.replace('\\',"/").split('/').any(|part|part.eq_ignore_ascii_case(".azcine"))
}
pub(crate) fn within_scope(relative:&str,scope:&[String])->bool {
    if !portable_relative(relative)||sensitive(relative){return false;}
    let file=relative.replace('\\',"/");
    scope.iter().any(|s|{let s=s.replace('\\',"/");s=="."||file==s||file.starts_with(&(s.trim_end_matches('/').to_string()+"/"))})
}
pub(crate) fn scoped_file(root:&Path,relative:&str,scope:&[String])->Result<PathBuf,StorageError>{
    if !within_scope(relative,scope){return Err(invalid("文件不在本次允许范围，或属于认证/工具缓存；未读取。"));}
    let canonical_root=fs::canonicalize(root).map_err(|_|invalid("仓库目录不可读。"))?;
    let candidate=canonical_root.join(relative.replace('\\',"/"));
    let canonical=fs::canonicalize(&candidate).map_err(|_|invalid("来源文件不存在或不可读。"))?;
    if !canonical.starts_with(&canonical_root)||!canonical.is_file(){return Err(invalid("路径越界、链接逃逸或不是文件，未读取。"));}
    Ok(canonical)
}
pub(crate) fn read_limited(path:&Path,limit:u64)->Result<Vec<u8>,StorageError>{
    let before=fs::metadata(path).map_err(|_|invalid("文件不存在或不可读。"))?;
    if !before.is_file()||before.len()>limit{return Err(invalid("文件过大或不是普通文件，请缩小交付范围。"));}
    use std::io::Read;
    let file=fs::File::open(path).map_err(|_|invalid("文件读取失败，原件保留。"))?;
    let mut bytes=Vec::new();file.take(limit+1).read_to_end(&mut bytes).map_err(|_|invalid("文件读取失败，原件保留。"))?;
    if bytes.len() as u64>limit{return Err(invalid("文件在读取期间增大，已停止接收。"));}
    let after=fs::metadata(path).map_err(|_|invalid("文件在读取期间改变，请重试。"))?;
    if before.len()!=after.len()||before.modified().ok()!=after.modified().ok(){return Err(invalid("文件在读取期间改变，请重新采样。"));}
    Ok(bytes)
}
pub(crate) fn protected_absolute(path:&Path,limit:u64)->Result<Vec<u8>,StorageError>{
    if !path.is_absolute()||path.components().any(|c|matches!(c,Component::ParentDir)){return Err(invalid("请选择不含上级跳转的绝对文件路径。"));}
    let canonical=fs::canonicalize(path).map_err(|_|invalid("交付文件不存在。"))?;
    if sensitive(&canonical.to_string_lossy()){return Err(invalid("认证、配置或工具缓存文件不能作为任务交付导入。"));}
    read_limited(&canonical,limit)
}
