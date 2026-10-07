use crate::herdr_adapter::{self,HerdrConfig,HerdrSession};
use crate::storage::{StorageError,Store};
use crate::task_panel_paths::hash;
use crate::task_panel_store::{bindings,db_error,decode,encode,event,executions,expected,graph_revision,invalid,is_live,new_id,now,receipt,request,task};
use crate::task_panel_types::{Binding,Execution};
use crate::task_panel_snapshots::sample;
use rusqlite::{OptionalExtension,params};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::path::Path;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct BindInput {pub request_id:String,pub task_id:String,pub expected_revision:i64,pub pane_id:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct DispatchInput {pub request_id:String,pub task_id:String,pub expected_revision:i64,pub context_id:String,pub binding_id:String,pub allowed_actions:Vec<String>,pub approved:bool,#[serde(default)]pub exchange_directory:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ExecutionActionInput {pub request_id:String,pub execution_id:String,pub action:String,pub reason:String,pub approved:bool}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct CreateExecutionInput {pub request_id:String,pub task_id:String,pub expected_revision:i64,pub kind:String,#[serde(default)]pub pane_name:String,pub approved:bool}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct CreationResult {#[serde(default)]pub server_id:Option<String>,pub state:String,pub workspace_id:Option<String>,pub pane_id:Option<String>,pub binding:Option<Binding>,pub reason:String}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct PendingCreation {
    pub kind:String, pub pane_name:String,
    #[serde(flatten)] pub result:CreationResult,
}

pub(crate) fn pending_creation(db:&rusqlite::Connection,task_id:&str)->Result<Option<(CreateExecutionInput,CreationResult)>,StorageError>{
    // Only the latest creation can be resumed; do not resurrect older attempts.
    let row:Option<(String,String)>=db.query_row("SELECT r.input,r.result FROM tp_requests r WHERE r.id=(SELECT request_id FROM tp_events WHERE kind='herdr_creation_intent' AND object_id=?1 ORDER BY sequence DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM tp_executions x WHERE x.binding_id=json_extract(r.result,'$.binding.id'))",[task_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
    row.map(|(input,result)|Ok((decode(&input)?,decode(&result)?))).transpose()
}

pub(crate) fn validate_actions(actions:&[String],approved:bool)->Result<(),StorageError>{
    if !approved||actions.is_empty()||actions.len()>12||actions.iter().any(|a|!["read_scoped_files","edit_task_files","write_delivery_artifacts","tests","initialize_directory","initialize_git","install_dependencies","render_architecture"].contains(&a.as_str())){return Err(invalid("请确认本次动作范围。"));}
    Ok(())
}
fn same_target(binding:&Binding,current:&HerdrSession)->bool {
    current.identity_confirmed&&binding.server_id==current.server_id&&binding.workspace_id==current.workspace_id&&binding.pane_id==current.pane_id&&binding.agent_id==current.agent_id
}
fn binding_config(mut config:HerdrConfig,binding:&Binding)->Result<HerdrConfig,StorageError>{
    let session=binding.server_id.strip_prefix("local-session:").filter(|s|!s.is_empty()&&s.len()<=80&&s.bytes().all(|c|c.is_ascii_alphanumeric()||b"-_".contains(&c))).ok_or_else(||invalid("原绑定缺少可核对的本机 session，未改用当前选中的入口。"))?;
    config.session=session.into();Ok(config)
}
fn same_directory(left:&str,right:&str)->bool{
    let l=std::fs::canonicalize(left).ok();let r=std::fs::canonicalize(right).ok();l.is_some()&&l==r
}
impl Store {
    pub fn task_panel_herdr_config(&self)->Result<HerdrConfig,StorageError>{
        let raw:Option<String>=self.db.query_row("SELECT value FROM app_meta WHERE key='task-panel:herdr'",[],|r|r.get(0)).optional().map_err(db_error)?;
        raw.as_deref().map(decode).transpose().map(|v|v.unwrap_or_default())
    }
    pub fn task_panel_save_herdr_config(&mut self,config:HerdrConfig)->Result<HerdrConfig,StorageError>{
        if config.session.is_empty()||config.session.len()>80||!config.session.bytes().all(|c|c.is_ascii_alphanumeric()||b"-_".contains(&c))||!config.executable.is_empty()&&(!Path::new(&config.executable).is_absolute()||!Path::new(&config.executable).is_file()){return Err(invalid("请填写明确的本机 session 和存在的 Herdr CLI 路径；留空 CLI 路径时只查本机 Herdr。"));}
        self.db.execute("INSERT INTO app_meta VALUES('task-panel:herdr',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[encode(&config)?]).map_err(db_error)?;Ok(config)
    }
    pub fn task_panel_bind(&mut self,input:BindInput)->Result<Binding,StorageError>{
        let config=self.task_panel_herdr_config()?;self.task_panel_bind_at(input,&config)
    }
    fn task_panel_bind_at(&mut self,input:BindInput,config:&HerdrConfig)->Result<Binding,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        let t=task(&self.db,&input.task_id)?;expected(t.revision,Some(input.expected_revision))?;
        let current=herdr_adapter::get(config,&input.pane_id)?;
        if !current.identity_confirmed{return Err(StorageError::new("herdr_identity_missing","会话缺少可核对的当前 Agent 身份；未绑定或发送。"));}
        if t.repository_id.is_some() {if !same_directory(&crate::task_panel_locations::execution_repository(&self.db,&t)?.path,&current.cwd){return Err(invalid("Herdr 工作目录与任务仓库不同，未绑定。"));}}
        let tx=self.db.transaction().map_err(db_error)?;
        let generation:i64=tx.query_row("SELECT coalesce(max(generation),0)+1 FROM tp_bindings WHERE task_id=?1",[&t.id],|r|r.get(0)).map_err(db_error)?;
        let result=Binding{id:new_id(&tx,"binding")?,task_id:t.id.clone(),server_id:current.server_id,workspace_id:current.workspace_id,pane_id:current.pane_id,agent_id:current.agent_id,kind:current.kind,cwd:current.cwd,generation,state:current.state,checked_at:now()};
        tx.execute("INSERT INTO tp_bindings VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![result.id,result.task_id,result.server_id,result.workspace_id,result.pane_id,result.agent_id,result.kind,result.cwd,result.generation,result.state,result.checked_at]).map_err(db_error)?;
        crate::task_panel_store::graph_object(&tx,&result.id,t.repository_id.as_deref(),"session",&format!("{} · {}",result.kind,result.pane_id),"observed",&json!({"serverId":result.server_id,"workspaceId":result.workspace_id,"agentId":result.agent_id,"bindingGeneration":generation}))?;
        crate::task_panel_store::graph_link(&tx,&t.id,&result.id,"related_to","observed","明确绑定记录；不代表执行已开始")?;
        event(&tx,&input.request_id,&t.id,"herdr_bound","user","已绑定指定 Herdr 会话；未发送消息，未改变任务执行状态")?;receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
    }
    pub fn task_panel_focus(&self,binding_id:&str)->Result<(),StorageError>{
        let binding=bindings(&self.db)?.into_iter().find(|b|b.id==binding_id).ok_or_else(||invalid("绑定不存在。"))?;
        let config=binding_config(self.task_panel_herdr_config()?,&binding)?;let current=herdr_adapter::get(&config,&binding.pane_id)?;
        if !same_target(&binding,&current){return Err(invalid("会话身份已改变，未跳到其他 Agent。"));}
        herdr_adapter::call(&config,"agent.focus",json!({"target":binding.pane_id}))?;Ok(())
    }
    pub fn task_panel_dispatch(&mut self,input:DispatchInput)->Result<Execution,StorageError>{
        self.task_panel_dispatch_with_access(input,None)
    }
    pub(crate) fn task_panel_dispatch_with_access(&mut self,input:DispatchInput,access_command:Option<String>)->Result<Execution,StorageError>{
        let encoded=encode(&input)?;
        if let Some(prior)=request::<Execution>(&self.db,&input.request_id,&encoded)?{
            return executions(&self.db)?.into_iter().find(|r|r.id==prior.id).ok_or_else(||invalid("派发回执缺少执行记录，未重发。"));
        }
        let t=task(&self.db,&input.task_id)?;expected(t.revision,Some(input.expected_revision))?;
        let view=self.task_panel_snapshot()?.tasks.into_iter().find(|v|v.task.id==t.id).unwrap();
        if !view.allowed_actions.iter().any(|a|a=="dispatch"){return Err(StorageError::new("task_not_ready","任务前置、范围或当前执行未就绪，未发送。"));}
        validate_actions(&input.allowed_actions,input.approved)?;
        if view.execution_profile=="architecture"&&(!input.allowed_actions.iter().any(|a|a=="render_architecture")||input.allowed_actions.iter().any(|a|a=="edit_task_files")){return Err(invalid("只读建图需要 Archify 渲染授权，不能派发源码编辑权限。"));}
        let repo=crate::task_panel_locations::execution_repository(&self.db,&t)?;
        let context=self.task_panel_get_context(&input.context_id)?;
        if context.task_id!=t.id||context.task_revision!=t.revision||if context.scope_hash.is_empty(){context.graph_revision!=graph_revision(&self.db)?}else{context.scope_hash!=crate::task_panel_context::scope_stamp(&self.db,&t.id)?}{return Err(crate::task_panel_store::conflict());}
        let current_snapshot=sample(&repo,&t.scope)?;
        if context.workspace_snapshot.as_ref().is_none_or(|old|old.fingerprint!=current_snapshot.fingerprint){return Err(StorageError::new("workspace_changed","代码在上下文预览后改变，请重新核对；未发送旧任务包。"));}
        let binding=bindings(&self.db)?.into_iter().find(|b|b.id==input.binding_id&&b.task_id==t.id).ok_or_else(||invalid("请先绑定此任务的目标会话。"))?;
        let latest_generation:i64=self.db.query_row("SELECT max(generation) FROM tp_bindings WHERE task_id=?1",[&t.id],|r|r.get(0)).map_err(db_error)?;
        if binding.generation!=latest_generation{return Err(invalid("这份绑定已被重新绑定替代。"));}
        let config=binding_config(self.task_panel_herdr_config()?,&binding)?;
        let current=herdr_adapter::get(&config,&binding.pane_id)?;
        if !same_target(&binding,&current)||!same_directory(&repo.path,&current.cwd){return Err(invalid("会话身份或工作目录改变，未发送。"));}
        if !current.interactive_ready||!["idle","done"].contains(&current.state.as_str()){return Err(StorageError::new("herdr_busy","Herdr 会话忙碌、等待人工或状态未知，未追加任务。"));}
        let automatic=if self.task_workspace.is_some(){Some(crate::task_panel_workspace::directory(&self.task_directory(&t.id)?,"runs")?)}else{None};
        let exchange=automatic.as_deref().unwrap_or_else(||Path::new(&input.exchange_directory));
        if !exchange.is_absolute()||!exchange.is_dir(){return Err(invalid("请先指定存在的专用非凭据交换目录；未将完整业务根交给 Agent。"));}
        let exchange=std::fs::canonicalize(exchange).map_err(|_|invalid("交换目录不可读。"))?;
        let own=std::fs::canonicalize(&self.root).map_err(|_|invalid("业务根无法核对。"))?;
        if exchange==own||exchange.starts_with(own.join("pi"))||exchange.starts_with(own.join("db"))||crate::task_panel_paths::sensitive(&exchange.to_string_lossy()){return Err(invalid("交换目录不能是业务根、数据库、Pi 状态或凭据/工具目录。"));}
        let run_id=new_id(&self.db,"run")?;
        let exchange=if self.task_workspace.is_some(){self.run_directory(&t.id,&run_id)?}else{exchange};
        let input_directory=if self.task_workspace.is_some(){crate::task_panel_workspace::directory(&exchange,"input")?}else{exchange.clone()};
        let output_directory=if self.task_workspace.is_some(){crate::task_panel_workspace::directory(&exchange,"output")?}else{exchange.clone()};
        let tx=self.db.transaction().map_err(db_error)?;
        let target_occupied:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM tp_executions e JOIN tp_bindings b ON b.id=e.binding_id WHERE b.server_id=?1 AND b.pane_id=?2 AND e.state IN ('sending','awaiting_receipt','accepted','running','blocked','uncertain','disconnected'))",params![binding.server_id,binding.pane_id],|r|r.get(0)).map_err(db_error)?;
        if target_occupied{return Err(StorageError::new("herdr_target_busy","原窗格仍有未结束或待核对的尝试，未向同一目标追加派发。"));}
        for other in executions(&tx)?.into_iter().filter(|r|is_live(&r.state)) {let other_task=task(&tx,&other.task_id)?;if other_task.repository_id.is_some() {if crate::task_panel_locations::overlap(&repo.path,&crate::task_panel_locations::execution_repository(&tx,&other_task)?.path){return Err(StorageError::new("workspace_busy","相同或相互包含的工作目录已有未结束执行；独立目录与独立窗格可分别推进。"));}}}
        let attempt:i64=tx.query_row("SELECT count(*)+1 FROM tp_executions WHERE task_id=?1",[&t.id],|r|r.get(0)).map_err(db_error)?;
        let mut result=Execution{id:run_id,task_id:t.id.clone(),task_revision:t.revision,context_id:context.id.clone(),binding_id:binding.id.clone(),binding_generation:binding.generation,state:"sending".into(),attempt,request_id:input.request_id.clone(),authorization:input.allowed_actions.clone(),snapshot_id:context.workspace_snapshot.as_ref().map(|s|s.id.clone()),reason:"发送意图已保存；外部副作用不能与业务事务原子提交".into(),created_at:now(),updated_at:now()};
        let graph_contract:Value=if view.execution_profile=="architecture"{serde_json::from_str(include_str!("../../resources/task-panel-graph-contract.json")).map_err(|_|invalid("内置建图契约无法读取"))?}else{Value::Null};
        let packet=json!({"graph_facts_contract":graph_contract,"protocol_version":1,"task_id":t.id,"task_revision":t.revision,"run_id":result.id,"context_id":context.id,"binding_generation":binding.generation,"workspace_snapshot_id":result.snapshot_id,"workspace":repo.path,"input_directory":input_directory,"output_directory":output_directory,"allowed_actions":input.allowed_actions,"requires_separate_authorization":["commit","merge","publish","delete_user_data","host_configuration"],"context":context,"agent_cli":access_command,"agent_cli_usage":"将命令末尾 frontier 替换为 task/context/source 查询；接收和交付均用 submit_result，先将对应 JSON 写到 output_directory，再以任务目录相对路径提交。具体参数见 --help。候选记忆不等于正式决定。","result_contract":"task-result-v1","result_file":format!("{}-result.json",result.id),"receipt_contract":{"identity_fields":["protocol_version","task_id","task_revision","run_id","context_id","binding_generation","workspace_snapshot_id"],"ack":{"accepted_or_blocked":"accepted | blocked","reason":"实际接收结果","started":"有开始依据时为 true"},"delivery":{"execution_outcome":"reported_finished | failed | blocked","changed_files":"仅源码快照内的仓库相对路径或 {path,sha256}；含实际增删；.azcine 交接物料不属于源码改动，只读建图填写 []","artifact_refs":"相对回执所在 output 目录的路径或 {path,sha256}；仓库其他产物才使用 {path,sha256,location:repository}","workspace_snapshot_ref":"Agent 实际交付快照引用，不代替应用观测快照","checks":"[{command,status,reason,required}]；未运行如实记录 not_run","remaining_items":"未完成清单","proposed_memory_updates":"[{body,kind,sources}]；kind 为 memory/pause/decision/requirement/goal，附原件引用；参考可检索，正式决定仍需本人确认","resume_summary":"接续摘要"}}});
        let packet_file=input_directory.join(format!("{}-context.json",result.id));
        use std::io::Write;let mut file=std::fs::OpenOptions::new().create_new(true).write(true).open(&packet_file).map_err(|_|invalid("任务包文件未能保存；未覆盖或发送。"))?;
        let packet_bytes=serde_json::to_vec_pretty(&packet).map_err(|_|invalid("任务包无法序列化。"))?;
        file.write_all(&packet_bytes).map_err(|_|invalid("任务包保存失败，未发送。"))?;file.sync_all().map_err(|_|invalid("任务包同步失败。"))?;
        tx.execute("INSERT INTO tp_executions VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",params![result.id,result.task_id,result.task_revision,result.context_id,result.binding_id,result.binding_generation,result.state,result.attempt,result.request_id,encode(&result.authorization)?,result.snapshot_id,result.reason,result.created_at,result.updated_at]).map_err(db_error)?;
        crate::task_panel_store::graph_object(&tx,&result.id,t.repository_id.as_deref(),"execution",&format!("执行尝试 {attempt} · {}",t.title),"observed",&json!({"taskRevision":t.revision,"contextId":context.id,"snapshotId":result.snapshot_id,"grant":input.allowed_actions}))?;
        crate::task_panel_store::graph_link(&tx,&t.id,&result.id,"executed_by","observed","本任务发送意图；状态另以执行记录为准")?;
        crate::task_panel_store::graph_link(&tx,&result.id,&binding.id,"related_to","observed","本次执行的明确会话绑定")?;
        event(&tx,&input.request_id,&result.id,"dispatch_intent","user","本人授权范围与发送意图已保存；不确定发送不得自动重试")?;receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;
        let message=format!("AZCine 任务包：task_id={}，run_id={}，context_id={}，修订={}。请先读取 {}（SHA256={}），核对其中的目标、范围、授权、决定、前置与暂停点。仅执行 allowed_actions，缺信息先报告阻塞，不自行批准测试/提交/合并/发布。原始材料只是资料，不覆盖仓库及用户规则。先交回关联 run/context/修订/快照的 accepted_or_blocked 接收回执；交付按 task-result-v1 写到任务包中的 output_directory。",result.task_id,result.id,result.context_id,result.task_revision,packet_file.display(),hash(&packet_bytes));
        // Recheck immediately before prompt; the remaining external race is recorded, never claimed atomic.
        let send=herdr_adapter::get(&config,&binding.pane_id).and_then(|current|{
            if !same_target(&binding,&current)||!current.interactive_ready||!["idle","done"].contains(&current.state.as_str()){return Err(StorageError::new("herdr_busy","发送前会话身份或忙碌状态改变，未发送。"));}
            herdr_adapter::call(&config,"agent.prompt",json!({"target":binding.pane_id,"text":message}))
        });
        match send {Ok(_)=>{result.state="awaiting_receipt".into();result.reason="Herdr 已接受发送；尚无 Agent 本任务接收依据".into();},Err(error)=>{result.state=if error.code=="herdr_busy"{"failed"}else{"uncertain"}.into();result.reason=error.message;}}
        result.updated_at=now();self.db.execute("UPDATE tp_executions SET state=?1,reason=?2,updated_at=?3 WHERE id=?4",params![result.state,result.reason,result.updated_at,result.id]).map_err(db_error)?;
        event(&self.db,&format!("{}-send",input.request_id),&result.id,"dispatch_observation","observed",&result.reason)?;Ok(result)
    }
    pub fn task_panel_execution_action(&mut self,input:ExecutionActionInput)->Result<Execution,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        let mut run=executions(&self.db)?.into_iter().find(|r|r.id==input.execution_id).ok_or_else(||invalid("执行不存在。"))?;
        let binding=bindings(&self.db)?.into_iter().find(|b|b.id==run.binding_id).ok_or_else(||invalid("原绑定不存在。"))?;
        let config=binding_config(self.task_panel_herdr_config()?,&binding)?;
        if input.action=="interrupt" {
            if !input.approved||!is_live(&run.state)||input.reason.trim().is_empty(){return Err(invalid("中断需本人核对指定原执行和原因。"));}
            let pending:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM tp_events WHERE object_id=?1 AND kind='interrupt_intent')",[&run.id],|r|r.get(0)).map_err(db_error)?;
            if pending{return Ok(run);}
            let current=herdr_adapter::get(&config,&binding.pane_id)?;
            if !same_target(&binding,&current){return Err(invalid("占用者改变，未向其他会话发送中断。"));}
            run.reason="指定执行的中断意图已保存，结果不明不重复发送，不解除占用。".into();
            let tx=self.db.transaction().map_err(db_error)?;receipt(&tx,&input.request_id,&encoded,&run)?;event(&tx,&input.request_id,&run.id,"interrupt_intent","user",&input.reason)?;tx.commit().map_err(db_error)?;
            match herdr_adapter::call(&config,"agent.send_keys",json!({"target":binding.pane_id})){Ok(_)=>run.reason="中断请求已送到指定原会话；是否停止仍需核对，不解除占用。".into(),Err(e)=>run.reason=e.message,}
            run.updated_at=now();let tx=self.db.transaction().map_err(db_error)?;
            tx.execute("UPDATE tp_executions SET reason=?1,updated_at=?2 WHERE id=?3",params![run.reason,run.updated_at,run.id]).map_err(db_error)?;
            tx.execute("UPDATE tp_requests SET result=?1 WHERE id=?2",params![encode(&run)?,input.request_id]).map_err(db_error)?;
            event(&tx,&format!("{}-result",input.request_id),&run.id,"interrupt_observation","observed",&run.reason)?;tx.commit().map_err(db_error)?;return Ok(run);
        }
        match input.action.as_str(){
            "reconcile"=>match herdr_adapter::get(&config,&binding.pane_id){
                Ok(current) if same_target(&binding,&current)=>{run.reason=format!("Herdr 当前状态 {}，仅为终端观察；没有任务回执，不判定完成，也不解除占用。",current.state);if run.state=="sending"{run.state="uncertain".into();}},
                Ok(_)=>{if is_live(&run.state){run.state="disconnected".into();}run.reason="窗格占用者改变，旧执行待核对；迟到回执不会用于新尝试".into();},
                Err(error)=>{if is_live(&run.state){run.state="disconnected".into();}run.reason=error.message;},
            },
            "release_for_rebind"=>{
                if !input.approved||input.reason.trim().is_empty(){return Err(invalid("手工换会话前，需明确核对旧执行与保存原因；不会自动清理原进程。"));}
                run.state="superseded".into();run.reason=input.reason.clone();
            },
            _=>return Err(invalid("执行动作不受支持；中断请回原 Herdr 会话操作。")),
        }
        let tx=self.db.transaction().map_err(db_error)?;run.updated_at=now();
        tx.execute("UPDATE tp_executions SET state=?1,reason=?2,updated_at=?3 WHERE id=?4",params![run.state,run.reason,run.updated_at,run.id]).map_err(db_error)?;
        event(&tx,&input.request_id,&run.id,"execution_reconciled",if input.action=="reconcile"{"observed"}else{"user"},&run.reason)?;
        receipt(&tx,&input.request_id,&encoded,&run)?;tx.commit().map_err(db_error)?;Ok(run)
    }
    pub(crate) fn task_panel_resume_creation(&mut self,input:&CreateExecutionInput,revision:i64,resume_request:&str)->Result<CreationResult,StorageError>{
        let t=task(&self.db,&input.task_id)?;expected(t.revision,Some(revision))?;
        let mut prior=request::<CreationResult>(&self.db,&input.request_id,&encode(input)?)?.ok_or_else(||invalid("原创建记录不存在，未重复创建。"))?;
        let pane=prior.pane_id.as_ref().ok_or_else(||invalid("原创建结果未返回窗格，请先核对 Herdr 中的实际位置；未重复创建。"))?;
        let mut config=self.task_panel_herdr_config()?;
        config.session=prior.server_id.clone().ok_or_else(||invalid("原创建记录缺少 Herdr 入口，请先核对原位置。"))?;
        let current=herdr_adapter::get(&config,pane)?;
        let correct=if input.kind=="codex"{current.kind=="codex"}else{["pi","openpi","opi"].contains(&current.kind.as_str())};
        if prior.workspace_id.as_deref()!=Some(current.workspace_id.as_str())||!correct||!current.identity_confirmed||prior.binding.as_ref().is_some_and(|b|!same_target(b,&current)){
            return Err(invalid("原窗格或 Agent 身份已改变，未向其他会话重试；请先核对原位置。"));
        }
        if !current.interactive_ready||!["idle","done"].contains(&current.state.as_str()){return Err(invalid("原窗格尚未就绪，请在 Herdr 完成启动或处理提问后重试；未发送任务。"));}
        let repo=crate::task_panel_locations::execution_repository(&self.db,&t)?;
        if !same_directory(&repo.path,&current.cwd){return Err(invalid("原窗格目录与当前任务不同，未发送。"));}
        let binding=self.task_panel_bind_at(BindInput{request_id:format!("{resume_request}-bind"),task_id:t.id.clone(),expected_revision:revision,pane_id:pane.clone()},&config)?;
        if !same_target(&binding,&current){return Err(invalid("核对期间 Agent 身份改变，未继续派发。"));}
        let changed=prior.binding.as_ref().is_none_or(|b|b.id!=binding.id);
        prior.binding=Some(binding);prior.state="ready".into();prior.reason="已核对原窗格；将按当前任务版本交接，未重复创建或启动。".into();
        let tx=self.db.transaction().map_err(db_error)?;
        tx.execute("UPDATE tp_requests SET result=?1 WHERE id=?2",params![encode(&prior)?,input.request_id]).map_err(db_error)?;
        if changed{event(&tx,&format!("{resume_request}-resume"),&t.id,"herdr_creation_resumed","observed",&prior.reason)?;}
        tx.commit().map_err(db_error)?;Ok(prior)
    }
    pub fn task_panel_focus_creation(&self,task_id:&str)->Result<(),StorageError>{
        let (_,prior)=pending_creation(&self.db,task_id)?.ok_or_else(||invalid("没有待核对的创建位置。"))?;
        let pane=prior.pane_id.ok_or_else(||invalid("原记录未返回窗格位置，请在 Herdr 查看。"))?;
        let mut config=self.task_panel_herdr_config()?;
        config.session=prior.server_id.ok_or_else(||invalid("原创建记录缺少 Herdr 入口。"))?;
        let current=herdr_adapter::get(&config,&pane)?;
        let t=task(&self.db,task_id)?;
        let repo=crate::task_panel_locations::execution_repository(&self.db,&t)?;
        if prior.workspace_id.as_deref()!=Some(current.workspace_id.as_str())||!same_directory(&repo.path,&current.cwd){return Err(invalid("原窗格位置或目录改变，未打开其他位置。"));}
        herdr_adapter::call(&config,"agent.focus",json!({"target":pane}))?;Ok(())
    }
    pub fn task_panel_create_execution(&mut self,input:CreateExecutionInput,_resource_dir:&Path)->Result<CreationResult,StorageError>{
        let encoded=encode(&input)?;
        if let Some(mut prior)=request::<CreationResult>(&self.db,&input.request_id,&encoded)?{
            if prior.binding.is_none() {
                if let Some(pane)=prior.pane_id.as_ref() {
                    let mut config=self.task_panel_herdr_config()?;
                    config.session=prior.server_id.clone().ok_or_else(||invalid("旧创建记录缺少 Herdr 入口，保留原窗格，请从会话页核对绑定。"))?;
                    let current=match herdr_adapter::get(&config,pane){Ok(value)=>value,Err(_)=>return Ok(prior)};
                    let correct=if input.kind=="codex"{current.kind=="codex"}else{["pi","openpi","opi"].contains(&current.kind.as_str())};
                    if !correct||!current.interactive_ready||!["idle","done"].contains(&current.state.as_str()){return Ok(prior);}
                    let binding=self.task_panel_bind_at(BindInput{request_id:format!("{}-bind",input.request_id),task_id:input.task_id.clone(),expected_revision:input.expected_revision,pane_id:pane.clone()},&config)?;
                    prior.binding=Some(binding);prior.state="ready".into();prior.reason="已核对先前创建的窗格并继续，未重复创建或启动。".into();
                    self.db.execute("UPDATE tp_requests SET result=?1 WHERE id=?2",params![encode(&prior)?,input.request_id]).map_err(db_error)?;
                }
            }
            return Ok(prior);
        }
        let t=task(&self.db,&input.task_id)?;expected(t.revision,Some(input.expected_revision))?;
        if !input.approved||!["codex","openpi"].contains(&input.kind.as_str()){return Err(invalid("新建 Herdr 执行需明确批准工具与目标。"));}
        let repo=crate::task_panel_locations::execution_repository(&self.db,&t)?;
        let config=herdr_adapter::discover(self.task_panel_herdr_config()?,Some(Path::new(&repo.path)))?;
        self.task_panel_save_herdr_config(config.clone())?;
        let label=if input.pane_name.trim().is_empty(){t.title.chars().take(64).collect::<String>()}else{input.pane_name.trim().to_owned()};
        if label.chars().count()>100||label.chars().any(char::is_control){return Err(invalid("窗格名称请填写 1–100 个可显示字符。"));}
        let mut result=CreationResult{server_id:Some(config.session.clone()),state:"uncertain".into(),workspace_id:None,pane_id:None,binding:None,reason:"新建意图已保存；结果不明时不得重复创建".into()};
        receipt(&self.db,&input.request_id,&encoded,&result)?;
        event(&self.db,&input.request_id,&t.id,"herdr_creation_intent","user",&result.reason)?;
        let creation=(||->Result<(),StorageError>{
            let prepared=self.task_setting(&crate::task_panel_locations::prepared_key(&repo.path))?.filter(|s|!s.is_empty()).and_then(|s|serde_json::from_str::<Value>(&s).ok());
            let created=if let Some(prepared)=prepared {
                if prepared["session"].as_str()!=Some(config.session.as_str()){return Err(invalid("分支原窗格所在服务改变，未重复创建。"));}
                let created=prepared["creation"].clone();
                self.save_task_setting(&crate::task_panel_locations::prepared_key(&repo.path), "")?;
                created
            }else{herdr_adapter::call(&config,"workspace.create",json!({"cwd":repo.path,"label":label}))?};
            result.workspace_id=created.pointer("/workspace/workspace_id").and_then(Value::as_str).map(String::from);
            result.pane_id=created.pointer("/root_pane/pane_id").and_then(Value::as_str).map(String::from);
            self.db.execute("UPDATE tp_requests SET result=?1 WHERE id=?2",params![encode(&result)?,input.request_id]).map_err(db_error)?;
            let pane=result.pane_id.as_ref().ok_or_else(||invalid("Herdr 创建响应没有明确根窗格，未猜测或启动 Agent。"))?;
            herdr_adapter::call(&config,"pane.rename",json!({"target":pane,"label":label}))?;
            herdr_adapter::start_powershell(&config,pane,&input.kind)?;
            let bind=self.task_panel_bind_at(BindInput{request_id:format!("{}-bind",input.request_id),task_id:t.id.clone(),expected_revision:t.revision,pane_id:pane.clone()},&config)?;
            result.binding=Some(bind);result.state="ready".into();result.reason="指定执行位置已创建并绑定，尚未派发任务".into();Ok(())
        })();
        if let Err(error)=creation{result.reason=error.message;}
        self.db.execute("UPDATE tp_requests SET result=?1 WHERE id=?2",params![encode(&result)?,input.request_id]).map_err(db_error)?;
        event(&self.db,&format!("{}-result",input.request_id),&t.id,"herdr_creation_observation","observed",&encode(&result)?)?;Ok(result)
    }
}
