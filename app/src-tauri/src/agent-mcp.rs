//! Native MCP stdio -> private loopback business dispatch. SQLite remains owned
//! by the application's Rust storage manager. Grants belong to one Pi process.
use crate::{agent_store::Providers,pi_manager::{PiManager,PiError},pi_launch_plan::{PiPaths,RuntimePaths},storage::StorageError};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::{collections::HashMap,ffi::OsString,fs::{File,OpenOptions},io::{BufRead,BufReader,Read,Write},net::{TcpListener,TcpStream},path::{Path,PathBuf},sync::{Arc,Mutex,Weak,atomic::{AtomicBool,AtomicUsize,Ordering}},time::Duration};
use tauri::{Manager as _,Emitter as _};

const SCRIPT:&str=include_str!("../resources/azcine-mcp-server.mjs");
fn error(message:&str)->StorageError{StorageError::new("agent_mcp",message)}
fn pi(message:&str)->PiError{PiError::new("pi_mcp",message)}
#[derive(Clone)]
pub struct Binding{pub root:PathBuf,pub key:String,pub session:String,pub generation:u64,pub background:bool,pub input_id:Option<String>,pub message_index:Option<usize>}
enum Owner{Conversation{manager:Weak<PiManager>,generation:u64,key:String,root:PathBuf},Job(Arc<Mutex<Option<Binding>>>) }
#[derive(Default)]
pub struct BusinessMcp{listener:Mutex<Option<String>>,grants:Arc<Mutex<HashMap<String,Owner>>>,stop:Arc<AtomicBool>}

impl BusinessMcp{
    fn address(&self,app:&tauri::AppHandle)->Result<String,PiError>{
        let mut address=self.listener.lock().map_err(|_|pi("业务连接状态中断。"))?;
        if let Some(address)=address.as_ref(){return Ok(address.clone());}
        let listener=TcpListener::bind(("127.0.0.1",0)).map_err(|_|pi("本机业务连接无法启动。"))?;
        listener.set_nonblocking(true).map_err(|_|pi("本机业务连接无法准备。"))?;
        let local=listener.local_addr().map_err(|_|pi("本机业务地址无法读取。"))?.to_string();
        let app=app.clone();let grants=self.grants.clone();let stop=self.stop.clone();let active=Arc::new(AtomicUsize::new(0));
        std::thread::spawn(move||while !stop.load(Ordering::Acquire){
            match listener.accept(){
                Ok((stream,peer))=>{if !peer.ip().is_loopback(){continue;}if active.fetch_add(1,Ordering::AcqRel)>=16{active.fetch_sub(1,Ordering::AcqRel);continue;}let app=app.clone();let grants=grants.clone();let active=active.clone();std::thread::spawn(move||{serve(&app,&grants,stream);active.fetch_sub(1,Ordering::AcqRel);});},
                Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>std::thread::sleep(Duration::from_millis(30)),
                Err(_)=>break,
            }
        });
        *address=Some(local.clone());Ok(local)
    }
    pub fn conversation(&self,app:&tauri::AppHandle,manager:Weak<PiManager>,generation:u64,key:String,root:PathBuf,paths:&PiPaths,runtime:&RuntimePaths)->Result<Vec<(OsString,OsString)>,PiError>{
        let token=token(app)?;let address=self.address(app)?;configuration(paths,runtime)?;
        let mut grants=self.grants.lock().map_err(|_|pi("业务连接登记失败。"))?;
        grants.retain(|_,owner|match owner{Owner::Conversation{manager,generation,..}=>manager.upgrade().and_then(|m|m.summary().ok()).is_some_and(|s|s["generation"].as_u64()==Some(*generation)&&matches!(s["connection"].as_str(),Some("ready"|"connecting"))),Owner::Job(_)=>true});
        grants.insert(token.clone(),Owner::Conversation{manager,generation,key,root});
        Ok(environment(address,token))
    }
    pub fn job(&self,app:&tauri::AppHandle,paths:&PiPaths,runtime:&RuntimePaths)->Result<(JobGrant,Vec<(OsString,OsString)>),PiError>{
        let token=token(app)?;let address=self.address(app)?;configuration(paths,runtime)?;
        let binding=Arc::new(Mutex::new(None));self.grants.lock().map_err(|_|pi("业务任务登记失败。"))?.insert(token.clone(),Owner::Job(binding.clone()));
        Ok((JobGrant{token:token.clone(),grants:self.grants.clone(),binding},environment(address,token)))
    }
    pub fn shutdown(&self){self.stop.store(true,Ordering::Release);if let Ok(mut grants)=self.grants.lock(){grants.clear();}}
}
pub struct JobGrant{token:String,grants:Arc<Mutex<HashMap<String,Owner>>>,binding:Arc<Mutex<Option<Binding>>>}
impl JobGrant{pub fn bind(&self,binding:Binding)->Result<(),StorageError>{*self.binding.lock().map_err(|_|error("任务会话状态中断。"))?=Some(binding);Ok(())}}
impl Drop for JobGrant{fn drop(&mut self){if let Ok(mut grants)=self.grants.lock(){grants.remove(&self.token);}}}
fn environment(address:String,token:String)->Vec<(OsString,OsString)>{vec![("AZCINE_BUSINESS_ADDR".into(),address.into()),("AZCINE_MCP_GRANT".into(),token.into())]}
fn token(app:&tauri::AppHandle)->Result<String,PiError>{tauri::async_runtime::block_on(crate::with_storage(app.clone(),|m|{let s=m.store()?;crate::agent_store::id(s)})).map_err(|e|PiError::new(e.code,&e.message))}

