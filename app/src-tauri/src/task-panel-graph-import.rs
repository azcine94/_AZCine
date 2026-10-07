use crate::storage::{StorageError,Store};
use crate::task_panel_paths::{hash,portable_relative,protected_absolute,read_limited,scoped_file,within_scope};
use crate::task_panel_store::{bump_graph,db_error,decode,encode,event,expected,graph_revision,id_ok,invalid,new_id,now,receipt,repository,request};
use rusqlite::{OptionalExtension,params};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::{collections::{HashMap,HashSet},path::Path};

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphSource {pub id:String,pub path:String,pub line_start:usize,pub line_end:usize,pub revision:Option<String>,pub sha256:Option<String>,pub statement:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportNode {pub id:String,pub kind:String,pub label:String,pub path:String,pub symbol:String,pub archify_component_id:Option<String>,pub sources:Vec<String>}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportRelation {pub id:String,pub from:String,pub to:String,pub kind:String,pub sources:Vec<String>,pub inference:Option<String>}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactRef {pub path:String,pub sha256:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportArtifacts {pub candidate:ArtifactRef,pub architecture:ArtifactRef,pub render_status:String,pub validation_status:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphFacts {
    pub schema_version:i64,pub analysis_id:String,pub run_id:Option<String>,pub context_id:Option<String>,
    pub repository_ref:String,pub revision:Option<String>,pub workspace_snapshot_id:Option<String>,
    pub scope:Vec<String>,pub exclusions:Vec<String>,pub coverage:Value,pub unknowns:Vec<String>,
    pub artifacts:ImportArtifacts,pub nodes:Vec<ImportNode>,pub relations:Vec<ImportRelation>,pub sources:Vec<GraphSource>,
    pub proposals:Vec<Value>,pub base_graph_revision:i64,pub changes:Vec<Value>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ImportPreviewInput {pub request_id:String,pub repository_id:String,pub facts_path:String,pub source:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct SourceReview {pub source_id:String,pub path:String,pub located:bool,pub reason:String,pub semantic_status:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ImportPreview {
    pub id:String,pub analysis_id:String,pub hash:String,pub repository_id:String,pub base_graph_revision:i64,
    pub facts:GraphFacts,pub source_reviews:Vec<SourceReview>,pub errors:Vec<String>,pub warnings:Vec<String>,pub status:String,
    pub observed_fingerprint:String,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ImportApplyInput {pub request_id:String,pub import_id:String,pub expected_graph_revision:i64,pub relation_ids:Vec<String>,pub approved:bool}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ImportReceipt {pub import_id:String,pub graph_revision:i64,pub nodes:usize,pub relations:usize,pub evidence_level:String}

fn validate(pack:&GraphFacts)->Result<(),StorageError>{
    if pack.schema_version!=1||!id_ok(&pack.analysis_id)||pack.nodes.len()>5000||pack.relations.len()>10000||pack.sources.len()>10000||pack.unknowns.len()>1000||pack.base_graph_revision<0 {
        return Err(invalid("分析包版本或规模不受支持；原件未改变。"));
    }
    let mut ids=HashSet::new();
    for n in &pack.nodes {if !id_ok(&n.id)||!ids.insert(n.id.clone())||n.label.trim().is_empty()||n.label.len()>2000||!portable_relative(&n.path)||n.symbol.len()>2000||!["module","component","file","function","command","database","design"].contains(&n.kind.as_str()){return Err(invalid("分析对象缺少稳定代码定位、类型不受支持或编号重复。"));}}
    let mut sources=HashSet::new();
    for s in &pack.sources {if !id_ok(&s.id)||!sources.insert(s.id.clone())||!portable_relative(&s.path)||s.line_start<1||s.line_end<s.line_start||s.statement.is_empty(){return Err(invalid("来源编号、路径、行范围或结论无效。"));}}
    let mut relation_ids=HashSet::new();
    for r in &pack.relations {if !id_ok(&r.id)||!relation_ids.insert(r.id.clone())||!ids.contains(&r.from)||!ids.contains(&r.to)||r.from==r.to||!["imports","calls","registers","reads","writes","contains","may_affect"].contains(&r.kind.as_str())||r.sources.is_empty()||r.sources.iter().any(|s|!sources.contains(s)){return Err(invalid("关系存在悬空引用、重复编号、缺来源或不支持的类型；代码调用不能成为调度前置。"));}}
    for n in &pack.nodes{if n.sources.iter().any(|s|!sources.contains(s)){return Err(invalid("对象引用了不存在的来源。"));}}
    Ok(())
}
pub(crate) fn review_sources(pack:&GraphFacts,repo:&crate::task_panel_types::Repository)->Vec<SourceReview>{
    pack.sources.iter().map(|s|{
        let result=(||->Result<(),StorageError>{
            let path=scoped_file(Path::new(&repo.path),&s.path,&pack.scope)?;let bytes=read_limited(&path,8_000_000)?;
            if let Some(wanted)=&s.sha256{if hash(&bytes)!=*wanted{return Err(invalid("内容哈希不同。"));}}
            let text=String::from_utf8(bytes).map_err(|_|invalid("来源不是可核对的文本。"))?;
            if s.line_end>text.lines().count(){return Err(invalid("来源行号不存在。"));}
            if s.revision!=pack.revision{return Err(invalid("来源版本与分析基线不同。"));}Ok(())
        })();
        SourceReview{source_id:s.id.clone(),path:s.path.clone(),located:result.is_ok(),reason:result.err().map(|e|e.message).unwrap_or_else(||"文件、行范围与提供的哈希可定位；语义尚未核对。".into()),semantic_status:"claim".into()}
    }).collect()
}
impl Store {
    pub fn task_panel_import_preview(&mut self,input:ImportPreviewInput)->Result<ImportPreview,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        if input.source.trim().is_empty(){return Err(invalid("请注明这次分析包的来源。"));}
        let mut repo=repository(&self.db,&input.repository_id)?;
        let bytes=protected_absolute(Path::new(&input.facts_path),16_000_000)?;
        let pack:GraphFacts=serde_json::from_slice(&bytes).map_err(|error|invalid(&format!("graph-facts.json 格式不符合 v1 约定：{error}；原件保留。")))?;validate(&pack)?;
        if let Some(run_id)=pack.run_id.as_ref(){
            if let Some(run)=crate::task_panel_store::executions(&self.db)?.into_iter().find(|r|&r.id==run_id){
                let task=crate::task_panel_store::task(&self.db,&run.task_id)?;
                if task.repository_id.as_ref()==Some(&input.repository_id){repo=crate::task_panel_locations::execution_repository(&self.db,&task)?;}
            }
        }
        let content_hash=hash(&bytes);
        let previous:Option<(String,String)>=self.db.query_row("SELECT id,hash FROM tp_imports WHERE analysis_id=?1",[&pack.analysis_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        if let Some((id,old))=previous {if old!=content_hash{return Err(StorageError::new("analysis_conflict","同一分析编号出现不同内容；原草案与文件均保留。"));}return self.task_panel_import_get(&id);}
        if pack.repository_ref!=input.repository_id{return Err(invalid("分析包所属仓库与选择不同。"));}
        if pack.scope.is_empty()||!crate::task_panel_store::valid_scope(&pack.scope)||pack.scope.iter().any(|s|!repo.scope.iter().any(|a|a=="."||s==a||s.starts_with(&(a.clone()+"/")))){return Err(invalid("分析范围越出仓库已确认范围。"));}
        if pack.nodes.iter().any(|n|!within_scope(&n.path,&pack.scope)){return Err(invalid("分析对象路径不在允许范围。"));}
        let facts_file=std::fs::canonicalize(&input.facts_path).map_err(|_|invalid("分析文件不可读。"))?;
        let directory=facts_file.parent().unwrap();let mut artifacts=Vec::new();
        for a in [&pack.artifacts.candidate,&pack.artifacts.architecture] {
            if !portable_relative(&a.path){return Err(invalid("产物引用必须是同一交付目录内的相对文件路径。"));}
            let file=std::fs::canonicalize(directory.join(&a.path)).map_err(|_|invalid("candidate 或 architecture 产物缺失。"))?;
            if !file.starts_with(directory){return Err(invalid("产物路径存在链接逃逸。"));}
            let bytes=read_limited(&file,32_000_000)?;if hash(&bytes)!=a.sha256{return Err(invalid("三件产物的哈希不匹配，不能混入不同版本。"));}artifacts.push((a.path.clone(),bytes));
        }
        let candidate:Value=serde_json::from_slice(&artifacts[0].1).map_err(|_|invalid("candidate.json 无法解析。"))?;
        if candidate.get("schema_version").and_then(Value::as_i64)!=Some(1)||candidate.get("diagram_type").and_then(Value::as_str)!=Some("architecture")||candidate.get("components").and_then(Value::as_array).is_none_or(|a|a.is_empty()){return Err(invalid("candidate.json 不是 Archify 架构图规格。"));}
        let mut errors=Vec::new();let mut warnings=Vec::new();
        let current_head=crate::task_panel_snapshots::sample(&repo,&pack.scope)?.head;
        if current_head!=pack.revision{errors.push("分析提交与仓库当前版本不同，请重新分析后核对。".into());}
        if pack.base_graph_revision!=graph_revision(&self.db)?{errors.push("关系图基线已改变，保留草案并重新核对。".into());}
        let candidate_revision=candidate.pointer("/meta/repository/revision").and_then(Value::as_str).or_else(||candidate.pointer("/meta/repository/commit").and_then(Value::as_str));
        if pack.revision.is_some()&&candidate_revision!=pack.revision.as_deref(){errors.push("candidate 与关系包的代码基线未关联。".into());}
        if let Some(run)=&pack.run_id {
            let execution=crate::task_panel_store::executions(&self.db)?.into_iter().find(|e|e.id==*run);
            if let Some(e)=execution{
                let task=crate::task_panel_store::task(&self.db,&e.task_id)?;
                let latest=crate::task_panel_store::executions(&self.db)?.into_iter().find(|r|r.task_id==e.task_id);
                if Some(&e.context_id)!=pack.context_id.as_ref()||e.snapshot_id!=pack.workspace_snapshot_id||task.repository_id.as_ref()!=Some(&repo.id)||task.revision!=e.task_revision||latest.is_none_or(|r|r.id!=e.id)||["superseded","cancelled"].contains(&e.state.as_str()){
                    errors.push("分析的 run/context/快照、任务修订或当前尝试不匹配；旧产物已保留，不能作用于新尝试。".into());
                }
            }else{errors.push("分析 run 不存在，不能混用外部执行编号。".into());}
        }else if pack.context_id.is_some(){
            errors.push("提供了 context 却缺少相应 run，请选择明确关联的原执行。".into());
        }
        let components:HashSet<_>=candidate["components"].as_array().unwrap().iter().filter_map(|n|n["id"].as_str()).collect();
        if pack.nodes.iter().any(|n|n.archify_component_id.as_ref().is_some_and(|id|!components.contains(id.as_str()))){errors.push("对象引用了 candidate 中不存在的组件。".into());}
        let baseline=repository(&self.db,&input.repository_id)?;
        if baseline.path!=repo.path && review_sources(&pack,&baseline).iter().any(|s|!s.located){
            errors.push("这些源码出处仅适用于任务分支；分析材料已保留，尚不能替换总仓库架构。请合入后按总仓库版本复核。".into());
        }
        let source_reviews=review_sources(&pack,&repo);
        if source_reviews.iter().any(|s|!s.located){warnings.push("部分出处尚不能定位；批准导入也不会提升代码语义等级。".into());}
        if pack.artifacts.validation_status!="passed"{warnings.push("Archify 制图验证未通过或未运行；不能代替代码语义查证。".into());}
        if !pack.proposals.is_empty(){warnings.push("建议任务、决定与调度前置仅保留草案材料，不自动应用。".into());}
        if !pack.changes.is_empty(){warnings.push("失效建议需另行核对；本次不会因缺少旧关系而删除它。".into());}
        let id=new_id(&self.db,"imp")?;
        let destination=self.root.join("task-panel/imports").join(&id);std::fs::create_dir_all(&destination).map_err(|_|invalid("分析原件副本保存失败。"))?;
        fn preserve(path:&Path,bytes:&[u8])->Result<(),StorageError>{use std::io::Write;let mut f=std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|_|invalid("分析原件副本保存失败，未覆盖旧文件。"))?;f.write_all(bytes).map_err(|_|invalid("分析副本写入失败。"))?;f.sync_all().map_err(|_|invalid("分析副本同步失败。"))}
        preserve(&destination.join("graph-facts.json"),&bytes)?;preserve(&destination.join("candidate.json"),&artifacts[0].1)?;preserve(&destination.join("architecture.html"),&artifacts[1].1)?;
        let observed_fingerprint=crate::task_panel_snapshots::sample(&repo,&pack.scope)?.fingerprint;
        let result=ImportPreview{id:id.clone(),analysis_id:pack.analysis_id.clone(),hash:content_hash.clone(),repository_id:repo.id,base_graph_revision:pack.base_graph_revision,facts:pack,source_reviews,errors,warnings,status:"draft".into(),observed_fingerprint};
        let tx=self.db.transaction().map_err(db_error)?;
        tx.execute("INSERT INTO tp_imports VALUES(?1,?2,?3,?4,?5,?6,?7,'draft',?8,?9)",params![id,result.analysis_id,result.repository_id,result.facts.run_id,result.base_graph_revision,encode(&result)?,content_hash,input.source,now()]).map_err(db_error)?;
        event(&tx,&input.request_id,&id,"graph_import_preview","observed","三件产物已保存为待核对草案；未修改关系图")?;receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
    }
    pub fn task_panel_import_get(&self,id:&str)->Result<ImportPreview,StorageError>{
        let (raw,status):(String,String)=self.db.query_row("SELECT content,status FROM tp_imports WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;let mut result:ImportPreview=decode(&raw)?;result.status=status;Ok(result)
    }
    pub fn task_panel_imports(&self)->Result<Vec<ImportPreview>,StorageError>{
        let mut statement=self.db.prepare("SELECT id FROM tp_imports ORDER BY created_at DESC").map_err(db_error)?;
        let ids=statement.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
        ids.iter().map(|id|self.task_panel_import_get(id)).collect()
    }
    pub fn task_panel_import_apply(&mut self,input:ImportApplyInput)->Result<ImportReceipt,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        if !input.approved{return Err(invalid("需本人核对并明确批准这批导入。"));}
        let draft=self.task_panel_import_get(&input.import_id)?;
        if !draft.errors.is_empty(){return Err(invalid("分析包仍有版本或引用问题，未应用；草案保留。"));}
        if draft.status!="draft"{return Err(invalid("这份分析已应用，请读取原结果。"));}
        let mut repo=repository(&self.db,&draft.repository_id)?;
        if let Some(run_id)=draft.facts.run_id.as_ref(){if let Some(run)=crate::task_panel_store::executions(&self.db)?.into_iter().find(|r|&r.id==run_id){
            let task=crate::task_panel_store::task(&self.db,&run.task_id)?;
            let actual=crate::task_panel_locations::execution_repository(&self.db,&task)?;
            if actual.id!=repo.id{return Err(invalid("分析执行不属于当前总仓库。"));}
            if actual.path!=repo.path && review_sources(&draft.facts,&repo).iter().any(|s|!s.located){return Err(invalid("分支分析与总仓库源码不符，保留候选材料，未覆盖共享架构。"));}
            repo=actual;
        }}
        let current=crate::task_panel_snapshots::sample(&repo,&draft.facts.scope)?.head;
        if current!=draft.facts.revision{return Err(crate::task_panel_store::conflict());}
        if crate::task_panel_snapshots::sample(&repo,&draft.facts.scope)?.fingerprint!=draft.observed_fingerprint{return Err(StorageError::new("workspace_changed","导入核对期间源码已改变；保留草案，未应用旧分析。"));}
        let ids:HashSet<_>=input.relation_ids.iter().collect();
        if ids.len()!=input.relation_ids.len()||ids.iter().any(|id|!draft.facts.relations.iter().any(|r|&r.id==*id)){return Err(invalid("选择的关系不存在或重复。"));}
        let tx=self.db.transaction().map_err(db_error)?;expected(graph_revision(&tx)?,Some(input.expected_graph_revision))?;expected(draft.base_graph_revision,Some(input.expected_graph_revision))?;
        let mut map=HashMap::new();
        for n in &draft.facts.nodes {
            let stable=format!("node-{}",hash(encode(&(&repo.id,&n.kind,n.path.replace('\\',"/"),&n.symbol))?.as_bytes()));map.insert(n.id.clone(),stable.clone());
            let refs:Vec<_>=draft.facts.sources.iter().filter(|s|n.sources.contains(&s.id)).collect();
            let source=encode(&refs)?;
            let previous:Option<String>=tx.query_row("SELECT sources FROM tp_nodes WHERE id=?1",[&stable],|r|r.get(0)).optional().map_err(db_error)?;
            if previous.as_ref().is_some_and(|s|s!=&source){event(&tx,&input.request_id,&stable,"node_analysis_replaced","user",&encode(&json!({"previousSources":previous,"importId":input.import_id}))?)?;}
            tx.execute("INSERT INTO tp_nodes VALUES(?1,?2,?3,?4,?5,?6,'claim',?7,0) ON CONFLICT(id) DO UPDATE SET label=excluded.label,sources=excluded.sources,evidence_level=CASE WHEN tp_nodes.sources=excluded.sources THEN tp_nodes.evidence_level ELSE 'claim' END,stale=0",params![stable,repo.id,n.kind,n.label,n.path,n.symbol,source]).map_err(db_error)?;
        }
        let mut count=0;
        for r in draft.facts.relations.iter().filter(|r|ids.contains(&r.id)) {
            let from=&map[&r.from];let to=&map[&r.to];
            let refs:Vec<_>=draft.facts.sources.iter().filter(|s|r.sources.contains(&s.id)).collect();
            let existing:Option<String>=tx.query_row("SELECT id FROM tp_relations WHERE from_id=?1 AND to_id=?2 AND kind=?3 AND active=1",params![from,to,r.kind],|r|r.get(0)).optional().map_err(db_error)?;
            let source=encode(&refs)?;
            if let Some(id)=existing{
                let previous=crate::task_panel_store::relations(&tx)?.into_iter().find(|r|r.id==id).ok_or_else(crate::task_panel_store::conflict)?;
                if previous.source!=source{
                    event(&tx,&input.request_id,&id,"relation_analysis_replaced","user",&encode(&json!({"previous":previous,"importId":input.import_id}))?)?;
                    tx.execute("UPDATE tp_relations SET source=?1,evidence_level='claim',revision=revision+1 WHERE id=?2",params![source,id]).map_err(db_error)?;
                }
            }else{let id=new_id(&tx,"rel")?;tx.execute("INSERT INTO tp_relations VALUES(?1,?2,?3,?4,'none',?5,'claim',1,1)",params![id,from,to,r.kind,source]).map_err(db_error)?;count+=1;}
        }
        let revision=bump_graph(&tx)?;tx.execute("UPDATE tp_imports SET status='applied' WHERE id=?1",[&input.import_id]).map_err(db_error)?;
        tx.execute("INSERT INTO tp_analysis_versions VALUES(?1,?2,?3,?4,?5,?6)",params![new_id(&tx,"analysis-version")?,input.import_id,revision,encode(&draft.facts.artifacts)?,encode(&json!({"approved":true,"selectedRelations":input.relation_ids,"sourceReviews":draft.source_reviews,"semanticLevel":"claim"}))?,now()]).map_err(db_error)?;
        let result=ImportReceipt{import_id:input.import_id.clone(),graph_revision:revision,nodes:map.len(),relations:count,evidence_level:"claim".into()};
        event(&tx,&input.request_id,&input.import_id,"graph_import_applied","user","本人批准导入；出处定位与代码语义等级分别保存，未自动提升证据")?;
        receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
    }
}
