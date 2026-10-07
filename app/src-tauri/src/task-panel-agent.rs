use crate::storage::{StorageError,Store};
use crate::task_panel_store::{db_error,encode,event,expected,id_ok,invalid,new_id,now,receipt,request,task};
use crate::task_panel_paths::hash;
use rusqlite::{OptionalExtension,params};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::io::{Read,Write};
use std::net::{TcpListener,TcpStream};
use std::path::{Path,PathBuf};
use std::sync::{Arc,Mutex,atomic::{AtomicBool,AtomicUsize,Ordering}};
use std::time::Duration;
use tauri::Manager;

#[derive(Clone)]
pub struct Endpoint {pub port:u16,pub session_id:String}
#[derive(Default)]
pub struct AgentAccessState(Mutex<Option<RunningEndpoint>>);
struct RunningEndpoint { endpoint:Endpoint, stopping:Arc<AtomicBool>, worker:std::thread::JoinHandle<()> }

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct WireRequest {workspace:String,protocol:u32,session_id:String,grant_id:String,token:String,request_id:String,method:String,#[serde(default)]params:Value}
#[derive(Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AccessInput {pub request_id:String,pub task_id:String,pub expected_revision:i64,#[serde(default)]pub directory:String,pub approved:bool}
#[derive(Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct RevokeInput {pub request_id:String,pub id:String}
#[derive(Deserialize,Serialize,Clone)]
#[serde(rename_all="camelCase")]
pub struct AccessSummary {pub id:String,pub task_id:String,pub project_id:String,pub task_revision:i64,pub directory:String,pub active:bool,pub created_at:String,pub command:String,pub reason:String}

pub fn ensure_endpoint(app:&tauri::AppHandle)->Result<Endpoint,StorageError>{
    let state=app.state::<AgentAccessState>();let mut guard=state.0.lock().map_err(|_|invalid("Agent 接入状态不可用。"))?;
    if let Some(running)=guard.as_ref(){return Ok(running.endpoint.clone());}
    let listener=TcpListener::bind(("127.0.0.1",0)).map_err(|_|invalid("本机 Agent 接入口未能建立。"))?;
    listener.set_nonblocking(true).map_err(|_|invalid("本机接入口无法配置。"))?;
    let endpoint=Endpoint{port:listener.local_addr().map_err(|_|invalid("本机接入地址不可读。"))?.port(),session_id:format!("{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default())};
    let owner=app.clone();let session=endpoint.session_id.clone();
    let stopping=Arc::new(AtomicBool::new(false));let stop=stopping.clone();
    let worker=std::thread::Builder::new().name("task-panel-agent-access".into()).spawn(move||{
        let active=Arc::new(AtomicUsize::new(0));
        while !stop.load(Ordering::Acquire){
            let socket=match listener.accept(){Ok((socket,_))=>socket,Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{std::thread::sleep(Duration::from_millis(50));continue;},Err(_)=>break};
            if active.fetch_add(1,Ordering::SeqCst)>=8{active.fetch_sub(1,Ordering::SeqCst);continue;}
            let owner=owner.clone();let session=session.clone();let count=active.clone();
            if std::thread::Builder::new().name("task-panel-agent-request".into()).spawn(move||{serve(socket,owner,session);count.fetch_sub(1,Ordering::SeqCst);}).is_err(){active.fetch_sub(1,Ordering::SeqCst);}
        }
    }).map_err(|_|invalid("Agent 接入口启动失败。"))?;
    *guard=Some(RunningEndpoint{endpoint:endpoint.clone(),stopping,worker});Ok(endpoint)
}

// Release the listener and its AppHandle before the desktop runtime shuts down.
pub fn shutdown(app:&tauri::AppHandle){
    let state=app.state::<AgentAccessState>();
    let running=state.0.lock().ok().and_then(|mut guard|guard.take());
    if let Some(running)=running {running.stopping.store(true,Ordering::Release);let _=running.worker.join();}
}

fn serve(mut socket:TcpStream,app:tauri::AppHandle,session:String){
    let _=socket.set_read_timeout(Some(Duration::from_secs(5)));let _=socket.set_write_timeout(Some(Duration::from_secs(5)));
    let result=(||->Result<Value,StorageError>{
        let mut header=[0;4];socket.read_exact(&mut header).map_err(|_|invalid("请求头缺失。"))?;
        let length=u32::from_be_bytes(header)as usize;if length==0||length>262144{return Err(invalid("请求超过范围。"));}
        let mut bytes=vec![0;length];socket.read_exact(&mut bytes).map_err(|_|invalid("请求未完整接收。"))?;
        let input:WireRequest=serde_json::from_slice(&bytes).map_err(|_|invalid("请求格式无效。"))?;
        tauri::async_runtime::block_on(crate::task_panel_workspace::with_store(app,input.workspace.clone(),move|store|store.agent_request(&session,input)))
    })();
    let response=match result{Ok(value)=>json!({"ok":true,"result":value}),Err(error)=>json!({"ok":false,"error":error})};
    if let Ok(bytes)=serde_json::to_vec(&response){let bytes=if bytes.len()>2097152{serde_json::to_vec(&json!({"ok":false,"error":{"code":"response_limit","message":"查询结果过大，请分页或缩小范围。"}})).unwrap_or_default()}else{bytes};let _=socket.write_all(&(bytes.len()as u32).to_be_bytes());let _=socket.write_all(&bytes);}
}

fn access_paths(directory:&Path,id:&str)->(PathBuf,PathBuf){(directory.join(format!("{id}-access.json")),directory.join(format!("{id}-cli.mjs")))}
fn create_file(path:&Path,bytes:&[u8])->Result<(),StorageError>{let mut file=std::fs::OpenOptions::new().create_new(true).write(true).open(path).map_err(|_|invalid("接入产物未能保存；已有文件保持原样。"))?;file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|_|invalid("接入文件保存未完成，保留部分产物，请核对。"))}
fn command(node:&Path,script:&Path,access:&Path)->String{format!("& '{}' '{}' --access '{}' frontier",node.to_string_lossy().replace('\'',"''"),script.to_string_lossy().replace('\'',"''"),access.to_string_lossy().replace('\'',"''"))}

impl Store {
    pub fn task_panel_agent_access(&mut self,input:AccessInput,endpoint:Endpoint,node:PathBuf)->Result<AccessSummary,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        let t=task(&self.db,&input.task_id)?;expected(t.revision,Some(input.expected_revision))?;
        if !input.approved{return Err(invalid("请确认本任务查询与候选回填范围。"));}
        let project=crate::task_panel_projects::plan(&self.db,&t.id)?.project_id.ok_or_else(||invalid("先明确任务所属项目，再开放 Agent 查询。"))?;
        let automatic=if self.task_workspace.is_some(){Some(crate::task_panel_workspace::directory(&self.task_directory(&t.id)?,"access")?)}else{None};
        let path=automatic.as_deref().unwrap_or_else(||Path::new(&input.directory));if !path.is_absolute()||!path.is_dir(){return Err(invalid("请选择存在的专用交换目录。"));}
        let directory=std::fs::canonicalize(path).map_err(|_|invalid("交换目录不可核对。"))?;
        let own=std::fs::canonicalize(&self.root).map_err(|_|invalid("业务根不可核对。"))?;
        if directory==own||directory.starts_with(own.join("db"))||directory.starts_with(own.join("pi"))||crate::task_panel_paths::sensitive(&directory.to_string_lossy()){return Err(invalid("请选择独立交换目录，不能使用数据库、Pi 状态或凭据目录。"));}
        let tx=self.db.transaction().map_err(db_error)?;let id=new_id(&tx,"access")?;
        let token:String=tx.query_row("SELECT lower(hex(randomblob(32)))",[],|r|r.get(0)).map_err(db_error)?;
        let (access,script)=access_paths(&directory,&id);
        let summary=AccessSummary{id:id.clone(),task_id:t.id.clone(),project_id:project.clone(),task_revision:t.revision,directory:directory.to_string_lossy().into_owned(),active:true,created_at:now(),command:command(&node,&script,&access),reason:"仅可查询所属项目、读取本任务范围源码、提交本任务候选与回执；不授予执行、测试或验收权限。任务修订或应用重启后需重新开放。".into()};
        create_file(&script,include_bytes!("../../resources/task-panel-cli.mjs"))?;
        let file=json!({"workspace":self.task_workspace.as_ref(),"protocol":1,"host":"127.0.0.1","port":endpoint.port,"sessionId":endpoint.session_id,"grantId":id,"token":token,"taskId":t.id,"projectId":project,"taskRevision":t.revision});
        create_file(&access,&serde_json::to_vec_pretty(&file).map_err(|_|invalid("接入文件无法编码。"))?)?;
        tx.execute("INSERT INTO tp_agent_grants VALUES(?1,?2,?3,?4,?5,?6,?7,0,?8)",params![id,t.id,project,t.revision,hash(token.as_bytes()),endpoint.session_id,summary.directory,summary.created_at]).map_err(db_error)?;
        event(&tx,&input.request_id,&t.id,"agent_access_granted","user","本任务的项目查询与候选回填入口已开放；访问凭证不进入日志或上下文")?;
        receipt(&tx,&input.request_id,&encoded,&summary)?;tx.commit().map_err(db_error)?;Ok(summary)
    }

    pub fn task_panel_agent_revoke(&mut self,input:RevokeInput)->Result<String,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        let tx=self.db.transaction().map_err(db_error)?;
        let task:String=tx.query_row("SELECT task_id FROM tp_agent_grants WHERE id=?1",[&input.id],|r|r.get(0)).optional().map_err(db_error)?.ok_or_else(||invalid("接入记录不存在。"))?;
        tx.execute("UPDATE tp_agent_grants SET revoked=1 WHERE id=?1",[&input.id]).map_err(db_error)?;
        event(&tx,&input.request_id,&task,"agent_access_revoked","user","本任务查询凭据已撤销，原文件保留")?;
        let result="接入已撤销".to_string();receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
    }

    pub fn task_panel_agent_accesses(&self,session:Option<&str>)->Result<Vec<AccessSummary>,StorageError>{
        let mut rows=self.db.prepare("SELECT g.id,g.task_id,g.project_id,g.task_revision,g.directory,g.revoked,g.created_at,g.session_id,t.revision,coalesce((SELECT json_extract(result,'$.command') FROM tp_requests WHERE json_extract(result,'$.id')=g.id LIMIT 1),'') FROM tp_agent_grants g JOIN tp_tasks t ON t.id=g.task_id ORDER BY g.created_at DESC LIMIT 300").map_err(db_error)?;
        rows.query_map([],|r|{let active=r.get::<_,i64>(5)?==0&&Some(r.get::<_,String>(7)?.as_str())==session&&r.get::<_,i64>(3)?==r.get::<_,i64>(8)?;Ok(AccessSummary{id:r.get(0)?,task_id:r.get(1)?,project_id:r.get(2)?,task_revision:r.get(3)?,directory:r.get(4)?,active,created_at:r.get(6)?,command:r.get(9)?,reason:if active{"本次应用内有效"}else{"已撤销、任务已修订或应用已重启"}.into()})}).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
    }

    fn agent_request(&mut self,session:&str,input:WireRequest)->Result<Value,StorageError>{
        if input.protocol!=1||input.session_id!=session||!id_ok(&input.grant_id)||!id_ok(&input.request_id)||input.token.len()!=64{return Err(invalid("接入身份无效或已失效。"));}
        let grant:Option<(String,String,i64,String,String)>=self.db.query_row("SELECT task_id,project_id,task_revision,token_hash,directory FROM tp_agent_grants WHERE id=?1 AND session_id=?2 AND revoked=0",params![input.grant_id,session],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(db_error)?;
        let (task_id,project_id,revision,digest,directory)=grant.ok_or_else(||invalid("接入已撤销或不存在。"))?;
        if hash(input.token.as_bytes())!=digest{return Err(invalid("接入身份无效。"));}
        let t=task(&self.db,&task_id)?;expected(t.revision,Some(revision))?;
        if crate::task_panel_projects::plan(&self.db,&task_id)?.project_id.as_ref()!=Some(&project_id){return Err(invalid("任务项目归属已改变。"));}
        let request_id=format!("agent:{}:{}",input.grant_id,input.request_id);
        let encoded=encode(&json!({"method":input.method,"params":input.params,"taskId":task_id,"taskRevision":revision}))?;
        match input.method.as_str(){
            "frontier"=>{
                let snapshot=self.task_panel_snapshot_scoped(Some(&project_id))?;
                let tasks:Vec<_>=snapshot.tasks.into_iter().filter(|v|v.plan.project_id.as_ref()==Some(&project_id)).map(|v|json!({"id":v.task.id,"title":v.task.title,"revision":v.task.revision,"plan":v.plan,"kind":v.object_kind,"lane":v.lane,"reasons":v.reason_codes,"blockers":v.blockers,"allowedActions":v.allowed_actions,"executionState":v.execution_state,"checkState":v.check_state,"acceptanceState":v.acceptance_state})).collect();
                Ok(json!({"projectId":project_id,"tasks":tasks,"observedAt":now(),"authorization":"可执行状态不授予动作权限，执行沿用 Herdr 和本人授权"}))
            },
            "task"=>{let plan=crate::task_panel_projects::plan(&self.db,&task_id)?;let memories:Vec<_>=crate::task_panel_store::memories_scoped(&self.db,Some(&project_id))?.into_iter().filter(|m|crate::task_panel_context::applicable(m,&task_id,&plan,t.repository_id.as_deref())&&["active","draft"].contains(&m.status.as_str())).collect();Ok(json!({"task":t,"plan":plan,"memories":memories,"observedAt":now()}))},
            "context"=>serde_json::to_value(self.task_panel_context(crate::task_panel_context::ContextInput{request_id,task_id,expected_revision:revision})?).map_err(|_|invalid("上下文编码失败。")),
            "graph"=>{
                let mut query:crate::task_panel_graph::GraphQuery=serde_json::from_value(input.params).map_err(|_|invalid("图查询参数无效。"))?;
                if query.project_id.as_ref().is_some_and(|p|p!=&project_id){return Err(invalid("不能查询其他项目。"));}query.project_id=Some(project_id);
                query.workspace_task_id=Some(task_id.clone());
                if query.limit==0{query.limit=60;}if query.limit>100{return Err(invalid("Agent 图查询每页最多 100 项。"));}
                serde_json::to_value(self.task_panel_graph(query)?).map_err(|_|invalid("图查询编码失败。"))
            },
            "source"=>{
                let id=input.params["id"].as_str().ok_or_else(||invalid("请提供来源对象 ID。"))?;
                let plan=crate::task_panel_projects::plan(&self.db,&task_id)?;
                if let Some(memory)=crate::task_panel_store::memories_scoped(&self.db,Some(&project_id))?.into_iter().find(|m|m.id==id&&crate::task_panel_context::applicable(m,&task_id,&plan,t.repository_id.as_deref())){return Ok(json!({"memory":memory,"meaning":"原始记录及引用，采纳不等于事实已验证"}));}
                if let Some(e)=crate::task_panel_store::evidence(&self.db)?.into_iter().find(|e|(e.id==id||e.kind=="receipt"&&e.detail["id"].as_str()==Some(id))&&e.task_id==task_id){let original=if e.path.is_empty(){None}else{let b=crate::task_panel_paths::protected_absolute(Path::new(&e.path),8_000_000)?;if hash(&b)!=e.hash{return Err(invalid("证据原件已改变。"));}Some(String::from_utf8_lossy(&b).chars().take(32000).collect::<String>())};return Ok(json!({"evidence":e,"original":original,"originalLimitCharacters":32000,"truncated":original.as_ref().is_some_and(|s|s.chars().count()==32000),"sourceLevel":"observed_original_not_semantic_verification"}));}
                let mut node=crate::task_panel_store::nodes(&self.db)?.into_iter().find(|n|n.id==id&&n.repository_id==t.repository_id&&!n.path.is_empty()).ok_or_else(||invalid("来源不属于本任务可读范围。"))?;
                let repo=crate::task_panel_locations::execution_repository(&self.db,&t)?;
                let path=crate::task_panel_paths::scoped_file(Path::new(&repo.path),&node.path,&t.scope)?;
                let bytes=crate::task_panel_paths::read_limited(&path,2_000_000)?;let text=String::from_utf8(bytes.clone()).map_err(|_|invalid("该来源不是 UTF-8 文本。"))?;
                let start=input.params["lineStart"].as_u64().unwrap_or(1).clamp(1,2_000_001)as usize;let count=input.params["lines"].as_u64().unwrap_or(100).clamp(1,200)as usize;
                let current_hash=hash(&bytes);let refs=node.sources.as_array().cloned().unwrap_or_else(||vec![node.sources.clone()]);let indexed:Vec<_>=refs.iter().filter(|s|s["path"].as_str()==Some(node.path.as_str())).filter_map(|s|s["sha256"].as_str()).collect();
                let indexed_source_matches=if indexed.is_empty(){None}else{Some(indexed.iter().all(|s|*s==current_hash))};if indexed_source_matches==Some(false){node.stale=true;}
                let lines:Vec<_>=text.lines().collect();let selected=lines.iter().skip(start-1).take(count).copied().collect::<Vec<_>>().join("\n");
                Ok(json!({"node":node,"path":path,"sha256":current_hash,"indexedSourceMatches":indexed_source_matches,"lineStart":start,"lineCount":count.min(lines.len().saturating_sub(start-1)),"totalLines":lines.len(),"text":selected,"truncated":start>1||start-1+count<lines.len(),"observedAt":now()}))
            },
            "propose_memory"=>{
                if let Some(prior)=request(&self.db,&request_id,&encoded)?{return Ok(prior);}
                let body=input.params["body"].as_str().ok_or_else(||invalid("候选正文缺失。"))?;let kind=input.params["kind"].as_str().unwrap_or("memory");
                let tx=self.db.transaction().map_err(db_error)?;
                let refs=json!({"accessId":input.grant_id,"claimedSources":input.params["sources"]});
                let id=crate::task_panel_store::memory_candidate(&tx,&t,kind,body,"Agent 本任务接入回填",&refs)?;
                event(&tx,&request_id,&task_id,"agent_memory_candidate","claim","Agent 提交候选；普通参考可供检索，重要决定等待本人确认")?;
                let requires_decision=["decision","requirement","goal"].contains(&kind);
                let result=json!({"id":id,"status":"draft","level":"claim","requiresDecision":requires_decision});receipt(&tx,&request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
            },
            "submit_result"=>{
                let run=input.params["executionId"].as_str().ok_or_else(||invalid("执行 ID 缺失。"))?;
                if !crate::task_panel_store::executions(&self.db)?.iter().any(|e|e.id==run&&e.task_id==task_id){return Err(invalid("不能回填其他任务的执行。"));}
                let relative=input.params["path"].as_str().ok_or_else(||invalid("回执文件相对路径缺失。"))?;
                let task_root=if self.task_workspace.is_some(){self.task_directory(&task_id)?}else{PathBuf::from(&directory)};
                let file=crate::task_panel_paths::scoped_file(&task_root,relative,&[".".into()])?;
                serde_json::to_value(self.task_panel_result(crate::task_panel_evidence::ResultInput{request_id,execution_id:run.into(),path:file.to_string_lossy().into_owned()})?).map_err(|_|invalid("回执编码失败。"))
            },
            _=>Err(invalid("此入口只开放 frontier/task/context/graph/source/propose_memory/submit_result；不会执行命令、审批或验收。")),
        }
    }
}

pub fn session(app:&tauri::AppHandle)->Option<String>{app.state::<AgentAccessState>().0.lock().ok().and_then(|g|g.as_ref().map(|e|e.endpoint.session_id.clone()))}
