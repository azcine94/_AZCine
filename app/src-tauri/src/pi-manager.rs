//! AZCine-owned Pi orchestration. No SQLite lock, host credentials, provider
//! client or Pi extension. All events and requests stay with their connection.
use crate::{pi_config_store::ConfigStore,pi_launch_plan::{PiPaths,RuntimePaths},pi_model_config::{ConfigError,ModelSettingsInput},pi_projection::{self,Projection},pi_redactor::Redactor,pi_rpc::{RpcError,RpcProcess,RpcRequest},pi_runtime,pi_sessions};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::{collections::HashMap,path::{Path,PathBuf},sync::{Arc,Mutex,MutexGuard,TryLockError,Weak},time::Duration};
const REQUEST_TIMEOUT:Duration=Duration::from_secs(30);
const STOP_TIMEOUT:Duration=Duration::from_secs(8);
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct PiError{pub code:&'static str,pub message:String}
impl PiError{pub fn new(code:&'static str,message:&str)->Self{Self{code,message:message.into()}}}
impl From<ConfigError> for PiError{fn from(e:ConfigError)->Self{Self::new(e.code,e.message)}}
impl From<RpcError> for PiError{fn from(e:RpcError)->Self{Self::new(e.code,e.message)}}
fn busy()->PiError{PiError::new("pi_busy","Pi 正在切换或处理请求，请先停止或等待当前操作；输入仍保留。")}
fn interrupted()->PiError{PiError::new("pi_interrupted","Pi 状态意外中断，未报告成功，请重新连接并核对会话。")}
fn cancelled()->PiError{PiError::new("pi_cancelled","本次连接或操作已停止，未继续发送。")}
fn invalid()->PiError{PiError::new("pi_response_invalid","原版 Pi 返回的状态不完整，未当作成功；请重新连接并核对会话。")}
fn accepted(response:Value)->Result<Value,PiError>{
    if response.get("success").and_then(Value::as_bool)==Some(true){Ok(response.get("data").cloned().unwrap_or(Value::Null))}
    else{Err(PiError::new("pi_command_rejected","原版 Pi 拒绝了本次操作。请检查模型配置、会话和能力；输入保留，原始诊断未回传以免暴露认证。"))}
}
fn request(rpc:&RpcProcess,command:&str,fields:Value,timeout:Duration)->Result<Value,PiError>{accepted(rpc.request(command,fields,timeout)?)}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ImageInput{pub data:String,pub mime_type:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SendInput{pub generation:u64,pub session_id:String,pub message:String,pub images:Vec<ImageInput>,pub behavior:Option<String>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SendReceipt{pub generation:u64,pub session_id:String,pub disposition:String}
struct Core{
    generation:u64,seq:u64,connection:String,state:Value,models:Vec<Value>,commands:Vec<String>,
    projection:Projection,error:Option<PiError>,notice:Option<String>,
    busy:bool,stopping:bool,sending:bool,session_changing:bool,exiting:bool,
    process:Option<Arc<RpcProcess>>,paths:Option<PiPaths>,cwd:Option<PathBuf>,runtime:Option<RuntimePaths>,
    redactor:Redactor,recovered:HashMap<String,Vec<String>>,
}
impl Default for Core{fn default()->Self{Self{generation:0,seq:0,connection:"disconnected".into(),state:Value::Null,models:vec![],commands:vec![],projection:Projection::default(),error:None,notice:None,busy:false,stopping:false,sending:false,session_changing:false,exiting:false,process:None,paths:None,cwd:None,runtime:None,redactor:Redactor::default(),recovered:HashMap::new()}}}
pub struct PiManager{core:Arc<Mutex<Core>>,operation:Mutex<()>}
impl Default for PiManager{fn default()->Self{Self{core:Arc::new(Mutex::new(Core::default())),operation:Mutex::new(())}}}
pub type Notify=Arc<dyn Fn()+Send+Sync>;
fn locked(core:&Mutex<Core>)->Result<MutexGuard<'_,Core>,PiError>{core.lock().map_err(|_|interrupted())}
fn update_state_flags(c:&mut Core){if c.state.is_object(){c.state["isStreaming"]=json!(matches!(c.projection.activity.as_str(),"starting"|"running"|"stopping"));c.state["isCompacting"]=json!(c.projection.activity=="compacting");c.state["messageCount"]=json!(c.projection.messages.len());c.state["pendingMessageCount"]=json!(c.projection.steering.len()+c.projection.follow_up.len());}}
fn on_event(core:&Weak<Mutex<Core>>,generation:u64,event:Value,notify:&Notify){
    let Some(core)=core.upgrade()else{return;};
    let mut halt=None;
    if let Ok(mut c)=core.lock(){
        if c.generation!=generation{return;}
        let kind=event.get("type").and_then(Value::as_str).unwrap_or("");
        if kind=="azcine_transport_error"{c.connection="error".into();c.error=Some(PiError::new("pi_disconnected","Pi 连接中断，未确认的请求不会自动重发；输入与已有消息保留。"));c.projection.event(&event);}
        else if !c.session_changing{
            c.projection.event(&event);
            if kind=="session_info_changed" && c.state.is_object(){c.state["sessionName"]=event.get("name").filter(|v|v.is_string()).cloned().unwrap_or(Value::Null);}
            if kind=="thinking_level_changed" && event.get("level").is_some_and(Value::is_string) && c.state.is_object(){c.state["thinkingLevel"]=event["level"].clone();}
            update_state_flags(&mut c);
            if c.projection.overflowed{c.connection="error".into();c.error=Some(PiError::new("pi_history_limit","会话超过界面读取上限，已停止本应用运行；原生记录和输入保留。"));halt=c.process.clone();}
        }
        c.seq=c.seq.saturating_add(1);
    }
    if let Some(process)=halt{let _=process.shutdown(Duration::ZERO);}
    notify();
}
fn is_running(c:&Core)->bool{c.projection.activity!="idle"||c.state.get("isStreaming").and_then(Value::as_bool)==Some(true)||c.state.get("isCompacting").and_then(Value::as_bool)==Some(true)}
fn check_idle(c:&Core)->Result<(),PiError>{if c.exiting||c.busy||c.stopping||c.sending||is_running(c){Err(busy())}else{Ok(())}}
fn check_session(c:&Core,generation:u64,session_id:&str)->Result<(),PiError>{if c.generation!=generation||c.state.get("sessionId").and_then(Value::as_str)!=Some(session_id){Err(PiError::new("pi_stale_session","会话已经切换，原输入仍保留；本次没有发给另一个会话。"))}else{Ok(())}}
fn connected(c:&Core)->Result<Arc<RpcProcess>,PiError>{if c.connection!="ready"{return Err(PiError::new("pi_not_ready","请先连接本应用的原版 Pi；输入仍保留。"));}c.process.clone().filter(|p|p.is_connected()).ok_or_else(interrupted)}
fn validate_state_path(paths:&PiPaths,state:&Value)->Result<(),PiError>{
    let Some(raw)=state["sessionFile"].as_str()else{return Err(invalid());};let file=Path::new(raw);
    // Empty native sessions need not exist yet. Validate parent + normal basename.
    if !file.is_absolute()||file.extension().and_then(|s|s.to_str())!=Some("jsonl"){return Err(invalid());}
    let parent=file.parent().ok_or_else(invalid)?;
    if file.components().any(|c|matches!(c,std::path::Component::ParentDir)){return Err(invalid());}
    let actual=std::fs::canonicalize(parent).map_err(|_|invalid())?;
    if !actual.starts_with(&paths.sessions)||file.file_name().is_none(){return Err(invalid());}
    let mut raw=PathBuf::new();for component in file.components(){raw.push(component);if matches!(component,std::path::Component::Normal(_)){crate::pi_launch_plan::no_link(&raw)?;}}
    crate::pi_launch_plan::no_link(file)?;
    if file.exists(){paths.checked_session(file)?;}
    Ok(())
}
struct Readback{state:Value,models:Vec<Value>,messages:Value,commands:Vec<String>}
fn readback(rpc:&RpcProcess,paths:&PiPaths)->Result<Readback,PiError>{
    let state=pi_projection::state(&request(rpc,"get_state",json!({}),REQUEST_TIMEOUT)?).ok_or_else(invalid)?;validate_state_path(paths,&state)?;
    let raw=request(rpc,"get_available_models",json!({}),REQUEST_TIMEOUT)?;let list=raw["models"].as_array().ok_or_else(invalid)?;let mut models=Vec::new();
    for value in list{let m=pi_projection::model(value).filter(|v|!v.is_null()).ok_or_else(invalid)?;if models.iter().any(|v:&Value|v["id"]==m["id"]&&v["provider"]==m["provider"]){return Err(invalid());}models.push(m);}
    let messages=request(rpc,"get_messages",json!({}),REQUEST_TIMEOUT)?.get("messages").filter(|v|v.is_array()).cloned().ok_or_else(invalid)?;
    let raw=request(rpc,"get_commands",json!({}),REQUEST_TIMEOUT)?;let commands=raw["commands"].as_array().ok_or_else(invalid)?.iter().map(|v|v["name"].as_str().map(str::to_owned).ok_or_else(invalid)).collect::<Result<Vec<_>,_>>()?;
    Ok(Readback{state,models,messages,commands})
}
impl PiManager{
    pub fn set_exiting(&self,value:bool){if let Ok(mut c)=self.core.lock(){c.exiting=value;}}
    fn operation(&self)->Result<MutexGuard<'_,()>,PiError>{self.operation.try_lock().map_err(|e|match e{TryLockError::WouldBlock=>busy(),TryLockError::Poisoned(_)=>interrupted()})}
    pub fn snapshot(&self)->Result<Value,PiError>{
        let c=locked(&self.core)?;
        let mut projection=serde_json::to_value(&c.projection).map_err(|_|interrupted())?;
        // Ordinary completed text is preserved; streaming partial suffixes are
        // redacted before each IPC snapshot, not after chunks have leaked.
        if let Some(partial)=projection.get_mut("partial"){*partial=c.redactor.value(partial.take(),true);}
        if let Some(tools)=projection.get_mut("tools"){*tools=c.redactor.value(tools.take(),true);}
        Ok(c.redactor.value(json!({"generation":c.generation,"seq":c.seq,"connection":c.connection,"busy":c.busy,"stopping":c.stopping,"sending":c.sending,"state":c.state,"models":c.models,"projection":projection,"recoveredQueue":c.state["sessionId"].as_str().and_then(|id|c.recovered.get(id)).cloned().unwrap_or_default(),"error":c.error,"notice":c.notice,"cwd":c.cwd,"runtime":c.runtime.as_ref().map(|r|json!({"piVersion":"0.99.1","nodeVersion":"24.21.0","root":r.root})),"paths":c.paths.as_ref().map(|p|json!({"agent":p.agent,"sessions":p.sessions,"defaultCwd":p.default_cwd}))}),false))
    }
    fn finish_error(&self,generation:u64,error:PiError,notify:&Notify){if let Ok(mut c)=self.core.lock(){if c.generation==generation{c.error=Some(error);c.busy=false;c.sending=false;c.session_changing=false;c.connection="error".into();c.projection.interrupted("本次连接未完成；已有消息和输入保留。");update_state_flags(&mut c);c.seq+=1;}}notify();}
    pub fn connect(&self,root:&Path,resources:&Path,cwd:Option<&Path>,session:Option<&Path>,notify:Notify)->Result<Value,PiError>{
        let _operation=self.operation()?;
        {let c=locked(&self.core)?;check_idle(&c)?;}
        self.connect_inner(root,resources,cwd,session,notify,None)
    }
    fn connect_inner(&self,root:&Path,resources:&Path,cwd:Option<&Path>,session:Option<&Path>,notify:Notify,expected_generation:Option<u64>)->Result<Value,PiError>{
        // Reserve cancellation generation BEFORE any filesystem or process work.
        let (generation,previous)={let mut c=locked(&self.core)?;if c.exiting||c.stopping||expected_generation.is_some_and(|g|g!=c.generation){return Err(cancelled());}c.generation+=1;c.seq+=1;c.busy=true;c.connection="connecting".into();c.error=None;c.notice=None;c.session_changing=true;(c.generation,c.process.take())};notify();
        if let Some(previous)=previous{if let Err(e)=previous.shutdown(STOP_TIMEOUT){let error=PiError::from(e);self.finish_error(generation,error.clone(),&notify);return Err(error);}}
        let result=(||->Result<(),PiError>{
            let runtime=pi_runtime::resolve(resources)?;let paths=PiPaths::prepare(root)?;
            let cwd=paths.checked_cwd(cwd)?;
            if let Some(file)=session{let info=pi_sessions::validate_session(&paths,file)?;if paths.checked_cwd(Some(Path::new(&info.cwd)))?!=cwd{return Err(PiError::new("pi_session_cwd","原生会话的工作目录与所选目录不同，未切换；请使用会话原目录。"));}}
            let config=ConfigStore::open(&paths.root)?;config.initialize_defaults()?;let docs=config.private_documents()?;validate_documents(&docs)?;
            let redactor=Redactor::from_documents(&docs[0],&docs[1]);
            let windows=std::env::var_os("SystemRoot").map(PathBuf::from).ok_or_else(||PiError::new("pi_windows_path","无法确定 Windows 系统目录，未启动 Pi。"))?;
            let mut program_files=Vec::new();if let Some(path)=std::env::var_os("ProgramFiles"){program_files.push(PathBuf::from(path));if let Some(path)=std::env::var_os("ProgramFiles(x86)"){program_files.push(PathBuf::from(path));}}
            let env=paths.environment(&runtime,&windows,&program_files)?;let args=paths.arguments(&runtime,session)?;
            {let c=locked(&self.core)?;if c.generation!=generation||c.stopping{return Err(cancelled());}}
            let core=Arc::downgrade(&self.core);let changed=notify.clone();
            let process=Arc::new(RpcProcess::spawn(&runtime.node,&args,&cwd,&env,move|event|on_event(&core,generation,event,&changed))?);
            {let mut c=locked(&self.core)?;if c.generation!=generation||c.stopping{drop(c);process.shutdown(Duration::from_secs(1))?;return Err(cancelled());}c.process=Some(process.clone());c.redactor=redactor;c.paths=Some(paths.clone());c.cwd=Some(cwd);c.runtime=Some(runtime);}
            let read=readback(&process,&paths)?;
            let config_notice=if read.models.is_empty()&&docs[0].get("providers").and_then(Value::as_object).is_some_and(|p|!p.is_empty()){Some("原生配置中有服务，但没有返回可用模型；请检查认证和配置兼容性。未把文件存在当连接成功。".to_owned())}else{None};
            let mut projection=Projection::default();if !projection.restore(&read.messages){return Err(PiError::new("pi_history_limit","原生会话超过界面读取上限或结构不完整，未假装显示全部；原文件保留。"));}
            if read.state["isStreaming"]==true{projection.activity="running".into();}else if read.state["isCompacting"]==true{projection.activity="compacting".into();}
            {let mut c=locked(&self.core)?;if c.generation!=generation||c.stopping{return Err(cancelled());}if !process.is_connected(){return Err(interrupted());}c.state=read.state;c.models=read.models;c.commands=read.commands;c.projection=projection;c.connection="ready".into();c.notice=config_notice;c.busy=false;c.session_changing=false;c.seq+=1;}
            Ok(())
        })();
        if let Err(error)=result{
            let process={let mut c=locked(&self.core)?;if c.generation==generation{c.process.take()}else{None}};
            if let Some(process)=process{let _=process.shutdown(Duration::from_secs(1));}
            self.finish_error(generation,error.clone(),&notify);return Err(error);
        }
        notify();self.snapshot()
    }
    pub fn disconnect(&self,notify:Notify)->Result<Value,PiError>{
        let (generation,process)={let mut c=locked(&self.core)?;if c.stopping{return Err(busy());}c.stopping=true;c.busy=true;c.generation+=1;c.seq+=1;(c.generation,c.process.take())};notify();
        let mut result=Ok(());
        if let Some(process)=process{
            if process.is_connected(){
                if let Ok(queue)=request(&process,"clear_queue",json!({}),STOP_TIMEOUT){if let Ok(mut c)=self.core.lock(){if c.generation==generation{c.notice=Some("连接已关闭，取消的排队文字保留在会话下方。".into());restore_queue(&mut c,&queue);c.projection.steering.clear();c.projection.follow_up.clear();}}}
                let _=request(&process,"abort_bash",json!({}),STOP_TIMEOUT);let _=request(&process,"abort",json!({}),STOP_TIMEOUT);
            }
            if let Err(e)=process.shutdown(STOP_TIMEOUT){result=Err(e.into());}
        }
        {let mut c=locked(&self.core)?;if c.generation==generation{c.connection=if result.is_ok(){"disconnected"}else{"error"}.into();c.busy=false;c.stopping=false;c.sending=false;c.session_changing=false;c.projection.interrupted("连接已关闭，未完成内容不算成功。");c.error=result.as_ref().err().cloned();update_state_flags(&mut c);c.seq+=1;}}
        notify();result?;self.snapshot()
    }
    pub fn send(&self,input:SendInput,notify:Notify)->Result<SendReceipt,PiError>{
        if input.message.chars().count()>100_000||(input.message.trim().is_empty()&&input.images.is_empty()){return Err(PiError::new("pi_message_invalid","请输入消息（最多 100000 字符），或选择图片；未发送。"));}
        let (mut request_fields,total)={let images=input.images.iter().map(|i|json!({"type":"image","data":i.data,"mimeType":i.mime_type})).collect::<Vec<_>>();(json!({"message":input.message,"images":images}),input.images.iter().fold(0usize,|n,i|n.saturating_add(i.data.len())))};
        if input.images.len()>4||total>8*1024*1024||input.images.iter().any(|i|!matches!(i.mime_type.as_str(),"image/png"|"image/jpeg"|"image/webp"|"image/gif")||i.data.is_empty()||i.data.len()>4*1024*1024||i.data.len()%4!=0||!valid_base64(&i.data)){return Err(PiError::new("pi_images_invalid","图片格式或大小不支持（最多4张、每张编码4MiB、合计8MiB），附件与输入保留。"));}
        if let Some(behavior)=&input.behavior{if !matches!(behavior.as_str(),"steer"|"followUp"){return Err(PiError::new("pi_behavior_invalid","请选择有效的插入或排队方式。"));}request_fields["streamingBehavior"]=json!(behavior);}
        let pending:RpcRequest={let mut c=locked(&self.core)?;check_session(&c,input.generation,&input.session_id)?;if c.exiting||c.busy||c.stopping||c.sending{return Err(busy());}let rpc=connected(&c)?;
            let current=&c.state["model"];if current.is_null()||!c.models.iter().any(|m|m["id"]==current["id"]&&m["provider"]==current["provider"]){return Err(PiError::new("pi_model_required","请先配置并选择模型；消息和附件仍保留。"));}
            if !input.images.is_empty()&&!current["input"].as_array().is_some_and(|a|a.iter().any(|v|v=="image")){return Err(PiError::new("pi_images_unsupported","当前模型没有声明图片能力，请换模型或移除图片后发送；附件和文字仍保留。"));}
            if let Some(command)=input.message.trim().strip_prefix('/').and_then(|s|s.split_whitespace().next()){if matches!(command,"login"|"logout"|"settings"|"reload"|"model"|"resume"|"new"|"tree"|"fork"|"clone"|"share"|"export"|"quit")&&!c.commands.iter().any(|v|v==command){return Err(PiError::new("pi_tui_command","这是原版终端专用命令，不会在 RPC 中假装执行；模型和会话请用本页入口，完整终端交接在资源阶段接入。"));}}
            if is_running(&c)&&input.behavior.is_none(){return Err(PiError::new("pi_streaming_behavior","Pi 正在运行，请选择“插入当前任务”或“排在之后”。"));}
            let pending=rpc.begin_request("prompt",request_fields)?;c.sending=true;c.projection.submitted();c.seq+=1;pending};notify();
        let response=pending.wait(REQUEST_TIMEOUT).map_err(PiError::from).and_then(accepted).and_then(|v|v["disposition"].as_str().filter(|s|matches!(*s,"started"|"queued"|"handled")).map(str::to_owned).ok_or_else(invalid));
        {let mut c=locked(&self.core)?;if c.generation==input.generation{c.sending=false;if let Err(error)=&response{c.error=Some(error.clone());if c.projection.activity=="starting"{c.projection.activity="idle".into();c.projection.outcome="incomplete".into();}}else if matches!(response.as_deref(),Ok("handled"))&&c.projection.activity=="starting"{c.projection.activity="idle".into();c.projection.outcome="incomplete".into();c.notice=Some("原生命令已处理；这不代表模型任务完成。".into());}update_state_flags(&mut c);c.seq+=1;}}
        notify();Ok(SendReceipt{generation:input.generation,session_id:input.session_id,disposition:response?})
    }
    pub fn stop(&self,generation:u64,session_id:&str,notify:Notify)->Result<Value,PiError>{
        {let c=locked(&self.core)?;check_session(&c,generation,session_id)?;if c.busy {drop(c);return self.disconnect(notify);}}
        let (rpc,paths)={let mut c=locked(&self.core)?;check_session(&c,generation,session_id)?;if c.stopping{return Err(busy());}let rpc=connected(&c)?;c.stopping=true;c.projection.stopping();c.seq+=1;(rpc,c.paths.clone().ok_or_else(interrupted)?)};notify();
        let result=(||->Result<(),PiError>{
            let queue=request(&rpc,"clear_queue",json!({}),STOP_TIMEOUT)?;
            {let mut c=locked(&self.core)?;if c.generation==generation{restore_queue(&mut c,&queue);}}
            request(&rpc,"abort_bash",json!({}),STOP_TIMEOUT)?;request(&rpc,"abort",json!({}),STOP_TIMEOUT)?;
            let read=readback(&rpc,&paths)?;
            let mut c=locked(&self.core)?;if c.generation!=generation{return Err(cancelled());}
            let tools=c.projection.tools.clone();
            if !c.projection.restore(&read.messages){return Err(invalid());}c.projection.tools=tools;c.state=read.state;c.models=read.models;c.commands=read.commands;c.projection.interrupted("当前运行已停止。取消的排队文字可取回输入，不会自动重发。");Ok(())
        })();
        if result.is_err(){let _=rpc.shutdown(Duration::from_secs(1));}
        {let mut c=locked(&self.core)?;if c.generation==generation{c.stopping=false;c.sending=false;if let Err(e)=&result{c.error=Some(e.clone());c.connection="error".into();c.projection.interrupted("停止时连接中断，已清理本应用 Pi 进程树；请核对原生会话。");}update_state_flags(&mut c);c.seq+=1;}}notify();result?;self.snapshot()
    }
    pub fn session_action(&self,generation:u64,session_id:&str,command:&str,fields:Value,notify:Notify)->Result<Value,PiError>{
        let _operation=self.operation()?;
        if !matches!(command,"new_session"|"switch_session"|"set_model"|"set_session_name"){return Err(PiError::new("pi_action_invalid","此操作没有受控原生入口，未发送。"));}
        if command=="switch_session"{
            let (paths,cwd)={let c=locked(&self.core)?;check_session(&c,generation,session_id)?;check_idle(&c)?;(c.paths.clone().ok_or_else(interrupted)?,c.cwd.clone())};
            let file=fields["sessionPath"].as_str().ok_or_else(invalid)?;let info=pi_sessions::validate_session(&paths,Path::new(file))?;
            if Some(paths.checked_cwd(Some(Path::new(&info.cwd)))?)!=cwd{return Err(PiError::new("pi_session_cwd","该会话属于不同工作目录，请用连接设置选择它的原目录后重连。"));}
        }
        let (rpc,paths)={let mut c=locked(&self.core)?;check_session(&c,generation,session_id)?;check_idle(&c)?;let rpc=connected(&c)?;let paths=c.paths.clone().ok_or_else(interrupted)?;
            if command=="set_model"&&!c.models.iter().any(|m|m["provider"]==fields["provider"]&&m["id"]==fields["modelId"]){return Err(PiError::new("pi_model_unavailable","所选模型不在当前原生可用清单中，未切换。"));}
            if command=="set_session_name"{let name=fields["name"].as_str().ok_or_else(invalid)?;if name.trim().is_empty()||name.chars().count()>1000{return Err(PiError::new("pi_name_invalid","会话名称需为1至1000字符。"));}}
            c.busy=true;c.session_changing=matches!(command,"new_session"|"switch_session");c.seq+=1;(rpc,paths)};notify();
        let result=(||->Result<Readback,PiError>{let data=request(&rpc,command,fields,REQUEST_TIMEOUT)?;if matches!(command,"new_session"|"switch_session"){match data["cancelled"].as_bool(){Some(false)=>{},Some(true)=>return Err(PiError::new("pi_switch_cancelled","原生扩展取消了会话切换，仍保留原会话。")),None=>return Err(invalid())}}readback(&rpc,&paths)})();
        if result.as_ref().err().is_some_and(|e|e.code!="pi_switch_cancelled"){let _=rpc.shutdown(Duration::from_secs(1));}
        {let mut c=locked(&self.core)?;if c.generation!=generation{return Err(cancelled());}c.busy=false;c.session_changing=false;match &result{Ok(read)=>{let mut projection=Projection::default();if !projection.restore(&read.messages){return Err(invalid());}c.state=read.state.clone();c.models=read.models.clone();c.commands=read.commands.clone();c.projection=projection;c.error=None;},Err(e)=>{c.error=Some(e.clone());if e.code!="pi_switch_cancelled"{c.connection="error".into();c.projection.interrupted("原生状态未能核对，已停止连接，不能向旧会话状态继续发送。");}}};c.seq+=1;}notify();result?;self.snapshot()
    }
    pub fn sessions(&self,root:&Path)->Result<Value,PiError>{let paths=PiPaths::prepare(root)?;let value=serde_json::to_value(pi_sessions::list_sessions(&paths)?).map_err(|_|interrupted())?;let c=locked(&self.core)?;Ok(c.redactor.value(value,false))}
    pub fn providers(&self, root:&Path)->Result<Value,PiError>{
        let _operation=self.operation.lock().map_err(|_|interrupted())?;
        let paths=PiPaths::prepare(root)?;
        Ok(ConfigStore::open(&paths.root)?.providers()?)
    }
    pub fn model_list_key(&self,root:&Path,provider:&str,base_url:&str)->Result<Option<String>,PiError>{
        let _operation=self.operation.lock().map_err(|_|interrupted())?;
        let paths=PiPaths::prepare(root)?;
        Ok(ConfigStore::open(&paths.root)?.model_list_key(provider,base_url)?)
    }
    pub fn save_model(&self,root:&Path,resources:&Path,input:ModelSettingsInput,notify:Notify)->Result<Value,PiError>{
        self.save_configuration(root,resources,notify,move|config|serde_json::to_value(config.save(&input)?).map_err(|_|interrupted()))
    }
    pub fn save_provider(&self,root:&Path,resources:&Path,input:crate::pi_provider_config::ProviderSettingsInput,notify:Notify)->Result<Value,PiError>{
        crate::pi_provider_config::plan_provider_update(&[json!({}),json!({}),json!({})],&input)?;
        self.save_configuration(root,resources,notify,move|config|{config.save_provider(&input)?;Ok(json!({"provider":input.provider,"models":input.models.len()}))})
    }
    fn save_configuration(&self,root:&Path,resources:&Path,notify:Notify,save:impl FnOnce(&ConfigStore)->Result<Value,PiError>)->Result<Value,PiError>{
        let _operation=self.operation()?;
        let (generation,old,cwd,session)={let mut c=locked(&self.core)?;check_idle(&c)?;c.generation+=1;c.busy=true;c.connection="connecting".into();c.error=None;c.seq+=1;let session=c.state["sessionFile"].as_str().map(PathBuf::from);(c.generation,c.process.take(),c.cwd.clone(),session)};notify();
        let session=session.filter(|p|p.is_file());
        if let Some(old)=old{if let Err(e)=old.shutdown(STOP_TIMEOUT){let e=PiError::from(e);self.finish_error(generation,e.clone(),&notify);return Err(e);}}
        let view=(||->Result<Value,PiError>{let paths=PiPaths::prepare(root)?;let config=ConfigStore::open(&paths.root)?;{let c=locked(&self.core)?;if c.generation!=generation||c.stopping{return Err(cancelled());}}save(&config)})();
        let view=match view{Ok(v)=>v,Err(e)=>{self.finish_error(generation,e.clone(),&notify);return Err(e)}};
        {let mut c=locked(&self.core)?;if c.generation!=generation{drop(c);return Ok(json!({"saved":true,"view":view,"connected":false,"message":"配置已保存；连接已被停止，没有自动重连。"}));}c.busy=false;c.notice=Some("模型设置已保存；这不代表端点已通过真实推理验证。".into());}
        // Saved and connection outcomes are separate: never invite blind save retry
        // merely because a subsequent native startup failed.
        let reconnect=self.connect_inner(root,resources,cwd.as_deref(),session.as_deref(),notify,Some(generation));
        Ok(json!({"saved":true,"view":view,"connected":reconnect.is_ok(),"message":if reconnect.is_ok(){"配置已保存并由原版加载；尚未验证真实回复。"}else{"配置已保存，但原版连接未完成。请查看连接错误，不要重复粘贴密钥。"}}))
    }
}
fn restore_queue(c:&mut Core,queue:&Value){
    let Some(id)=c.state["sessionId"].as_str().map(str::to_owned)else{return;};
    let target=c.recovered.entry(id).or_default();
    for name in ["steering","followUp"] {
        if let Some(items)=queue[name].as_array(){for item in items{if let Some(text)=item.as_str(){target.push(text.into());}}}
    }
}
fn validate_documents(docs:&[Value;3])->Result<(),PiError>{
    let bad=||PiError::new("pi_config_invalid","本应用原生配置结构不完整，未启动或覆盖。请修复独立配置后重试。");
    if let Some(providers)=docs[0].get("providers"){
        for provider in providers.as_object().ok_or_else(bad)?.values(){let p=provider.as_object().ok_or_else(bad)?;
            for field in ["apiKey","api","baseUrl"]{if p.get(field).is_some_and(|v|!v.is_string()){return Err(bad());}}
            if let Some(models)=p.get("models"){let mut ids=std::collections::HashSet::new();for m in models.as_array().ok_or_else(bad)?{let id=m["id"].as_str().filter(|s|!s.is_empty()).ok_or_else(bad)?;if !ids.insert(id){return Err(bad());}for f in ["name","api","baseUrl"]{if m.get(f).is_some_and(|v|!v.is_string()){return Err(bad());}}}}
        }
    }else if docs[0].as_object().is_some_and(|o|!o.is_empty()){return Err(bad());}
    for credential in docs[1].as_object().ok_or_else(bad)?.values(){match credential["type"].as_str(){Some("api_key")=>{if credential.get("key").is_some_and(|v|!v.is_string()){return Err(bad());}},Some("oauth")=>{if !credential["access"].is_string()||!credential["refresh"].is_string()||!credential["expires"].is_number(){return Err(bad());}},_=>return Err(bad())}}
    Ok(())
}
fn valid_base64(value:&str)->bool{let mut padding=false;let mut pads=0;for b in value.bytes(){if b==b'='{padding=true;pads+=1;if pads>2{return false;}}else if padding||!b.is_ascii_alphanumeric()&&b!=b'+'&&b!=b'/'{return false;}}true}
#[cfg(test)] #[path="pi-manager-tests.rs"] mod tests;
