use crate::storage::{StorageError,Store};
use crate::task_panel_store::{db_error,decode,encode,event,executions,expected,invalid,is_live,new_id,now,receipt,request,task};
use crate::task_panel_paths::{hash,protected_absolute,read_limited,scoped_file,within_scope};
use crate::task_panel_snapshots::{sample,WorkspaceSnapshot};
use crate::task_panel_types::{Evidence,Execution};
use rusqlite::{params,OptionalExtension};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::path::Path;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ResultInput {pub request_id:String,pub execution_id:String,pub path:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ResultReview {pub id:String,pub execution_id:String,pub status:String,pub errors:Vec<String>,pub original_hash:String,pub observed_snapshot_id:Option<String>,pub raw:Value}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct CheckInput {pub request_id:String,pub execution_id:String,pub expected_revision:i64,#[serde(default)]pub check_id:Option<String>,pub command:String,pub exit_code:Option<i64>,pub status:String,pub log_path:String,#[serde(default)]pub expected_log_hash:Option<String>,pub coverage:Vec<String>,pub approved:bool,pub reason:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AcceptInput {pub request_id:String,pub task_id:String,pub expected_revision:i64,pub execution_id:String,pub snapshot_id:String,pub accepted:bool,pub approved:bool,pub acknowledge_unverified:bool,pub reason:String}

pub(crate) fn snapshot(db:&rusqlite::Connection,id:&str)->Result<WorkspaceSnapshot,StorageError>{
    let raw:String=db.query_row("SELECT content FROM tp_snapshots WHERE id=?1",[id],|r|r.get(0)).map_err(db_error)?;decode(&raw)
}
pub(crate) fn add_evidence(db:&rusqlite::Connection,run:&Execution,kind:&str,level:&str,status:&str,path:&str,digest:&str,detail:&Value,snapshot_id:Option<&str>)->Result<Evidence,StorageError>{
    let e=Evidence{id:new_id(db,"evidence")?,task_id:run.task_id.clone(),execution_id:run.id.clone(),task_revision:run.task_revision,kind:kind.into(),level:level.into(),status:status.into(),path:path.into(),hash:digest.into(),detail:detail.clone(),snapshot_id:snapshot_id.map(String::from),created_at:now()};
    db.execute("INSERT INTO tp_evidence VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![e.id,e.task_id,e.execution_id,e.task_revision,e.kind,e.level,e.status,e.path,e.hash,encode(&e.detail)?,e.snapshot_id,e.created_at]).map_err(db_error)?;
    let t=task(db,&run.task_id)?;
    crate::task_panel_store::graph_object(db,&e.id,t.repository_id.as_deref(),if kind=="check"{"check"}else{"evidence"},&format!("{kind} · {status}"),level,&json!({"path":path,"hash":digest,"snapshotId":snapshot_id,"detail":detail}))?;
    crate::task_panel_store::graph_link(db,&run.id,&e.id,"produced","observed","本执行保存的原件或证据记录，不提升声明等级")?;
    if kind=="check"{crate::task_panel_store::graph_link(db,&run.task_id,&e.id,"checked_by",level,"本次技术检查记录")?;}
    Ok(e)
}
pub(crate) fn current_evidence(db:&rusqlite::Connection,e:&Evidence,t:&crate::task_panel_types::Task)->bool {
    let current=crate::task_panel_locations::execution_repository(db,t).and_then(|r|sample(&r,&t.scope)).ok();
    evidence_invalid_reason(db,e,t,current.as_ref()).is_none()
}
pub(crate) fn evidence_invalid_reason(db:&rusqlite::Connection,e:&Evidence,t:&crate::task_panel_types::Task,current:Option<&WorkspaceSnapshot>)->Option<String>{
    if e.task_revision!=t.revision{return Some("任务要求已修订，属于旧版本记录".into());}
    if e.kind=="check"&&!e.path.is_empty()&&protected_absolute(Path::new(&e.path),8_000_000).map_or(true,|b|hash(&b)!=e.hash){return Some("检查原件不可读或内容已变化".into());}
    let Some(sid)=&e.snapshot_id else{return Some("没有可核对的代码快照".into());};
    let Ok(old)=snapshot(db,sid) else{return Some("原代码快照不可读".into());};
    let Some(current)=current else{return Some("执行目录或当前代码不可读".into());};
    if old.fingerprint!=current.fingerprint{return Some("当前代码已变化，需重新检查".into());}
    None
}
pub(crate) fn check_identity(detail:&Value)->String{
    for field in ["checkId","check_id","id","command","name","description"] {if let Some(value)=detail[field].as_str().map(str::trim).filter(|s|!s.is_empty()){return value.into();}}
    String::new()
}
fn check_coverage_matches(required:&Value,confirmed:&Value)->bool{
    let Some(paths)=required["coverage"].as_array() else{return true;};
    let Some(actual)=confirmed["coverage"].as_array() else{return paths.is_empty();};
    paths.iter().all(|path|path.as_str().is_some_and(|wanted|{
        let wanted=wanted.replace('\\',"/");
        actual.iter().any(|p|p.as_str().is_some_and(|p|{let p=p.replace('\\',"/");p=="."||p==wanted||wanted.strip_prefix(p.trim_end_matches('/')).is_some_and(|suffix|suffix.starts_with('/'))}))
    }))
}
// Agent-reported `required` remains part of the technical status. Only a
// requirement confirmed by the user may prevent the user's acceptance.
pub(crate) fn acceptance_checks_satisfied(db:&rusqlite::Connection,t:&crate::task_panel_types::Task,run:&Execution,evidence:&[Evidence],current:Option<&WorkspaceSnapshot>)->bool{
    let records:Vec<_>=evidence.iter().filter(|e|e.execution_id==run.id&&e.task_revision==t.revision&&e.kind=="check").collect();
    let mut confirmations=std::collections::BTreeMap::new();
    for e in &records{if ["observed","user_confirmed"].contains(&e.level.as_str()){confirmations.entry(check_identity(&e.detail)).or_insert(*e);}}
    records.iter().filter(|e|e.level=="user_confirmed"&&e.detail["required"].as_bool()==Some(true)).all(|requirement|{
        let identity=check_identity(&requirement.detail);
        !identity.is_empty()&&confirmations.get(&identity).is_some_and(|e|e.status=="passed"&&evidence_invalid_reason(db,e,t,current).is_none()&&check_coverage_matches(&requirement.detail,&e.detail))
    })
}
// Required checks accumulate within this execution; partial reports cannot erase them.
pub(crate) fn checks_status(db:&rusqlite::Connection,t:&crate::task_panel_types::Task,run:&Execution,evidence:&[Evidence],current:Option<&WorkspaceSnapshot>)->String{
    let records:Vec<_>=evidence.iter().filter(|e|e.execution_id==run.id&&e.task_revision==t.revision&&e.kind=="check").collect();
    let mut confirmations=std::collections::BTreeMap::new();
    for e in &records {if ["observed","user_confirmed"].contains(&e.level.as_str()) {confirmations.entry(check_identity(&e.detail)).or_insert(*e);}}
    if confirmations.values().any(|e|evidence_invalid_reason(db,e,t,current).is_none()&&e.status=="failed"){return "failed".into();}
    let required:Vec<&Evidence>=records.iter().copied().filter(|e|e.detail["required"].as_bool()==Some(true)).collect();
    let satisfied=|requirement:&Evidence|{let identity=check_identity(&requirement.detail);!identity.is_empty()&&confirmations.get(&identity).is_some_and(|e|e.status=="passed"&&evidence_invalid_reason(db,e,t,current).is_none()&&check_coverage_matches(&requirement.detail,&e.detail))};
    if !required.is_empty()&&required.iter().any(|e|!satisfied(e)){return if confirmations.values().any(|e|evidence_invalid_reason(db,e,t,current).is_some()){"stale"}else{"not_run"}.into();}
    if confirmations.values().any(|e|e.status=="passed"&&evidence_invalid_reason(db,e,t,current).is_none()){return "passed".into();}
    if confirmations.values().any(|e|evidence_invalid_reason(db,e,t,current).is_some()){return "stale".into();}
    "not_run".into()
}
fn own_file(parent:&Path,relative:&str)->Result<(String,String),StorageError>{
    let path=scoped_file(parent,relative,&[".".into()])?;
    let bytes=read_limited(&path,32_000_000)?;Ok((path.to_string_lossy().into_owned(),hash(&bytes)))
}
impl Store {
    pub fn task_panel_result(&mut self,input:ResultInput)->Result<ResultReview,StorageError>{
        let encoded=encode(&input)?;
        if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        let mut run=executions(&self.db)?.into_iter().find(|r|r.id==input.execution_id).ok_or_else(||invalid("请指定原执行记录；不会猜测回执归属。"))?;
        let path=Path::new(&input.path);let bytes=protected_absolute(path,4_000_000)?;let digest=hash(&bytes);
        if let Some(raw)=self.db.query_row("SELECT detail FROM tp_evidence WHERE execution_id=?1 AND kind='receipt' AND hash=?2 LIMIT 1",params![run.id,digest],|r|r.get::<_,String>(0)).optional().map_err(db_error)?{return decode(&raw);}
        let id=new_id(&self.db,"receipt")?;
        let dir=self.root.join("task-panel/receipts");std::fs::create_dir_all(&dir).map_err(|_|invalid("回执原件保存目录不可用。"))?;
        let saved=dir.join(format!("{id}.json"));
        use std::io::Write;let mut out=std::fs::OpenOptions::new().create_new(true).write(true).open(&saved).map_err(|_|invalid("未能保存原始回执，未更新执行。"))?;
        out.write_all(&bytes).and_then(|_|out.sync_all()).map_err(|_|invalid("原始回执保存失败，未更新执行。"))?;
        let parsed=serde_json::from_slice::<Value>(&bytes);
        let mut errors=Vec::new();let raw=match parsed {Ok(v) if v.is_object()=>v,_=>{errors.push("回执不是完整的 JSON 对象；原件已保留。".into());Value::Null}};
        let t=task(&self.db,&run.task_id)?;
        for (key,wanted) in [("task_id",run.task_id.as_str()),("run_id",run.id.as_str()),("context_id",run.context_id.as_str())] {if raw.get(key).and_then(Value::as_str)!=Some(wanted){errors.push(format!("{key} 与本执行不符，不能用作当前结果。"));}}
        if raw["protocol_version"].as_i64()!=Some(1)||raw["task_revision"].as_i64()!=Some(run.task_revision){errors.push("协议或任务修订不匹配。".into());}
        if raw["binding_generation"].as_i64()!=Some(run.binding_generation){errors.push("回执缺少匹配的绑定代次。".into());}
        if raw["workspace_snapshot_id"].as_str()!=run.snapshot_id.as_deref(){errors.push("回执的执行前代码快照不匹配。".into());}
        let latest_attempt:i64=self.db.query_row("SELECT max(attempt) FROM tp_executions WHERE task_id=?1",[&run.task_id],|r|r.get(0)).map_err(db_error)?;
        let latest_binding:i64=self.db.query_row("SELECT coalesce(max(generation),0) FROM tp_bindings WHERE task_id=?1",[&run.task_id],|r|r.get(0)).map_err(db_error)?;
        if run.attempt!=latest_attempt||run.binding_generation!=latest_binding||run.task_revision!=t.revision||run.state=="superseded"{errors.push("这是已替换的执行、绑定或任务修订，只保留历史，不能更新新尝试。".into());}
        let outcome=raw["execution_outcome"].as_str().unwrap_or("");let ack=raw["accepted_or_blocked"].as_str().unwrap_or("");
        if !["accepted","blocked",""].contains(&ack)||!["reported_finished","failed","blocked",""].contains(&outcome)||ack.is_empty()&&outcome.is_empty(){errors.push("没有有效接收或交付状态。".into());}
        if !is_live(&run.state)&&run.state!="reported_finished"{errors.push("执行已结束或已替换，本回执只留作历史。".into());}
        let valid_identity=errors.is_empty();let mut observed=None;
        if valid_identity&&outcome=="reported_finished" {
            match t.repository_id.as_ref().map(|_|self.task_panel_snapshot_task(&t)).transpose(){
                Ok(Some(current))=>{
                    let old=run.snapshot_id.as_ref().map(|s|snapshot(&self.db,s)).transpose()?;
                    let actual:Vec<String>=current.files.iter().filter(|f|old.as_ref().is_none_or(|o|!o.files.iter().any(|p|p.path==f.path&&p.hash==f.hash))).map(|f|f.path.clone()).chain(old.iter().flat_map(|o|o.files.iter().filter(|p|!current.files.iter().any(|f|f.path==p.path)).map(|p|p.path.clone()))).collect();
                    let claimed=raw["changed_files"].as_array();
                    if claimed.is_none(){errors.push("交付缺少 changed_files 列表。".into());}
                    let mut claimed_paths=Vec::new();
                    if let Some(files)=claimed {for item in files.iter().take(5001){
                        let relative=item.as_str().or_else(||item["path"].as_str()).unwrap_or("");
                        if !within_scope(relative,&t.scope){errors.push(format!("变更路径超出授权范围：{relative}"));continue;}
                        claimed_paths.push(relative.to_string());
                        if !current.files.iter().any(|f|f.path==relative)&&!old.as_ref().is_some_and(|s|s.files.iter().any(|f|f.path==relative)){errors.push(format!("声明变更文件不存在：{relative}"));}
                        if let Some(h)=item["sha256"].as_str(){if !current.files.iter().any(|f|f.path==relative&&f.hash==h){errors.push(format!("声明的文件哈希不符：{relative}"));}}
                    }if files.len()>5000{errors.push("变更清单超过接收上限。".into());}}
                    for p in &actual{if !claimed_paths.contains(p){errors.push(format!("实际改动未列入交付：{p}"));}}
                    let detail=json!({"actualChangedFiles":actual,"claimedChangedFiles":claimed_paths,"fingerprint":current.fingerprint,"coverage":current.coverage,"unknowns":current.unknowns,"errors":errors});
                    add_evidence(&self.db,&run,"file_check","observed",if errors.is_empty(){"passed"}else{"failed"},"",&current.fingerprint,&detail,Some(&current.id))?;
                    if crate::task_panel_locations::assigned(&self.db,&t.id)?.is_none(){for p in &actual{self.db.execute("UPDATE tp_nodes SET stale=1 WHERE repository_id=?1 AND (path=?2 OR path LIKE ?3)",params![t.repository_id,p,format!("{p}/%")]).map_err(db_error)?;}}
                    observed=Some(current.id);
                },
                Ok(None)=>errors.push("交付尚无真实工作区。".into()),Err(e)=>errors.push(e.message),
            }
            let repo=t.repository_id.as_ref().map(|_|crate::task_panel_locations::execution_repository(&self.db,&t)).transpose()?;
            let parent=std::fs::canonicalize(path).ok().and_then(|p|p.parent().map(Path::to_path_buf));
            match raw["artifact_refs"].as_array(){Some(refs) if refs.len()<=200=>for item in refs {
                let relative=item.as_str().or_else(||item["path"].as_str()).unwrap_or("");
                let file=if item["location"].as_str()==Some("repository"){repo.as_ref().ok_or_else(||invalid("产物缺少仓库归属。")).and_then(|r|scoped_file(Path::new(&r.path),relative,&t.scope)).and_then(|p|read_limited(&p,32_000_000).map(|b|(p.to_string_lossy().into_owned(),hash(&b))))}
                    else{parent.as_ref().ok_or_else(||invalid("回执目录不可读。")).and_then(|p|own_file(p,relative))};
                match file {Ok((p,h))=>{let matches=item["sha256"].as_str().is_none_or(|wanted|wanted==h);if !matches{errors.push(format!("产物哈希不符：{relative}"));}
                    let saved_dir=self.root.join("task-panel/artifacts");std::fs::create_dir_all(&saved_dir).map_err(|_|invalid("产物原件目录不可用。"))?;let saved=saved_dir.join(format!("{}-{}",run.id,new_id(&self.db,"artifact")?));
                    let bytes=read_limited(Path::new(&p),32_000_000)?;if hash(&bytes)!=h{return Err(invalid("产物在核对期间改变，请重新接收；原回执已保留。"));}
                    let mut out=std::fs::OpenOptions::new().create_new(true).write(true).open(&saved).map_err(|_|invalid("产物副本保存失败。"))?;out.write_all(&bytes).and_then(|_|out.sync_all()).map_err(|_|invalid("产物副本保存失败。"))?;
                    add_evidence(&self.db,&run,"artifact","observed",if matches{"located"}else{"mismatch"},&saved.to_string_lossy(),&h,&json!({"source":"explicit_result","originalPath":p,"semanticStatus":"not_reviewed"}),observed.as_deref())?;},Err(e)=>errors.push(format!("产物 {relative}：{}",e.message)),}
            },_=>errors.push("交付缺少有效的 artifact_refs 清单。".into())}
            if let Some(checks)=raw["checks"].as_array(){
                if checks.len()>100{errors.push("技术检查清单超过 100 项，原件保留；未静默忽略剩余必做检查。".into());}
                for check in checks.iter().take(100){
                    let mut detail=check.clone();
                    // Logs are supplied with the delivery, never discovered in arbitrary
                    // host directories. Saving a log does not prove an Agent's claim.
                    if detail.is_object(){
                        detail.as_object_mut().unwrap().remove("reportedLog");
                        if let Some(log)=check.get("log_ref"){
                            let saved=(||->Result<Value,StorageError>{
                                let relative=log.as_str().or_else(||log["path"].as_str()).ok_or_else(||invalid("检查日志引用缺少路径。"))?;
                                let folder=parent.as_ref().ok_or_else(||invalid("交付目录不可读。"))?;
                                let file=scoped_file(folder,relative,&[".".into()])?;
                                let bytes=read_limited(&file,8_000_000)?;let digest=hash(&bytes);
                                if log["sha256"].as_str().is_some_and(|wanted|wanted!=digest){return Err(invalid("检查日志哈希不符。"));}
                                let directory=self.root.join("task-panel/checks").join(new_id(&self.db,"reported-check")?);
                                std::fs::create_dir_all(&directory).map_err(|_|invalid("检查日志保存失败。"))?;
                                let path=directory.join("check.log");
                                use std::io::Write;
                                let mut out=std::fs::OpenOptions::new().create_new(true).write(true).open(&path).map_err(|_|invalid("检查日志保存失败。"))?;
                                out.write_all(&bytes).and_then(|_|out.sync_all()).map_err(|_|invalid("检查日志保存失败。"))?;
                                let text=String::from_utf8_lossy(&bytes);let preview:String=text.chars().take(12000).collect();
                                Ok(json!({"path":path.to_string_lossy(),"hash":digest,"preview":preview,"truncated":text.chars().count()>12000}))
                            })();
                            match saved{Ok(log)=>{detail["reportedLog"]=log;},Err(e)=>{detail["logError"]=json!(e.message);}}
                        }
                    }
                    add_evidence(&self.db,&run,"check","claim",check["status"].as_str().unwrap_or("not_run"),detail["reportedLog"]["path"].as_str().unwrap_or(""),detail["reportedLog"]["hash"].as_str().unwrap_or(""),&detail,observed.as_deref())?;
                }
            }
            else{errors.push("交付缺少技术检查/未运行说明。".into());}
        }
        let status=if !valid_identity{"quarantined"}else if !errors.is_empty(){"needs_review"}else{"matched"};
        let review=ResultReview{id,execution_id:run.id.clone(),status:status.into(),errors,original_hash:digest.clone(),observed_snapshot_id:observed.clone(),raw:raw.clone()};
        let tx=self.db.transaction().map_err(db_error)?;
        add_evidence(&tx,&run,"receipt","claim",status,&saved.to_string_lossy(),&digest,&serde_json::to_value(&review).map_err(|_|invalid("回执保存失败。"))?,observed.as_deref())?;
        if valid_identity {
            let delivery_already_seen=run.state=="reported_finished";
            run.state=if !outcome.is_empty(){outcome.into()}else if ack=="blocked"{"blocked".into()}else if raw["started"].as_bool()==Some(true){"running".into()}else{"accepted".into()};
            if delivery_already_seen&&outcome.is_empty(){run.state="reported_finished".into();}
            run.reason=if review.errors.is_empty(){raw["reason"].as_str().unwrap_or("已收到本任务回执；没有自动验收").chars().take(5000).collect()}else{review.errors.join("；")};run.updated_at=now();
            tx.execute("UPDATE tp_executions SET state=?1,reason=?2,updated_at=?3 WHERE id=?4",params![run.state,run.reason,run.updated_at,run.id]).map_err(db_error)?;
            let source=format!("回执 {}",review.id);let refs=json!([{"receiptId":review.id,"sha256":digest,"executionId":run.id,"snapshotId":observed}]);
            if let Some(summary)=raw["resume_summary"].as_str().filter(|s|!s.trim().is_empty()&&s.chars().count()<=20_000){crate::task_panel_store::memory_candidate(&tx,&t,"pause",summary,&source,&refs)?;}
            if let Some(proposals)=raw["proposed_memory_updates"].as_array(){for p in proposals.iter().take(100){if let Some(body)=p["body"].as_str().filter(|b|!b.trim().is_empty()&&b.chars().count()<=20_000){let kind=p["kind"].as_str().filter(|k|["memory","pause","decision","goal","requirement"].contains(k)).unwrap_or("memory");crate::task_panel_store::memory_candidate(&tx,&t,kind,body,&source,&json!({"receipt":refs,"claimedSources":p["sources"]}))?;}}}
        }
        event(&tx,&input.request_id,&run.id,"receipt_reviewed","observed",&encode(&json!({"status":status,"errors":review.errors,"hash":digest}))?)?;
        receipt(&tx,&input.request_id,&encoded,&review)?;tx.commit().map_err(db_error)?;Ok(review)
    }
    pub fn task_panel_check(&mut self,input:CheckInput)->Result<Evidence,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        let run=executions(&self.db)?.into_iter().find(|r|r.id==input.execution_id).ok_or_else(||invalid("执行记录不存在。"))?;let t=task(&self.db,&run.task_id)?;expected(t.revision,Some(input.expected_revision))?;
        if run.task_revision!=t.revision||!input.approved||input.command.trim().is_empty()||input.command.len()>2000||input.check_id.as_ref().is_some_and(|id|id.trim().is_empty()||id.len()>2000)||!crate::task_panel_store::valid_scope(&input.coverage)||input.coverage.is_empty()||!["passed","failed","not_run"].contains(&input.status.as_str())||input.status=="passed"&&input.exit_code!=Some(0)||input.reason.len()>5000{return Err(invalid("请本人核对原始检查记录、实际退出码和覆盖范围；不会执行报告中的命令。"));}
        if input.coverage.iter().any(|p|p!="."&&!within_scope(p,&t.scope))||input.coverage.iter().any(|p|p=="."&&!t.scope.iter().any(|s|s==".")){return Err(invalid("检查覆盖超出任务范围。"));}
        let current=self.task_panel_snapshot_task(&t)?;
        let delivery=crate::task_panel_store::evidence(&self.db)?.into_iter().find(|e|e.execution_id==run.id&&e.kind=="file_check"&&e.status=="passed").ok_or_else(||invalid("请先接收并核对当前交付文件。"))?;
        if !current_evidence(&self.db,&delivery,&t){return Err(invalid("交付核对后代码已改变，请重新接收当前版本。"));}
        let (path,digest)=if input.status=="not_run"{(String::new(),String::new())}else{
            let bytes=protected_absolute(Path::new(&input.log_path),8_000_000)?;
            if input.expected_log_hash.as_ref().is_some_and(|wanted|wanted!=&hash(&bytes)){return Err(invalid("检查日志在查看后改变，请重新核对。"));}
            let directory=self.root.join("task-panel/checks").join(new_id(&self.db,"check-original")?);
            std::fs::create_dir_all(&directory).map_err(|_|invalid("检查原件保存失败。"))?;
            let saved=directory.join("check.log");use std::io::Write;
            let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&saved).map_err(|_|invalid("检查原件保存失败。"))?;
            file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|invalid("检查原件保存失败。"))?;
            (saved.to_string_lossy().into_owned(),hash(&bytes))
        };
        let tx=self.db.transaction().map_err(db_error)?;
        let evidence=add_evidence(&tx,&run,"check","user_confirmed",&input.status,&path,&digest,&json!({"checkId":input.check_id,"command":input.command,"exitCode":input.exit_code,"coverage":input.coverage,"reason":input.reason,"source":"manually_reviewed_external_check","originalPath":input.log_path,"fingerprint":current.fingerprint}),Some(&current.id))?;
        event(&tx,&input.request_id,&run.id,"check_confirmed","user","本人核对技术检查原件；检查命令未由报告自动执行")?;receipt(&tx,&input.request_id,&encoded,&evidence)?;tx.commit().map_err(db_error)?;Ok(evidence)
    }
    pub fn task_panel_accept(&mut self,input:AcceptInput)->Result<String,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        let t=task(&self.db,&input.task_id)?;expected(t.revision,Some(input.expected_revision))?;
        let run=executions(&self.db)?.into_iter().find(|r|r.id==input.execution_id&&r.task_id==t.id&&r.task_revision==t.revision).ok_or_else(||invalid("执行与当前任务修订不匹配。"))?;
        if !input.approved||input.reason.trim().is_empty()||input.reason.len()>5000{return Err(invalid("请本人明确验收决定与理由。"));}
        let evidence=crate::task_panel_store::evidence(&self.db)?;
        if input.accepted {
            if run.state!="reported_finished"||t.lifecycle!="active"{return Err(invalid("尚无当前交付，或任务已暂停/取消，不能验收为完成。"));}
            let old=snapshot(&self.db,&input.snapshot_id)?;
            let repo=crate::task_panel_locations::execution_repository(&self.db,&t)?;
            let workspace=sample(&repo,&t.scope)?;
            if workspace.fingerprint!=old.fingerprint{return Err(invalid("代码版本在核对后改变，旧证据不能验收当前版本。"));}
            let current:Vec<_>=evidence.iter().filter(|e|e.execution_id==run.id&&evidence_invalid_reason(&self.db,e,&t,Some(&workspace)).is_none()).collect();
            if !current.iter().find(|e|e.kind=="file_check"&&e.level=="observed").is_some_and(|e|e.status=="passed")||!current.iter().find(|e|e.kind=="receipt").is_some_and(|e|e.status=="matched"){return Err(invalid("回执或文件仍有缺项，不能验收。"));}
            let status=checks_status(&self.db,&t,&run,&evidence,Some(&workspace));
            if status=="failed"{return Err(invalid("本版本存在技术检查失败，需逐项补做后核对。"));}
            if !acceptance_checks_satisfied(&self.db,&t,&run,&evidence,Some(&workspace)){return Err(invalid("本人明确确认的必做检查尚未通过，请补齐对应当前代码的检查记录。"));}
            if status!="passed"&&!input.acknowledge_unverified{return Err(invalid("技术检查尚未核对通过；如本人决定接受当前交付，请明确确认按未验证结果验收。"));}
        }
        let tx=self.db.transaction().map_err(db_error)?;let id=new_id(&tx,"acceptance")?;
        tx.execute("INSERT INTO tp_acceptances VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![id,t.id,t.revision,run.id,if input.snapshot_id.is_empty(){None}else{Some(input.snapshot_id.as_str())},input.accepted,input.reason,now()]).map_err(db_error)?;
        crate::task_panel_store::graph_object(&tx,&id,t.repository_id.as_deref(),"acceptance",if input.accepted{"本人验收"}else{"本人退回"},"user_confirmed",&json!({"taskRevision":t.revision,"snapshotId":input.snapshot_id,"reason":input.reason,"accepted":input.accepted}))?;
        crate::task_panel_store::graph_link(&tx,&t.id,&id,"governed_by","user_confirmed","本人对明确任务修订和代码版本的决定")?;
        event(&tx,&input.request_id,&t.id,if input.accepted{"task_accepted"}else{"task_rejected"},"user",&encode(&json!({"snapshotId":input.snapshot_id,"reason":input.reason,"evidenceIds":evidence.iter().filter(|e|e.execution_id==run.id).map(|e|&e.id).collect::<Vec<_>>(),"acknowledgeUnverified":input.acknowledge_unverified}))?)?;
        receipt(&tx,&input.request_id,&encoded,&id)?;tx.commit().map_err(db_error)?;Ok(id)
    }
}
