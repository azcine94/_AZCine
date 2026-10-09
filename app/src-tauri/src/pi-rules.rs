use crate::{pi_launch_plan::{PiPaths,no_link},pi_manager::PiError};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::{fs::File,io::Read};
pub const SUGGESTED:&str=include_str!("../resources/APPEND_SYSTEM.md");
pub const DEFAULT_AGENTS:&str=include_str!("../resources/AGENTS.md");
/// Seed once when absent; a newer application template never replaces user rules.
pub fn provision_agents(agent:&std::path::Path)->Result<(),crate::pi_model_config::ConfigError>{
    use std::io::Write;
    let failed=||crate::pi_model_config::ConfigError{code:"pi_rules_init",message:"默认工作规则初始化失败；已有文件未覆盖。"};
    let path=agent.join("AGENTS.md");no_link(&path)?;
    if path.try_exists().map_err(|_|failed())?{return if path.is_file(){Ok(())}else{Err(failed())};}
    let mut file=tempfile::NamedTempFile::new_in(agent).map_err(|_|failed())?;
    file.write_all(DEFAULT_AGENTS.as_bytes()).and_then(|_|file.as_file().sync_all()).map_err(|_|failed())?;
    match file.persist_noclobber(&path){Ok(_)=>Ok(()),Err(e) if e.error.kind()==std::io::ErrorKind::AlreadyExists=>{no_link(&path)?;if path.is_file(){Ok(())}else{Err(failed())}},Err(_)=>Err(failed())}
}
/// Explicit, application-owned context. Do not discover ancestors or migrate APPEND_SYSTEM.
pub fn context(paths:&PiPaths)->Result<(String,Value),PiError>{
    let mut text=String::new();let mut files=Vec::new();
    for name in ["APPEND_SYSTEM.md","AGENTS.md"]{
        let path=paths.agent.join(name);
        let content=crate::self_evolution::text_file(&path).map_err(|e|PiError::new(e.code,&e.message))?;
        if let Some(content)=content{
            if !content.trim().is_empty(){text.push_str(&format!("\n# Context file: {name}\n{content}\n"));}
            files.push(json!({"path":path,"hash":format!("{:x}",Sha256::digest(content.as_bytes())),"status":if content.trim().is_empty(){"empty"}else{"loaded"}}));
        }
    }
    Ok((text,json!({"status":if files.is_empty(){"missing"}else{"loaded"},"files":files,"loadedAt":chrono::Utc::now().to_rfc3339()})))
}
pub fn read(paths:&PiPaths)->Result<(String,Value),PiError>{
    let path=paths.agent.join("APPEND_SYSTEM.md");no_link(&path)?;
    let file=match File::open(&path){Ok(f)=>f,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(("\n".into(),json!({"status":"missing","path":path,"hash":null}))),Err(_)=>return Err(PiError::new("pi_rules_read","自定义工作规则无法读取；未忽略规则继续连接。"))};
    if !file.metadata().is_ok_and(|m|m.is_file()&&m.len()<=128*1024){return Err(PiError::new("pi_rules_limit","自定义工作规则不是普通文件或超过128KiB，未截断加载。"));}
    let mut bytes=Vec::new();file.take(128*1024+1).read_to_end(&mut bytes).map_err(|_|PiError::new("pi_rules_read","自定义工作规则读取失败。"))?;
    if bytes.len()>128*1024{return Err(PiError::new("pi_rules_limit","自定义工作规则超过128KiB，未截断加载。"));}
    let hash=format!("{:x}",Sha256::digest(&bytes));
    // Retire only the exact old application-supplied template. A user's edits
    // have another digest and remain verbatim. Keep the old bytes outside Pi's
    // automatic resource discovery for recovery and handoff.
    if format!("{:x}",Sha256::digest(String::from_utf8_lossy(&bytes).replace("\r\n","\n").as_bytes()))=="aa2144024e93d1088f5a3a9824ca5146f56f9fd9050f9b263b8f00733e893e9f"{
        use std::io::Write;
        let directory=paths.pi_root.join("retired-rules");no_link(&directory)?;std::fs::create_dir_all(&directory).map_err(|_|PiError::new("pi_rules_retire","旧业务规则无法保留，未继续加载冲突规则。"))?;
        let backup=directory.join(format!("APPEND_SYSTEM-{hash}.md"));no_link(&backup)?;
        if !backup.exists(){let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&backup).map_err(|_|PiError::new("pi_rules_retire","旧业务规则备份失败。"))?;file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|PiError::new("pi_rules_retire","旧业务规则备份未完成。"))?;}
        else if std::fs::read(&backup).map_err(|_|PiError::new("pi_rules_retire","旧规则备份无法读取。"))?!=bytes{return Err(PiError::new("pi_rules_retire","旧规则备份冲突，未覆盖。"));}
        if std::fs::read(&path).map_err(|_|PiError::new("pi_rules_retire","规则已发生变化，未清理。"))?!=bytes{return Err(PiError::new("pi_rules_retire","规则已被本人修改，未覆盖，请重连。"));}
        let mut replacement=tempfile::NamedTempFile::new_in(&paths.agent).map_err(|_|PiError::new("pi_rules_retire","规则清理临时文件无法准备。"))?;
        replacement.write_all(b"").and_then(|_|replacement.as_file().sync_all()).map_err(|_|PiError::new("pi_rules_retire","旧规则清理失败。"))?;
        replacement.persist(&path).map_err(|_|PiError::new("pi_rules_retire","旧规则清理失败，原文件保留。"))?;
        return Ok((String::new(),json!({"status":"retired","path":path,"hash":null,"backup":backup})));
    }
    let content=String::from_utf8(bytes).map_err(|_|PiError::new("pi_rules_encoding","自定义规则不是UTF-8，未加载或覆盖。"))?;
    if content.trim().is_empty(){return Ok((String::new(),json!({"status":"empty","path":path,"hash":hash})));}
    // Literal text snapshot avoids a concurrent edit between hashing and Pi read.
    // A newline also prevents text from being mistaken for a filesystem path.
    Ok((format!("{content}\n"),json!({"status":"loaded","path":path,"hash":hash,"loadedAt":chrono::Utc::now().to_rfc3339()})))
}
