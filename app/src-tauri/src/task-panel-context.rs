use crate::storage::{StorageError, Store};
use crate::task_panel_paths::hash;
use crate::task_panel_snapshots::WorkspaceSnapshot;
use crate::task_panel_store::{db_error, decode, encode, event, expected, graph_revision, invalid, memories_scoped, new_id, now, receipt, relations, request, task};
use crate::task_panel_types::{Memory, Relation,Node,TaskPlan,TaskProject,Evidence};
use rusqlite::params;
use serde::{Deserialize,Serialize};

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ContextInput {pub request_id:String,pub task_id:String,pub expected_revision:i64}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ContextPackage {
    pub id:String,pub protocol_version:i64,pub task_id:String,pub task_revision:i64,pub graph_revision:i64,
    pub goal:String,pub title:String,pub scope:Vec<String>,pub acceptance_criteria:Vec<String>,pub repository_id:Option<String>,
    pub workspace_snapshot:Option<WorkspaceSnapshot>,pub dependencies:Vec<Relation>,pub decisions:Vec<Memory>,
    pub resume_summary:String,pub source_refs:Vec<String>,pub missing_information:Vec<String>,pub hash:String,pub created_at:String,
    pub related_files:Vec<Node>,pub impact_candidates:Vec<Relation>,
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub related_objects:Vec<Node>,
    #[serde(default)] pub plan:TaskPlan,
    #[serde(default)] pub project:Option<TaskProject>,
    #[serde(default)] pub references:Vec<Memory>,
    #[serde(default)] pub evidence:Vec<Evidence>,
    #[serde(default)] pub scope_hash:String,
    #[serde(default)] pub omitted_items:usize,
}

pub(crate) fn applicable(m:&Memory,task_id:&str,plan:&TaskPlan,repo:Option<&str>)->bool{
    if m.task_id.as_deref()==Some(task_id){return true;}
    if m.project_id!=plan.project_id{return false;}
    if m.task_id.as_ref().is_some_and(|id|plan.goal_id.as_ref()==Some(id)){return true;}
    m.task_id.is_none()&&(m.repository_id.as_deref().is_some_and(|r|Some(r)==repo)||m.repository_id.is_none()&&plan.project_id.is_some())
}

