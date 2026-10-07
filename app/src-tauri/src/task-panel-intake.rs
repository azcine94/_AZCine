use crate::storage::{StorageError,Store};
use crate::task_panel_store::{bump_graph,db_error,encode,event,expected,graph_revision,invalid,new_id,now,receipt,repository,request,task,valid_scope};
use crate::task_panel_paths::{hash,protected_absolute,portable_relative};
use crate::task_panel_types::{Mutation,MutationInput};
use rusqlite::params;
use serde::{Deserialize,Serialize};
use serde_json::json;
use std::path::Path;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PlanTask {pub title:String,pub goal:String,pub scope:Vec<String>,pub criteria:Vec<String>}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PlanDependency {pub task:usize,pub prerequisite:usize,#[serde(default="acceptance_threshold")]pub threshold:String}
fn acceptance_threshold()->String{"acceptance".into()}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct GoalInput {pub request_id:String,pub expected_graph_revision:i64,pub title:String,pub goal:String,pub requirements:Vec<String>,pub decisions:Vec<String>,pub tasks:Vec<PlanTask>,pub dependencies:Vec<PlanDependency>,pub designs:Vec<String>,pub source:String,pub approved:bool,pub parent_repository_id:Option<String>,pub new_directory:String,pub initialize_git:bool,pub install_dependencies:bool,#[serde(default)]pub project_id:Option<String>}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct GoalReceipt {pub goal_id:String,pub task_ids:Vec<String>,pub initialization_task_id:Option<String>,pub graph_revision:i64,pub warnings:Vec<String>,pub project_id:String}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AnalysisInput {pub request_id:String,pub repository_id:String,#[serde(default)]pub skill_path:String,#[serde(default)]pub exchange_directory:String,pub focus:String,pub incremental:bool,pub approved:bool}

fn insert_task(db:&rusqlite::Connection,id:&str,title:&str,goal:&str,scope:&[String],criteria:&[String],repo:Option<&str>,source:&str)->Result<(),StorageError>{
    db.execute("INSERT INTO tp_tasks SELECT ?1,coalesce(max(number),0)+1,?2,?3,?4,?5,?6,'active','',?7,'',1,?8,?8 FROM tp_tasks",params![id,title,goal,encode(scope)?,encode(criteria)?,repo,source,now()]).map_err(db_error)?;
    db.execute("INSERT INTO tp_nodes VALUES(?1,?2,'task',?3,'','','user_confirmed',?4,0)",params![id,repo,title,encode(&json!([{"source":source}]))?]).map_err(db_error)?;Ok(())
}
fn relation(db:&rusqlite::Connection,from:&str,to:&str,kind:&str,source:&str)->Result<(),StorageError>{
    db.execute("INSERT INTO tp_relations VALUES(?1,?2,?3,?4,?5,?6,'user_confirmed',1,1)",params![new_id(db,"rel")?,from,to,kind,if kind=="depends_on"{"acceptance"}else{"none"},source]).map_err(db_error)?;Ok(())
}
impl Store {
    pub fn task_panel_goal(&mut self,input:GoalInput)->Result<GoalReceipt,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        if !input.approved||input.title.trim().is_empty()||input.title.len()>500||input.goal.trim().is_empty()||input.goal.len()>20_000||input.source.trim().is_empty()||input.source.len()>2000||input.tasks.len()>100||input.requirements.len()>100||input.decisions.len()>100||input.designs.len()>100||input.dependencies.len()>400||input.requirements.iter().chain(input.decisions.iter()).chain(input.designs.iter()).any(|s|s.trim().is_empty()||s.len()>5000)||input.tasks.iter().any(|t|t.title.trim().is_empty()||t.title.len()>500||t.goal.len()>20_000||!valid_scope(&t.scope)||t.criteria.len()>100||t.criteria.iter().any(|c|c.len()>2000)){return Err(invalid("请核对目标、需求、设计和阶段任务草案后批准；不会执行环境初始化。"));}
        let parent=input.parent_repository_id.as_ref().map(|id|repository(&self.db,id)).transpose()?;
        if parent.is_some()&&(!portable_relative(&input.new_directory)||crate::task_panel_paths::sensitive(&input.new_directory)||!parent.as_ref().unwrap().scope.iter().any(|s|s=="."||s==&input.new_directory||input.new_directory.starts_with(&(s.clone()+"/")))){return Err(invalid("新目录必须在已确认父目录的允许范围内，不能覆盖父仓库本身。"));}
        if parent.is_none()&&(!input.new_directory.is_empty()||input.initialize_git||input.install_dependencies){return Err(invalid("初始化需先选择存在的父工作区；目标与规划仍可独立保存。"));}
        for dep in &input.dependencies{if dep.task>=input.tasks.len()||dep.prerequisite>=input.tasks.len()||dep.task==dep.prerequisite||!["acceptance","technical"].contains(&dep.threshold.as_str()){return Err(invalid("规划依赖引用无效。"));}}
        fn cycle(node:usize,deps:&[PlanDependency],path:&mut Vec<usize>)->bool{if path.contains(&node){return true;}path.push(node);let found=deps.iter().filter(|d|d.task==node).any(|d|cycle(d.prerequisite,deps,path));path.pop();found}
        if (0..input.tasks.len()).any(|n|cycle(n,&input.dependencies,&mut Vec::new())){return Err(StorageError::new("dependency_cycle","阶段任务形成循环，整批未保存。"));}
        let mut warnings=Vec::new();
        if let Some(p)=&parent {let target=Path::new(&p.path).join(&input.new_directory);if target.exists(){let real=std::fs::canonicalize(&target).map_err(|_|invalid("目标目录不能核对。"))?;if !real.starts_with(Path::new(&p.path)){return Err(invalid("新目录链接越出已授权父目录。"));}warnings.push("目标目录已存在；初始化任务只补缺项，保留原文件，冲突需核对。".into());}}
        let tx=self.db.transaction().map_err(db_error)?;expected(graph_revision(&tx)?,Some(input.expected_graph_revision))?;
        let goal_id=new_id(&tx,"goal")?;
        let project_id=if let Some(id)=input.project_id.clone().or(parent.as_ref().map(|p|crate::task_panel_projects::repository_project(&tx,&p.id)).transpose()?.flatten()){id}else{
            let id=new_id(&tx,"project")?;crate::task_panel_projects::save_project(&tx,&id,&input.title,&input.goal,&[],None)?;id
        };
        insert_task(&tx,&goal_id,&input.title,&input.goal,&[],&["核对需求、决定、设计和阶段任务".into()],None,&input.source)?;
        tx.execute("UPDATE tp_nodes SET kind='goal' WHERE id=?1",[&goal_id]).map_err(db_error)?;
        crate::task_panel_projects::save_plan(&tx,&goal_id,&crate::task_panel_types::TaskPlan{project_id:Some(project_id.clone()),goal_id:None,phase:String::new()})?;
        for (kind,items) in [("requirement",&input.requirements),("decision",&input.decisions)] {for body in items {
            let id=new_id(&tx,"memory")?;tx.execute("INSERT INTO tp_memories VALUES(?1,?2,NULL,?3,?4,?5,'active',NULL,1,1,?6)",params![id,goal_id,kind,body,input.source,now()]).map_err(db_error)?;
            tx.execute("INSERT INTO tp_nodes VALUES(?1,NULL,?2,?3,'','','user_confirmed',?4,0)",params![id,kind,body.chars().take(100).collect::<String>(),encode(&json!({"body":body,"source":input.source}))?]).map_err(db_error)?;relation(&tx,&goal_id,&id,"governed_by",&input.source)?;
        }}
        for body in &input.designs {let id=new_id(&tx,"design")?;tx.execute("INSERT INTO tp_nodes VALUES(?1,NULL,'design',?2,'','','user_confirmed',?3,0)",params![id,body.chars().take(100).collect::<String>(),encode(&json!({"body":body,"status":"proposed_design","source":input.source,"projectId":project_id}))?]).map_err(db_error)?;relation(&tx,&goal_id,&id,"related_to",&input.source)?;}
        let initialization_task_id=if let Some(p)=&parent {
            let id=new_id(&tx,"task")?;let scope=vec![input.new_directory.clone()];let init=json!({"newDirectory":input.new_directory,"initializeDirectory":true,"initializeGit":input.initialize_git,"installDependencies":input.install_dependencies,"parentPath":p.path,"overwriteExisting":false});
            insert_task(&tx,&id,&format!("初始化 {}",input.title),&format!("在指定目录开始已确认目标：{}。初始化范围：{}。现有内容须保留；没有模板或技术栈时先提出方案，不自行安装。",input.goal,init),&scope,&["仅创建已授权范围内的缺失内容，现有文件保持完整".into(),"交回实际文件、未完成项与检查/未运行说明".into()],Some(&p.id),&input.source)?;relation(&tx,&id,&goal_id,"related_to",&input.source)?;Some(id)
        }else{None};
        let mut task_ids=Vec::new();
        for t in &input.tasks {let id=new_id(&tx,"task")?;
            let scoped:Vec<_>=if parent.is_some(){t.scope.iter().map(|s|if s=="."{input.new_directory.clone()}else{format!("{}/{}",input.new_directory,s)}).collect()}else{t.scope.clone()};
            insert_task(&tx,&id,&t.title,&t.goal,&scoped,&t.criteria,parent.as_ref().map(|p|p.id.as_str()),&input.source)?;relation(&tx,&id,&goal_id,"related_to",&input.source)?;
            if let Some(init)=&initialization_task_id{relation(&tx,&id,init,"depends_on",&input.source)?;}task_ids.push(id);
        }
        for dep in &input.dependencies{relation(&tx,&task_ids[dep.task],&task_ids[dep.prerequisite],"depends_on",&input.source)?;tx.execute("UPDATE tp_relations SET threshold=?1 WHERE from_id=?2 AND to_id=?3 AND kind='depends_on' AND active=1",params![dep.threshold,task_ids[dep.task],task_ids[dep.prerequisite]]).map_err(db_error)?;}
        for id in task_ids.iter().chain(initialization_task_id.iter()) {crate::task_panel_projects::save_plan(&tx,id,&crate::task_panel_types::TaskPlan{project_id:Some(project_id.clone()),goal_id:Some(goal_id.clone()),phase:String::new()})?;}
        let result=GoalReceipt{goal_id:goal_id.clone(),task_ids,initialization_task_id,graph_revision:bump_graph(&tx)?,warnings,project_id};
        event(&tx,&input.request_id,&goal_id,"goal_plan_applied","user","本人核对目标/规划草案后入库；初始化仅登记任务，未创建目录、Git 或安装依赖")?;receipt(&tx,&input.request_id,&encoded,&result)?;tx.commit().map_err(db_error)?;Ok(result)
    }
    pub fn task_panel_analysis(&mut self,input:AnalysisInput)->Result<String,StorageError>{
        let encoded=encode(&input)?;if let Some(prior)=request(&self.db,&input.request_id,&encoded)?{return Ok(prior);}
        if !input.approved||input.focus.len()>10_000{return Err(invalid("请确认只读建图范围、Skill 来源和产物目录。"));}
        let repo=repository(&self.db,&input.repository_id)?;let configured=if input.skill_path.trim().is_empty(){self.task_setting("task-panel:archify")?.unwrap_or_else(||crate::task_panel_workspace::DEFAULT_ARCHIFY.into())}else{input.skill_path.clone()};let selected=Path::new(&configured);let skill=if selected.is_dir(){selected.join("SKILL.md")}else{selected.to_path_buf()};
        let bytes=protected_absolute(&skill,300_000)?;
        if skill.file_name().and_then(|s|s.to_str())!=Some("SKILL.md"){return Err(invalid("选择 Archify 的 SKILL.md 或其目录，不能用任意脚本代替。"));}
        let automatic=if self.task_workspace.is_some(){Some(crate::task_panel_workspace::directory(&self.root,"task-panel/tasks")?)}else{None};
        let exchange=automatic.as_deref().unwrap_or_else(||Path::new(&input.exchange_directory));if !exchange.is_absolute()||!exchange.is_dir(){return Err(invalid("请指定存在的非凭据产物交换目录。"));}
        let id=format!("analysis-task-{}",hash(input.request_id.as_bytes()));
        self.save_task_setting("task-panel:archify",&configured)?;
        let source=format!("Archify {}；SHA256={}；产物目录={}",skill.display(),hash(&bytes),exchange.display());
        let goal=format!("按所选 Archify Skill 在允许范围 {:?} 查证 {}。{}；读代码时遵守原仓库规则，不修改源码。交付原生 candidate.json、architecture.html 和独立 graph-facts.json v1。三件产物必须共享 analysis_id、真实 HEAD/未提交快照基线及本次 run/context。graph-facts 字段：schema_version=1,analysis_id,run_id,context_id,repository_ref={},revision,workspace_snapshot_id,scope,exclusions,coverage,unknowns,artifacts{{candidate{{path,sha256}},architecture{{path,sha256}},render_status,validation_status}},nodes[{{id,kind,label,path,symbol,archify_component_id,sources}}],relations[{{id,from,to,kind,sources,inference}}],sources[{{id,path,line_start,line_end,revision,sha256,statement}}],proposals,base_graph_revision,changes。初始图基线使用派发包 graphRevision；关系不得生成调度前置；逐条带出处，未查证标明未知；未提交代码用内容哈希，不能冒充提交。只允许本次授权的渲染和验证；找不到 Skill/渲染失败则保留部分产物及缺项。增量仅建议已覆盖且有出处的明确失效，不删未读旧关系。产物交到本次派发包 output_directory；任务包未派发时先不执行。目录归属于 {}。",repo.scope,input.focus,if input.incremental{"对已变更文件和待复核关系做增量分析，保留稳定定位"}else{"首次分析仓库实际架构"},repo.id,exchange.display());
        self.task_panel_mutate(MutationInput{request_id:format!("{}-task",input.request_id),expected_revision:None,action:Mutation::SaveTask{id:id.clone(),title:format!("{} {} · Archify",if input.incremental{"增量复核"}else{"接手仓库"},repo.label),goal,scope:repo.scope,criteria:vec!["三件产物的任务身份、代码版本与哈希一致".into(),"逐条来源、分析覆盖和未知项可追溯".into(),"保留 claim 等级，核对后才应用图谱".into()],repository_id:Some(repo.id),source,plan:None}})?;
        self.save_task_setting(&format!("task-panel:profile:{id}"),"architecture")?;
        receipt(&self.db,&input.request_id,&encoded,&id)?;let _=task(&self.db,&id)?;Ok(id)
    }
}
