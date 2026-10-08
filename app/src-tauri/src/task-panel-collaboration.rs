//! Repository-owned feedback and editor drafts. Pi/Codex remain unchanged.
use crate::{storage::{StorageError,Store}, task_panel_store::{bindings,db_error,decode,encode,event,executions,expected,id_ok,invalid,is_live,now,receipt,request,task}};
use rusqlite::params;
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Feedback {
    pub id:String,pub task_id:String,pub task_revision:i64,pub execution_id:String,
    pub binding_generation:i64,pub body:String,pub state:String,pub reason:String,
    pub response:String,pub created_at:String,pub updated_at:String,
}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct FeedbackInput {pub request_id:String,pub task_id:String,pub expected_revision:i64,pub execution_id:String,pub id:String,pub action:String,#[serde(default)]pub body:String,pub approved:bool}

fn feedback_key(id:&str)->String{format!("task-panel:feedback:{id}")}
pub fn feedback(db:&rusqlite::Connection)->Result<Vec<Feedback>,StorageError>{
    db.prepare("SELECT value FROM app_meta WHERE key LIKE 'task-panel:feedback:%' ORDER BY key").map_err(db_error)?.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?
        .map(|r|r.map_err(db_error).and_then(|s|decode(&s))).collect()
}
fn save_feedback(db:&rusqlite::Connection,value:&Feedback)->Result<(),StorageError>{
    db.execute("INSERT INTO app_meta VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![feedback_key(&value.id),encode(value)?]).map_err(db_error)?;Ok(())
}
pub fn acknowledge_feedback(db:&rusqlite::Connection,task_id:&str,revision:i64,execution_id:&str,id:&str,state:&str,response:&str,request_id:&str)->Result<Feedback,StorageError>{
    if !["received","addressed"].contains(&state)||response.chars().count()>5000||state=="addressed"&&response.trim().is_empty(){return Err(invalid("意见回应需 received 或 addressed；处理完需说明结果。"));}
    let mut value=feedback(db)?.into_iter().find(|f|f.id==id&&f.task_id==task_id&&f.task_revision==revision&&f.execution_id==execution_id).ok_or_else(||invalid("意见不属于此任务修订和执行。"))?;
    let run=executions(db)?.into_iter().find(|r|r.id==execution_id&&r.task_id==task_id&&r.task_revision==revision&&is_live(&r.state)).ok_or_else(||invalid("原执行已结束，不能更新新执行的意见状态。"))?;
    if run.binding_generation!=value.binding_generation||value.state=="cancelled"{return Err(invalid("原意见已撤回或执行绑定改变。"));}
    if value.state=="addressed"&&state=="received"{return Ok(value);}
    value.state=state.into();value.response=response.trim().into();value.reason=if state=="addressed"{"Agent 回报已处理；执行、检查和本人验收仍分别核对"}else{"Agent 已确认收到此意见"}.into();value.updated_at=now();
    save_feedback(db,&value)?;event(db,request_id,task_id,"feedback_response","claim",&encode(&json!({"id":id,"executionId":execution_id,"state":state,"response":response}))?)?;Ok(value)
}
impl Store {
    pub fn task_panel_feedback(&mut self,input:FeedbackInput)->Result<Feedback,StorageError>{
        if !input.approved||!id_ok(&input.id){return Err(invalid("请确认本任务意见及目标执行。"));}
        let encoded=encode(&input)?;
        if let Some(previous)=request::<Feedback>(&self.db,&input.request_id,&encoded)?{return feedback(&self.db)?.into_iter().find(|f|f.id==previous.id).ok_or_else(||invalid("意见记录不可读，未重复发送。"));}
        let t=task(&self.db,&input.task_id)?;expected(t.revision,Some(input.expected_revision))?;
        crate::task_panel_projects::require_task_active(&self.db,&t.id)?;
        let run=executions(&self.db)?.into_iter().find(|r|r.id==input.execution_id&&r.task_id==t.id&&r.task_revision==t.revision&&is_live(&r.state)).ok_or_else(||invalid("请选择当前修订仍在进行的原执行；未向其他 Agent 发送。"))?;
        let mut value=if input.action=="save" {
            if input.body.trim().is_empty()||input.body.chars().count()>5000{return Err(invalid("补充意见需要正文，最多 5000 字。"));}
            if feedback(&self.db)?.iter().any(|f|f.id==input.id){return Err(invalid("意见编号已存在，未覆盖或重复发送。"));}
            Feedback{id:input.id.clone(),task_id:t.id.clone(),task_revision:t.revision,execution_id:run.id.clone(),binding_generation:run.binding_generation,body:input.body.trim().into(),state:"pending".into(),reason:"意见已保存，等待原会话可接收；不扩展原执行授权".into(),response:String::new(),created_at:now(),updated_at:now()}
        }else{feedback(&self.db)?.into_iter().find(|f|f.id==input.id&&f.task_id==t.id&&f.task_revision==t.revision&&f.execution_id==run.id&&f.binding_generation==run.binding_generation).ok_or_else(||invalid("意见与原执行不匹配。"))?};
        match input.action.as_str(){
            "save"|"cancel"=>{
                if input.action=="cancel" {
                    if value.state!="pending"{return Err(invalid("已发送或结果不明的意见不能假装撤回，请向原会话补充说明。"));}
                    value.state="cancelled".into();value.reason="待发送意见已撤回；历史保留".into();value.updated_at=now();
                }
                let tx=self.db.transaction().map_err(db_error)?;save_feedback(&tx,&value)?;event(&tx,&input.request_id,&t.id,"feedback_saved","user",&encode(&value)?)?;receipt(&tx,&input.request_id,&encoded,&value)?;tx.commit().map_err(db_error)?;Ok(value)
            },
            "send"=>{
                if value.state!="pending"{return Ok(value);}
                let binding=bindings(&self.db)?.into_iter().find(|b|b.id==run.binding_id&&b.generation==run.binding_generation).ok_or_else(||invalid("原绑定不存在，意见保留待核对。"))?;
                let config=crate::task_panel_execution::binding_config(self.task_panel_herdr_config()?,&binding)?;
                let current=crate::herdr_adapter::get(&config,&binding.pane_id)?;
                if !crate::task_panel_execution::same_target(&binding,&current)||!crate::task_panel_execution::same_directory(&binding.cwd,&current.cwd){return Err(invalid("原窗格身份或目录改变，意见保留，未发送到其他会话。"));}
                // Do not type into a running tool or a permission dialog. The
                // authorized inbox is queryable by CLI at any time; the UI may
                // retry a still-pending notification once this exact pane idles.
                if !current.interactive_ready||!["idle","done"].contains(&current.state.as_str()){return Ok(value);}
                let directory=crate::task_panel_workspace::directory(&self.task_directory(&t.id)?,"feedback")?;
                let file=directory.join(format!("{}.json",value.id));
                crate::task_panel_workspace::preserve(&file,&serde_json::to_vec_pretty(&value).map_err(|_|invalid("意见原件无法编码。"))?)?;
                let message=format!("本任务有一条本人补充意见，请读取 {}。意见 ID={}，任务={} r{}，执行={}。这是原约定内的补充，不增加测试、安装、提交或超范围改动授权。用任务包中的 agent_cli 查询 feedback；以固定 request-id 调用 acknowledge_feedback（id、executionId、state=received/ addressed、response）记录收到和处理结果。需要改范围或完成条件时先提交候选并等待本人决定，不能覆盖正式任务。",file.display(),value.id,t.id,t.revision,run.id);
                value.state="sending".into();value.reason="发送意图已保存；结果不明时不自动重发".into();value.updated_at=now();
                let tx=self.db.transaction().map_err(db_error)?;save_feedback(&tx,&value)?;receipt(&tx,&input.request_id,&encoded,&value)?;event(&tx,&input.request_id,&t.id,"feedback_send_intent","user",&encode(&json!({"id":value.id,"executionId":run.id,"paneId":binding.pane_id}))?)?;tx.commit().map_err(db_error)?;
                let sent=crate::herdr_adapter::get(&config,&binding.pane_id).and_then(|current|{
                    if !crate::task_panel_execution::same_target(&binding,&current)||!crate::task_panel_execution::same_directory(&binding.cwd,&current.cwd)||!current.interactive_ready||!["idle","done"].contains(&current.state.as_str()){return Err(invalid("发送前原会话状态改变，结果需核对。"));}
                    crate::herdr_adapter::call(&config,"agent.prompt",json!({"target":binding.pane_id,"text":message}))
                });
                match sent{Ok(_)=>{value.state="sent".into();value.reason="Herdr 已接收发送，等待 Agent 确认收到".into();},Err(error)=>{value.state="uncertain".into();value.reason=error.message;}}
                value.updated_at=now();let tx=self.db.transaction().map_err(db_error)?;save_feedback(&tx,&value)?;tx.execute("UPDATE tp_requests SET result=?1 WHERE id=?2",params![encode(&value)?,input.request_id]).map_err(db_error)?;
                event(&tx,&format!("{}-result",input.request_id),&t.id,"feedback_send_observation","observed",&encode(&value)?)?;tx.commit().map_err(db_error)?;Ok(value)
            },_=>Err(invalid("意见操作只支持保存、发送和撤回待发送意见。")),
        }
    }
}

#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct DraftInput {pub id:String,pub draft:Option<Value>}
pub fn drafts(db:&rusqlite::Connection)->Result<Value,StorageError>{
    let mut result=serde_json::Map::new();
    let mut query=db.prepare("SELECT key,value FROM app_meta WHERE key LIKE 'task-panel:editor-draft:%'").map_err(db_error)?;
    let rows=query.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(db_error)?;
    for row in rows{let (key,raw)=row.map_err(db_error)?;result.insert(key.trim_start_matches("task-panel:editor-draft:").into(),decode(&raw)?);}
    Ok(Value::Object(result))
}
impl Store {
    pub fn task_panel_draft(&mut self,input:DraftInput)->Result<(),StorageError>{
        if input.id.is_empty()||input.id.len()>240||!input.id.bytes().all(|c|c.is_ascii_alphanumeric()||b"-_:".contains(&c)){return Err(invalid("草案编号无效。"));}
        let key=format!("task-panel:editor-draft:{}",input.id);
        if let Some(mut value)=input.draft {
            if !value.is_object()||value["id"].as_str()!=Some(input.id.as_str())||encode(&value)?.len()>120_000{return Err(invalid("草案内容或长度无效，输入保留在窗口中。"));}
            // Restoring an editor draft must never dispatch work by itself.
            value["autoStart"]=Value::Bool(false);value["draftSavedAt"]=Value::String(now());
            self.save_task_setting(&key,&encode(&value)?)
        }else{self.db.execute("DELETE FROM app_meta WHERE key=?1",[key]).map_err(db_error)?;Ok(())}
    }
}
