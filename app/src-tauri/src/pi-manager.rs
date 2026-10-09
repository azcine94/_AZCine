//! AZCine-owned Pi orchestration. No SQLite lock, host credentials, provider
//! client or Pi extension. All events and requests stay with their connection.
use crate::{pi_config_store::ConfigStore,pi_launch_plan::{PiPaths,RuntimePaths},pi_model_config::{ConfigError,ModelSettingsInput},pi_projection::{self,Projection},pi_redactor::Redactor,pi_rpc::{RpcError,RpcProcess,RpcRequest},pi_runtime,pi_sessions};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
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
fn invalid()->PiError{PiError::new("pi_response_invalid","Agent 返回的状态不完整，未当作成功；请重新连接并核对会话。")}
fn accepted(response:Value)->Result<Value,PiError>{
    if response.get("success").and_then(Value::as_bool)==Some(true){Ok(response.get("data").cloned().unwrap_or(Value::Null))}
    else{Err(PiError::new("pi_command_rejected","Agent 拒绝了本次操作。请检查模型配置、会话和能力；输入保留，原始诊断未回传以免暴露认证。"))}
}
fn request(rpc:&RpcProcess,command:&str,fields:Value,timeout:Duration)->Result<Value,PiError>{
    let started=std::time::Instant::now();
    accepted(rpc.request(command,fields,timeout).map_err(|e|PiError::new(e.code,&format!("会话请求 {command}（{} ms）：{}",started.elapsed().as_millis(),e.message)))?)
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ImageInput{pub data:String,pub mime_type:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SendInput{pub generation:u64,pub session_id:String,pub message:String,pub images:Vec<ImageInput>,pub behavior:Option<String>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SendReceipt{pub generation:u64,pub session_id:String,pub disposition:String}
struct BusinessInput{id:String,fingerprint:String,priority:u8}
struct Core{
    generation:u64,seq:u64,connection:String,state:Value,models:Vec<Value>,commands:Vec<String>,
    projection:Projection,error:Option<PiError>,notice:Option<String>,
    queue_paused:bool,busy:bool,stopping:bool,sending:bool,session_changing:bool,exiting:bool,
    process:Option<Arc<RpcProcess>>,paths:Option<PiPaths>,cwd:Option<PathBuf>,runtime:Option<RuntimePaths>,
    redactor:Redactor,recovered:HashMap<String,Vec<String>>,
    session_lease:Option<crate::pi_session_lock::SessionLease>,extensions:crate::pi_extension_ui::ExtensionUi,rules:Value,
    delivered_inputs:Vec<String>,business_inputs:Vec<BusinessInput>,business_input:Option<(String,usize)>,
}
impl Default for Core{fn default()->Self{Self{generation:0,seq:0,connection:"disconnected".into(),state:Value::Null,models:vec![],commands:vec![],projection:Projection::default(),error:None,notice:None,queue_paused:false,busy:false,stopping:false,sending:false,session_changing:false,exiting:false,process:None,paths:None,cwd:None,runtime:None,redactor:Redactor::default(),recovered:HashMap::new(),session_lease:None,extensions:crate::pi_extension_ui::ExtensionUi::default(),rules:Value::Null,delivered_inputs:vec![],business_inputs:vec![],business_input:None}}}
pub type BusinessEnvironment=Arc<dyn Fn(u64,&PiPaths,&RuntimePaths)->Result<Vec<(std::ffi::OsString,std::ffi::OsString)>,PiError>+Send+Sync>;
pub struct PiManager{core:Arc<Mutex<Core>>,operation:Mutex<()>,business_environment:Mutex<Option<BusinessEnvironment>>}
impl Default for PiManager{fn default()->Self{Self{core:Arc::new(Mutex::new(Core::default())),operation:Mutex::new(()),business_environment:Mutex::new(None)}}}
pub type Notify=Arc<dyn Fn()+Send+Sync>;
fn locked(core:&Mutex<Core>)->Result<MutexGuard<'_,Core>,PiError>{core.lock().map_err(|_|interrupted())}
fn update_state_flags(c:&mut Core){if c.state.is_object(){c.state["isStreaming"]=json!(matches!(c.projection.activity.as_str(),"starting"|"running"|"stopping"));c.state["isCompacting"]=json!(c.projection.activity=="compacting");c.state["messageCount"]=json!(c.projection.messages.len());c.state["pendingMessageCount"]=json!(c.projection.steering.len()+c.projection.follow_up.len());}}
fn on_event(core:&Weak<Mutex<Core>>,generation:u64,event:Value,notify:&Notify){
    let Some(core)=core.upgrade()else{return;};
    let mut halt=None;let mut ui_cancel=None;
    if let Ok(mut c)=core.lock(){
        if c.generation!=generation{return;}
        let kind=event.get("type").and_then(Value::as_str).unwrap_or("");
        if kind=="azcine_transport_error"{c.connection="error".into();c.error=Some(if event["code"]=="pi_monitor_stopped"{PiError::new("pi_monitor_stopped","已从进程监控停止 Agent；输入与已有消息保留，可重新连接。")}else{PiError::new("pi_disconnected","Agent 连接中断，未确认的请求不会自动重发；输入与已有消息保留。")});c.projection.event(&event);}
        else if kind=="extension_ui_request"{if let Some(response)=c.extensions.event(&event){ui_cancel=c.process.clone().map(|process|(process,response));}}
        else if !c.session_changing{
            if kind=="message_end"&&event["message"]["role"]=="user"{
                let text=crate::agent_store::message_text(&event["message"]);
                let fingerprint=format!("{:x}",Sha256::digest(text.as_bytes()));
                // Native prompt templates/Skills may expand the text. Fall back
                // to Pi's delivery order: started, steering, then follow-up.
                let pending=c.business_inputs.iter().position(|input|input.fingerprint==fingerprint)
                    .or_else(||c.business_inputs.iter().enumerate().min_by_key(|(_,input)|input.priority).map(|(index,_)|index));
                c.business_input=pending.map(|index|(c.business_inputs.remove(index).id,c.projection.messages.len()));
                if let Some((id,_))=c.business_input.clone(){c.delivered_inputs.push(id);if c.delivered_inputs.len()>200{c.delivered_inputs.remove(0);}}
            }
            c.projection.event(&event);
            if kind=="session_info_changed" && c.state.is_object(){c.state["sessionName"]=event.get("name").filter(|v|v.is_string()).cloned().unwrap_or(Value::Null);}
            if kind=="thinking_level_changed" && event.get("level").is_some_and(Value::is_string) && c.state.is_object(){c.state["thinkingLevel"]=event["level"].clone();}
            update_state_flags(&mut c);
            if c.projection.overflowed{c.connection="error".into();c.error=Some(PiError::new("pi_history_limit","会话超过界面读取上限，已停止本应用运行；原生记录和输入保留。"));halt=c.process.clone();}
        }
        c.seq=c.seq.saturating_add(1);
    }
    if let Some((process,response))=ui_cancel{let _=process.send_notification(&response);}
    if let Some(process)=halt{let _=process.shutdown(Duration::ZERO);}
    notify();
}
fn is_running(c:&Core)->bool{c.extensions.waiting()||c.projection.tools.iter().any(|t|matches!(t["status"].as_str(),Some("running")))||c.projection.activity!="idle"||c.state.get("isStreaming").and_then(Value::as_bool)==Some(true)||c.state.get("isCompacting").and_then(Value::as_bool)==Some(true)}
fn check_idle(c:&Core)->Result<(),PiError>{if c.exiting||c.busy||c.stopping||c.sending||is_running(c){Err(busy())}else{Ok(())}}
fn check_session(c:&Core,generation:u64,session_id:&str)->Result<(),PiError>{if c.generation!=generation||c.state.get("sessionId").and_then(Value::as_str)!=Some(session_id){Err(PiError::new("pi_stale_session","会话已经切换，原输入仍保留；本次没有发给另一个会话。"))}else{Ok(())}}
fn connected(c:&Core)->Result<Arc<RpcProcess>,PiError>{if c.connection!="ready"{return Err(PiError::new("pi_not_ready","请先连接本应用的 Agent；输入仍保留。"));}c.process.clone().filter(|p|p.is_connected()).ok_or_else(interrupted)}
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
    pub fn business_environment(&self,environment:BusinessEnvironment)->Result<(),PiError>{*self.business_environment.lock().map_err(|_|interrupted())?=Some(environment);Ok(())}
    // Snapshot owned configuration under the same lock used by connect/save.
    // News runs in its own process, but must not race configuration recovery.
    pub fn news_documents(&self,root:&Path,resources:&Path)->Result<[Value;3],PiError>{
        let _operation=self.operation.try_lock().map_err(|_|busy())?;
        let paths=PiPaths::prepare(root)?;let runtime=pi_runtime::resolve(resources)?;let lease=crate::pi_config_lock::ConfigLease::acquire_wait(&paths,&runtime)?;
        let config=ConfigStore::open(&paths.root)?;config.initialize_defaults()?;let docs=config.private_documents()?;lease.check()?;Ok(docs)
    }
    pub fn set_exiting(&self,value:bool){if let Ok(mut c)=self.core.lock(){c.exiting=value;}}
    fn operation(&self)->Result<MutexGuard<'_,()>,PiError>{self.operation.try_lock().map_err(|e|match e{TryLockError::WouldBlock=>busy(),TryLockError::Poisoned(_)=>interrupted()})}
    pub fn snapshot(&self)->Result<Value,PiError>{
        let c=locked(&self.core)?;
        let mut projection=serde_json::to_value(&c.projection).map_err(|_|interrupted())?;
        // Ordinary completed text is preserved; streaming partial suffixes are
        // redacted before each IPC snapshot, not after chunks have leaked.
        if let Some(partial)=projection.get_mut("partial"){*partial=c.redactor.value(partial.take(),true);}
        if let Some(tools)=projection.get_mut("tools"){*tools=c.redactor.value(tools.take(),true);}
        Ok(c.redactor.value(json!({"generation":c.generation,"seq":c.seq,"connection":c.connection,"busy":c.busy,"stopping":c.stopping,"sending":c.sending,"state":c.state,"historyReleased":c.process.is_none()&&c.projection.messages.is_empty()&&c.state["messageCount"].as_u64().is_some_and(|count|count>0),"models":c.models,"projection":projection,"extensions":c.extensions,"rules":c.rules,"recoveredQueue":c.state["sessionId"].as_str().and_then(|id|c.recovered.get(id)).cloned().unwrap_or_default(),"error":c.error,"notice":c.notice,"cwd":c.cwd,"runtime":c.runtime.as_ref().map(|r|json!({"piVersion":pi_runtime::versions()["piVersion"],"nodeVersion":pi_runtime::versions()["nodeVersion"],"root":r.root})),"paths":c.paths.as_ref().map(|p|json!({"agent":p.agent,"sessions":p.sessions,"defaultCwd":p.default_cwd}))}),false))
    }
    fn finish_error(&self,generation:u64,error:PiError,notify:&Notify){if let Ok(mut c)=self.core.lock(){if c.generation==generation{c.error=Some(error);c.busy=false;c.sending=false;c.session_changing=false;c.connection="error".into();c.projection.interrupted("本次连接未完成；已有消息和输入保留。");update_state_flags(&mut c);c.seq+=1;}}notify();}
    pub fn connect(&self,root:&Path,resources:&Path,cwd:Option<&Path>,session:Option<&Path>,notify:Notify)->Result<Value,PiError>{
        let _operation=self.operation()?;
        {let c=locked(&self.core)?;check_idle(&c)?;}
        self.connect_inner(root,resources,cwd,session,notify,None)
    }
    fn connect_inner(&self,root:&Path,resources:&Path,cwd:Option<&Path>,session:Option<&Path>,notify:Notify,expected_generation:Option<u64>)->Result<Value,PiError>{
        // Reserve cancellation generation BEFORE any filesystem or process work.
        let (generation,previous)={let mut c=locked(&self.core)?;if c.exiting||c.stopping||expected_generation.is_some_and(|g|g!=c.generation){return Err(cancelled());}c.generation+=1;c.seq+=1;c.busy=true;c.connection="connecting".into();c.business_inputs.clear();c.business_input=None;c.error=None;c.notice=None;c.session_changing=true;(c.generation,c.process.take())};notify();
        if let Some(previous)=previous{if let Err(e)=previous.shutdown(STOP_TIMEOUT){let error=PiError::from(e);self.finish_error(generation,error.clone(),&notify);return Err(error);}}
        {let mut c=locked(&self.core)?;c.session_lease=None;c.extensions=crate::pi_extension_ui::ExtensionUi::default();}
        let result=(||->Result<(),PiError>{
            let runtime=pi_runtime::resolve(resources)?;let paths=PiPaths::prepare(root)?;
            let cwd=paths.checked_cwd(cwd)?;
            if let Some(file)=session{let info=pi_sessions::validate_session(&paths,file)?;if paths.checked_cwd(Some(Path::new(&info.cwd)))?!=cwd{return Err(PiError::new("pi_session_cwd","原生会话的工作目录与所选目录不同，未切换；请使用会话原目录。"));}}
            let session_lease=session.map(|s|crate::pi_session_lock::SessionLease::acquire(&paths,s)).transpose()?;
            let docs={let lease=crate::pi_config_lock::ConfigLease::acquire_wait(&paths,&runtime)?;let config=ConfigStore::open(&paths.root)?;config.initialize_defaults()?;let docs=config.private_documents()?;validate_documents(&docs)?;lease.check()?;docs};
            let mut redactor=Redactor::from_documents(&docs[0],&docs[1]);
            let windows=std::env::var_os("SystemRoot").map(PathBuf::from).ok_or_else(||PiError::new("pi_windows_path","无法确定 Windows 系统目录，未启动 Pi。"))?;
            let mut program_files=Vec::new();if let Some(path)=std::env::var_os("ProgramFiles"){program_files.push(PathBuf::from(path));if let Some(path)=std::env::var_os("ProgramFiles(x86)"){program_files.push(PathBuf::from(path));}}
            let mut env=paths.environment(&runtime,&windows,&program_files)?;let mut args=paths.arguments(&runtime,session)?;
            let business=self.business_environment.lock().map_err(|_|interrupted())?.clone();if let Some(environment)=business{let business=environment(generation,&paths,&runtime)?;for (name,value) in &business{if name.to_str()==Some("AZCINE_MCP_GRANT"){if let Some(value)=value.to_str(){redactor.add(value);}}}env.extend(business);}
            let (rules_text,rules)=crate::pi_rules::context(&paths)?;if !rules_text.trim().is_empty(){args.push("--append-system-prompt".into());args.push(rules_text.into());}
            {let c=locked(&self.core)?;if c.generation!=generation||c.stopping{return Err(cancelled());}}
            let core=Arc::downgrade(&self.core);let changed=notify.clone();
            let process=Arc::new(RpcProcess::spawn_named("Agent 会话",&runtime.node,&args,&cwd,&env,move|event|on_event(&core,generation,event,&changed))?);
            {let mut c=locked(&self.core)?;if c.generation!=generation||c.stopping{drop(c);process.shutdown(Duration::from_secs(1))?;return Err(cancelled());}c.process=Some(process.clone());c.session_lease=session_lease;c.redactor=redactor;c.paths=Some(paths.clone());c.cwd=Some(cwd);c.runtime=Some(runtime);c.rules=rules;}
            let read=readback(&process,&paths)?;
            {let mut c=locked(&self.core)?;if c.session_lease.is_none(){c.session_lease=Some(crate::pi_session_lock::SessionLease::acquire(&paths,Path::new(read.state["sessionFile"].as_str().ok_or_else(invalid)?))?);}}
            let config_notice=if read.models.is_empty()&&docs[0].get("providers").and_then(Value::as_object).is_some_and(|p|!p.is_empty()){Some("原生配置中有服务，但没有返回可用模型；请检查认证和配置兼容性。未把文件存在当连接成功。".to_owned())}else{None};
            let mut projection=Projection::default();if !projection.restore(&read.messages){return Err(PiError::new("pi_history_limit","原生会话超过界面读取上限或结构不完整，未假装显示全部；原文件保留。"));}
            if read.state["isStreaming"]==true{projection.activity="running".into();}else if read.state["isCompacting"]==true{projection.activity="compacting".into();}
            {let mut c=locked(&self.core)?;if c.generation!=generation||c.stopping{return Err(cancelled());}if !process.is_connected(){return Err(interrupted());}c.state=read.state;c.models=read.models;c.commands=read.commands;c.projection=projection;c.connection="ready".into();c.notice=config_notice;c.busy=false;c.session_changing=false;c.seq+=1;}
            Ok(())
        })();
        if let Err(error)=result{
            let process={let mut c=locked(&self.core)?;if c.generation==generation{c.process.take()}else{None}};
            if let Some(process)=process{let _=process.shutdown(Duration::from_secs(1));}
            {let mut c=locked(&self.core)?;if c.generation==generation{c.session_lease=None;}}
            self.finish_error(generation,error.clone(),&notify);return Err(error);
        }
        notify();self.snapshot()
    }
    pub fn suspend(&self,notify:Notify)->Result<Value,PiError>{
        let process={let mut c=locked(&self.core)?;if c.busy||c.stopping||is_running(&c){return Err(busy());}c.busy=true;c.stopping=true;c.generation+=1;c.process.take()};
        let result=process.as_ref().map(|p|p.shutdown(STOP_TIMEOUT).map(|_|()).map_err(PiError::from)).unwrap_or(Ok(()));
        {let mut c=locked(&self.core)?;c.busy=false;c.stopping=false;if result.is_ok(){c.session_lease=None;c.connection="disconnected".into();if c.state["sessionFile"].as_str().is_some_and(|path|Path::new(path).is_file()){c.projection=Projection::default();c.models.clear();c.commands.clear();}}else{c.process=process;c.connection="error".into();}c.error=result.as_ref().err().cloned();c.seq+=1;}notify();result?;self.snapshot()
    }
    pub fn disconnect(&self,notify:Notify)->Result<Value,PiError>{
        let (generation,process)={let mut c=locked(&self.core)?;if c.stopping{return Err(busy());}c.stopping=true;c.busy=true;c.generation+=1;c.seq+=1;(c.generation,c.process.take())};notify();
        let mut result=Ok(());
        if let Some(process)=process{
            {let mut c=locked(&self.core)?;for response in c.extensions.cancel_all(){let _=process.send_notification(&response);}}
            if process.is_connected(){
                if let Ok(queue)=request(&process,"clear_queue",json!({}),STOP_TIMEOUT){if let Ok(mut c)=self.core.lock(){if c.generation==generation{c.notice=Some("连接已关闭，取消的排队文字保留在会话下方。".into());restore_queue(&mut c,&queue);c.projection.steering.clear();c.projection.follow_up.clear();}}}
                let _=request(&process,"abort_bash",json!({}),STOP_TIMEOUT);let _=request(&process,"abort",json!({}),STOP_TIMEOUT);
            }
            if let Err(e)=process.shutdown(STOP_TIMEOUT){result=Err(e.into());}
        }
        {let mut c=locked(&self.core)?;if c.generation==generation{if result.is_ok(){c.session_lease=None;}c.connection=if result.is_ok(){"disconnected"}else{"error"}.into();c.busy=false;c.stopping=false;c.sending=false;c.session_changing=false;c.projection.interrupted("连接已关闭，未完成内容不算成功。");c.error=result.as_ref().err().cloned();update_state_flags(&mut c);c.seq+=1;}}
        notify();result?;self.snapshot()
    }
    pub fn send(&self,input:SendInput,notify:Notify)->Result<SendReceipt,PiError>{self.send_inner(input,notify,None,false)}
    pub fn send_business(&self,input:SendInput,notify:Notify,input_id:String)->Result<SendReceipt,PiError>{self.send_inner(input,notify,Some(input_id),false)}
    pub fn pause_business_queue(&self,paused:bool)->Result<(),PiError>{locked(&self.core)?.queue_paused=paused;Ok(())}
    pub fn send_queued(&self,input:SendInput,notify:Notify,input_id:String)->Result<SendReceipt,PiError>{self.send_inner(input,notify,Some(input_id),true)}
    fn send_inner(&self,input:SendInput,notify:Notify,input_id:Option<String>,queued:bool)->Result<SendReceipt,PiError>{
        if input.message.chars().count()>100_000||(input.message.trim().is_empty()&&input.images.is_empty()){return Err(PiError::new("pi_message_invalid","请输入消息（最多 100000 字符），或选择图片；未发送。"));}
        let (mut request_fields,total)={let images=input.images.iter().map(|i|json!({"type":"image","data":i.data,"mimeType":i.mime_type})).collect::<Vec<_>>();(json!({"message":input.message,"images":images}),input.images.iter().fold(0usize,|n,i|n.saturating_add(i.data.len())))};
        if input.images.len()>crate::pi_image_limits::MAX_IMAGES||total>crate::pi_image_limits::MAX_IMAGE_BATCH_BASE64_BYTES||input.images.iter().any(|i|!matches!(i.mime_type.as_str(),"image/png"|"image/jpeg"|"image/webp"|"image/gif")||!crate::pi_image_limits::image_encoded_size_allowed(&i.data)||!valid_base64(&i.data)){return Err(PiError::new("pi_images_invalid","图片格式或大小不支持（最多4张，每张不超过50MB），附件与输入保留。"));}
        if let Some(behavior)=&input.behavior{if !matches!(behavior.as_str(),"steer"|"followUp"){return Err(PiError::new("pi_behavior_invalid","请选择有效的插入或排队方式。"));}request_fields["streamingBehavior"]=json!(behavior);}
        let pending:RpcRequest={let mut c=locked(&self.core)?;if queued&&c.queue_paused{return Err(PiError::new("agent_queue_paused","队列已暂停，此消息未发送。"));}check_session(&c,input.generation,&input.session_id)?;if c.exiting||c.busy||c.stopping||c.sending{return Err(busy());}let rpc=connected(&c)?;
            let current=&c.state["model"];if current.is_null()||!c.models.iter().any(|m|m["id"]==current["id"]&&m["provider"]==current["provider"]){return Err(PiError::new("pi_model_required","请先配置并选择模型；消息和附件仍保留。"));}
            if !input.images.is_empty()&&!current["input"].as_array().is_some_and(|a|a.iter().any(|v|v=="image")){return Err(PiError::new("pi_images_unsupported","当前模型没有声明图片能力，请换模型或移除图片后发送；附件和文字仍保留。"));}
            if let Some(command)=input.message.trim().strip_prefix('/').and_then(|s|s.split_whitespace().next()){if matches!(command,"login"|"logout"|"settings"|"reload"|"model"|"resume"|"new"|"tree"|"fork"|"clone"|"share"|"export"|"quit")&&!c.commands.iter().any(|v|v==command){return Err(PiError::new("pi_tui_command","这是 Agent 终端专用命令，不会在 RPC 中假装执行；模型和会话请用本页入口，完整终端交接在资源阶段接入。"));}}
            if is_running(&c)&&input.behavior.is_none(){return Err(PiError::new("pi_streaming_behavior","Pi 正在运行，请选择“插入当前任务”或“排在之后”。"));}
            if input_id.is_some()&&c.business_inputs.len()>=100{return Err(PiError::new("agent_input_limit","待处理的业务输入超过100条，请停止队列后重试；输入保留。"));}
            let priority=if !is_running(&c){0}else if input.behavior.as_deref()==Some("steer"){1}else{2};
            let pending=rpc.begin_request("prompt",request_fields)?;
            if let Some(id)=&input_id{c.business_inputs.push(BusinessInput{id:id.clone(),fingerprint:format!("{:x}",Sha256::digest(input.message.as_bytes())),priority});}c.sending=true;c.projection.submitted();c.seq+=1;pending};notify();
        let response=pending.wait_paused(REQUEST_TIMEOUT,||self.core.lock().is_ok_and(|c|c.generation==input.generation&&c.extensions.waiting())).map_err(PiError::from).and_then(accepted).and_then(|v|v["disposition"].as_str().filter(|s|matches!(*s,"started"|"queued"|"handled")).map(str::to_owned).ok_or_else(invalid));
        {let mut c=locked(&self.core)?;if c.generation==input.generation{c.sending=false;if response.as_ref().is_ok_and(|d|d=="handled")||response.as_ref().is_err_and(|e|e.code=="pi_command_rejected"){if let Some(id)=&input_id{c.business_inputs.retain(|pending|&pending.id!=id);}}if let Err(error)=&response{c.error=Some(error.clone());if c.projection.activity=="starting"{c.projection.activity="idle".into();c.projection.outcome="incomplete".into();}}else if matches!(response.as_deref(),Ok("handled"))&&c.projection.activity=="starting"{c.projection.activity="idle".into();c.projection.outcome="incomplete".into();c.notice=Some("原生命令已处理；这不代表模型任务完成。".into());}update_state_flags(&mut c);c.seq+=1;}}
        notify();Ok(SendReceipt{generation:input.generation,session_id:input.session_id,disposition:response?})
    }
    pub fn stop(&self,generation:u64,session_id:&str,notify:Notify)->Result<Value,PiError>{
        {let c=locked(&self.core)?;check_session(&c,generation,session_id)?;if c.busy {drop(c);return self.disconnect(notify);}}
        let (rpc,paths)={let mut c=locked(&self.core)?;check_session(&c,generation,session_id)?;if c.stopping{return Err(busy());}let rpc=connected(&c)?;c.stopping=true;c.projection.stopping();c.seq+=1;(rpc,c.paths.clone().ok_or_else(interrupted)?)};notify();
        let result=(||->Result<(),PiError>{
            {let mut c=locked(&self.core)?;for response in c.extensions.cancel_all(){rpc.send_notification(&response)?;}}
            let queue=request(&rpc,"clear_queue",json!({}),STOP_TIMEOUT)?;
            {let mut c=locked(&self.core)?;if c.generation==generation{restore_queue(&mut c,&queue);c.business_inputs.clear();}}
            request(&rpc,"abort_bash",json!({}),STOP_TIMEOUT)?;request(&rpc,"abort",json!({}),STOP_TIMEOUT)?;
            let read=readback(&rpc,&paths)?;
            let mut c=locked(&self.core)?;if c.generation!=generation{return Err(cancelled());}
            let tools=c.projection.tools.clone();
            if !c.projection.restore(&read.messages){return Err(invalid());}c.projection.tools=tools;c.state=read.state;c.models=read.models;c.commands=read.commands;c.projection.interrupted("当前运行已停止。取消的排队文字可取回输入，不会自动重发。");Ok(())
        })();
        if result.is_err(){let _=rpc.shutdown(Duration::from_secs(1));}
        {let mut c=locked(&self.core)?;if c.generation==generation{c.stopping=false;c.sending=false;if let Err(e)=&result{c.error=Some(e.clone());c.connection="error".into();c.projection.interrupted("停止时连接中断，已清理本应用 Agent 进程树；请核对原生会话。");}update_state_flags(&mut c);c.seq+=1;}}notify();result?;self.snapshot()
    }
    pub fn session_action(&self,generation:u64,session_id:&str,command:&str,fields:Value,notify:Notify)->Result<Value,PiError>{
        let _operation=self.operation()?;
        if !matches!(command,"new_session"|"switch_session"|"set_model"|"set_session_name"|"set_thinking_level"){return Err(PiError::new("pi_action_invalid","此操作没有受控原生入口，未发送。"));}
        if command=="set_thinking_level"&&!matches!(fields["level"].as_str(),Some("off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max")){return Err(PiError::new("pi_thinking_invalid","思考级别无效。"));}
        let mut next_lease=None;
        if command=="switch_session"{
            let (paths,cwd)={let c=locked(&self.core)?;check_session(&c,generation,session_id)?;check_idle(&c)?;(c.paths.clone().ok_or_else(interrupted)?,c.cwd.clone())};
            let file=fields["sessionPath"].as_str().ok_or_else(invalid)?;let info=pi_sessions::validate_session(&paths,Path::new(file))?;
            if Some(paths.checked_cwd(Some(Path::new(&info.cwd)))?)!=cwd{return Err(PiError::new("pi_session_cwd","该会话属于不同工作目录，请用连接设置选择它的原目录后重连。"));}
            next_lease=Some(crate::pi_session_lock::SessionLease::acquire(&paths,Path::new(file))?);
        }
        let (rpc,paths)={let mut c=locked(&self.core)?;check_session(&c,generation,session_id)?;check_idle(&c)?;let rpc=connected(&c)?;let paths=c.paths.clone().ok_or_else(interrupted)?;
            if command=="set_model"&&!c.models.iter().any(|m|m["provider"]==fields["provider"]&&m["id"]==fields["modelId"]){return Err(PiError::new("pi_model_unavailable","所选模型不在当前原生可用清单中，未切换。"));}
            if command=="set_session_name"{let name=fields["name"].as_str().ok_or_else(invalid)?;if name.trim().is_empty()||name.chars().count()>1000{return Err(PiError::new("pi_name_invalid","会话名称需为1至1000字符。"));}}
            c.busy=true;c.session_changing=matches!(command,"new_session"|"switch_session");c.seq+=1;(rpc,paths)};notify();
        let result=(||->Result<Readback,PiError>{let data=request(&rpc,command,fields,REQUEST_TIMEOUT)?;if matches!(command,"new_session"|"switch_session"){match data["cancelled"].as_bool(){Some(false)=>{},Some(true)=>return Err(PiError::new("pi_switch_cancelled","原生扩展取消了会话切换，仍保留原会话。")),None=>return Err(invalid())}}let read=readback(&rpc,&paths)?;if command=="new_session"{next_lease=Some(crate::pi_session_lock::SessionLease::acquire(&paths,Path::new(read.state["sessionFile"].as_str().ok_or_else(invalid)?))?);}Ok(read)})();
        if result.as_ref().err().is_some_and(|e|e.code!="pi_switch_cancelled"){let _=rpc.shutdown(Duration::from_secs(1));}
        {let mut c=locked(&self.core)?;if c.generation!=generation{return Err(cancelled());}c.busy=false;c.session_changing=false;match &result{Ok(read)=>{let mut projection=Projection::default();if !projection.restore(&read.messages){return Err(invalid());}if let Some(lease)=next_lease{c.session_lease=Some(lease);}if c.state["sessionId"]!=read.state["sessionId"]{c.business_inputs.clear();c.business_input=None;}c.state=read.state.clone();c.models=read.models.clone();c.commands=read.commands.clone();c.projection=projection;c.error=None;},Err(e)=>{c.error=Some(e.clone());if e.code!="pi_switch_cancelled"{c.connection="error".into();c.projection.interrupted("原生状态未能核对，已停止连接，不能向旧会话状态继续发送。");}}};c.seq+=1;}notify();result?;self.snapshot()
    }
    pub fn sessions(&self,root:&Path)->Result<Value,PiError>{let paths=PiPaths::prepare(root)?;let value=serde_json::to_value(pi_sessions::list_sessions(&paths)?).map_err(|_|interrupted())?;let c=locked(&self.core)?;Ok(c.redactor.value(value,false))}
    fn resource_index_inner(&self,root:&Path,resources:&Path)->Result<(PiPaths,crate::pi_resources::ResourceIndex),PiError>{
        let paths=PiPaths::prepare(root)?;
        let runtime=pi_runtime::resolve(resources)?;
        let (generation,cwd,rpc)={let c=locked(&self.core)?;
            let own=c.paths.as_ref().is_some_and(|p|p.agent==paths.agent);
            (c.generation,if own{c.cwd.clone().unwrap_or_else(||paths.default_cwd.clone())}else{paths.default_cwd.clone()},
             if own&&c.connection=="ready"{c.process.clone().filter(|p|p.is_connected())}else{None})};
        let commands=if let Some(rpc)=&rpc{request(rpc,"get_commands",json!({}),REQUEST_TIMEOUT)?.get("commands").cloned().ok_or_else(invalid)?}else{json!([])};
        let index=crate::pi_resources::inspect(&runtime,&paths,&cwd,generation,commands,rpc.is_some())?;
        if locked(&self.core)?.generation!=generation{return Err(cancelled());}
        Ok((paths,index))
    }
    pub fn resources(&self,root:&Path,resources:&Path)->Result<Value,PiError>{
        let _operation=self.operation()?;
        let (_,index)=self.resource_index_inner(root,resources)?;
        serde_json::to_value(index).map_err(|_|invalid())
    }
    pub fn save_resource(&self,root:&Path,resources:&Path,input:crate::pi_resources::ResourceUpdate)->Result<Value,PiError>{
        let _operation=self.operation()?;
        {let c=locked(&self.core)?;if c.exiting||c.generation!=input.generation{return Err(cancelled());}}
        let (paths,index)=self.resource_index_inner(root,resources)?;
        let runtime=pi_runtime::resolve(resources)?;
        crate::pi_resources::update(&runtime,&paths,&index,&input)?;
        Ok(json!({"saved":true,"message":"已保存。资源配置在下次连接时生效；工作规则是否加载以右侧说明为准。"}))
    }
    pub fn model_catalog(&self,root:&Path,resources:&Path)->Result<Value,PiError>{
        crate::pi_model_catalog::read(root,resources)
    }
    pub fn providers(&self, root:&Path,resources:&Path)->Result<Value,PiError>{
        let _operation=self.operation.lock().map_err(|_|interrupted())?;
        let paths=PiPaths::prepare(root)?;
        let runtime=pi_runtime::resolve(resources)?;let lease=crate::pi_config_lock::ConfigLease::acquire_wait(&paths,&runtime)?;
        let providers=ConfigStore::open(&paths.root)?.providers()?;lease.check()?;Ok(providers)
    }
    pub fn model_list_key(&self,root:&Path,resources:&Path,provider:&str,base_url:&str)->Result<Option<String>,PiError>{
        let _operation=self.operation.lock().map_err(|_|interrupted())?;
        let paths=PiPaths::prepare(root)?;
        let runtime=pi_runtime::resolve(resources)?;let lease=crate::pi_config_lock::ConfigLease::acquire_wait(&paths,&runtime)?;
        let key=ConfigStore::open(&paths.root)?.model_list_key(provider,base_url)?;lease.check()?;Ok(key)
    }
    pub fn save_model(&self,root:&Path,resources:&Path,input:ModelSettingsInput,notify:Notify)->Result<Value,PiError>{
        self.save_configuration(root,resources,notify,move|config|serde_json::to_value(config.save(&input)?).map_err(|_|interrupted()))
    }
    pub fn save_provider(&self,root:&Path,resources:&Path,input:crate::pi_provider_config::ProviderSettingsInput,notify:Notify)->Result<Value,PiError>{
        crate::pi_provider_config::plan_provider_update(&[json!({}),json!({}),json!({})],&input)?;
        self.save_configuration(root,resources,notify,move|config|{config.save_provider(&input)?;Ok(json!({"provider":input.provider,"models":input.models.len()}))})
    }
    pub fn delete_provider(&self,root:&Path,resources:&Path,input:crate::pi_provider_config::ProviderDeleteInput,notify:Notify)->Result<Value,PiError>{
        self.save_configuration(root,resources,notify,move|config|{config.delete_provider(&input)?;Ok(json!({"provider":input.provider,"deleted":true}))})
    }
    fn save_configuration(&self,root:&Path,resources:&Path,notify:Notify,save:impl FnOnce(&ConfigStore)->Result<Value,PiError>)->Result<Value,PiError>{
        let _operation=self.operation()?;
        if locked(&self.core)?.exiting{return Err(cancelled());}
        let paths=PiPaths::prepare(root)?;let runtime=pi_runtime::resolve(resources)?;
        let lease=crate::pi_config_lock::ConfigLease::acquire_wait(&paths,&runtime)?;
        let config=ConfigStore::open(&paths.root)?;let view=save(&config)?;lease.check()?;
        let connected=locked(&self.core)?.connection=="ready";notify();
        Ok(json!({"saved":true,"view":view,"connected":connected,"message":"配置已保存，正在运行的会话继续使用原配置；各会话下次连接时加载新配置。"}))
    }
    pub fn active(&self)->Result<bool,PiError>{let c=locked(&self.core)?;Ok(c.busy||c.sending||c.stopping||is_running(&c))}
    pub fn resident(&self)->Result<bool,PiError>{Ok(locked(&self.core)?.process.as_ref().is_some_and(|p|p.is_connected()))}
    pub fn remember_history_view(&self,generation:u64,seq:u64,state:Value,cwd:String)->Result<bool,PiError>{
        let mut c=locked(&self.core)?;
        if c.generation!=generation||c.seq!=seq||c.busy||c.sending||c.stopping||is_running(&c)||c.process.as_ref().is_some_and(|process|process.is_connected()){return Ok(false);}
        // Keep identifiers for reconnect/delete without retaining cold message
        // bodies or creating a native process. The frontend owns the view cache.
        c.state=state;c.cwd=Some(PathBuf::from(cwd));c.seq+=1;Ok(true)
    }
    pub fn summary(&self)->Result<Value,PiError>{let c=locked(&self.core)?;Ok(json!({"generation":c.generation,"seq":c.seq,"connection":c.connection,"active":c.busy||c.sending||c.stopping||is_running(&c),"waiting":c.extensions.waiting(),"stopping":c.stopping,"sessionId":c.state["sessionId"],"sessionFile":c.state["sessionFile"],"name":c.state["sessionName"],"deliveredInputIds":c.delivered_inputs,"businessInputId":c.business_input.as_ref().map(|v|&v.0),"businessMessageIndex":c.business_input.as_ref().map(|v|v.1),"outcome":c.projection.outcome,"cwd":c.cwd}))}
    pub fn expire_ui(&self,notify:&Notify)->Result<(),PiError>{let mut c=locked(&self.core)?;if c.extensions.expire(){c.seq+=1;drop(c);notify();}Ok(())}
    pub fn respond_ui(&self,input:crate::pi_extension_ui::UiResponse,notify:Notify)->Result<Value,PiError>{
        let mut c=locked(&self.core)?;check_session(&c,input.generation,&input.session_id)?;let rpc=connected(&c)?;
        let response=c.extensions.response(&input)?;rpc.send_notification(&response)?;c.extensions.answered(&input.id);c.seq+=1;drop(c);notify();
        Ok(json!({"sent":true,"id":input.id,"message":"回答已发送给 Agent 扩展；后续结果以实际事件为准。"}))
    }
    pub fn stats(&self,generation:u64,session_id:&str)->Result<Value,PiError>{let (rpc,redactor)={let c=locked(&self.core)?;check_session(&c,generation,session_id)?;(connected(&c)?,c.redactor.clone())};let raw=request(&rpc,"get_session_stats",json!({}),REQUEST_TIMEOUT)?;let mut out=json!({});for name in ["userMessages","assistantMessages","toolCalls","toolResults","totalMessages","tokens","cost","contextUsage"]{if let Some(v)=raw.get(name){out[name]=v.clone();}}{let c=locked(&self.core)?;check_session(&c,generation,session_id)?;}Ok(redactor.value(out,false))}
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