// The only managed entry is azcine. Never rewrite user-defined server entries.
fn configuration(paths:&PiPaths,runtime:&RuntimePaths)->Result<(),PiError>{
    let directory=paths.pi_root.join("azcine-mcp");crate::pi_launch_plan::no_link(&directory)?;std::fs::create_dir_all(&directory).map_err(|_|pi("MCP 资源目录无法准备。"))?;
    let script=directory.join(format!("server-{:x}.mjs",Sha256::digest(SCRIPT.as_bytes())));crate::pi_launch_plan::no_link(&script)?;
    if !script.exists(){let mut file=OpenOptions::new().write(true).create_new(true).open(&script).map_err(|_|pi("MCP 协议资源无法创建。"))?;file.write_all(SCRIPT.as_bytes()).and_then(|_|file.sync_all()).map_err(|_|pi("MCP 协议资源无法保存。"))?;}
    else if std::fs::read(&script).map_err(|_|pi("MCP 协议资源无法读取。"))?!=SCRIPT.as_bytes(){return Err(pi("MCP 协议资源已被改动，未覆盖。"));}
    let path=paths.agent.join("mcp.json");let lock_path=paths.agent.join("azcine-mcp.lock");crate::pi_launch_plan::no_link(&path)?;crate::pi_launch_plan::no_link(&lock_path)?;
    let lock=OpenOptions::new().read(true).write(true).create(true).truncate(false).open(lock_path).map_err(|_|pi("MCP 配置锁无法打开。"))?;
    lock.try_lock().map_err(|_|pi("MCP 配置正在由其他窗口保存，请稍后重连。"))?;
    let old=read_config(&path)?;let mut config=match old.as_ref(){Some(bytes)=>serde_json::from_slice::<Value>(bytes).map_err(|_|pi("MCP 配置格式无效，未覆盖用户配置。"))?,None=>json!({})};
    let object=config.as_object_mut().ok_or_else(||pi("MCP 配置必须是对象，未覆盖。"))?;
    let servers=object.entry("mcpServers").or_insert_with(||json!({})).as_object_mut().ok_or_else(||pi("MCP 服务配置格式无效。"))?;
    if let Some(previous)=servers.get("azcine"){if previous["env"]["AZCINE_MCP_MANAGED"]!="1"{return Err(pi("已有本人配置的 azcine MCP，未覆盖；请调整服务名称后重连。"));}}
    let mut managed=json!({"type":"stdio","command":runtime.node,"args":[script],"env":{"AZCINE_MCP_MANAGED":"1"},"description":"AZCine 工作台：检索、读取各模块对象与版本，准备待本人核对的变更草案，查询保存回执及后台任务。","exposure":"codemode","toolExposure":{"get_context":"direct","list_capabilities":"direct"},"timeout":300});
    if let Some(previous)=servers.get("azcine"){for field in ["enabled","exposure","toolExposure"]{if let Some(value)=previous.get(field){managed[field]=value.clone();}}}
    servers.insert("azcine".into(),managed);
    let bytes=serde_json::to_vec_pretty(&config).map_err(|_|pi("MCP 配置无法序列化。"))?;
    if old.as_ref()==Some(&bytes){return Ok(());}
    let mut temporary=tempfile::NamedTempFile::new_in(&paths.agent).map_err(|_|pi("MCP 配置临时文件无法准备。"))?;temporary.write_all(&bytes).and_then(|_|temporary.as_file().sync_all()).map_err(|_|pi("MCP 配置写入失败。"))?;
    if read_config(&path)?!=old{return Err(pi("MCP 配置已被本人修改，未覆盖；请重连。"));}
    temporary.persist(&path).map_err(|_|pi("MCP 配置替换失败，原配置保留。"))?;Ok(())
}
fn read_config(path:&Path)->Result<Option<Vec<u8>>,PiError>{match File::open(path){Ok(file)=>{if file.metadata().map_err(|_|pi("MCP 配置无法读取。"))?.len()>1024*1024{return Err(pi("MCP 配置超过1MiB，未截断或覆盖。"));}let mut bytes=Vec::new();file.take(1024*1024+1).read_to_end(&mut bytes).map_err(|_|pi("MCP 配置无法读取。"))?;Ok(Some(bytes))},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(None),Err(_)=>Err(pi("MCP 配置无法读取。"))}}

