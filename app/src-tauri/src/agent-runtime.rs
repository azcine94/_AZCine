//! App-side routing and admission, outside the unmodified upstream processes.
use crate::{pi_manager::{PiManager,PiError,Notify,SendInput,SendReceipt},pi_launch_plan::{PiPaths,no_link}};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::{collections::{HashMap,HashSet},path::{Path,PathBuf},sync::{Arc,Mutex},time::{Duration,Instant},fs::{File,OpenOptions},io::{Read,Write}};
const IDLE_TIMEOUT:Duration=Duration::from_secs(600);
struct Slot{manager:Arc<PiManager>,used:Instant}
struct Pool{slots:HashMap<String,Slot>,sending:HashSet<String>,connecting:HashSet<String>,deleting:HashSet<String>,retired:HashSet<String>,limit:usize,revision:u64,loaded_root:Option<PathBuf>,exiting:bool}
impl Default for Pool{fn default()->Self{Self{slots:HashMap::new(),sending:HashSet::new(),connecting:HashSet::new(),deleting:HashSet::new(),retired:HashSet::new(),limit:3,revision:0,loaded_root:None,exiting:false}}}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ConversationDelete{pub conversation_key:Option<String>,pub session_path:Option<String>,pub session_id:String,pub generation:Option<u64>}
#[derive(Default)]
pub struct AgentRuntime{pool:Mutex<Pool>,connect_operation:Mutex<()>}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Config{version:u32,revision:u64,reply_limit:usize}
fn interrupted()->PiError{PiError::new("pi_runtime_interrupted","会话调度中断；输入仍保留，请核对运行状态。")}
fn key(value:&str)->Result<(),PiError>{if value.is_empty()||value.len()>200||!value.bytes().all(|c|c.is_ascii_alphanumeric()||matches!(c,b'-'|b'_'|b':')){Err(PiError::new("pi_conversation_invalid","会话来源标识无效，未发送。"))}else{Ok(())}}
fn config_path(root:&Path)->Result<PathBuf,PiError>{Ok(PiPaths::prepare(root)?.pi_root.join("azcine-runtime.json"))}
fn read_config(path:&Path)->Result<Config,PiError>{
    no_link(path)?;let file=match File::open(path){Ok(f)=>f,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Config{version:1,revision:0,reply_limit:3}),Err(_)=>return Err(interrupted())};
    let mut bytes=Vec::new();file.take(4097).read_to_end(&mut bytes).map_err(|_|interrupted())?;
    let config:Config=serde_json::from_slice(&bytes).map_err(|_|PiError::new("pi_runtime_config","并行设置损坏，未用默认值覆盖。"))?;
    if bytes.len()>4096||config.version!=1||!(1..=64).contains(&config.reply_limit){return Err(PiError::new("pi_runtime_config","并行设置无效，未覆盖。"));}Ok(config)
}
impl AgentRuntime{
    pub fn manager(&self,conversation:&str)->Result<Arc<PiManager>,PiError>{
        key(conversation)?;let mut pool=self.pool.lock().map_err(|_|interrupted())?;
        if pool.exiting{return Err(PiError::new("pi_app_exiting","应用正在退出，未接受新操作。"));}
        if pool.deleting.contains(conversation)||pool.retired.contains(conversation){return Err(PiError::new("agent_conversation_deleted","会话正在删除或已经删除，请开始新会话。"));}
        if !pool.slots.contains_key(conversation)&&pool.slots.len()>=256{return Err(PiError::new("pi_conversation_limit","本次运行的会话来源过多，请先退出并重开应用；原生历史保留。"));}
        let slot=pool.slots.entry(conversation.into()).or_insert_with(||Slot{manager:Arc::new(PiManager::default()),used:Instant::now()});Ok(slot.manager.clone())
    }
    fn touch(&self,conversation:&str)->Result<(),PiError>{let mut pool=self.pool.lock().map_err(|_|interrupted())?;if let Some(slot)=pool.slots.get_mut(conversation){slot.used=Instant::now();}Ok(())}
    pub fn load(&self,root:&Path)->Result<(),PiError>{let path=config_path(root)?;let config=read_config(&path)?;let mut pool=self.pool.lock().map_err(|_|interrupted())?;pool.limit=config.reply_limit;pool.revision=config.revision;pool.loaded_root=Some(root.into());Ok(())}
    pub fn connect(&self,conversation:&str,root:&Path,resources:&Path,cwd:Option<&Path>,session:Option<&Path>,reconnect:bool,notify:Notify)->Result<Value,PiError>{
        let _operation=self.connect_operation.lock().map_err(|_|interrupted())?;
        self.load(root)?;let manager=self.manager(conversation)?;self.touch(conversation)?;
        if manager.resident()?&&!reconnect{return manager.snapshot();}
        let victim={let mut pool=self.pool.lock().map_err(|_|interrupted())?;
            if pool.connecting.contains(conversation){return Err(PiError::new("pi_busy","会话正在连接，请等待；输入保留。"));}
            let residents=pool.slots.values().filter(|s|s.manager.resident().unwrap_or(true)).count()+pool.connecting.len();
            let victim=if !manager.resident()?&&residents>=pool.limit+2{
                let selected=pool.slots.iter().filter(|(k,s)|k.as_str()!=conversation&&!pool.sending.contains(*k)&&!pool.connecting.contains(*k)&&s.manager.resident().unwrap_or(false)&&!s.manager.active().unwrap_or(true)).min_by_key(|(_,s)|s.used).map(|(_,s)|s.manager.clone());
                if selected.is_none(){return Err(PiError::new("pi_resident_limit","当前会话进程均在忙碌，无法释放空闲名额；输入保留。"));}selected
            }else{None};pool.connecting.insert(conversation.into());victim};
        let result=(||{if let Some(v)=victim{v.suspend(Arc::new(||{}))?;}
            let summary=manager.summary()?;
            let prior=summary["sessionFile"].as_str().map(PathBuf::from).filter(|p|p.is_file());
            let prior_cwd=summary["cwd"].as_str().map(PathBuf::from);
            manager.connect(root,resources,cwd.or(prior_cwd.as_deref()),session.or(prior.as_deref()),notify)
        })();
        if let Ok(mut pool)=self.pool.lock(){pool.connecting.remove(conversation);}result
    }
    pub fn send(&self,conversation:&str,input:SendInput,notify:Notify)->Result<SendReceipt,PiError>{self.send_inner(conversation,input,notify,None)}
    pub fn send_business(&self,conversation:&str,input:SendInput,notify:Notify,input_id:String)->Result<SendReceipt,PiError>{self.send_inner(conversation,input,notify,Some(input_id))}
    fn send_inner(&self,conversation:&str,input:SendInput,notify:Notify,input_id:Option<String>)->Result<SendReceipt,PiError>{
        let manager=self.manager(conversation)?;self.touch(conversation)?;
        {let mut pool=self.pool.lock().map_err(|_|interrupted())?;
            if pool.sending.contains(conversation)||pool.deleting.contains(conversation)||pool.retired.contains(conversation){return Err(PiError::new("pi_busy","此会话正在发送或删除，请等待；输入保留。"));}
            let running=pool.slots.iter().filter(|(k,s)|k.as_str()!=conversation&&(pool.sending.contains(*k)||s.manager.active().unwrap_or(true))).count();
            if !manager.active()?&&running>=pool.limit{return Err(PiError::new("pi_reply_limit","已达到同时回复上限；本次未排队，文字与附件保留。"));}
            pool.sending.insert(conversation.into());
        }
        let result=match input_id{Some(id)=>manager.send_business(input,notify,id),None=>manager.send(input,notify)};
        if let Ok(mut pool)=self.pool.lock(){pool.sending.remove(conversation);}result
    }
    pub fn summary(&self)->Result<Value,PiError>{let pool=self.pool.lock().map_err(|_|interrupted())?;let slots=pool.slots.iter().map(|(key,s)|{let mut value=s.manager.summary()?;value["conversationKey"]=json!(key);Ok(value)}).collect::<Result<Vec<_>,PiError>>()?;let active=slots.iter().filter(|s|s["active"]==true).count();Ok(json!({"replyLimit":pool.limit,"revision":pool.revision,"active":active,"conversations":slots}))}
    pub fn delete_idle(&self,root:&Path,target:&ConversationDelete,save:impl FnOnce(&[String],Option<&str>)->Result<Value,PiError>)->Result<Value,PiError>{
        let _operation=self.connect_operation.lock().map_err(|_|interrupted())?;
        if target.session_id.is_empty()||target.session_id.len()>500{return Err(PiError::new("pi_stale_session","会话标识无效，未删除。"));}
        let mut path=target.session_path.clone();
        if let Some(key)=target.conversation_key.as_deref(){
            let pool=self.pool.lock().map_err(|_|interrupted())?;let slot=pool.slots.get(key).ok_or_else(||PiError::new("pi_stale_session","会话列表已变化，请刷新后重试。"))?;let snapshot=slot.manager.summary()?;
            if snapshot["sessionId"].as_str()!=Some(target.session_id.as_str())||snapshot["generation"].as_u64()!=target.generation{return Err(PiError::new("pi_stale_session","会话已经切换，未按旧列表删除。"));}
            path=snapshot["sessionFile"].as_str().map(str::to_owned);
        }else if path.is_none(){return Err(PiError::new("pi_stale_session","缺少已保存会话，未删除。"));}
        if let Some(saved)=path.as_deref(){
            if Path::new(saved).is_file(){let paths=PiPaths::prepare(root)?;let session=crate::pi_sessions::validate_session(&paths,Path::new(saved))?;
                if session.id!=target.session_id{return Err(PiError::new("pi_stale_session","原生会话文件已变化，未删除。"));}path=Some(session.path);
            }else if target.conversation_key.is_none(){return Err(PiError::new("pi_stale_session","会话文件无法读取，未删除。"));}
        }
        let selected={let mut pool=self.pool.lock().map_err(|_|interrupted())?;if pool.exiting{return Err(PiError::new("pi_app_exiting","应用正在退出，未删除会话。"));}
            let mut selected=Vec::new();for (key,slot) in &pool.slots{let summary=slot.manager.summary()?;
                let matches=target.conversation_key.as_deref()==Some(key.as_str())||path.as_deref().zip(summary["sessionFile"].as_str()).is_some_and(|(a,b)|crate::agent_store::session_path_key(a)==crate::agent_store::session_path_key(b));
                if matches{if pool.sending.contains(key)||pool.connecting.contains(key)||pool.deleting.contains(key)||summary["active"]==true||summary["waiting"]==true{return Err(PiError::new("pi_busy","会话正在运行、连接或等待回答，请先结束后再删除。"));}selected.push((key.clone(),slot.manager.clone()));}
            }
            for (key,_) in &selected{pool.deleting.insert(key.clone());}selected
        };
        let keys=selected.iter().map(|(key,_)|key.clone()).collect::<Vec<_>>();
        let result=(||{for (_,manager) in &selected{manager.suspend(Arc::new(||{}))?;}save(&keys,path.as_deref())})();
        let mut pool=self.pool.lock().map_err(|_|interrupted())?;
        for key in &keys{pool.deleting.remove(key);if result.is_ok(){pool.slots.remove(key);pool.retired.insert(key.clone());}}
        result
    }
    pub fn save_limit(&self,root:&Path,limit:usize,revision:u64)->Result<Value,PiError>{
        if !(1..=64).contains(&limit){return Err(PiError::new("pi_limit_invalid","同时回复数需为1至64；较大的值可能增加资源占用。"));}
        let path=config_path(root)?;let lock=path.with_extension("lock");no_link(&lock)?;
        let mut options=OpenOptions::new();options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]{use std::os::windows::fs::OpenOptionsExt;options.share_mode(0x1|0x2);}
        let file=options.open(lock).map_err(|_|interrupted())?;file.try_lock().map_err(|_|PiError::new("pi_runtime_config_busy","另一操作正在保存并行设置，输入保留。"))?;
        let before=read_config(&path)?;if before.revision!=revision{return Err(PiError::new("pi_runtime_config_conflict","并行设置已经变化，请重新读取；输入保留。"));}
        let config=Config{version:1,revision:revision.checked_add(1).ok_or_else(interrupted)?,reply_limit:limit};
        let mut temp=tempfile::NamedTempFile::new_in(path.parent().ok_or_else(interrupted)?).map_err(|_|interrupted())?;temp.write_all(&serde_json::to_vec(&config).map_err(|_|interrupted())?).map_err(|_|interrupted())?;temp.as_file().sync_all().map_err(|_|interrupted())?;temp.persist(path).map_err(|_|interrupted())?;
        self.load(root)?;self.summary()
    }
    pub fn tick(&self,notify:impl Fn(&str)->Notify)->Result<(),PiError>{
        let slots={let pool=self.pool.lock().map_err(|_|interrupted())?;if pool.exiting{return Ok(());}pool.slots.iter().filter(|(key,_)|!pool.connecting.contains(*key)&&!pool.sending.contains(*key)&&!pool.deleting.contains(*key)).map(|(key,s)|(key.clone(),s.manager.clone(),s.used)).collect::<Vec<_>>()};
        for (key,m,used) in slots{let n=notify(&key);m.expire_ui(&n)?;if m.active()?{if let Ok(mut pool)=self.pool.lock(){if let Some(slot)=pool.slots.get_mut(&key){slot.used=Instant::now();}}}else if used.elapsed()>=IDLE_TIMEOUT&&m.resident()?{m.suspend(n)?;}}
        Ok(())
    }
    pub fn set_exiting(&self,exiting:bool){if let Ok(mut pool)=self.pool.lock(){pool.exiting=exiting;for s in pool.slots.values(){s.manager.set_exiting(exiting);}}}
    pub fn shutdown(&self,notify:Notify)->Result<(),PiError>{
        let managers=self.pool.lock().map_err(|_|interrupted())?.slots.values().map(|s|s.manager.clone()).collect::<Vec<_>>();let mut first=None;
        for m in managers{if let Err(e)=m.disconnect(notify.clone()){if first.is_none(){first=Some(e);}}}if let Some(e)=first{Err(e)}else{Ok(())}
    }
}
