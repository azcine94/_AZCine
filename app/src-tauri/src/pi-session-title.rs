//! Provision the one extension explicitly requested by the user. Upstream Pi stays untouched.
use crate::pi_model_config::ConfigError;
use std::{fs,io::Write,path::Path};
const SOURCE:&str=include_str!("../../resources/agent-extensions/auto-session-title.ts");
fn failed()->ConfigError{ConfigError{code:"pi_title_extension_install",message:"自动会话标题扩展未能完整安装，现有资源和输入保留。"}}
fn publish(directory:&Path,path:&Path,bytes:&[u8])->Result<(),ConfigError>{
    let mut file=tempfile::NamedTempFile::new_in(directory).map_err(|_|failed())?;
    file.write_all(bytes).map_err(|_|failed())?;file.as_file().sync_all().map_err(|_|failed())?;
    match file.persist_noclobber(path){Ok(_)=>Ok(()),Err(error) if error.error.kind()==std::io::ErrorKind::AlreadyExists=>Ok(()),Err(_)=>Err(failed())}
}
pub fn provision(pi_root:&Path,agent:&Path)->Result<(),ConfigError>{
    let marker=pi_root.join("auto-session-title-installed");crate::pi_launch_plan::no_link(&marker)?;
    if marker.try_exists().map_err(|_|failed())?{return Ok(());}
    let directory=agent.join("extensions");let path=directory.join("auto-session-title.ts");crate::pi_launch_plan::no_link(&path)?;
    // Existing user edits win. A removed extension stays removed after the first installation.
    if !path.try_exists().map_err(|_|failed())?{publish(&directory,&path,SOURCE.as_bytes())?;}
    if fs::metadata(&path).map_err(|_|failed())?.is_dir(){return Err(failed());}
    publish(pi_root,&marker,b"1\n")
}