fn binding(grants:&Mutex<HashMap<String,Owner>>,token:&str)->Result<Option<Binding>,StorageError>{
    let grants=grants.lock().map_err(|_|error("业务连接状态中断。"))?;
    match grants.get(token).ok_or_else(||error("业务连接已失效，请重新连接 Agent。"))?{
        Owner::Conversation{manager,generation,key,root}=>{
            let manager=manager.upgrade().ok_or_else(||error("Agent 进程已关闭。"))?;let state=manager.summary().map_err(|e|error(&e.message))?;
            if state["stopping"]==true||state["generation"].as_u64()!=Some(*generation)||!matches!(state["connection"].as_str(),Some("ready"|"connecting")){return Err(error("业务连接属于旧 Agent 进程，未执行。"));}
            Ok(state["sessionId"].as_str().filter(|s|!s.is_empty()).map(|session|Binding{root:root.clone(),key:key.clone(),session:session.into(),generation:*generation,background:false,input_id:state["businessInputId"].as_str().map(str::to_owned),message_index:state["businessMessageIndex"].as_u64().and_then(|n|usize::try_from(n).ok())}))
        },
        Owner::Job(context)=>Ok(context.lock().map_err(|_|error("任务会话状态中断。"))?.clone()),
    }
}
fn serve(app:&tauri::AppHandle,grants:&Arc<Mutex<HashMap<String,Owner>>>,mut stream:TcpStream){
    let _=stream.set_read_timeout(Some(Duration::from_secs(10)));let _=stream.set_write_timeout(Some(Duration::from_secs(15)));
    let result=(||->Result<Value,StorageError>{let mut raw=Vec::new();BufReader::new(&mut stream).take(8*1024*1024+1).read_until(b'\n',&mut raw).map_err(|_|error("业务请求读取失败。"))?;
        if raw.len()>8*1024*1024||raw.last()!=Some(&b'\n'){return Err(error("业务请求超过上限或未完整收到。"));}
        let request:Value=serde_json::from_slice(&raw).map_err(|_|error("业务请求格式无效。"))?;let token=request["grant"].as_str().ok_or_else(||error("缺少业务连接凭据。"))?;
        let owner=binding(grants,token)?;let method=request["method"].as_str().ok_or_else(||error("业务请求缺少方法。"))?;let params=request["params"].clone();
        if method=="tools/list"{return Ok(json!({"tools":crate::agent_mcp_tools::tools()}));}
        if method=="resources/templates/list"{return Ok(json!({"resourceTemplates":[]}));}
        if method=="resources/list"{return Ok(json!({"resources":[{"uri":"azcine://context","name":"当前工作台上下文","mimeType":"application/json"}]}));}
        let owner=owner.ok_or_else(||error("Agent 尚未完成连接，请稍后重试。"))?;
        let current=binding(grants,token)?.ok_or_else(||error("会话连接已变化。"))?;
        if current.key!=owner.key||current.session!=owner.session||current.generation!=owner.generation||current.input_id!=owner.input_id{return Err(error("Agent 会话已切换，未执行旧请求。"));}
        if method=="resources/read"{if params["uri"]!="azcine://context"{return Err(error("资源不存在。"));}let value=dispatch(app,grants,token,&owner,"get_context",json!({}))?;return Ok(json!({"contents":[{"uri":"azcine://context","mimeType":"application/json","text":serde_json::to_string(&value).map_err(|_|error("上下文编码失败。"))?}]}));}
        if method!="tools/call"{return Err(error("不支持此 MCP 方法。"));}
        let name=params["name"].as_str().ok_or_else(||error("缺少工具名称。"))?;
        let value=dispatch(app,grants,token,&owner,name,params.get("arguments").cloned().unwrap_or_else(||json!({})))?;
        if value.get("attachmentImage").is_some(){return Ok(json!({"content":[{"type":"text","text":serde_json::to_string(&value["metadata"]).map_err(|_|error("附件元数据编码失败。"))?}],"attachmentImage":value["attachmentImage"]}));}
        Ok(json!({"content":[{"type":"text","text":serde_json::to_string(&value).map_err(|_|error("工具结果编码失败。"))?}],"isError":false}))
    })();
    let reply=match result{Ok(result)=>json!({"result":result}),Err(e)=>json!({"error":e.message})};
    if let Ok(mut bytes)=serde_json::to_vec(&reply){
        if bytes.len()>15*1024*1024{bytes=serde_json::to_vec(&json!({"error":"结果超过单次传输上限，请缩小查询或按字段分页。写入/任务可能已完成，请先查询草案或任务状态，勿重复提交。"})).unwrap_or_default();}
        bytes.push(b'\n');let _=stream.write_all(&bytes);
    }
}
fn dispatch(app:&tauri::AppHandle,grants:&Arc<Mutex<HashMap<String,Owner>>>,token:&str,owner:&Binding,name:&str,args:Value)->Result<Value,StorageError>{
    if app.state::<crate::pi_commands::PiExit>().0.load(Ordering::Acquire)!=0{return Err(error("应用正在退出。"));}
    if !args.is_object(){return Err(error("工具参数必须是对象。"));}
    let expected_root=owner.root.clone();let key=owner.key.clone();
    tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let store=m.store()?;if store.root!=expected_root{return Err(error("数据根已变化，请重新连接Agent。"));}store.agent_check_open(&key,None)}))?;
    if let Some(task)=crate::agent_mcp_tools::task(app,owner,name,&args){return task;}
    let providers=app.state::<Providers>().inner().clone();let owner=owner.clone();let grants=grants.clone();let token=token.to_owned();let name=name.to_owned();let draft=name=="prepare_changes";
    let result=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|manager|{
        let store=manager.store()?;let current=binding(&grants,&token)?.ok_or_else(||error("会话连接已关闭。"))?;
        if current.session!=owner.session||current.key!=owner.key||current.input_id!=owner.input_id||store.root!=owner.root{return Err(error("会话或数据根已变化，未执行。"));}
        crate::agent_mcp_tools::storage(store,&providers,&owner,&name,args)
    }));
    if result.is_ok()&&draft{let _=app.emit_to("main","azcine-agent-data-changed",());}result
}
