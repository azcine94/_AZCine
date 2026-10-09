//! One model catalog per owned data root. Never cache credentials or hold a
//! configuration lease while the native SDK builds its available-model list.
use crate::{pi_manager::PiError,pi_launch_plan::{PiPaths,no_link},pi_config_lock::ConfigLease,pi_config_store::ConfigStore};
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{collections::HashMap,fs,io::Read,path::{Path,PathBuf},sync::{Arc,Mutex,OnceLock},time::{Duration,Instant}};
const FILES:[&str;4]=["models.json","auth.json","settings.json","models-store.json"];
#[derive(Default)]struct Entry{stamp:Vec<Option<Vec<u8>>>,result:Option<Result<Value,PiError>>,at:Option<Instant>}
type Entries=Mutex<HashMap<PathBuf,Arc<Mutex<Entry>>>>;
fn error()->PiError{PiError::new("pi_catalog_read","无法读取本机模型配置，已有列表和任务保留。")}
fn bytes(path:&Path)->Result<Option<Vec<u8>>,PiError>{
    no_link(path)?;let file=match fs::File::open(path){Ok(file)=>file,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(_)=>return Err(error())};
    let mut out=Vec::new();file.take(8*1024*1024+1).read_to_end(&mut out).map_err(|_|error())?;
    if out.len()>8*1024*1024{return Err(error());}Ok(Some(out))
}
fn stamp(agent:&Path)->Result<Vec<Option<Vec<u8>>>,PiError>{FILES.iter().map(|name|Ok(bytes(&agent.join(name))?.map(|value|Sha256::digest(value).to_vec()))).collect()}
pub fn read(root:&Path,resources:&Path)->Result<Value,PiError>{
    static ENTRIES:OnceLock<Entries>=OnceLock::new();
    let paths=PiPaths::prepare(root)?;
    let entry=ENTRIES.get_or_init(Default::default).lock().map_err(|_|error())?.entry(paths.agent.clone()).or_default().clone();
    let mut entry=entry.lock().map_err(|_|error())?;
    let current=stamp(&paths.agent)?;
    if entry.stamp==current{if let Some(result)=&entry.result{if result.is_ok()||entry.at.is_some_and(|at|at.elapsed()<Duration::from_millis(500)){return result.clone();}}}
    let stage=|name:&str,e:PiError|PiError::new(e.code,&format!("获取模型选项 · {name}：{}",e.message));
    let result=(||{
        let runtime=crate::pi_runtime::resolve(resources)?;
        for _ in 0..3{
            let snapshot=tempfile::Builder::new().prefix("catalog-").tempdir_in(&paths.temp).map_err(|_|error())?;
            let (snapshot_stamp,redactor)={
                let lease=ConfigLease::acquire_catalog_wait(&paths,&runtime).map_err(|e|stage("等待配置快照",e))?;
                let docs=ConfigStore::open(&paths.root)?.private_documents()?;
                let mut fingerprint=Vec::new();
                for name in FILES{let value=bytes(&paths.agent.join(name))?;fingerprint.push(value.as_ref().map(|value|Sha256::digest(value).to_vec()));if let Some(value)=value{fs::write(snapshot.path().join(name),value).map_err(|_|error())?;}}
                lease.check()?;
                (fingerprint,crate::pi_redactor::Redactor::from_documents(&docs[0],&docs[1]))
            }; // Release the shared-root lock before SDK initialization.
            let mut isolated=paths.clone();isolated.agent=snapshot.path().to_path_buf();
            let models=crate::pi_resources::models(&runtime,&isolated).map_err(|e|stage("读取本机模型目录",e))?;
            if stamp(&paths.agent)?==snapshot_stamp{return Ok((snapshot_stamp,redactor.value(models,false)));}
        }
        Err(PiError::new("pi_catalog_changed","模型配置持续变化，本次列表未发布；请稍后刷新。"))
    })();
    match result{
        Ok((stamp,value))=>{entry.stamp=stamp;entry.result=Some(Ok(value.clone()));entry.at=Some(Instant::now());Ok(value)},
        Err(error)=>{entry.stamp=current;entry.result=Some(Err(error.clone()));entry.at=Some(Instant::now());Err(error)},
    }
}
