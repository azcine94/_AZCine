use crate::storage::{StorageError, Store};
use crate::task_panel_store::{db_error, graph_revision, invalid, nodes, relations};
use crate::task_panel_types::{Node, Relation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap,HashSet};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphQuery {
    pub project_id: Option<String>,
    #[serde(default)] pub workspace_task_id:Option<String>,
    #[serde(default)] pub layer:String,
    pub task_id: Option<String>, pub repository_id: Option<String>,
    #[serde(default)] pub kinds: Vec<String>,
    #[serde(default)] pub levels: Vec<String>,
    #[serde(default)] pub depth: usize,
    #[serde(default)] pub offset: usize,
    #[serde(default)] pub limit: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphView {
    pub graph_revision: i64, pub nodes: Vec<Node>, pub relations: Vec<Relation>,
    pub total_nodes: usize, pub offset: usize, pub has_more: bool,
    pub coverage: Vec<Value>, pub unknowns: Vec<String>,
}
fn source_hash(db:&rusqlite::Connection,cache:&mut HashMap<(String,String),Option<String>>,repo:&str,path:&str,execution_repo:Option<&crate::task_panel_types::Repository>)->Option<String>{
    cache.entry((repo.into(),path.into())).or_insert_with(||execution_repo.filter(|r|r.id==repo).cloned().map(Ok).unwrap_or_else(||crate::task_panel_store::repository(db,repo)).and_then(|r|crate::task_panel_paths::scoped_file(std::path::Path::new(&r.path),path,&r.scope)).and_then(|p|crate::task_panel_paths::read_limited(&p,8_000_000)).ok().map(|b|crate::task_panel_paths::hash(&b))).clone()
}
fn execution_node(kind:&str)->bool{["project","goal","phase","task","requirement","decision","idea","hypothesis","judgment","design","memory","pause","execution","session","evidence","check","acceptance","artifact"].contains(&kind)}
fn task_flow_node(kind:&str)->bool{["project","goal","phase","task"].contains(&kind)}
fn task_flow_neighborhood(id:&str,edges:&[Relation],depth:usize)->HashSet<String>{
    let mut included=HashSet::from([id.to_owned()]);
    // Walk prerequisites and downstream separately; sharing a prerequisite does not make a task downstream.
    for upstream in [true,false] {
        let mut seen=HashSet::from([id.to_owned()]);let mut frontier=seen.clone();
        for _ in 0..depth.max(1) {
            let mut next=HashSet::new();
            for edge in edges.iter().filter(|e|e.kind=="depends_on") {
                let (from,to)=if upstream{(&edge.from_id,&edge.to_id)}else{(&edge.to_id,&edge.from_id)};
                if frontier.contains(from)&&seen.insert(to.clone()){included.insert(to.clone());next.insert(to.clone());}
            }
            frontier=next;if frontier.is_empty(){break;}
        }
    }
    // Add project/goal/phase ancestors without expanding unrelated sibling tasks.
    let mut frontier=included.clone();
    while !frontier.is_empty(){
        let mut next=HashSet::new();
        for edge in edges.iter().filter(|e|e.kind=="contains") {
            if frontier.contains(&edge.to_id)&&included.insert(edge.from_id.clone()){next.insert(edge.from_id.clone());}
        }
        frontier=next;
    }
    included
}
impl Store {
    pub fn task_panel_graph(&self, input: GraphQuery) -> Result<GraphView, StorageError> {
        if !["","all","code","execution"].contains(&input.layer.as_str())||input.depth>4 || input.offset>100000 || input.limit>500 || input.kinds.len()>20 || input.levels.len()>5 || input.levels.iter().any(|s|!["claim","observed","user_confirmed","fixture","stale"].contains(&s.as_str())) {return Err(invalid("图查询范围过大或证据分类无效，请缩小范围。"));}
        let execution_repo=if input.layer=="execution"{None}else{input.workspace_task_id.as_ref().map(|id|crate::task_panel_store::task(&self.db,id).and_then(|t|crate::task_panel_locations::execution_repository(&self.db,&t))).transpose()?};
        let mut all=nodes(&self.db)?;let mut current_hashes=HashMap::new();
        if input.layer=="execution"{all.retain(|n|task_flow_node(&n.kind));}
        let deleted:HashSet<String>=crate::task_panel_projects::projects(&self.db)?.into_iter().filter(|p|p.deleted).map(|p|p.id).collect();
        if !deleted.is_empty(){let mut visible=Vec::new();for node in all {if crate::task_panel_projects::node_project(&self.db,&node.id)?.is_none_or(|p|!deleted.contains(&p)){visible.push(node);}}all=visible;}
        if let Some(project)=&input.project_id {
            let mut scoped=Vec::new();for node in all {if crate::task_panel_projects::node_project(&self.db,&node.id)?.as_ref()==Some(project){scoped.push(node);}}all=scoped;
        }
        if let Some(repo)=&input.repository_id {
            if input.project_id.as_ref().is_some_and(|p|crate::task_panel_projects::repository_project(&self.db,repo).ok().flatten().as_ref()!=Some(p)){return Err(invalid("仓库不属于当前项目。"));}
        }
        for node in &mut all {
            if let Some(repo_id)=&node.repository_id {
                if let Ok(repo)=crate::task_panel_store::repository(&self.db,repo_id){
                    let sources=if let Some(a)=node.sources.as_array(){a.clone()}else{vec![node.sources.clone()]};
                    if sources.iter().any(|s|s["path"].is_string()&&s["sha256"].is_string()){node.stale=false;}
                    for source in sources {
                        if let (Some(path),Some(wanted))=(source["path"].as_str(),source["sha256"].as_str()) {
                            if source_hash(&self.db,&mut current_hashes,&repo.id,path,execution_repo.as_ref()).as_deref()!=Some(wanted){node.stale=true;}
                        }
                    }
                }else if !node.path.is_empty(){node.stale=true;}
            }
        }
        let allowed_ids:HashSet<_>=all.iter().map(|n|n.id.clone()).collect();
        let mut edges:Vec<_>=relations(&self.db)?.into_iter().filter(|r|r.active&&allowed_ids.contains(&r.from_id)&&allowed_ids.contains(&r.to_id)&&(input.kinds.is_empty()||input.kinds.contains(&r.kind))).collect();
        if input.layer=="execution"{edges.retain(|r|["depends_on","contains"].contains(&r.kind.as_str()));}
        // Declared task scope is an explicit bridge, never a scheduling dependency or proof of impact.
        let tasks=self.db.prepare(&format!("SELECT {} FROM tp_tasks ORDER BY id",crate::task_panel_store::TASK_COLUMNS)).map_err(db_error)?.query_map([],crate::task_panel_store::task_row).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
        let mut bridge_truncated=false;let mut bridges=0;
        if input.kinds.is_empty()||input.kinds.iter().any(|k|k=="related_to") {for task in tasks.iter().filter(|t|allowed_ids.contains(&t.id)) {
            for node in all.iter().filter(|n|!n.path.is_empty()&&n.repository_id.is_some()&&n.repository_id==task.repository_id&&crate::task_panel_paths::within_scope(&n.path,&task.scope)) {
                if edges.iter().any(|r|r.from_id==task.id&&r.to_id==node.id){continue;}
                if bridges>=5000{bridge_truncated=true;break;}
                edges.push(Relation{id:format!("scope:{}:{}",task.id,node.id),from_id:task.id.clone(),to_id:node.id.clone(),kind:"related_to".into(),threshold:"none".into(),source:serde_json::json!({"kind":"declared_task_scope","taskRevision":task.revision,"path":node.path,"meaning":"任务声明范围内的代码，不代表已修改或已验证"}).to_string(),evidence_level:if node.stale{"stale"}else{"observed"}.into(),active:true,revision:task.revision});bridges+=1;
            }
        }}
        for edge in &mut edges {
            if let Some(repo_id)=all.iter().find(|n|n.id==edge.from_id).and_then(|n|n.repository_id.as_ref()){
                if let Ok(repo)=crate::task_panel_store::repository(&self.db,repo_id){
                    if let Ok(source)=serde_json::from_str::<Value>(&edge.source){
                        let refs=source.as_array().cloned().unwrap_or_else(||vec![source]);
                        for s in refs {if let (Some(path),Some(wanted))=(s["path"].as_str(),s["sha256"].as_str()){
                            if source_hash(&self.db,&mut current_hashes,&repo.id,path,execution_repo.as_ref()).as_deref()!=Some(wanted){edge.evidence_level="stale".into();}
                        }}
                    }
                }
            }
        }
        if !input.levels.is_empty(){edges.retain(|r|input.levels.contains(&r.evidence_level));}
        let neighborhood=if let Some(id)=&input.task_id {
            if !all.iter().any(|n|&n.id==id){return Err(invalid("图中心对象不存在。"));}
            if input.layer=="execution"&&all.iter().any(|n|&n.id==id&&n.kind=="task") {
                Some(task_flow_neighborhood(id,&edges,input.depth))
            } else {
            let mut included=HashSet::from([id.clone()]);let mut frontier=vec![id.clone()];
            for _ in 0..input.depth.max(1) {
                let mut next=Vec::new();
                for r in &edges {
                    if frontier.contains(&r.from_id)&&included.insert(r.to_id.clone()){next.push(r.to_id.clone());}
                    if frontier.contains(&r.to_id)&&included.insert(r.from_id.clone()){next.push(r.from_id.clone());}
                }
                frontier=next;
            }
            Some(included)
            }
        }else{None};
        let matching:Vec<_>=all.into_iter().filter(|n|(input.task_id.as_ref()==Some(&n.id)||match input.layer.as_str(){"code"=>!execution_node(&n.kind),"execution"=>execution_node(&n.kind),_=>true})&&neighborhood.as_ref().is_none_or(|set|set.contains(&n.id))&&input.repository_id.as_ref().is_none_or(|r|n.repository_id.as_ref()==Some(r))).collect();
        let total_nodes=matching.len();let limit=if input.limit==0{80}else{input.limit};
        let ids:HashSet<_>=matching.iter().take(input.offset+limit).map(|n|n.id.clone()).collect();
        let page:Vec<_>=matching.into_iter().skip(input.offset).take(limit).collect();
        let relations=edges.into_iter().filter(|r|ids.contains(&r.from_id)&&ids.contains(&r.to_id)).collect();
        if input.layer=="execution"{
            return Ok(GraphView{graph_revision:graph_revision(&self.db)?,nodes:page,relations,total_nodes,offset:input.offset,has_more:input.offset+limit<total_nodes,coverage:Vec::new(),unknowns:Vec::new()});
        }
        let mut coverage=Vec::new();let mut unknowns=Vec::new();
        if bridge_truncated{unknowns.push("任务与代码范围关联超过 5000 项，请缩小项目或仓库范围。".into());}
        let mut q=self.db.prepare("SELECT content FROM tp_imports WHERE status='applied' AND (?1 IS NULL OR repository_id=?1) AND (?2 IS NULL OR repository_id IN (SELECT repository_id FROM tp_project_repositories WHERE project_id=?2)) ORDER BY created_at DESC LIMIT 20").map_err(db_error)?;
        let raw=q.query_map(rusqlite::params![input.repository_id,input.project_id],|r|r.get::<_,String>(0)).map_err(db_error)?;
        for row in raw {
            let pack:Value=serde_json::from_str(&row.map_err(db_error)?).map_err(|_|invalid("架构分析记录格式损坏。"))?;
            if let Some(value)=pack.pointer("/facts/coverage"){coverage.push(value.clone());}
            if let Some(items)=pack.pointer("/facts/unknowns").and_then(Value::as_array){unknowns.extend(items.iter().filter_map(Value::as_str).map(String::from));}
        }
        let mut indexes=self.db.prepare("SELECT detail FROM tp_events WHERE kind='static_index' AND (?1 IS NULL OR object_id=?1) AND (?2 IS NULL OR object_id IN (SELECT repository_id FROM tp_project_repositories WHERE project_id=?2)) ORDER BY sequence DESC LIMIT 20").map_err(db_error)?;
        for row in indexes.query_map(rusqlite::params![input.repository_id,input.project_id],|r|r.get::<_,String>(0)).map_err(db_error)?{
            let index:Value=serde_json::from_str(&row.map_err(db_error)?).map_err(|_|invalid("静态索引记录格式损坏。"))?;
            coverage.push(serde_json::json!({"kind":"explicit_static_index","repositoryId":index["repositoryId"],"paths":index["coverage"],"exclusions":index["exclusions"],"scannedFiles":index["scannedFiles"],"fingerprint":index["fingerprint"]}));
            if let Some(items)=index["unknowns"].as_array(){unknowns.extend(items.iter().filter_map(Value::as_str).map(String::from));}
        }
        if coverage.is_empty(){unknowns.push("尚未导入代码架构，影响范围未知。".into());}
        unknowns.sort();unknowns.dedup();
        Ok(GraphView{graph_revision:graph_revision(&self.db)?,nodes:page,relations,total_nodes,offset:input.offset,has_more:input.offset+limit<total_nodes,coverage,unknowns})
    }
}
