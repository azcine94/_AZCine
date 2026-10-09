use crate::{pi_launch_plan::{PiPaths,RuntimePaths,no_link},pi_rpc::RpcProcess,pi_manager::PiError};
use serde_json::{json,Value};
use std::{fs::File,path::PathBuf,time::Duration};
const NAMES: [&str;4] = ["models.json","auth.json","settings.json","models-store.json"];
pub struct ConfigLease { process:RpcProcess, directories:Vec<File>, _permit:Option<RootPermit> }
struct RootPermit(PathBuf);
type Gates=(std::sync::Mutex<std::collections::HashSet<PathBuf>>,std::sync::Condvar);
fn gates()->&'static Gates{static GATES:std::sync::OnceLock<Gates>=std::sync::OnceLock::new();GATES.get_or_init(||Default::default())}
impl Drop for RootPermit{fn drop(&mut self){let (state,changed)=gates();if let Ok(mut state)=state.lock(){state.remove(&self.0);changed.notify_all();}}}
fn lost()->PiError{PiError::new("pi_config_lock_lost","配置锁已中断，未确认操作成功；已有模型目录和输入保留。请稍后重试读取，保存前先核对原配置。")}
fn response(value:&Value)->Result<(),PiError>{
    if value["success"]==true{return Ok(());}
    Err(match value["errorCode"].as_str(){
        Some("busy")=>PiError::new("pi_config_busy","Agent 正在更新配置或认证；输入保留，请稍后重试。异常退出留下的临时锁会在过期后重试获取，不要手动删除使用中的锁。"),
        Some("lost")=>lost(),
        Some("permission")=>PiError::new("pi_config_permission","无法访问 Agent 配置锁，请检查数据目录的读写权限；已有配置和输入保留。"),
        _=>PiError::new("pi_config_lock_io","Pi 配置锁的文件系统操作失败，请检查目录是否可用及同步状态后重试；已有配置和输入保留。"),
    })
}
#[cfg(windows)]
fn pin_directory(path:&std::path::Path)->Result<File,PiError>{
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{FILE_FLAG_BACKUP_SEMANTICS,FILE_LIST_DIRECTORY,FILE_READ_ATTRIBUTES,FILE_SHARE_READ,FILE_SHARE_WRITE};
    no_link(path)?;
    // No FILE_SHARE_DELETE: a native stale-lock remover (or sync client) cannot
    // replace this directory while Rust is reading/writing protected config.
    // Attribute-only opens do not participate in Windows sharing checks.
    std::fs::OpenOptions::new().access_mode(FILE_LIST_DIRECTORY.0|FILE_READ_ATTRIBUTES.0)
        .share_mode(FILE_SHARE_READ.0|FILE_SHARE_WRITE.0).custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0)
        .open(path).map_err(|e|if e.kind()==std::io::ErrorKind::PermissionDenied{
            PiError::new("pi_config_permission","无法保护 Pi 配置锁，请检查目录权限；未写入配置，输入保留。")
        }else{lost()})
}
impl ConfigLease {
    /// Coordinate application readers/writers per root, then cooperate with native Pi locks.
    /// Only configuration work waits here; model execution never holds this permit.
    pub fn acquire_wait(paths:&PiPaths,runtime:&RuntimePaths)->Result<Self,PiError>{Self::wait(paths,runtime,false)}
    pub fn acquire_catalog_wait(paths:&PiPaths,runtime:&RuntimePaths)->Result<Self,PiError>{Self::wait(paths,runtime,true)}
    fn wait(paths:&PiPaths,runtime:&RuntimePaths,catalog:bool)->Result<Self,PiError>{
        let end=std::time::Instant::now()+Duration::from_secs(10);
        let (state,changed)=gates();
        let interrupted=||PiError::new("pi_config_lock_lost","配置读取协调中断，请重试；已有任务不受影响。");
        let timeout=||PiError::new("pi_config_busy","配置仍在更新，等待超过10秒；已有任务继续运行，请稍后重试。");
        let mut state=state.lock().map_err(|_|interrupted())?;
        while state.contains(&paths.agent){
            let remaining=end.checked_duration_since(std::time::Instant::now()).ok_or_else(timeout)?;
            state=changed.wait_timeout(state,remaining).map_err(|_|interrupted())?.0;
        }
        state.insert(paths.agent.clone());drop(state);
        let permit=RootPermit(paths.agent.clone());
        loop{match Self::acquire_inner(paths,runtime,catalog){
            Ok(mut lease)=>{lease._permit=Some(permit);return Ok(lease);},
            Err(e) if e.code=="pi_config_busy"=>{if std::time::Instant::now()>=end{return Err(timeout());}std::thread::sleep(Duration::from_millis(50));},
            Err(e)=>return Err(e),
        }}
    }
    pub fn acquire(paths:&PiPaths,runtime:&RuntimePaths)->Result<Self,PiError>{
        Self::acquire_inner(paths,runtime,false)
    }
    pub fn acquire_catalog(paths:&PiPaths,runtime:&RuntimePaths)->Result<Self,PiError>{
        Self::acquire_inner(paths,runtime,true)
    }
    fn acquire_inner(paths:&PiPaths,runtime:&RuntimePaths,catalog:bool)->Result<Self,PiError>{
        // ConfigStore can recover a transaction across all three config files.
        // Only the catalog reader also consumes the upstream model cache.
        let names=if catalog{&NAMES[..]}else{&NAMES[..3]};
        for name in names{no_link(&paths.agent.join(name))?;no_link(&paths.agent.join(format!("{name}.lock")))?;}
        let windows=std::env::var_os("SystemRoot").map(PathBuf::from).ok_or_else(||PiError::new("pi_system_path","无法定位系统目录。"))?;
        let env=paths.environment(runtime,&windows,&[])?;
        let args=vec!["--no-global-search-paths".into(),"--input-type=module".into(),"--eval".into(),include_str!("../resources/pi-config-lock.mjs").into()];
        let process=RpcProcess::spawn_named("配置与认证锁",&runtime.node,&args,&paths.default_cwd,&env,|_|{})?;
        let value=process.request("acquire",json!({"package":runtime.package,"agent":paths.agent,"catalog":catalog}),Duration::from_secs(5))?;
        response(&value)?;
        let mut lease=Self{process,directories:Vec::new(),_permit:None};
        #[cfg(windows)]
        {
            for name in names{lease.directories.push(pin_directory(&paths.agent.join(format!("{name}.lock")))?);}
            // The helper verifies that these pinned paths still have the file
            // identities it created, closing the acquire-to-pin handoff race.
            response(&lease.process.request("protect",json!({}),Duration::from_secs(5)).map_err(|_|lost())?)?;
        }
        lease.check()?;
        Ok(lease)
    }
    pub fn check(&self)->Result<(),PiError>{response(&self.process.request("check",json!({}),Duration::from_secs(5)).map_err(|_|lost())?)}
}
impl Drop for ConfigLease{fn drop(&mut self){
    self.directories.clear();
    let _=self.process.request("release",json!({}),Duration::from_secs(2));
    let _=self.process.shutdown(Duration::from_secs(2));
}}

#[cfg(all(test,windows))]
#[path="pi-config-lock-tests.rs"]
mod tests;
