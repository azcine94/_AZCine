//! Resolve only bundled application resources, never PATH or another Pi.
use crate::{pi_launch_plan::{RuntimePaths,no_link},pi_model_config::ConfigError};
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{fs::File,io::Read,path::{Path,PathBuf}};
const LOCK:&str=include_str!("../../resources/runtime-lock.json");
pub fn versions()->Value {
    let lock:Value=serde_json::from_str(LOCK).unwrap_or(Value::Null);
    serde_json::json!({"piVersion":lock["piVersion"],"nodeVersion":lock["nodeVersion"]})
}
fn invalid()->ConfigError{ConfigError{code:"pi_runtime_incomplete",message:"本应用的独立原版 Pi 运行资源缺失或校验不符，未调用系统其他 Pi。请完成应用运行资源准备后重试；输入仍保留。"}}
fn checksum(path:&Path)->Result<String,ConfigError>{let mut file=File::open(path).map_err(|_|invalid())?;let mut hash=Sha256::new();let mut buffer=[0u8;65536];loop{let n=file.read(&mut buffer).map_err(|_|invalid())?;if n==0{break;}hash.update(&buffer[..n]);}Ok(format!("{:x}",hash.finalize()))}
pub fn resolve(resource_dir:&Path)->Result<RuntimePaths,ConfigError>{
    let lock:Value=serde_json::from_str(LOCK).map_err(|_|invalid())?;
    let directory=lock["directory"].as_str().ok_or_else(invalid)?;
    #[cfg(debug_assertions)]
    let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/runtime").join(directory);
    #[cfg(not(debug_assertions))]
    let root=resource_dir.join("runtime").join(directory);
    let _=resource_dir;
    no_link(&root)?;
    let manifest=root.join("runtime-manifest.json");no_link(&manifest)?;
    let file=File::open(manifest).map_err(|_|invalid())?;
    if file.metadata().map_err(|_|invalid())?.len()>65536{return Err(invalid());}
    let manifest:Value=serde_json::from_reader(file).map_err(|_|invalid())?;
    if manifest["version"]!=1||manifest["piVersion"]!=lock["piVersion"]||manifest["nodeVersion"]!=lock["nodeVersion"]{return Err(invalid());}
    let runtime=RuntimePaths::at(&root)?;
    for name in ["node","pi","packageLock"]{
        let relative=lock[name].as_str().ok_or_else(invalid)?;
        if manifest[name]!=lock[name] || manifest["entrySha256"][name]!=lock["entrySha256"][name]{return Err(invalid());}
        let path=root.join(relative);let mut cursor=root.clone();for component in Path::new(relative).components(){cursor.push(component);no_link(&cursor)?;}
        if checksum(&path)?!=lock["entrySha256"][name].as_str().ok_or_else(invalid)?{return Err(invalid());}
    }
    // Complete byte/dependency validation occurs at controlled installation. This
    // startup guard checks immutable entrypoints and exact wrapper lock, not a
    // claim that OS-level tampering with every dependency is sandboxed.
    Ok(runtime)
}