// A change in an unrelated project must not invalidate this task's prepared context.
pub(crate) fn scope_stamp(db:&rusqlite::Connection,task_id:&str)->Result<String,StorageError>{
    let t=task(db,task_id)?;let plan=crate::task_panel_projects::plan(db,task_id)?;
    let project=crate::task_panel_projects::projects(db)?.into_iter().find(|p|Some(&p.id)==plan.project_id.as_ref());
    let repo=t.repository_id.as_ref().map(|_|crate::task_panel_locations::execution_repository(db,&t)).transpose()?;
    let memory:Vec<_>=memories_scoped(db,plan.project_id.as_deref())?.into_iter().filter(|m|applicable(m,task_id,&plan,t.repository_id.as_deref())&&(m.status=="active"||m.status=="draft"&&m.category=="reference"&&!m.stale)).collect();
    let nodes:Vec<_>=crate::task_panel_store::nodes(db)?.into_iter().filter(|n|n.id==task_id||Some(&n.id)==plan.goal_id.as_ref()||Some(&n.id)==plan.project_id.as_ref()||t.repository_id.is_some()&&n.repository_id==t.repository_id).collect();
    let ids:std::collections::HashSet<_>=nodes.iter().map(|n|n.id.as_str()).collect();
    let edges:Vec<_>=relations(db)?.into_iter().filter(|r|r.active&&(r.from_id==task_id||r.to_id==task_id||ids.contains(r.from_id.as_str())&&ids.contains(r.to_id.as_str()))).collect();
    Ok(hash(encode(&(t,plan,project,repo,memory,&nodes,edges))?.as_bytes()))
}
impl Store {
    pub fn task_panel_context(&mut self,input:ContextInput)->Result<ContextPackage,StorageError>{
        let encoded=encode(&input)?;
        if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        let t=task(&self.db,&input.task_id)?;expected(t.revision,Some(input.expected_revision))?;
        let plan=crate::task_panel_projects::plan(&self.db,&t.id)?;
        let project=crate::task_panel_projects::projects(&self.db)?.into_iter().find(|p|Some(&p.id)==plan.project_id.as_ref());
        let scope_hash=scope_stamp(&self.db,&t.id)?;
        let snapshot=t.repository_id.as_ref().map(|_|self.task_panel_snapshot_task(&t)).transpose()?;
        let all_relations=relations(&self.db)?;
        let all_nodes=crate::task_panel_store::nodes(&self.db)?;
        let related_goals:Vec<_>=plan.goal_id.iter().cloned().collect();
        let mut related_objects:Vec<_>=all_nodes.iter().filter(|n|!n.stale&&(related_goals.contains(&n.id)||all_relations.iter().any(|r|r.active&&related_goals.contains(&r.from_id)&&r.to_id==n.id))).cloned().collect();
        let dependencies=all_relations.iter().filter(|r|r.active&&r.from_id==t.id&&r.kind=="depends_on").cloned().collect();
        let mut related_files:Vec<Node>=all_nodes.into_iter().filter(|n|n.repository_id==t.repository_id&&!n.path.is_empty()&&crate::task_panel_paths::within_scope(&n.path,&t.scope)).collect();
        let mut impact_candidates:Vec<_>=all_relations.into_iter().filter(|r|r.active&&r.kind=="may_affect"&&related_files.iter().any(|n|n.id==r.from_id||n.id==r.to_id)).collect();
        let memory=memories_scoped(&self.db,plan.project_id.as_deref())?;
        let decisions=memory.iter().filter(|m|m.status=="active"&&m.category=="decision"&&applicable(m,&t.id,&plan,t.repository_id.as_deref())).cloned().collect();
        let mut references:Vec<Memory>=memory.into_iter().rev().filter(|m|["draft","active"].contains(&m.status.as_str())&&m.category=="reference"&&!m.stale&&applicable(m,&t.id,&plan,t.repository_id.as_deref())).collect();
        let mut evidence:Vec<Evidence>=crate::task_panel_store::evidence(&self.db)?.into_iter().filter(|e|e.task_id==t.id&&e.task_revision==t.revision).collect();
        let omitted_items=references.len().saturating_sub(12)+evidence.len().saturating_sub(12)+related_objects.len().saturating_sub(250)+related_files.len().saturating_sub(250)+impact_candidates.len().saturating_sub(250);
        references.truncate(12);evidence.truncate(12);
        let mut missing=Vec::new();
        for (kind,count) in [("目标关联对象",related_objects.len()),("关联代码",related_files.len()),("影响候选",impact_candidates.len())]{if count>250{missing.push(format!("{}共 {} 项，仅附前 250 项；完整范围请在关系图分页核对。",kind,count));}}
        related_objects.truncate(250);related_files.truncate(250);impact_candidates.truncate(250);
        for node in &mut related_files {
            let refs=node.sources.as_array().cloned().unwrap_or_else(||vec![node.sources.clone()]);
            let hashes:Vec<_>=refs.iter().filter_map(|s|s["path"].as_str().zip(s["sha256"].as_str())).collect();
            if !hashes.is_empty(){node.stale=hashes.iter().any(|(path,wanted)|snapshot.as_ref().is_none_or(|snap|!snap.files.iter().any(|f|f.path==*path&&f.hash==*wanted)));}
        }
        for edge in &mut impact_candidates {
            let refs:serde_json::Value=serde_json::from_str(&edge.source).unwrap_or_default();let refs=refs.as_array().cloned().unwrap_or_else(||vec![refs]);
            for source in refs {if let (Some(path),Some(wanted))=(source["path"].as_str(),source["sha256"].as_str()){if snapshot.as_ref().is_none_or(|s|!s.files.iter().any(|f|f.path==path&&f.hash==wanted)){edge.evidence_level="stale".into();}}}
        }
        if related_files.iter().any(|n|n.stale){missing.push("部分代码索引与当前文件不一致，影响关系仅供复核，请回读当前源码。".into());}
        if references.iter().any(|m|m.origin_level=="claim"){missing.push("参考摘要来自 Agent 候选，未核实且不构成授权或正式决定；重要结论需回读所列原件。".into());}
        if t.repository_id.is_none(){missing.push("尚未指定真实工作区；可保存规划，不能直接派发代码修改。".into());}
        if snapshot.as_ref().is_none_or(|s|s.head.is_none()){missing.push("没有可核对的提交；未伪造代码版本。".into());}
        let has_graph:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM tp_nodes WHERE repository_id=?1 AND path<>'')",[t.repository_id.as_deref()],|r|r.get(0)).map_err(db_error)?;
        if !has_graph{missing.push("尚无代码架构，影响范围未知。".into());}
        let tx=self.db.transaction().map_err(db_error)?;
        let mut result=ContextPackage{id:new_id(&tx,"ctx")?,protocol_version:1,task_id:t.id.clone(),task_revision:t.revision,graph_revision:graph_revision(&tx)?,goal:t.goal,title:t.title,scope:t.scope,acceptance_criteria:t.criteria,repository_id:t.repository_id,
            workspace_snapshot:snapshot,dependencies,decisions,resume_summary:t.resume_summary,source_refs:vec![t.source],missing_information:missing,hash:String::new(),created_at:now(),related_files,impact_candidates,related_objects,plan,project,references,evidence,scope_hash,omitted_items};
        while encode(&result)?.len()>120_000 {
            if result.references.pop().is_none()&&result.impact_candidates.pop().is_none()&&result.related_files.pop().is_none()&&result.related_objects.pop().is_none()&&result.evidence.pop().is_none(){return Err(invalid("目标、有效决定和必要快照超过上下文预算，请拆分任务；没有省略正式约束。"));}
            result.omitted_items+=1;
        }
        if result.omitted_items>0{result.missing_information.push(format!("上下文预算 128 KB，本次省略 {} 项补充资料；可通过 Agent 查询入口按对象回读。有效决定保留。",result.omitted_items));}
        let body=encode(&result)?;
        if body.len()>128_000{return Err(invalid("上下文超过 128 KB，请缩小任务范围；没有静默省略约束。"));}
        result.hash=hash(body.as_bytes());
        tx.execute("INSERT INTO tp_contexts VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![result.id,result.task_id,result.task_revision,result.graph_revision,result.workspace_snapshot.as_ref().map(|s|s.id.as_str()),encode(&result)?,result.hash,result.created_at]).map_err(db_error)?;
        event(&tx,&input.request_id,&result.task_id,"context_created","observed","已生成有版本的任务上下文；未发送给 Agent")?;
        receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
    }
    pub fn task_panel_get_context(&self,id:&str)->Result<ContextPackage,StorageError>{
        let raw:String=self.db.query_row("SELECT content FROM tp_contexts WHERE id=?1",[id],|r|r.get(0)).map_err(db_error)?;decode(&raw)
    }
}
