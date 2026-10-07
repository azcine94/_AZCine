//! Durable source binding, application-owned provenance and transactional draft
//! dispatch. Business adapters register here only after their scope is confirmed.
use crate::storage::{Store,StorageError};
use rusqlite::{Transaction,OptionalExtension,params};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::{collections::HashMap,sync::Arc};
fn db(_:rusqlite::Error)->StorageError{StorageError::new("agent_storage","Agent记录无法完整保存，草稿保留。")}
fn invalid(message:&str)->StorageError{StorageError::new("agent_invalid",message)}
pub fn create_schema(tx:&Transaction<'_>)->Result<(),StorageError>{tx.execute_batch("
    CREATE TABLE agent_conversations(id TEXT PRIMARY KEY,source TEXT NOT NULL,session_path TEXT,native_session_id TEXT,cwd TEXT,title TEXT,updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE agent_bindings(source_key TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES agent_conversations(id)) STRICT;
    CREATE TABLE agent_inputs(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),session_id TEXT NOT NULL,generation INTEGER NOT NULL,message_count INTEGER NOT NULL,context TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
    CREATE TABLE agent_attachments(id TEXT PRIMARY KEY,name TEXT NOT NULL,relative_path TEXT NOT NULL,hash TEXT NOT NULL,bytes INTEGER NOT NULL,mime_type TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
    CREATE TABLE agent_drafts(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),input_id TEXT NOT NULL REFERENCES agent_inputs(id),message_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,validation TEXT NOT NULL,status TEXT NOT NULL,receipt TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL) STRICT;
    CREATE INDEX agent_drafts_status ON agent_drafts(status,created_at);
    CREATE TABLE agent_jobs(id TEXT PRIMARY KEY,template TEXT NOT NULL,input TEXT NOT NULL,parent_id TEXT REFERENCES agent_jobs(id),status TEXT NOT NULL,output TEXT,error TEXT,context_objects TEXT NOT NULL DEFAULT '[]',timeout_ms INTEGER NOT NULL,ordinal INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT) STRICT;
    CREATE TABLE agent_job_logs(id INTEGER PRIMARY KEY,job_id TEXT NOT NULL REFERENCES agent_jobs(id),at TEXT NOT NULL,message TEXT NOT NULL) STRICT;
    ").map_err(db)?;create_deletion_schema(tx)}
pub fn create_deletion_schema(tx:&Transaction<'_>)->Result<(),StorageError>{tx.execute_batch("
    ALTER TABLE agent_conversations ADD COLUMN deleted_at TEXT;
    CREATE TABLE agent_deleted_sessions(path TEXT PRIMARY KEY,session_id TEXT NOT NULL,deleted_at TEXT NOT NULL) STRICT;
    ").map_err(db)}
pub fn upgrade_schema13(tx:&Transaction<'_>)->Result<(),StorageError>{
    let mut query=tx.prepare("PRAGMA table_info(agent_jobs)").map_err(db)?;let columns=query.query_map([],|r|r.get::<_,String>(1)).map_err(db)?.collect::<Result<Vec<_>,_>>().map_err(db)?;drop(query);
    if !columns.contains(&"ordinal".into()){tx.execute_batch("ALTER TABLE agent_jobs ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0;").map_err(db)?;}
    if !columns.contains(&"context_objects".into()){tx.execute_batch("ALTER TABLE agent_jobs ADD COLUMN context_objects TEXT NOT NULL DEFAULT '[]';").map_err(db)?;}Ok(())
}
pub fn validate_schema(connection:&rusqlite::Connection)->Result<(),StorageError>{for query in ["SELECT id,source,session_path,native_session_id,cwd,title,updated_at,deleted_at FROM agent_conversations LIMIT 0","SELECT path,session_id,deleted_at FROM agent_deleted_sessions LIMIT 0","SELECT id,input_id,payload,validation,status,receipt,revision FROM agent_drafts LIMIT 0","SELECT id,template,input,parent_id,status,timeout_ms,ordinal,context_objects FROM agent_jobs LIMIT 0"]{connection.prepare(query).map_err(db)?;}Ok(())}
pub(crate) fn session_path_key(path:&str)->String{
    #[cfg(windows)] {let path=path.replace('\\',"/");path.strip_prefix("//?/").unwrap_or(&path).to_ascii_lowercase()}
    #[cfg(not(windows))] {path.to_owned()}
}
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Source{pub module:String,pub page:String,pub object_id:Option<String>}
impl Source{
    pub fn validate(&self)->Result<(),StorageError>{if (self.module.is_empty()||self.module.len()>64||!self.module.bytes().all(|c|c.is_ascii_alphanumeric()||matches!(c,b'-'|b'_')))||self.page.is_empty()||self.page.len()>500||self.object_id.as_ref().is_some_and(|s|s.is_empty()||s.len()>200){return Err(invalid("会话来源无效，未建立绑定。"));}Ok(())}
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ObjectContext{pub source:Source,pub revision:i64,pub snapshot:Value,pub operations:Vec<String>}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Operation{pub module:String,pub object_id:String,pub action:String,pub values:Value}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct DraftPayload{pub version:u32,pub operations:Vec<Operation>,pub decisions:Vec<String>}
pub trait ModuleProvider:Send+Sync{
    fn list(&self,_tx:&Transaction<'_>)->Result<Vec<Value>,StorageError>{Ok(vec![])}
    fn actions(&self)->Vec<String>{vec![]}
    fn new_object_id(&self,id:&str)->String{id.to_owned()}
    fn prepare_values(&self,action:&str,object_id:&str,_revision:Option<i64>,mut values:Value)->Result<Value,StorageError>{if action=="create"{values.as_object_mut().ok_or_else(||invalid("values 必须是对象。"))?.insert("id".into(),json!(object_id));}Ok(values)}
    fn creation(&self,_tx:&Transaction<'_>,_op:&Operation)->Result<ObjectContext,StorageError>{Err(invalid("此模块未开放创建能力。"))}
    fn list_deleted(&self,_tx:&Transaction<'_>)->Result<Vec<Value>,StorageError>{Ok(vec![])}
    fn operation_schema(&self,_action:&str)->Value{Value::Null}
    fn snapshot(&self,tx:&Transaction<'_>,source:&Source)->Result<ObjectContext,StorageError>;
    fn validate(&self,tx:&Transaction<'_>,operation:&Operation,baseline:&ObjectContext)->Result<Value,StorageError>;
    fn apply(&self,tx:&Transaction<'_>,operation:&Operation,baseline:&ObjectContext)->Result<Value,StorageError>;
}
#[derive(Default,Clone)]
pub struct Providers(pub HashMap<String,Arc<dyn ModuleProvider>>);
impl Providers{
    pub fn module(&self,module:&str)->Result<&Arc<dyn ModuleProvider>,StorageError>{self.0.get(module).ok_or_else(||StorageError::new("agent_module_unavailable","此模块尚未接入正式业务操作；没有更新记录。"))}
    pub fn catalog(&self,tx:&Transaction<'_>,query:&str)->Result<Value,StorageError>{
        if query.chars().count()>200{return Err(invalid("对象搜索最多200字。"));}let query=query.trim().to_lowercase();let mut modules=Vec::new();
        let mut names=self.0.keys().collect::<Vec<_>>();names.sort_by_key(|name|(["projects","today","ideas","news","bookkeeping","models","jobs"].iter().position(|module|*module==name.as_str()).unwrap_or(99),name.as_str()));
        for module in names{let mut objects=self.0[module].list(tx)?;for object in &objects{let source:Source=serde_json::from_value(object["source"].clone()).map_err(|_|invalid("模块对象来源无效。"))?;source.validate()?;if source.module!=*module||source.object_id.is_none()||!object["title"].is_string(){return Err(invalid("模块返回无效对象标识，未附加。"));}}
            objects.retain(|o|query.is_empty()||o["title"].as_str().unwrap_or("").to_lowercase().contains(&query));let total=objects.len();objects.truncate(200);
            modules.push(json!({"id":module,"label":match module.as_str(){"projects"=>"公司项目","today"=>"待办","ideas"=>"灵感","bookkeeping"=>"记账","news"=>"资讯与信源","models"=>"模型榜","jobs"=>"后台任务",_=>module.as_str()},"objects":objects,"total":total,"hasMore":total>200}));
        }Ok(json!({"modules":modules}))
    }
}
pub fn id(store:&Store)->Result<String,StorageError>{store.db.query_row("SELECT lower(hex(randomblob(16)))",[],|r|r.get(0)).map_err(db)}
fn now()->String{chrono::Utc::now().to_rfc3339()}
fn encoded<T:Serialize>(value:&T)->Result<String,StorageError>{serde_json::to_string(value).map_err(|_|invalid("Agent记录格式无效。"))}
impl Store{
    pub fn agent_bind(&mut self,source:Source,fresh:bool)->Result<Value,StorageError>{
        source.validate()?;let source_key=encoded(&source)?;
        if !fresh{let previous:Option<String>=self.db.query_row("SELECT conversation_id FROM agent_bindings WHERE source_key=?",[&source_key],|r|r.get(0)).optional().map_err(db)?;if let Some(key)=previous{return self.agent_conversation(&key);}}
        let key=format!("b-{}",id(self)?);let tx=self.db.transaction().map_err(db)?;
        tx.execute("INSERT INTO agent_conversations(id,source,updated_at) VALUES(?,?,?)",params![key,source_key,now()]).map_err(db)?;
        tx.execute("INSERT INTO agent_bindings(source_key,conversation_id) VALUES(?,?) ON CONFLICT(source_key) DO UPDATE SET conversation_id=excluded.conversation_id",params![source_key,key]).map_err(db)?;
        tx.commit().map_err(db)?;self.agent_conversation(&key)
    }
    pub fn agent_conversation(&self,key:&str)->Result<Value,StorageError>{self.db.query_row("SELECT source,session_path,native_session_id,cwd,title,updated_at FROM agent_conversations WHERE id=? AND deleted_at IS NULL",[key],|r|Ok(json!({"conversationKey":key,"source":serde_json::from_str::<Value>(&r.get::<_,String>(0)?).unwrap_or(Value::Null),"sessionPath":r.get::<_,Option<String>>(1)?,"sessionId":r.get::<_,Option<String>>(2)?,"cwd":r.get::<_,Option<String>>(3)?,"title":r.get::<_,Option<String>>(4)?,"updatedAt":r.get::<_,String>(5)?}))).map_err(db)}
    pub fn agent_remember(&self,key:&str,state:&Value)->Result<(),StorageError>{if state["state"].is_null(){return Ok(());}self.db.execute("UPDATE agent_conversations SET session_path=?,native_session_id=?,cwd=?,title=?,updated_at=? WHERE id=? AND deleted_at IS NULL",params![state["state"]["sessionFile"].as_str().filter(|path|std::path::Path::new(path).is_file()),state["state"]["sessionId"].as_str(),state["cwd"].as_str(),state["state"]["sessionName"].as_str(),now(),key]).map_err(db)?;Ok(())}
    pub fn agent_deleted_paths(&self)->Result<Vec<String>,StorageError>{
        let mut query=self.db.prepare("SELECT path FROM agent_deleted_sessions").map_err(db)?;
        let result=query.query_map([],|r|r.get::<_,String>(0)).map_err(db)?.collect::<Result<Vec<_>,_>>().map_err(db)?;Ok(result)
    }
    pub fn agent_check_open(&self,key:&str,path:Option<&str>)->Result<(),StorageError>{
        let deleted:Option<String>=self.db.query_row("SELECT deleted_at FROM agent_conversations WHERE id=?",[key],|r|r.get(0)).optional().map_err(db)?.flatten();
        let hidden=if let Some(path)=path{self.agent_deleted_paths()?.iter().any(|p|session_path_key(p)==session_path_key(path))}else{false};
        if deleted.is_some()||hidden{return Err(StorageError::new("agent_conversation_deleted","这段会话已删除，请开始新会话。"));}Ok(())
    }
    pub fn agent_delete_conversation(&mut self,keys:&[String],path:Option<&str>,session_id:&str)->Result<Value,StorageError>{
        let tx=self.db.transaction().map_err(db)?;let at=now();let mut removed=keys.to_vec();
        let mut query=tx.prepare("SELECT id,session_path FROM agent_conversations").map_err(db)?;
        let rows=query.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?))).map_err(db)?.collect::<Result<Vec<_>,_>>().map_err(db)?;drop(query);
        for (key,saved) in rows{if path.zip(saved.as_deref()).is_some_and(|(a,b)|session_path_key(a)==session_path_key(b))&&!removed.contains(&key){removed.push(key);}}
        for key in &removed{
            tx.execute("UPDATE agent_conversations SET deleted_at=COALESCE(deleted_at,?),updated_at=? WHERE id=?",params![at,at,key]).map_err(db)?;
            tx.execute("DELETE FROM agent_bindings WHERE conversation_id=?",[key]).map_err(db)?;
        }
        if let Some(path)=path{tx.execute("INSERT INTO agent_deleted_sessions(path,session_id,deleted_at) VALUES(?,?,?) ON CONFLICT(path) DO NOTHING",params![session_path_key(path),session_id,at]).map_err(db)?;}
        tx.commit().map_err(db)?;Ok(json!({"deleted":true,"conversationKeys":removed,"sessionPath":path,"sessionId":session_id}))
    }
    pub fn agent_prepare_input(&mut self,key:&str,session:&str,generation:u64,message_count:usize,objects:&[Source],attachments:&[String],providers:&Providers)->Result<(String,Value),StorageError>{
        self.agent_prepare_input_at(key,session,generation,message_count,objects,attachments,providers,None)
    }
    pub fn agent_prepare_input_at(&mut self,key:&str,session:&str,generation:u64,message_count:usize,objects:&[Source],attachments:&[String],providers:&Providers,current_source:Option<Source>)->Result<(String,Value),StorageError>{
        let binding=self.agent_conversation(key)?;
        let source:Source=match current_source{Some(source)=>source,None=>serde_json::from_value(binding["source"].clone()).map_err(|_|invalid("会话来源记录损坏。"))?};
        source.validate()?;
        if objects.len()>16||attachments.len()>16{return Err(invalid("最多附加16个工作台对象或文件。"));}
        let attachment_root=self.root.clone();let input_id=id(self)?;let tx=self.db.transaction().map_err(db)?;
        let mut contexts=Vec::new();let mut seen=std::collections::HashSet::new();
        for target in objects{target.validate()?;if !seen.insert((target.module.clone(),target.object_id.clone())){return Err(invalid("同一对象不能重复附加。"));}let snapshot=providers.module(&target.module)?.snapshot(&tx,target)?;if snapshot.source.module!=target.module||snapshot.source.object_id!=target.object_id||snapshot.revision<1{return Err(invalid("模块返回的对象基线无效，未发送。"));}contexts.push(snapshot);}
        if source.object_id.is_some()&&providers.0.contains_key(&source.module)&&!objects.iter().any(|o|o.module==source.module&&o.object_id==source.object_id){contexts.push(providers.module(&source.module)?.snapshot(&tx,&source)?);}
        if contexts.len()>16{return Err(invalid("包含当前详情在内，最多附加16个工作台对象；请减少选择后重试。"));}
        let mut files=Vec::new();for attachment in attachments{let info=tx.query_row("SELECT name,relative_path,hash,bytes,mime_type FROM agent_attachments WHERE id=?",[attachment],|r|Ok(json!({"id":attachment,"name":r.get::<_,String>(0)?,"relativePath":r.get::<_,String>(1)?,"hash":r.get::<_,String>(2)?,"bytes":r.get::<_,i64>(3)?,"mimeType":r.get::<_,String>(4)?}))).optional().map_err(db)?.ok_or_else(||invalid("文件副本记录不存在，未发送。"))?;let mut info=info;info["path"]=json!(attachment_root.join(info["relativePath"].as_str().ok_or_else(||invalid("文件副本路径损坏。"))?).to_string_lossy());files.push(info);}
        let context=json!({"version":2,"inputId":input_id,"conversationKey":key,"sessionId":session,"messageCount":message_count,"source":source,"objects":contexts.iter().map(|o|json!({"source":o.source})).collect::<Vec<_>>(),"attachments":files});
        let text=encoded(&context)?;if text.len()>256*1024{return Err(invalid("对象上下文超过256KiB，未截断发送；输入保留。"));}
        tx.execute("INSERT INTO agent_inputs(id,conversation_id,session_id,generation,message_count,context,status,created_at) VALUES(?,?,?,?,?,?,?,?)",params![input_id,key,session,generation as i64,message_count as i64,text,"prepared",now()]).map_err(db)?;tx.commit().map_err(db)?;Ok((input_id,context))
    }
    pub fn agent_input_status(&self,input_id:&str,status:&str)->Result<(),StorageError>{self.db.execute("UPDATE agent_inputs SET status=? WHERE id=?",params![status,input_id]).map_err(db)?;Ok(())}
    pub fn agent_draft(&self,key:&str,session:&str,id:&str)->Result<Value,StorageError>{
        self.agent_check_open(key,None)?;
        self.db.query_row("SELECT d.id,d.conversation_id,d.input_id,d.payload,d.validation,d.status,d.receipt,d.revision,d.created_at,i.context,d.message_key FROM agent_drafts d JOIN agent_inputs i ON i.id=d.input_id JOIN agent_conversations c ON c.id=d.conversation_id WHERE d.id=? AND i.session_id=? AND c.deleted_at IS NULL",params![id,session],|r|Ok(json!({"id":r.get::<_,String>(0)?,"conversationKey":r.get::<_,String>(1)?,"inputId":r.get::<_,String>(2)?,"payload":serde_json::from_str::<Value>(&r.get::<_,String>(3)?).unwrap_or(Value::Null),"validation":serde_json::from_str::<Value>(&r.get::<_,String>(4)?).unwrap_or(Value::Null),"status":r.get::<_,String>(5)?,"receipt":r.get::<_,Option<String>>(6)?.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"revision":r.get::<_,i64>(7)?,"createdAt":r.get::<_,String>(8)?,"messageKey":r.get::<_,String>(10)?,"context":serde_json::from_str::<Value>(&r.get::<_,String>(9)?).unwrap_or(Value::Null)}))).optional().map_err(db)?.ok_or_else(||invalid("本会话草案不存在。"))
    }
    pub fn agent_drafts(&self)->Result<Vec<Value>,StorageError>{let mut statement=self.db.prepare("SELECT d.id,d.conversation_id,d.input_id,d.payload,d.validation,d.status,d.receipt,d.revision,d.created_at,i.context,d.message_key FROM agent_drafts d JOIN agent_inputs i ON i.id=d.input_id WHERE d.status!='discarded' ORDER BY d.created_at DESC LIMIT 200").map_err(db)?;statement.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"conversationKey":r.get::<_,String>(1)?,"inputId":r.get::<_,String>(2)?,"payload":serde_json::from_str::<Value>(&r.get::<_,String>(3)?).unwrap_or(Value::Null),"validation":serde_json::from_str::<Value>(&r.get::<_,String>(4)?).unwrap_or(Value::Null),"status":r.get::<_,String>(5)?,"receipt":r.get::<_,Option<String>>(6)?.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"revision":r.get::<_,i64>(7)?,"createdAt":r.get::<_,String>(8)?,"messageKey":r.get::<_,String>(10)?,"context":serde_json::from_str::<Value>(&r.get::<_,String>(9)?).unwrap_or(Value::Null)}))).map_err(db)?.collect::<Result<Vec<_>,_>>().map_err(db)}
    pub fn agent_revalidate(&mut self,draft_id:&str,revision:i64,providers:&Providers)->Result<Value,StorageError>{
        let tx=self.db.transaction().map_err(db)?;
        let (raw,context,status,actual):(String,String,String,i64)=tx.query_row("SELECT d.payload,i.context,d.status,d.revision FROM agent_drafts d JOIN agent_inputs i ON i.id=d.input_id WHERE d.id=?",[draft_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(db)?;
        if actual!=revision||!matches!(status.as_str(),"blocked"|"review"|"conflict"){return Err(StorageError::new("agent_draft_conflict","草案状态已经变化，请重新读取。"));}
        let result=serde_json::from_str::<DraftPayload>(&raw).map_err(|_|invalid("草案JSON结构无效，原回复保留。")).and_then(|payload|serde_json::from_str::<Value>(&context).map_err(|_|invalid("发送基线损坏。")).and_then(|context|validate_payload(&tx,&payload,&context,providers)));
        let (status,validation)=match result{Ok(items)=>("review",json!({"items":items,"error":null})),Err(error)=>(if error.code=="agent_baseline_conflict"{"conflict"}else{"blocked"},json!({"items":[],"error":error.message}))};
        tx.execute("UPDATE agent_drafts SET status=?,validation=?,revision=revision+1 WHERE id=? AND revision=?",params![status,encoded(&validation)?,draft_id,revision]).map_err(db)?;
        tx.commit().map_err(db)?;Ok(json!({"status":status,"validation":validation}))
    }
    pub fn agent_apply(&mut self,draft_id:&str,revision:i64,providers:&Providers)->Result<Value,StorageError>{
        let tx=self.db.transaction().map_err(db)?;
        let (payload,context,status,receipt,actual):(String,String,String,Option<String>,i64)=tx.query_row("SELECT d.payload,i.context,d.status,d.receipt,d.revision FROM agent_drafts d JOIN agent_inputs i ON i.id=d.input_id WHERE d.id=?",[draft_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(db)?;
        if status=="applied"{return serde_json::from_str(receipt.as_deref().ok_or_else(||invalid("保存回执缺失，请保留记录并核对。"))?).map_err(|_|invalid("保存回执损坏。"));}
        if status!="review"||actual!=revision{return Err(StorageError::new("agent_draft_conflict","草案状态已经变化，未应用；请重新读取。"));}
        let payload:DraftPayload=serde_json::from_str(&payload).map_err(|_|invalid("草案格式损坏。"))?;let context:Value=serde_json::from_str(&context).map_err(|_|invalid("发送基线损坏。"))?;
        if let Err(e)=validate_payload(&tx,&payload,&context,providers){
            drop(tx);if e.code=="agent_baseline_conflict"{self.db.execute("UPDATE agent_drafts SET status='conflict',validation=json_set(validation,'$.error',?),revision=revision+1 WHERE id=? AND revision=? AND status='review'",params![e.message,draft_id,revision]).map_err(db)?;}return Err(e);
        }
        let mut receipts=Vec::new();for op in &payload.operations{let baseline=baseline(&context,op)?;receipts.push(providers.module(&op.module)?.apply(&tx,op,&baseline)?);}
        let receipt=json!({"draftId":draft_id,"appliedAt":now(),"items":receipts,"pendingDecisions":payload.decisions});
        tx.execute("UPDATE agent_drafts SET status='applied',receipt=?,revision=revision+1 WHERE id=?",params![encoded(&receipt)?,draft_id]).map_err(db)?;tx.commit().map_err(db)?;Ok(receipt)
    }
    pub fn agent_discard(&self,draft_id:&str,revision:i64)->Result<(),StorageError>{let changed=self.db.execute("UPDATE agent_drafts SET status='discarded',revision=revision+1 WHERE id=? AND revision=? AND status IN ('review','blocked','conflict')",params![draft_id,revision]).map_err(db)?;if changed!=1{return Err(StorageError::new("agent_draft_conflict","草案已变化，未重复作废。"));}Ok(())}
}
fn baseline(context:&Value,op:&Operation)->Result<ObjectContext,StorageError>{let target=context["objects"].as_array().and_then(|a|a.iter().find(|v|v["source"]["module"]==op.module&&v["source"]["objectId"]==op.object_id)).ok_or_else(||invalid("草案目标缺少已保存的版本基线，未应用。"))?;serde_json::from_value(target.clone()).map_err(|_|invalid("对象基线格式无效。"))}
pub(crate) fn validate_payload(tx:&Transaction<'_>,payload:&DraftPayload,context:&Value,providers:&Providers)->Result<Vec<Value>,StorageError>{
    if payload.version!=1{return Err(invalid("草案版本不受支持，请按当前协议重写。"));}
    if payload.operations.is_empty(){return Err(invalid("草案没有可应用的变更；待确认事项保留，请补齐后重新生成。"));}
    if payload.operations.len()>100{return Err(invalid("草案变更超过100项，请拆分后重新生成。"));}
    let mut items=Vec::new();let mut seen=std::collections::HashSet::new();for op in &payload.operations{
        if !seen.insert((&op.module,&op.object_id)){return Err(invalid("同批草案对一个对象只能包含一个完整操作，请合并后重写。"));}
        let before=baseline(context,op)?;if !before.operations.contains(&op.action){return Err(invalid("模块没有提供此操作，未应用。"));}
        let provider=providers.module(&op.module)?;
        if before.revision==0{provider.creation(tx,op)?;}else{let current=provider.snapshot(tx,&before.source)?;if current.revision!=before.revision{return Err(StorageError::new("agent_baseline_conflict","对象已被手动修改，整批草案过期；请按新版本重做。"));}}
        let mut item=provider.validate(tx,op,&before)?;if !item.is_object(){return Err(invalid("模块校验结果无效，未应用。"));}item["module"]=json!(op.module);item["objectId"]=json!(op.object_id);item["action"]=json!(op.action);item["before"]=before.snapshot.clone();item["proposed"]=op.values.clone();items.push(item);
    }Ok(items)
}
pub fn message_text(message:&Value)->String{if let Some(s)=message["content"].as_str(){return s.into();}message["content"].as_array().map(|a|a.iter().filter(|b|b["type"]=="text").filter_map(|b|b["text"].as_str()).collect::<Vec<_>>().join("\n")).unwrap_or_default()}
