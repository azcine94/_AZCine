use crate::storage::StorageError;
use crate::task_panel_types::{MutationInput, MutationReceipt, PanelSnapshot, Event};
use crate::task_panel_graph::{GraphQuery, GraphView};
use tauri::Manager;
#[tauri::command]
pub async fn task_panel_agent_access(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_agent::AccessInput)->Result<crate::task_panel_agent::AccessSummary,StorageError>{
    crate::main_window(&window)?;
    if !input.approved{return Err(crate::task_panel_store::invalid("请先核对本任务接入范围。"));}
    let resources=app.path().resource_dir().map_err(|_|crate::task_panel_store::invalid("应用资源目录不可读。"))?;
    let runtime=crate::pi_runtime::resolve(&resources).map_err(|e|StorageError::new(e.code,e.message))?;
    let endpoint=crate::task_panel_agent::ensure_endpoint(&app)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_agent_access(input,endpoint,runtime.node)).await
}
#[tauri::command]
pub async fn task_panel_agent_revoke(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_agent::RevokeInput)->Result<String,StorageError>{
    crate::main_window(&window)?;crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_agent_revoke(input)).await
}
#[tauri::command]
pub async fn task_panel_agent_accesses(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String)->Result<Vec<crate::task_panel_agent::AccessSummary>,StorageError>{
    crate::main_window(&window)?;let session=crate::task_panel_agent::session(&app);
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_agent_accesses(session.as_deref())).await
}
#[tauri::command]
pub fn task_panel_validation_identity(window:tauri::WebviewWindow)->Result<serde_json::Value,StorageError>{
    crate::main_window(&window)?;
    #[cfg(debug_assertions)] {
        let config=std::env::var("AZCINE_TEST_CONFIG_DIR").map_err(|_|crate::task_panel_store::invalid("当前进程没有显式隔离测试配置，拒绝验证操作。"))?;
        let data=std::env::var("AZCINE_TEST_DEFAULT_ROOT").map_err(|_|crate::task_panel_store::invalid("当前进程没有显式隔离测试根，拒绝验证操作。"))?;
        return Ok(serde_json::json!({"pid":std::process::id(),"config":config,"data":data,"herdrFixture":crate::herdr_adapter::fixture_configured(),"isolated":true}));
    }
    #[cfg(not(debug_assertions))] Err(crate::task_panel_store::invalid("正式版不开放隔离测试身份接口。"))
}
#[tauri::command]
pub async fn task_panel_context(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_context::ContextInput)->Result<crate::task_panel_context::ContextPackage,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_context(input)).await
}

#[tauri::command]
pub async fn task_panel_context_get(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,id:String)->Result<crate::task_panel_context::ContextPackage,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_get_context(&id)).await
}

#[tauri::command]
pub async fn task_panel_imports(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String)->Result<Vec<crate::task_panel_graph_import::ImportPreview>,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_imports()).await
}

#[tauri::command]
pub async fn task_panel_import_preview(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_graph_import::ImportPreviewInput)->Result<crate::task_panel_graph_import::ImportPreview,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_import_preview(input)).await
}

#[tauri::command]
pub async fn task_panel_import_apply(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_graph_import::ImportApplyInput)->Result<crate::task_panel_graph_import::ImportReceipt,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_import_apply(input)).await
}

#[tauri::command]
pub async fn task_panel_herdr_config(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String)->Result<crate::herdr_adapter::HerdrConfig,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_herdr_config()).await
}

#[tauri::command]
pub async fn task_panel_herdr_config_save(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,config:crate::herdr_adapter::HerdrConfig)->Result<crate::herdr_adapter::HerdrConfig,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_save_herdr_config(config)).await
}

#[tauri::command]
pub async fn task_panel_herdr_status(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String)->Result<crate::herdr_adapter::HerdrCapabilities,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|Ok(crate::herdr_adapter::capabilities(&m.task_panel_herdr_config()?))).await
}

#[tauri::command]
pub async fn task_panel_herdr_sessions(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String)->Result<Vec<crate::herdr_adapter::HerdrSession>,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|crate::herdr_adapter::sessions(&m.task_panel_herdr_config()?)).await
}

#[tauri::command]
pub async fn task_panel_bind(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_execution::BindInput)->Result<crate::task_panel_types::Binding,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_bind(input)).await
}

#[tauri::command]
pub async fn task_panel_focus(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,binding_id:Option<String>,task_id:Option<String>)->Result<(),StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|match (binding_id,task_id){
        (Some(id),None)=>m.task_panel_focus(&id),
        (None,Some(id))=>m.task_panel_focus_creation(&id),
        _=>Err(crate::task_panel_store::invalid("请指定唯一的原窗格记录。")),
    }).await
}

#[tauri::command]
pub async fn task_panel_dispatch(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_execution::DispatchInput)->Result<crate::task_panel_types::Execution,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_dispatch_store(app,workspace,move|m|m.task_panel_dispatch(input)).await
}

#[tauri::command]
pub async fn task_panel_execution_action(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_execution::ExecutionActionInput)->Result<crate::task_panel_types::Execution,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_execution_action(input)).await
}

#[tauri::command]
pub async fn task_panel_create_execution(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_execution::CreateExecutionInput)->Result<crate::task_panel_execution::CreationResult,StorageError>{
    crate::main_window(&window)?;
    let resources=app.path().resource_dir().map_err(|_|crate::task_panel_store::invalid("应用运行资源目录无法核对。"))?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_create_execution(input,&resources)).await
}

#[tauri::command]
pub async fn task_panel_result(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_evidence::ResultInput)->Result<crate::task_panel_evidence::ResultReview,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_result(input)).await
}

#[tauri::command]
pub async fn task_panel_check(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_evidence::CheckInput)->Result<crate::task_panel_types::Evidence,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_check(input)).await
}

#[tauri::command]
pub async fn task_panel_accept(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_evidence::AcceptInput)->Result<String,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_accept(input)).await
}

#[tauri::command]
pub async fn task_panel_index(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_index::IndexInput)->Result<crate::task_panel_index::IndexReport,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_index(input)).await
}

#[tauri::command]
pub async fn task_panel_recovery(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,execution_id:String)->Result<serde_json::Value,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_recovery_source(&execution_id)).await
}

#[tauri::command]
pub async fn task_panel_goal(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_intake::GoalInput)->Result<crate::task_panel_intake::GoalReceipt,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_goal(input)).await
}

#[tauri::command]
pub async fn task_panel_analysis(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:crate::task_panel_intake::AnalysisInput)->Result<String,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_analysis(input)).await
}


#[tauri::command]
pub async fn task_panel_list(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String)->Result<PanelSnapshot,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,|m|m.task_panel_snapshot()).await
}
#[tauri::command]
pub async fn task_panel_mutate(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:MutationInput)->Result<MutationReceipt,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_mutate(input)).await
}
#[tauri::command]
pub async fn task_panel_graph(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,input:GraphQuery)->Result<GraphView,StorageError>{
    crate::main_window(&window)?;
    crate::task_panel_workspace::with_store(app,workspace,move|m|m.task_panel_graph(input)).await
}
#[tauri::command]
pub async fn task_panel_changes(app:tauri::AppHandle,window:tauri::WebviewWindow,workspace:String,after:i64)->Result<Vec<Event>,StorageError>{
    crate::main_window(&window)?;
    if after<0{return Err(crate::task_panel_store::invalid("事件序号无效。"));}
    crate::task_panel_workspace::with_store(app,workspace,move|m|crate::task_panel_store::events(&m.db,after,500)).await
}
