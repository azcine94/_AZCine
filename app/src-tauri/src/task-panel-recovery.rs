use crate::storage::{StorageError,Store};
use crate::task_panel_store::{encode,event,executions,invalid,task};
use crate::task_panel_evidence::snapshot;
use crate::task_panel_snapshots::sample;
use crate::task_panel_types::{Evidence,Execution,Task};
use serde::{Deserialize,Serialize};
use serde_json::Value;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct RecoveryFile {pub path:String,pub before_hash:Option<String>,pub current_hash:Option<String>,pub change:String,pub restorable:bool,pub reason:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct RecoveryPreview {pub task:Task,pub execution:Execution,pub files:Vec<RecoveryFile>,pub evidence:Vec<Evidence>,pub missing:Vec<String>,pub current_fingerprint:Option<String>,pub preserved_sources:Vec<String>,pub affected_tasks:Vec<String>}
impl Store {
    pub fn task_panel_recovery(&self,execution_id:&str)->Result<RecoveryPreview,StorageError>{
        let run=executions(&self.db)?.into_iter().find(|r|r.id==execution_id).ok_or_else(||invalid("执行记录不存在。"))?;let t=task(&self.db,&run.task_id)?;
        let mut missing=Vec::new();let old=run.snapshot_id.as_ref().map(|s|snapshot(&self.db,s)).transpose().unwrap_or_else(|_|{missing.push("执行前快照记录不可读取，不能承诺还原。".into());None});
        let current=t.repository_id.as_ref().map(|_|crate::task_panel_locations::execution_repository(&self.db,&t).and_then(|r|sample(&r,&t.scope))).transpose().unwrap_or_else(|e|{missing.push(e.message);None});
        if old.is_none(){missing.push("没有执行前代码快照。".into());}
        if run.task_revision!=t.revision{missing.push("当前任务与原执行修订不同，恢复需重新核对范围。".into());}
        if crate::task_panel_store::is_live(&run.state){missing.push("原执行是否仍在运行须对账；本预览不会停止 Herdr。".into());}
        let mut paths:Vec<_>=old.iter().chain(current.iter()).flat_map(|s|s.files.iter().map(|f|f.path.clone())).collect();paths.sort();paths.dedup();
        let files=paths.into_iter().map(|p|{let before=old.as_ref().and_then(|s|s.files.iter().find(|f|f.path==p)).map(|f|f.hash.clone());let cur=current.as_ref().and_then(|s|s.files.iter().find(|f|f.path==p)).map(|f|f.hash.clone());
            let change=match(&before,&cur){(None,Some(_))=>"added",(Some(_),None)=>"removed",(a,b) if a==b=>"unchanged",_=>"modified"};
            RecoveryFile{path:p,before_hash:before,current_hash:cur,change:change.into(),restorable:false,reason:"快照保留版本和哈希，未保存源码原文；不能直接回滚或覆盖当前文件。".into()}
        }).collect();
        let evidence:Vec<_>=crate::task_panel_store::evidence(&self.db)?.into_iter().filter(|e|e.execution_id==run.id).collect();
        let own=self.root.join("task-panel");
        let preserved_sources=evidence.iter().filter_map(|e|{let p=std::path::Path::new(&e.path);if p.is_file()&&p.starts_with(&own){Some(e.path.clone())}else{None}}).collect();
        missing.push("源码及未跟踪文件未保留原文的部分不可自动恢复；可从已保存的回执/分析产物继续任务。实际覆盖必须另行明确授权。".into());
        let affected_tasks=crate::task_panel_store::relations(&self.db)?.into_iter().filter(|r|r.active&&r.kind=="depends_on"&&r.to_id==t.id).map(|r|r.from_id).collect();
        Ok(RecoveryPreview{task:t,execution:run,files,evidence,missing,current_fingerprint:current.map(|s|s.fingerprint),preserved_sources,affected_tasks})
    }
    pub fn task_panel_recovery_source(&self,execution_id:&str)->Result<Value,StorageError>{
        let preview=self.task_panel_recovery(execution_id)?;
        event(&self.db,&format!("recovery-preview-{}",preview.execution.id),&preview.task.id,"recovery_preview","observed","只预览原执行与当前差异，未覆盖文件")?;
        serde_json::from_str(&encode(&preview)?).map_err(|_|invalid("恢复预览无法读取。"))
    }
}
