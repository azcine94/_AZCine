use crate::{pi_launch_plan::{PiPaths,RuntimePaths,no_link},pi_rpc::RpcProcess,pi_manager::PiError};
use serde_json::json;
use std::{path::PathBuf,time::Duration};
pub struct ConfigLease { process:RpcProcess }
impl ConfigLease {
    pub fn acquire(paths:&PiPaths,runtime:&RuntimePaths)->Result<Self,PiError>{
        for name in ["models.json","auth.json","settings.json"]{no_link(&paths.agent.join(name))?;}
        let windows=std::env::var_os("SystemRoot").map(PathBuf::from).ok_or_else(||PiError::new("pi_system_path","无法定位系统目录。"))?;
        let env=paths.environment(runtime,&windows,&[])?;
        let args=vec!["--no-global-search-paths".into(),"--input-type=module".into(),"--eval".into(),include_str!("../resources/pi-config-lock.mjs").into()];
        let process=RpcProcess::spawn(&runtime.node,&args,&paths.default_cwd,&env,|_|{})?;
        let value=process.request("acquire",json!({"package":runtime.package,"agent":paths.agent}),Duration::from_secs(5))?;
        if value["success"]!=true{return Err(PiError::new("pi_config_busy","原版 Pi 正在更新配置或认证；没有覆盖，输入保留，请稍后保存。"));}
        Ok(Self{process})
    }
    pub fn check(&self)->Result<(),PiError>{if self.process.is_connected(){Ok(())}else{Err(PiError::new("pi_config_lock_lost","配置锁已中断，未报告保存成功，请核对原配置。"))}}
}
impl Drop for ConfigLease{fn drop(&mut self){let _=self.process.shutdown(Duration::from_secs(2));}}
