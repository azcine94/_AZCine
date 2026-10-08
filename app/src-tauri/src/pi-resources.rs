//! Resource previews and native configuration edits; no model calls or factories.
use crate::{pi_launch_plan::{PiPaths,RuntimePaths,no_link},pi_manager::PiError,pi_rpc::RpcProcess};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::{fs,io::Write,path::{Path,PathBuf},time::Duration};

/// Explicitly requested skill in the ordinary app-owned resource directory.
/// Keep user edits, and remember installation so removal stays removed.
pub fn provision_task_refinement(pi_root:&Path,agent:&Path)->Result<(),crate::pi_model_config::ConfigError>{
    use crate::pi_model_config::ConfigError;
    let failed=||ConfigError{code:"pi_task_skill_install",message:"任务细化 Skill 安装未完成，已有资源保留。"};
    let marker=pi_root.join("task-refine-installed");no_link(&marker)?;
    if marker.try_exists().map_err(|_|failed())?{return Ok(());}
    let directory=agent.join("skills").join("task-refine");no_link(&directory)?;
    fs::create_dir_all(&directory).map_err(|_|failed())?;
    let path=directory.join("SKILL.md");no_link(&path)?;
    let publish=|parent:&Path,target:&Path,bytes:&[u8]|->Result<(),ConfigError>{
        let mut file=tempfile::NamedTempFile::new_in(parent).map_err(|_|failed())?;
        file.write_all(bytes).map_err(|_|failed())?;file.as_file().sync_all().map_err(|_|failed())?;
        match file.persist_noclobber(target){Ok(_)=>Ok(()),Err(e) if e.error.kind()==std::io::ErrorKind::AlreadyExists=>Ok(()),Err(_)=>Err(failed())}
    };
    if !path.try_exists().map_err(|_|failed())?{publish(&directory,&path,include_bytes!("../../resources/skills/task-refine/SKILL.md"))?;}
    if !path.is_file(){return Err(failed());}
    publish(pi_root,&marker,b"1\n")
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ResourceUpdate { pub generation:u64,pub id:String,pub hash:Option<String>,pub content:Option<String>,pub enabled:Option<bool> }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ResourceIndex { pub generation:u64,pub connected:bool,pub agent_dir:String,pub cwd:String,pub entries:Vec<Value>,pub diagnostics:Vec<String>,pub settings_hash:Option<String>,#[serde(skip)] pub settings_document:Value }
fn error()->PiError{PiError::new("pi_resources_read","无法读取原版 Pi 资源，请检查资源配置、文件权限和运行环境；已有内容与草稿保留。")}
fn conflict()->PiError{PiError::new("pi_resource_conflict","资源已被其他操作修改，未覆盖；请保留草稿，重新读取后核对。")}
fn bridge(runtime:&RuntimePaths,paths:&PiPaths,cwd:&Path,command:&str,input:Value)->Result<Value,PiError>{
    let windows=std::env::var_os("SystemRoot").map(PathBuf::from).ok_or_else(error)?;
    let env=paths.environment(runtime,&windows,&[])?;
    let args=vec!["--no-global-search-paths".into(),"--input-type=module".into(),"--eval".into(),include_str!("../resources/pi-resource-inspector.mjs").into()];
    let process=RpcProcess::spawn(&runtime.node,&args,cwd,&env,|_|{})?;
    let reply=process.request(command,json!({"input":input}),Duration::from_secs(15));
    let stopped=process.shutdown(Duration::from_secs(3));
    let reply=reply?;stopped?;
    if reply["success"]!=true{return Err(if reply["errorCode"]=="conflict"{conflict()}else{error()});}
    Ok(reply["data"].clone())
}
pub fn inspect(runtime:&RuntimePaths,paths:&PiPaths,cwd:&Path,generation:u64,commands:Value,connected:bool)->Result<ResourceIndex,PiError>{
    let mut data=bridge(runtime,paths,cwd,"resources",json!({"package":runtime.package,"agent":paths.agent,"cwd":cwd,"commands":commands}))?;
    let append=paths.agent.join("APPEND_SYSTEM.md");
    if let Some(entries)=data["entries"].as_array_mut(){if !entries.iter().any(|e|e["path"].as_str().is_some_and(|p|Path::new(p)==append))&&!append.exists(){entries.push(json!({"id":format!("rule:{}",append.display()),"kind":"rule","name":"APPEND_SYSTEM.md","path":append,"description":"可选的个人工作规则；保存后下次连接全文追加，业务能力由 MCP 提供。","content":crate::pi_rules::SUGGESTED,"hash":null,"editable":true,"enabled":true,"loaded":false,"toggleable":false,"error":null,"commands":[]}));}}
    Ok(ResourceIndex {generation,connected,agent_dir:paths.agent.to_string_lossy().into_owned(),cwd:cwd.to_string_lossy().into_owned(),
        entries:data["entries"].as_array().cloned().ok_or_else(error)?,diagnostics:data["diagnostics"].as_array().ok_or_else(error)?.iter().map(|v|v.as_str().map(str::to_owned).ok_or_else(error)).collect::<Result<_,_>>()?,
        settings_hash:data["settingsHash"].as_str().map(str::to_owned),settings_document:data["settingsDocument"].clone()})
}
fn checked_file(paths:&PiPaths,path:&Path)->Result<(),PiError>{
    let workspaces=paths.pi_root.join("workspaces");
    if !path.is_absolute()||path.components().any(|c|matches!(c,std::path::Component::ParentDir)){return Err(error());}
    let mut cursor=PathBuf::new();for part in path.components(){cursor.push(part);if matches!(part,std::path::Component::Normal(_)){no_link(&cursor)?;}}
    let parent=fs::canonicalize(path.parent().ok_or_else(error)?).map_err(|_|error())?;
    if !parent.starts_with(&paths.agent)&&!parent.starts_with(workspaces){return Err(error());}Ok(())
}
fn file_hash(path:&Path)->Result<Option<String>,PiError>{
    match fs::read(path){Ok(bytes)=>Ok(Some(format!("{:x}",Sha256::digest(bytes)))),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(None),Err(_)=>Err(error())}
}
fn save_file(paths:&PiPaths,path:&Path,expected:Option<&str>,content:&str)->Result<(),PiError>{
    checked_file(paths,path)?;
    if content.len()>128*1024{return Err(PiError::new("pi_resource_size","内容超过 128 KB，未保存；草稿保留。"));}
    if file_hash(path)?.as_deref()!=expected{return Err(conflict());}
    let parent=path.parent().ok_or_else(error)?;
    let mut temp=tempfile::NamedTempFile::new_in(parent).map_err(|_|error())?;
    temp.write_all(content.as_bytes()).map_err(|_|error())?;temp.as_file().sync_all().map_err(|_|error())?;
    checked_file(paths,path)?;
    if file_hash(path)?.as_deref()!=expected{return Err(conflict());}
    if expected.is_some(){temp.persist(path).map_err(|_|error())?;}else{temp.persist_noclobber(path).map_err(|_|conflict())?;}
    Ok(())
}
pub fn update(runtime:&RuntimePaths,paths:&PiPaths,index:&ResourceIndex,input:&ResourceUpdate)->Result<(),PiError>{
    if input.generation!=index.generation{return Err(conflict());}
    let entry=index.entries.iter().find(|item|item["id"].as_str()==Some(input.id.as_str())).ok_or_else(error)?;
    if let Some(content)=&input.content{
        if input.enabled.is_some()||entry["editable"]!=true||!matches!(entry["kind"].as_str(),Some("rule"|"skill")){return Err(error());}
        save_file(paths,Path::new(entry["path"].as_str().ok_or_else(error)?),input.hash.as_deref(),content)?;
    }else if let Some(enabled)=input.enabled{
        if entry["toggleable"]!=true||entry["kind"]!="extension"{return Err(error());}
        if input.hash!=index.settings_hash{return Err(conflict());}
        let path=entry["path"].as_str().ok_or_else(error)?;
        let mut settings=index.settings_document.clone();
        if !settings.is_object(){return Err(error());}
        let mut extensions=settings.get("extensions").and_then(Value::as_array).cloned().unwrap_or_default();
        extensions.retain(|item|item.as_str().is_none_or(|s|{
            if !(s.starts_with('+')||s.starts_with('-')||s.starts_with('!')){return true;}
            let raw=&s[1..];if raw==path{return false;}
            if raw.starts_with("builtin:"){return true;}
            let candidate=if Path::new(raw).is_absolute(){PathBuf::from(raw)}else{paths.agent.join(raw)};
            match (fs::canonicalize(candidate),fs::canonicalize(path)){(Ok(a),Ok(b))=>a!=b,_=>true}
        }));
        extensions.push(json!(format!("{}{}",if enabled{"+"}else{"-"},path)));
        settings["extensions"]=json!(extensions);
        let text=serde_json::to_string_pretty(&settings).map_err(|_|error())?;
        // Let the original SDK acquire its native cross-process settings lock.
        // The compare happens inside that lock, preserving concurrent Pi edits.
        let result=bridge(runtime,paths,Path::new(&index.cwd),"save_extensions",json!({"package":runtime.package,"agent":paths.agent,"cwd":index.cwd,"hash":input.hash,"document":text+"\n"}))?;
        if result["saved"]!=true{return Err(error());}
    }else{return Err(error());}
    Ok(())
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn owned_verbatim_windows_rule_path_can_be_created_and_conflicting_save_preserves_it(){let base=std::env::var_os("AZCINE_PI_CONFIG_TEST_ROOT").map(PathBuf::from).unwrap_or_else(||PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation/agent-resource-tests"));std::fs::create_dir_all(&base).unwrap();let root=tempfile::Builder::new().prefix("rules-").tempdir_in(base).unwrap().keep();let paths=PiPaths::prepare(&root).unwrap();let file=paths.agent.join("APPEND_SYSTEM.md");save_file(&paths,&file,None,"保留默认系统提示").unwrap();assert_eq!(std::fs::read_to_string(&file).unwrap(),"保留默认系统提示");assert_eq!(save_file(&paths,&file,None,"旧版本覆盖").unwrap_err().code,"pi_resource_conflict");assert_eq!(std::fs::read_to_string(&file).unwrap(),"保留默认系统提示");}
}
