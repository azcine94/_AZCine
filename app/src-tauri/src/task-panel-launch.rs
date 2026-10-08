use crate::{storage::{StorageError,Store},task_panel_store::{encode,expected,invalid,request,receipt,task},task_panel_types::Execution};
use serde::{Deserialize,Serialize};
use tauri::Manager;

#[derive(Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct LaunchInput {
    pub request_id:String, pub task_id:String, pub expected_revision:i64,
    pub kind:String, pub pane_name:String, pub allowed_actions:Vec<String>, pub approved:bool,
}

impl Store {
    pub fn task_panel_launch(&mut self,input:LaunchInput,resources:&std::path::Path,endpoint:crate::task_panel_agent::Endpoint,node:std::path::PathBuf)->Result<Execution,StorageError> {
        let encoded=encode(&input)?;
        if let Some(prior)=request::<Execution>(&self.db,&input.request_id,&encoded)? {return crate::task_panel_store::executions(&self.db)?.into_iter().find(|r|r.id==prior.id).ok_or_else(||invalid("执行记录缺失，未重发。"));}
        if let Some(run)=crate::task_panel_store::executions(&self.db)?.into_iter().find(|r|r.request_id==format!("{}-dispatch",input.request_id)) {return Ok(run);}
        if !input.approved || !["codex","openpi"].contains(&input.kind.as_str()) {return Err(invalid("请确认执行工具和窗格名称后开始。"));}
        crate::task_panel_execution::validate_actions(&input.allowed_actions,input.approved)?;
        let current=task(&self.db,&input.task_id)?;expected(current.revision,Some(input.expected_revision))?;
        crate::task_panel_projects::require_task_active(&self.db,&input.task_id)?;
        let view=self.task_panel_snapshot()?.tasks.into_iter().find(|t|t.task.id==input.task_id).ok_or_else(||invalid("任务不存在。"))?;
        if !view.allowed_actions.iter().any(|a|a=="dispatch") {return Err(invalid("任务前置尚未满足或原执行待核对，未新建其他窗格。"));}
        if view.execution_profile=="architecture"&&(!input.allowed_actions.iter().any(|a|a=="render_architecture")||input.allowed_actions.iter().any(|a|a=="edit_task_files")) {return Err(invalid("建图任务需要允许 Archify 渲染，且保持源码只读；请核对任务范围。"));}
        // Persisted creation receipts survive UI reloads. Resume the last pane
        // that has not received any run instead of creating a second workspace.
        let pending=crate::task_panel_execution::pending_creation(&self.db,&input.task_id)?;
        let previous=crate::task_panel_store::executions(&self.db)?.into_iter().find(|r|r.task_id==input.task_id);
        let retry_binding=if previous.as_ref().is_some_and(|r|["failed","cancelled","superseded"].contains(&r.state.as_str())||r.state=="reported_finished"&&r.task_revision!=current.revision){
            crate::task_panel_store::bindings(&self.db)?.into_iter().filter(|b|b.task_id==input.task_id).max_by_key(|b|b.generation).filter(|b|if input.kind=="codex"{b.kind=="codex"}else{["pi","openpi","opi"].contains(&b.kind.as_str())})
        }else{None};
        let binding=if let Some((old,_))=pending {
            if old.kind!=input.kind{return Err(invalid("原窗格使用的工具不同，请先核对原位置；不会因切换工具重复创建。"));}
            self.task_panel_resume_creation(&old,input.expected_revision,&input.request_id)?.binding.ok_or_else(||invalid("原窗格尚未绑定，未发送任务。"))?
        }else if let Some(binding)=retry_binding {binding}
        else {
            let creation=self.task_panel_create_execution(crate::task_panel_execution::CreateExecutionInput{
            request_id:format!("{}-create",input.request_id),task_id:input.task_id.clone(),expected_revision:input.expected_revision,
            kind:input.kind.clone(),pane_name:input.pane_name.clone(),approved:true,
            },resources)?;
            creation.binding.filter(|_|creation.state=="ready").ok_or_else(||invalid(&format!("{} 已创建的位置保留：工作区 {}，窗格 {}。请核对原位置后重试，不会重复创建。",creation.reason,creation.workspace_id.as_deref().unwrap_or("未返回"),creation.pane_id.as_deref().unwrap_or("未返回"))))?
        };
        let access=self.task_panel_agent_access(crate::task_panel_agent::AccessInput{
            request_id:format!("{}-access-{}",input.request_id,crate::task_panel_paths::hash(endpoint.session_id.as_bytes()).chars().take(12).collect::<String>()),task_id:input.task_id.clone(),expected_revision:input.expected_revision,directory:String::new(),approved:true,
        },endpoint,node)?;
        let repo=crate::task_panel_locations::execution_repository(&self.db,&current)?;
        let observed=crate::task_panel_snapshots::sample(&repo,&current.scope)?;
        let stamp=crate::task_panel_context::scope_stamp(&self.db,&current.id)?;
        let context=self.task_panel_context(crate::task_panel_context::ContextInput{
            request_id:format!("{}-context-{}",input.request_id,crate::task_panel_paths::hash(format!("{}:{stamp}",observed.fingerprint).as_bytes()).chars().take(12).collect::<String>()),task_id:input.task_id.clone(),expected_revision:input.expected_revision,
        })?;
        let run=self.task_panel_dispatch_with_access(crate::task_panel_execution::DispatchInput{
            request_id:format!("{}-dispatch",input.request_id),task_id:input.task_id,expected_revision:input.expected_revision,
            context_id:context.id,binding_id:binding.id,allowed_actions:input.allowed_actions,approved:true,exchange_directory:String::new(),
        },Some(access.command))?;
        receipt(&self.db,&input.request_id,&encoded,&run)?;
        Ok(run)
    }
}

#[tauri::command]
pub async fn task_panel_launch(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:LaunchInput)->Result<Execution,StorageError> {
    crate::main_window(&window)?;
    if !input.approved {return Err(invalid("请确认执行工具和窗格名称。"));}
    let resources=app.path().resource_dir().map_err(|_|invalid("应用运行资源目录不可读。"))?;
    let runtime=crate::pi_runtime::resolve(&resources).map_err(|e|StorageError::new(e.code,e.message))?;
    let endpoint=crate::task_panel_agent::ensure_endpoint(&app)?;
    crate::task_panel_workspace::with_dispatch_store(app,workspace,move|store|store.task_panel_launch(input,&resources,endpoint,runtime.node)).await
}
