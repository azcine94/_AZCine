use crate::storage::Store;
use crate::task_panel_types::{Mutation, MutationInput};
use crate::task_panel_graph::GraphQuery;
use std::path::PathBuf;
use serde_json::{json,Value};
use crate::task_panel_context::ContextInput;
use crate::task_panel_evidence::{ResultInput,AcceptInput};
use crate::task_panel_execution::{BindInput,DispatchInput};

fn repo_fixture(s:&mut Store,run:&std::path::Path)->PathBuf {
    let root=run.join("workspace");std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/a.ts"),"import {b} from './b';\nexport const a = b;\n").unwrap();std::fs::write(root.join("src/b.ts"),"export const b = 1;\n").unwrap();
    mutate(s,"repo",None,Mutation::Repository{project_id:None,id:"repo-a".into(),label:"虚构工作区".into(),path:root.to_string_lossy().into_owned(),scope:vec![".".into()]});root
}
fn repo_task(s:&mut Store,id:&str){
    mutate(s,&format!("create-{id}"),None,Mutation::SaveTask{plan:None,id:id.into(),title:id.into(),goal:"隔离任务闭环".into(),scope:vec!["src".into()],criteria:vec!["本人核对实际交付".into()],repository_id:Some("repo-a".into()),source:"fixture".into()});
}
fn agent(root:&std::path::Path,state:&str,session:&str)->Value {json!({"terminal_id":"terminal-fixture","pane_id":"pane-fixture","workspace_id":"workspace-fixture","agent":"codex","agent_status":state,"agent_session":{"kind":"codex","value":session},"foreground_cwd":root.to_string_lossy(),"interactive_ready":true,"state_change_seq":3})}
fn setup_herdr(s:&mut Store,root:&std::path::Path,state:&str){
    s.task_panel_save_herdr_config(crate::herdr_adapter::HerdrConfig{executable:String::new(),session:"isolated-fixture".into()}).unwrap();
    crate::herdr_adapter::test_fixture(json!({"agent.get":{"agent":agent(root,state,"agent-session-fixture")},"agent.list":{"agents":[agent(root,state,"agent-session-fixture")]},"agent.prompt":{"type":"agent_prompted"},"agent.focus":{"type":"agent_focused"}}));
}
fn dispatch_fixture(s:&mut Store,root:&std::path::Path,exchange:&std::path::Path,id:&str)->crate::task_panel_types::Execution {
    setup_herdr(s,root,"idle");
    let binding=s.task_panel_bind(BindInput{request_id:format!("bind-{id}"),task_id:id.into(),expected_revision:1,pane_id:"pane-fixture".into()}).unwrap();
    let context=s.task_panel_context(ContextInput{request_id:format!("context-{id}"),task_id:id.into(),expected_revision:1}).unwrap();
    s.task_panel_dispatch(DispatchInput{request_id:format!("dispatch-{id}"),task_id:id.into(),expected_revision:1,context_id:context.id,binding_id:binding.id,allowed_actions:vec!["read_scoped_files".into(),"edit_task_files".into(),"write_delivery_artifacts".into()],approved:true,exchange_directory:exchange.to_string_lossy().into_owned()}).unwrap()
}
fn result_file(run:&std::path::Path,execution:&crate::task_panel_types::Execution,kind:&str)->PathBuf {
    let value=json!({"protocol_version":1,"task_id":execution.task_id,"task_revision":execution.task_revision,"run_id":execution.id,"context_id":execution.context_id,"binding_generation":execution.binding_generation,"workspace_snapshot_id":execution.snapshot_id,"execution_outcome":"reported_finished","changed_files":[],"artifact_refs":[],"checks":[{"status":"not_run","reason":"未运行检查"}],"remaining_items":[],"resume_summary":"交付待本人核对","proposed_memory_updates":[]});
    let file=run.join(format!("{kind}.json"));std::fs::write(&file,serde_json::to_vec(&value).unwrap()).unwrap();file
}

fn fixture()->(PathBuf,Store) {
    let base=std::env::var_os("AZCINE_TASK_PANEL_TEST_ROOT").map(PathBuf::from).unwrap_or_else(||PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation/task-panel-dev-20261006-183535/backend-fixtures"));
    std::fs::create_dir_all(&base).unwrap();
    let run=tempfile::Builder::new().prefix("task-panel-").tempdir_in(base).unwrap().keep();let run=std::fs::canonicalize(run).unwrap();
    let store=Store::open(&run.join("data"),true).unwrap();(run,store)
}
fn create(id:&str)->Mutation {
    Mutation::SaveTask{plan:None,id:id.into(),title:format!("测试任务 {id}"),goal:"验证实际行为".into(),scope:vec!["src".into()],criteria:vec!["保存后可重读".into()],repository_id:None,source:"隔离虚构测试".into()}
}

fn second_project(s:&mut Store,base:&std::path::Path)->PathBuf {
    let root=base.join("workspace-b");std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/b.ts"),"export const privateB = 'project-b-only';").unwrap();
    mutate(s,"create-project-b",None,Mutation::Project{id:"project-b".into(),name:"隔离项目 B".into(),summary:"独立项目".into(),repository_ids:vec![]});
    mutate(s,"create-repo-b",None,Mutation::Repository{id:"repo-b".into(),label:"B 工作区".into(),path:root.to_string_lossy().into_owned(),scope:vec!["src".into()],project_id:Some("project-b".into())});
    mutate(s,"create-task-b",None,Mutation::SaveTask{id:"task-b".into(),title:"B 任务".into(),goal:"B 目标".into(),scope:vec!["src".into()],criteria:vec!["B 验收".into()],repository_id:Some("repo-b".into()),source:"fixture".into(),plan:None});root
}

#[test]
fn given_two_projects_when_b_changes_then_a_snapshot_memory_graph_and_prepared_context_stay_isolated(){
    let (base,mut s)=fixture();repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");second_project(&mut s,&base);
    let pa=crate::task_panel_projects::plan(&s.db,"task-a").unwrap().project_id.unwrap();
    let ctx=s.task_panel_context(ContextInput{request_id:"a-context".into(),task_id:"task-a".into(),expected_revision:1}).unwrap();
    mutate(&mut s,"b-memory",None,Mutation::MemoryDraft{id:"memory-b".into(),task_id:None,repository_id:None,project_id:Some("project-b".into()),kind:"decision".into(),body:"B 独有的重要决定".into(),source:"本人".into(),supersedes:None});
    mutate(&mut s,"b-apply",Some(1),Mutation::ApplyMemory{id:"memory-b".into()});
    assert_eq!(ctx.scope_hash,crate::task_panel_context::scope_stamp(&s.db,"task-a").unwrap());
    let a=s.task_panel_snapshot_scoped(Some(&pa)).unwrap();assert_eq!(a.tasks.len(),1);assert_eq!(a.tasks[0].task.id,"task-a");assert!(a.memories.is_empty());assert_eq!(a.repositories.len(),1);
    let graph=s.task_panel_graph(GraphQuery{project_id:Some(pa),..Default::default()}).unwrap();assert!(!graph.nodes.iter().any(|n|n.id=="task-b"||n.id=="memory-b"));
    let revision=s.task_panel_snapshot().unwrap().graph_revision;
    assert!(s.task_panel_mutate(MutationInput{request_id:"cross-project-dependency".into(),expected_revision:Some(revision),action:Mutation::Relation{from_id:"task-a".into(),to_id:"task-b".into(),kind:"depends_on".into(),threshold:"acceptance".into(),source:"fixture".into()}}).is_err());
}

#[test]
fn given_independent_projects_when_b_is_dispatched_then_both_runs_coexist_but_nested_directories_remain_blocked(){
    let (base,mut s)=fixture();let a=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let b=second_project(&mut s,&base);
    let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();dispatch_fixture(&mut s,&a,&exchange,"task-a");
    let mut other=agent(&b,"idle","session-b");other["pane_id"]=json!("pane-b");other["terminal_id"]=json!("terminal-b");
    crate::herdr_adapter::test_fixture(json!({"agent.get":{"agent":other},"agent.prompt":{"type":"agent_prompted"}}));
    let binding=s.task_panel_bind(BindInput{request_id:"bind-b".into(),task_id:"task-b".into(),expected_revision:1,pane_id:"pane-b".into()}).unwrap();
    let ctx=s.task_panel_context(ContextInput{request_id:"ctx-b".into(),task_id:"task-b".into(),expected_revision:1}).unwrap();
    s.task_panel_dispatch(DispatchInput{request_id:"dispatch-b".into(),task_id:"task-b".into(),expected_revision:1,context_id:ctx.id,binding_id:binding.id,allowed_actions:vec!["read_scoped_files".into()],approved:true,exchange_directory:exchange.to_string_lossy().into_owned()}).unwrap();
    assert_eq!(s.task_panel_snapshot().unwrap().executions.len(),2);
    mutate(&mut s,"nested-repo",None,Mutation::Repository{id:"repo-nested".into(),label:"嵌套工作区".into(),path:a.join("src").to_string_lossy().into_owned(),scope:vec![".".into()],project_id:None});
    mutate(&mut s,"nested-task",None,Mutation::SaveTask{id:"task-nested".into(),title:"嵌套任务".into(),goal:"隔离".into(),scope:vec![".".into()],criteria:vec!["核对".into()],repository_id:Some("repo-nested".into()),source:"fixture".into(),plan:None});
    let snapshot=s.task_panel_snapshot().unwrap();let nested=snapshot.tasks.iter().find(|t|t.task.id=="task-nested").unwrap();assert!(nested.reason_codes.iter().any(|r|r=="workspace_busy"));assert!(!nested.allowed_actions.iter().any(|a|a=="dispatch"));
}

#[test]
fn given_agent_reference_and_decision_when_source_changes_then_reference_stales_without_auto_approving_the_decision(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");
    let t=crate::task_panel_store::task(&s.db,"task-a").unwrap();let refs=json!([{"path":"src/a.ts","sha256":crate::task_panel_paths::hash(&std::fs::read(root.join("src/a.ts")).unwrap())}]);
    let reference=crate::task_panel_store::memory_candidate(&s.db,&t,"memory","源码摘要","fixture Agent",&refs).unwrap();
    let repeated=crate::task_panel_store::memory_candidate(&s.db,&t,"memory","源码摘要","fixture Agent",&refs).unwrap();assert_eq!(reference,repeated);
    let decision=crate::task_panel_store::memory_candidate(&s.db,&t,"decision","候选重要决定","fixture Agent",&refs).unwrap();
    let ctx=s.task_panel_context(ContextInput{request_id:"ctx-fresh".into(),task_id:"task-a".into(),expected_revision:1}).unwrap();assert_eq!(ctx.references.len(),1);assert!(ctx.decisions.is_empty());
    std::fs::write(root.join("src/a.ts"),"export const changed = true;").unwrap();
    let ctx=s.task_panel_context(ContextInput{request_id:"ctx-stale".into(),task_id:"task-a".into(),expected_revision:1}).unwrap();assert!(ctx.references.is_empty());
    let memory=crate::task_panel_store::memories(&s.db).unwrap();assert!(memory.iter().find(|m|m.id==reference).unwrap().stale);assert_eq!(memory.iter().find(|m|m.id==decision).unwrap().status,"draft");
    mutate(&mut s,"approve-decision",Some(1),Mutation::ApplyMemory{id:decision.clone()});
    let memory=crate::task_panel_store::memories(&s.db).unwrap();let m=memory.iter().find(|m|m.id==decision).unwrap();assert_eq!(m.status,"active");assert_eq!(m.origin_level,"claim");
}

#[test]
fn given_indexed_code_when_switching_graph_layers_then_execution_ownership_and_code_symbols_are_separate(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");
    std::fs::write(root.join("src/a.ts"),"export function helper() {}\nexport function run() { helper(); }\n").unwrap();
    let rev=s.task_panel_snapshot().unwrap().graph_revision;s.task_panel_index(crate::task_panel_index::IndexInput{request_id:"index-layers".into(),repository_id:"repo-a".into(),expected_graph_revision:rev,approved:true}).unwrap();
    let code=s.task_panel_graph(GraphQuery{layer:"code".into(),..Default::default()}).unwrap();assert!(code.nodes.iter().any(|n|n.kind=="symbol"));assert!(!code.nodes.iter().any(|n|n.kind=="task"||n.kind=="project"));assert!(code.relations.iter().any(|r|r.kind=="calls"&&r.evidence_level=="claim"));
    let execution=s.task_panel_graph(GraphQuery{layer:"execution".into(),..Default::default()}).unwrap();assert!(execution.nodes.iter().any(|n|n.kind=="task"));assert!(!execution.nodes.iter().any(|n|!n.path.is_empty()));
}

#[test]
fn given_legacy_task_v13_when_opened_on_merged_schema_then_original_records_and_inferred_project_survive_reopen(){
    let (base,mut s)=fixture();repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");
    mutate(&mut s,"legacy-memory",Some(1),Mutation::MemoryDraft{id:"memory-legacy".into(),task_id:Some("task-a".into()),repository_id:None,kind:"decision".into(),body:"迁移保留决定".into(),source:"本人".into(),supersedes:None,project_id:None});
    let receipts:i64=s.db.query_row("SELECT count(*) FROM tp_requests",[],|r|r.get(0)).unwrap();
    s.db.execute_batch("DROP TABLE agent_job_logs; DROP TABLE agent_jobs; DROP TABLE agent_drafts; DROP TABLE agent_attachments; DROP TABLE agent_inputs; DROP TABLE agent_bindings; DROP TABLE agent_deleted_sessions; DROP TABLE agent_conversations; ALTER TABLE todos DROP COLUMN deleted; DELETE FROM app_meta WHERE key='task_panel_schema'; DROP TABLE tp_agent_grants; DROP TABLE tp_memory_origins; DROP TABLE tp_task_plans; DROP TABLE tp_project_repositories; DROP TABLE tp_projects; DELETE FROM tp_relations WHERE source='task_plan_membership'; DELETE FROM tp_nodes WHERE kind='project'; PRAGMA user_version=13;").unwrap();drop(s);
    let s=Store::open(&base.join("data"),false).unwrap();assert_eq!(s.db.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),crate::storage::SCHEMA_VERSION);
    let snapshot=s.task_panel_snapshot().unwrap();assert_eq!(snapshot.tasks.len(),1);assert_eq!(snapshot.projects.len(),1);assert_eq!(snapshot.memories[0].body,"迁移保留决定");assert!(snapshot.tasks[0].plan.project_id.is_some());
    assert_eq!(s.db.query_row("SELECT count(*) FROM tp_requests",[],|r|r.get::<_,i64>(0)).unwrap(),receipts);let identity=snapshot.projects[0].id.clone();drop(s);
    let s=Store::open(&base.join("data"),false).unwrap();assert_eq!(s.task_panel_snapshot().unwrap().projects[0].id,identity);
}
fn mutate(store:&mut Store,id:&str,revision:Option<i64>,action:Mutation)->crate::task_panel_types::MutationReceipt {
    store.task_panel_mutate(MutationInput{request_id:id.into(),expected_revision:revision,action}).unwrap()
}
#[test]
fn given_task_when_save_is_repeated_and_app_reopens_then_one_task_and_original_receipt_remain(){
    let (run,mut s)=fixture();let first=mutate(&mut s,"req-1",None,create("task-1"));
    let second=mutate(&mut s,"req-1",None,create("task-1"));assert_eq!(first.sequence,second.sequence);
    assert_eq!(s.task_panel_snapshot().unwrap().tasks.len(),1);drop(s);
    let s=Store::open(&run.join("data"),false).unwrap();assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].task.title,"测试任务 task-1");
}
#[test]
fn given_request_id_when_reused_with_different_input_then_no_second_task_is_saved(){
    let (_,mut s)=fixture();mutate(&mut s,"req-1",None,create("task-1"));
    let e=s.task_panel_mutate(MutationInput{request_id:"req-1".into(),expected_revision:None,action:create("task-2")}).unwrap_err();
    assert_eq!(e.code,"request_conflict");assert_eq!(s.task_panel_snapshot().unwrap().tasks.len(),1);
}
#[test]
fn given_newer_task_when_old_editor_saves_then_new_content_is_not_overwritten(){
    let (_,mut s)=fixture();mutate(&mut s,"req-1",None,create("task-1"));
    mutate(&mut s,"req-2",Some(1),Mutation::ResumeSummary{id:"task-1".into(),summary:"新暂停点".into()});
    assert_eq!(s.task_panel_mutate(MutationInput{request_id:"req-3".into(),expected_revision:Some(1),action:create("task-1")}).unwrap_err().code,"task_panel_conflict");
    assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].task.resume_summary,"新暂停点");
}
#[test]
fn given_unaccepted_prerequisite_when_added_then_task_is_blocked_and_cycle_is_rejected_atomically(){
    let (base,mut s)=fixture();repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");repo_task(&mut s,"task-b");
    let revision=s.task_panel_snapshot().unwrap().graph_revision;
    mutate(&mut s,"req-rel",Some(revision),Mutation::Relation{from_id:"task-a".into(),to_id:"task-b".into(),kind:"depends_on".into(),threshold:"acceptance".into(),source:"本人指定".into()});
    let snapshot=s.task_panel_snapshot().unwrap();let a=snapshot.tasks.iter().find(|t|t.task.id=="task-a").unwrap();
    assert_eq!(a.lane,"blocked");assert_eq!(a.prerequisites_satisfied,0);assert!(!a.allowed_actions.iter().any(|a|a=="dispatch"));
    let error=s.task_panel_mutate(MutationInput{request_id:"req-cycle".into(),expected_revision:Some(snapshot.graph_revision),action:Mutation::Relation{from_id:"task-b".into(),to_id:"task-a".into(),kind:"depends_on".into(),threshold:"acceptance".into(),source:"循环测试".into()}}).unwrap_err();
    assert_eq!(error.code,"dependency_cycle");assert_eq!(s.task_panel_snapshot().unwrap().relations.iter().filter(|r|r.kind=="depends_on").count(),1);
}
#[test]
fn given_related_task_when_relation_is_not_a_prerequisite_then_task_remains_ready(){
    let (base,mut s)=fixture();repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");repo_task(&mut s,"task-b");
    let revision=s.task_panel_snapshot().unwrap().graph_revision;
    mutate(&mut s,"req-rel",Some(revision),Mutation::Relation{from_id:"task-a".into(),to_id:"task-b".into(),kind:"related_to".into(),threshold:"none".into(),source:"本人指定".into()});
    assert!(s.task_panel_snapshot().unwrap().tasks.iter().all(|t|t.lane=="ready"&&t.prerequisites_total==0));
}

#[cfg(windows)]
#[test]
fn given_owned_native_process_when_it_exits_then_its_birth_identity_is_no_longer_live(){
    use std::process::{Command,Stdio};use std::os::windows::process::CommandExt;
    let (run,_)=fixture();let runtime=crate::pi_runtime::resolve(&run).unwrap();
    let mut child=Command::new(runtime.node).env_clear().args(["--eval","setTimeout(()=>{},3000)"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x08000000).spawn().unwrap();
    let pid=child.id();let first=crate::herdr_adapter::process_stamp(pid);
    let second=crate::herdr_adapter::process_stamp(pid);child.kill().unwrap();child.wait().unwrap();
    assert!(first.is_some());assert_eq!(first,second);assert!(crate::herdr_adapter::process_stamp(pid).is_none());
}

#[cfg(windows)]
#[test]
fn given_herdr_pi_creation_when_preparing_then_owned_runtime_and_state_are_pinned_and_existing_launcher_is_preserved(){
    let (run,_)=fixture();let cwd=run.join("workspace");std::fs::create_dir_all(&cwd).unwrap();let data=run.join("pi-data");std::fs::create_dir_all(&data).unwrap();
    let environment=crate::herdr_adapter::owned_pi_environment(&data,&run,&cwd).unwrap();
    let value=|key:&str|environment.iter().find(|(k,_)|k==key).unwrap().1.clone();
    assert_eq!(std::fs::canonicalize(value("PI_CODING_AGENT_DIR")).unwrap(),std::fs::canonicalize(data.join("pi/agent")).unwrap());
    assert!(value("PATH").split(';').next().unwrap().ends_with("native-herdr-bin"));
    for forbidden in ["NODE_OPTIONS","NODE_PATH","OPENAI_API_KEY","BASH_ENV","PI_PROVIDER","PI_MODEL"]{assert!(!environment.iter().any(|(k,_)|k==forbidden));}
    let launcher=data.join("pi/native-herdr-bin/pi.cmd");let body=std::fs::read_to_string(&launcher).unwrap();assert!(body.contains("--no-context-files"));assert!(body.contains("--no-global-search-paths"));assert!(!body.contains(" --mode rpc"));
    assert!(!body.contains("\\\\?\\"));assert!(!value("PATH").contains("\\\\?\\"));
    assert_eq!(crate::herdr_adapter::owned_pi_environment(&data,&run,&cwd).unwrap(),environment);
    std::fs::write(&launcher,"retained test edit").unwrap();assert!(crate::herdr_adapter::owned_pi_environment(&data,&run,&cwd).is_err());assert_eq!(std::fs::read_to_string(&launcher).unwrap(),"retained test edit");
    let foreign=cwd.join(".pi/hooks");std::fs::create_dir_all(&foreign).unwrap();assert!(crate::herdr_adapter::owned_pi_environment(&data,&run,&cwd).is_err());assert!(foreign.is_dir());
}
#[test]
fn given_memory_draft_when_task_changes_during_review_then_draft_does_not_overwrite_formal_memory(){
    let (_,mut s)=fixture();mutate(&mut s,"req-a",None,create("task-a"));
    mutate(&mut s,"req-memory",Some(1),Mutation::MemoryDraft{project_id:None,id:"memory-a".into(),task_id:Some("task-a".into()),repository_id:None,kind:"decision".into(),body:"只修改当前范围".into(),source:"本人决定".into(),supersedes:None});
    assert_eq!(s.task_panel_snapshot().unwrap().memories[0].status,"draft");
    mutate(&mut s,"req-resume",Some(1),Mutation::ResumeSummary{id:"task-a".into(),summary:"修改了任务基线".into()});
    let e=s.task_panel_mutate(MutationInput{request_id:"req-apply".into(),expected_revision:Some(1),action:Mutation::ApplyMemory{id:"memory-a".into()}}).unwrap_err();
    assert_eq!(e.code,"task_panel_conflict");assert_eq!(s.task_panel_snapshot().unwrap().memories[0].status,"draft");
}
#[test]
fn given_graph_larger_than_page_when_queried_then_truncation_and_next_page_are_explicit(){
    let (_,mut s)=fixture();for n in 0..5{mutate(&mut s,&format!("req-{n}"),None,create(&format!("task-{n}")));}
    let first=s.task_panel_graph(GraphQuery{limit:2,..Default::default()}).unwrap();
    assert_eq!(first.total_nodes,5);assert!(first.has_more);assert_eq!(first.nodes.len(),2);
    let last=s.task_panel_graph(GraphQuery{limit:2,offset:4,..Default::default()}).unwrap();assert!(!last.has_more);assert_eq!(last.nodes.len(),1);
}
#[test]
fn given_paused_or_cancelled_task_when_projected_then_it_is_never_counted_as_completed(){
    let (_,mut s)=fixture();mutate(&mut s,"req-a",None,create("task-a"));
    mutate(&mut s,"req-pause",Some(1),Mutation::Lifecycle{id:"task-a".into(),lifecycle:"paused".into(),reason:"保留输入".into()});
    assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].lane,"human");
    mutate(&mut s,"req-cancel",Some(2),Mutation::Lifecycle{id:"task-a".into(),lifecycle:"cancelled".into(),reason:"取消不报成功".into()});
    assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].acceptance_state,"not_accepted");
}

#[test]
fn given_scoped_context_when_other_tasks_and_drafts_exist_then_only_effective_related_material_is_included(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");repo_task(&mut s,"task-b");
    mutate(&mut s,"draft-a",Some(1),Mutation::MemoryDraft{project_id:None,id:"memory-a".into(),task_id:Some("task-a".into()),repository_id:None,kind:"decision".into(),body:"任务 A 的约束".into(),source:"本人核对".into(),supersedes:None});
    mutate(&mut s,"apply-a",Some(1),Mutation::ApplyMemory{id:"memory-a".into()});
    mutate(&mut s,"draft-b",Some(1),Mutation::MemoryDraft{project_id:None,id:"memory-b".into(),task_id:Some("task-b".into()),repository_id:None,kind:"decision".into(),body:"不能进入 A".into(),source:"选定材料".into(),supersedes:None});
    std::fs::write(root.join("src/.env"),"DO_NOT_READ_FIXTURE").unwrap();
    let ctx=s.task_panel_context(ContextInput{request_id:"ctx-a".into(),task_id:"task-a".into(),expected_revision:1}).unwrap();
    assert_eq!(ctx.decisions.len(),1);assert_eq!(ctx.decisions[0].id,"memory-a");assert!(ctx.workspace_snapshot.as_ref().unwrap().head.is_none());assert_eq!(ctx.workspace_snapshot.as_ref().unwrap().files.len(),2);
    assert!(!serde_json::to_string(&ctx).unwrap().contains("DO_NOT_READ_FIXTURE"));assert!(!ctx.hash.is_empty());
}
#[test]
fn given_idle_herdr_fixture_when_dispatching_twice_then_one_prompt_and_no_inferred_completion(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();
    let run=dispatch_fixture(&mut s,&root,&exchange,"task-a");assert_eq!(run.state,"awaiting_receipt");assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].lane,"running");
    let context=s.task_panel_get_context(&run.context_id).unwrap();
    let again=s.task_panel_dispatch(DispatchInput{request_id:run.request_id.clone(),task_id:run.task_id.clone(),expected_revision:1,context_id:context.id,binding_id:run.binding_id.clone(),allowed_actions:run.authorization.clone(),approved:true,exchange_directory:exchange.to_string_lossy().into_owned()}).unwrap();
    assert_eq!(run.id,again.id);assert_eq!(crate::herdr_adapter::test_calls("agent.prompt"),1);
    let reconciled=s.task_panel_execution_action(crate::task_panel_execution::ExecutionActionInput{request_id:"reconcile-a".into(),execution_id:run.id,action:"reconcile".into(),reason:String::new(),approved:false}).unwrap();assert_eq!(reconciled.state,"awaiting_receipt");
}
#[test]
fn given_busy_or_replaced_agent_when_dispatching_then_no_prompt_is_sent(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();
    setup_herdr(&mut s,&root,"idle");let binding=s.task_panel_bind(BindInput{request_id:"bind-a".into(),task_id:"task-a".into(),expected_revision:1,pane_id:"pane-fixture".into()}).unwrap();let ctx=s.task_panel_context(ContextInput{request_id:"ctx-a".into(),task_id:"task-a".into(),expected_revision:1}).unwrap();
    setup_herdr(&mut s,&root,"running");
    let input=DispatchInput{request_id:"dispatch-a".into(),task_id:"task-a".into(),expected_revision:1,context_id:ctx.id,binding_id:binding.id,allowed_actions:vec!["read_scoped_files".into()],approved:true,exchange_directory:exchange.to_string_lossy().into_owned()};
    assert_eq!(s.task_panel_dispatch(input.clone()).unwrap_err().code,"herdr_busy");assert_eq!(crate::herdr_adapter::test_calls("agent.prompt"),0);
    crate::herdr_adapter::test_fixture(json!({"agent.get":{"agent":agent(&root,"idle","replacement")}}));
    assert!(s.task_panel_dispatch(input).is_err());assert_eq!(crate::herdr_adapter::test_calls("agent.prompt"),0);
}
#[test]
fn given_uncertain_prompt_when_user_retries_then_persisted_intent_prevents_resend_after_reopen(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();setup_herdr(&mut s,&root,"idle");
    let binding=s.task_panel_bind(BindInput{request_id:"bind-a".into(),task_id:"task-a".into(),expected_revision:1,pane_id:"pane-fixture".into()}).unwrap();let ctx=s.task_panel_context(ContextInput{request_id:"ctx-a".into(),task_id:"task-a".into(),expected_revision:1}).unwrap();
    crate::herdr_adapter::test_fixture(json!({"agent.get":{"agent":agent(&root,"idle","agent-session-fixture")},"agent.prompt":{"fixture_error":"传输结果未知"}}));
    let input=DispatchInput{request_id:"dispatch-a".into(),task_id:"task-a".into(),expected_revision:1,context_id:ctx.id,binding_id:binding.id,allowed_actions:vec!["read_scoped_files".into()],approved:true,exchange_directory:exchange.to_string_lossy().into_owned()};
    assert_eq!(s.task_panel_dispatch(input.clone()).unwrap().state,"uncertain");drop(s);let mut s=Store::open(&base.join("data"),false).unwrap();
    assert_eq!(s.task_panel_dispatch(input).unwrap().state,"uncertain");assert_eq!(crate::herdr_adapter::test_calls("agent.prompt"),1);
}
#[test]
fn given_delivery_when_files_are_verified_then_acceptance_is_separate_and_stales_after_code_changes(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();let run=dispatch_fixture(&mut s,&root,&exchange,"task-a");
    let path=result_file(&exchange,&run,"delivery");let input=ResultInput{request_id:"result-a".into(),execution_id:run.id.clone(),path:path.to_string_lossy().into_owned()};
    let review=s.task_panel_result(input.clone()).unwrap();assert_eq!(review.status,"matched");assert_eq!(s.task_panel_result(input).unwrap().id,review.id);
    let view=s.task_panel_snapshot().unwrap();assert_eq!(view.tasks[0].lane,"verify");assert_eq!(view.tasks[0].check_state,"not_run");assert_eq!(view.tasks[0].acceptance_state,"not_accepted");
    let accepted=AcceptInput{request_id:"accept-a".into(),task_id:"task-a".into(),expected_revision:1,execution_id:run.id.clone(),snapshot_id:review.observed_snapshot_id.clone().unwrap(),accepted:true,approved:true,acknowledge_unverified:true,reason:"本人接受本次未指定技术检查的交付".into()};
    s.task_panel_accept(accepted).unwrap();assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].lane,"done");
    std::fs::write(root.join("src/b.ts"),"export const b = 2;\n").unwrap();let view=s.task_panel_snapshot().unwrap();assert_ne!(view.tasks[0].lane,"done");assert!(view.tasks[0].reason_codes.iter().any(|r|r=="evidence_stale"));
    let preview=s.task_panel_recovery(&run.id).unwrap();assert!(preview.files.iter().any(|f|f.path=="src/b.ts"&&f.change=="modified"));assert!(preview.files.iter().all(|f|!f.restorable));
}
#[test]
fn given_missing_file_or_late_result_when_received_then_original_is_preserved_without_new_attempt_pollution(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();let run=dispatch_fixture(&mut s,&root,&exchange,"task-a");
    let path=result_file(&exchange,&run,"missing");let mut value:Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();value["changed_files"]=json!(["src/missing.ts"]);std::fs::write(&path,serde_json::to_vec(&value).unwrap()).unwrap();
    let review=s.task_panel_result(ResultInput{request_id:"missing-result".into(),execution_id:run.id.clone(),path:path.to_string_lossy().into_owned()}).unwrap();assert_eq!(review.status,"needs_review");assert!(!review.errors.is_empty());
    s.task_panel_execution_action(crate::task_panel_execution::ExecutionActionInput{request_id:"release-a".into(),execution_id:run.id.clone(),action:"release_for_rebind".into(),reason:"已核对原执行停止".into(),approved:true}).unwrap();
    let later=result_file(&exchange,&run,"late");let review=s.task_panel_result(ResultInput{request_id:"late-result".into(),execution_id:run.id.clone(),path:later.to_string_lossy().into_owned()}).unwrap();assert_eq!(review.status,"quarantined");assert_eq!(s.task_panel_snapshot().unwrap().executions[0].state,"superseded");assert!(path.exists());
}
#[test]
fn given_goal_plan_without_repository_when_approved_then_no_directory_is_created_and_design_remains_proposed(){
    let (_,mut s)=fixture();
    let input=crate::task_panel_intake::GoalInput{project_id:None,request_id:"goal-a".into(),expected_graph_revision:0,title:"新目标".into(),goal:"先核对方案".into(),requirements:vec!["保存材料".into()],decisions:vec!["先规划".into()],tasks:vec![crate::task_panel_intake::PlanTask{title:"方案".into(),goal:"提出技术选项".into(),scope:vec![],criteria:vec!["本人核对".into()]}],dependencies:vec![],designs:vec!["拟议模块，尚无代码".into()],source:"选定草案".into(),approved:true,parent_repository_id:None,new_directory:String::new(),initialize_git:false,install_dependencies:false};
    let result=s.task_panel_goal(input.clone()).unwrap();assert_eq!(s.task_panel_goal(input).unwrap().goal_id,result.goal_id);assert!(result.initialization_task_id.is_none());assert_eq!(s.task_panel_snapshot().unwrap().tasks.len(),2);
    let context=s.task_panel_context(ContextInput{request_id:"goal-stage-context".into(),task_id:result.task_ids[0].clone(),expected_revision:1}).unwrap();assert!(context.decisions.iter().any(|m|m.body=="先规划"));assert!(context.related_objects.iter().any(|n|n.kind=="design"));assert!(context.dependencies.is_empty());
    let graph=s.task_panel_graph(GraphQuery::default()).unwrap();assert!(graph.nodes.iter().any(|n|n.kind=="design"&&n.path.is_empty()));assert!(graph.nodes.iter().all(|n|n.evidence_level=="user_confirmed"));
}
#[test]
fn given_explicit_typescript_imports_when_indexed_then_comments_dynamic_calls_and_task_prerequisites_are_not_inferred(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);std::fs::write(root.join("src/a.ts"),"// import x from './fake';\nimport { b } from './b';\nimport(dynamicName);\nconst message = \"invoke('missing')\";\nconst pattern = /import x from './fake-regex'/;\n").unwrap();
    let rev=s.task_panel_snapshot().unwrap().graph_revision;
    let report=s.task_panel_index(crate::task_panel_index::IndexInput{request_id:"index-a".into(),repository_id:"repo-a".into(),expected_graph_revision:rev,approved:true}).unwrap();assert_eq!(report.scanned_files,2);assert_eq!(report.added_relations,2);assert!(report.unknowns.iter().any(|s|s.contains("动态导入")));
    let graph=s.task_panel_graph(GraphQuery::default()).unwrap();assert!(graph.relations.iter().any(|r|r.kind=="imports"&&r.evidence_level=="observed"));assert!(!graph.relations.iter().any(|r|r.kind=="depends_on"));assert!(!graph.nodes.iter().any(|n|n.path.contains("fake")));
}

#[test]
fn given_relation_review_when_source_changes_then_old_semantic_proof_is_stale_and_cannot_be_reapproved(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);
    let revision=s.task_panel_snapshot().unwrap().graph_revision;
    s.task_panel_index(crate::task_panel_index::IndexInput{request_id:"index-review".into(),repository_id:"repo-a".into(),expected_graph_revision:revision,approved:true}).unwrap();
    let graph=s.task_panel_graph(GraphQuery::default()).unwrap();let edge=graph.relations.iter().find(|r|r.kind=="imports").unwrap();let id=edge.id.clone();
    mutate(&mut s,"semantic-review",Some(graph.graph_revision),Mutation::ReviewRelation{id:id.clone(),reason:"本人逐行核对相对 import 与目标文件，未证明运行时调用".into()});
    assert_eq!(s.task_panel_graph(GraphQuery::default()).unwrap().relations.iter().find(|r|r.id==id).unwrap().evidence_level,"user_confirmed");
    std::fs::write(root.join("src/a.ts"),"export const changed = 1;\n").unwrap();let graph=s.task_panel_graph(GraphQuery::default()).unwrap();assert_eq!(graph.relations.iter().find(|r|r.id==id).unwrap().evidence_level,"stale");
    let err=s.task_panel_mutate(MutationInput{request_id:"stale-semantic-review".into(),expected_revision:Some(graph.graph_revision),action:Mutation::ReviewRelation{id:id.clone(),reason:"不应将旧来源批准为当前语义".into()}}).unwrap_err();assert!(err.message.contains("改变"));
    mutate(&mut s,"invalidate-old-relation",Some(graph.graph_revision),Mutation::InvalidateRelation{id:id.clone()});assert!(!s.task_panel_graph(GraphQuery::default()).unwrap().relations.iter().any(|r|r.id==id));assert!(s.task_panel_snapshot().unwrap().relations.iter().any(|r|r.id==id&&!r.active));
}

#[test]
fn given_partial_herdr_creation_when_retried_then_original_workspace_is_preserved_without_a_second_creation(){
    use crate::task_panel_execution::CreateExecutionInput;
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");setup_herdr(&mut s,&root,"idle");
    crate::herdr_adapter::test_fixture(json!({"workspace.create":{"workspace":{"workspace_id":"workspace-fixture"},"root_pane":{"pane_id":"pane-fixture"}},"pane.rename":{},"pane.run":{"fixture_error":"工具不可用"}}));
    let input=CreateExecutionInput{request_id:"create-herdr".into(),task_id:"task-a".into(),expected_revision:1,kind:"codex".into(),pane_name:"测试任务".into(),approved:true};
    let result=s.task_panel_create_execution(input.clone(),&base).unwrap();assert_eq!(result.state,"uncertain");assert_eq!(result.workspace_id.as_deref(),Some("workspace-fixture"));assert!(result.binding.is_none());
    drop(s);let mut s=Store::open(&base.join("data"),false).unwrap();assert_eq!(s.task_panel_create_execution(input,&base).unwrap().pane_id.as_deref(),Some("pane-fixture"));assert_eq!(crate::herdr_adapter::test_calls("workspace.create"),1);assert_eq!(crate::herdr_adapter::test_calls("pane.run"),1);assert!(s.task_panel_snapshot().unwrap().executions.is_empty());
    crate::herdr_adapter::test_fixture(json!({"workspace.create":{"workspace":{"workspace_id":"workspace-fixture"},"root_pane":{"pane_id":"pane-fixture"}},"pane.rename":{},"pane.run":{},"agent.get":{"agent":agent(&root,"idle","agent-session-fixture")}}));
    let result=s.task_panel_create_execution(CreateExecutionInput{request_id:"create-herdr-second-intent".into(),task_id:"task-a".into(),expected_revision:1,kind:"codex".into(),pane_name:"测试任务".into(),approved:true},&base).unwrap();assert_eq!(result.state,"ready");assert!(result.binding.is_some());assert!(s.task_panel_snapshot().unwrap().executions.is_empty());
}

#[test]
fn given_saved_context_without_optional_goal_objects_when_reopened_then_identity_hash_and_original_body_remain(){
    let (base,mut s)=fixture();repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");
    let context=s.task_panel_context(crate::task_panel_context::ContextInput{request_id:"old-context".into(),task_id:"task-a".into(),expected_revision:1}).unwrap();
    let mut legacy=serde_json::to_value(&context).unwrap();legacy.as_object_mut().unwrap().remove("relatedObjects");
    let original=serde_json::to_string(&legacy).unwrap();
    s.db.execute("UPDATE tp_contexts SET content=?1 WHERE id=?2",rusqlite::params![original,context.id]).unwrap();
    drop(s);let s=Store::open(&base.join("data"),false).unwrap();
    let restored=s.task_panel_get_context(&context.id).unwrap();assert_eq!(restored.id,context.id);assert_eq!(restored.hash,context.hash);assert!(restored.related_objects.is_empty());
    assert_eq!(s.db.query_row("SELECT content FROM tp_contexts WHERE id=?1",[&context.id],|r|r.get::<_,String>(0)).unwrap(),original);
    let mut unhashed=restored.clone();unhashed.hash.clear();assert_eq!(crate::task_panel_paths::hash(serde_json::to_string(&unhashed).unwrap().as_bytes()),context.hash);
}

#[test]
fn given_interrupt_request_when_repeated_then_it_is_sent_once_and_live_occupancy_is_not_released(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();let run=dispatch_fixture(&mut s,&root,&exchange,"task-a");
    crate::herdr_adapter::test_fixture(json!({"agent.get":{"agent":agent(&root,"idle","agent-session-fixture")},"agent.send_keys":{"type":"keys_sent"}}));
    let input=crate::task_panel_execution::ExecutionActionInput{request_id:"interrupt-once".into(),execution_id:run.id.clone(),action:"interrupt".into(),reason:"本人请求中断原会话".into(),approved:true};
    assert_eq!(s.task_panel_execution_action(input.clone()).unwrap().state,"awaiting_receipt");s.task_panel_execution_action(input).unwrap();assert_eq!(crate::herdr_adapter::test_calls("agent.send_keys"),1);assert_eq!(s.task_panel_snapshot().unwrap().executions[0].state,"awaiting_receipt");
}

#[test]
fn given_required_check_claim_when_accepting_then_real_log_review_is_required_and_corrected_check_can_pass(){
    use crate::task_panel_evidence::CheckInput;
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();let run=dispatch_fixture(&mut s,&root,&exchange,"task-a");
    let path=result_file(&exchange,&run,"required-check");let mut result:Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();result["checks"]=json!([{"status":"passed","required":true,"command":"fictional test"}]);std::fs::write(&path,serde_json::to_vec(&result).unwrap()).unwrap();
    let review=s.task_panel_result(ResultInput{request_id:"required-result".into(),execution_id:run.id.clone(),path:path.to_string_lossy().into_owned()}).unwrap();
    let acceptance=AcceptInput{request_id:"required-accept".into(),task_id:"task-a".into(),expected_revision:1,execution_id:run.id.clone(),snapshot_id:review.observed_snapshot_id.unwrap(),accepted:true,approved:true,acknowledge_unverified:true,reason:"本人核对".into()};
    assert!(s.task_panel_accept(acceptance.clone()).is_err());
    let log=exchange.join("check.log");std::fs::write(&log,"fictional check failed\n").unwrap();
    let check=CheckInput{check_id:Some("fictional test".into()),request_id:"check-failed".into(),execution_id:run.id,expected_revision:1,command:"fictional check".into(),exit_code:Some(1),status:"failed".into(),log_path:log.to_string_lossy().into_owned(),expected_log_hash:None,coverage:vec!["src".into()],approved:true,reason:"本人核对隔离日志".into()};
    s.task_panel_check(check.clone()).unwrap();assert!(s.task_panel_accept(acceptance.clone()).is_err());
    std::fs::write(&log,"fictional check passed\n").unwrap();let mut check=check;check.request_id="check-corrected".into();check.status="passed".into();check.exit_code=Some(0);let evidence=s.task_panel_check(check).unwrap();assert_ne!(evidence.path,log.to_string_lossy());assert!(std::path::Path::new(&evidence.path).is_file());
    s.task_panel_accept(acceptance).unwrap();assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].lane,"done");
    std::fs::write(&evidence.path,"changed saved log; original digest no longer matches\n").unwrap();assert_ne!(s.task_panel_snapshot().unwrap().tasks[0].check_state,"passed");
}

#[test]
fn given_two_reported_required_checks_when_incomplete_then_technical_stays_unverified_and_acceptance_needs_confirmation(){
    use crate::task_panel_evidence::CheckInput;
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");
    let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();let run=dispatch_fixture(&mut s,&root,&exchange,"task-a");
    let path=result_file(&exchange,&run,"two-checks");let mut raw:Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    raw["checks"]=json!([{"id":"a","command":"check a","required":true,"status":"passed","coverage":["src/a.ts"]},{"id":"b","command":"check b","required":true,"status":"passed","coverage":["src/b.ts"]}]);
    std::fs::write(&path,serde_json::to_vec(&raw).unwrap()).unwrap();
    let review=s.task_panel_result(ResultInput{request_id:"two-result".into(),execution_id:run.id.clone(),path:path.to_string_lossy().into_owned()}).unwrap();
    let accept=AcceptInput{request_id:"two-accept".into(),task_id:"task-a".into(),expected_revision:1,execution_id:run.id.clone(),snapshot_id:review.observed_snapshot_id.unwrap(),accepted:true,approved:true,acknowledge_unverified:false,reason:"本人核对".into()};
    let log=exchange.join("check.log");std::fs::write(&log,"fixture reviewed log\n").unwrap();
    let mut check=CheckInput{request_id:"wrong-coverage".into(),execution_id:run.id.clone(),expected_revision:1,check_id:Some("a".into()),command:"actual check a".into(),exit_code:Some(0),status:"passed".into(),log_path:log.to_string_lossy().into_owned(),expected_log_hash:None,coverage:vec!["src/b.ts".into()],approved:true,reason:"隔离虚构记录".into()};
    s.task_panel_check(check.clone()).unwrap();assert!(s.task_panel_accept(accept.clone()).is_err());
    let mut personal_acceptance=accept.clone();personal_acceptance.request_id="accept-reported-checks-unverified".into();personal_acceptance.acknowledge_unverified=true;
    s.task_panel_accept(personal_acceptance).unwrap();
    assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].check_state,"not_run");
    check.request_id="correct-a".into();check.coverage=vec!["src/a.ts".into()];s.task_panel_check(check.clone()).unwrap();
    assert_ne!(s.task_panel_snapshot().unwrap().tasks[0].check_state,"passed");assert!(s.task_panel_accept(accept.clone()).is_err());
    let partial=result_file(&exchange,&run,"partial-checks");raw["checks"]=json!([{"id":"a","command":"check a","required":true,"status":"passed","coverage":["src/a.ts"]}]);
    std::fs::write(&partial,serde_json::to_vec(&raw).unwrap()).unwrap();s.task_panel_result(ResultInput{request_id:"partial-result".into(),execution_id:run.id.clone(),path:partial.to_string_lossy().into_owned()}).unwrap();
    assert!(s.task_panel_accept(accept.clone()).is_err()); // Partial reports do not make technical checks passed.
    crate::task_panel_evidence::add_evidence(&s.db,&run,"check","user_confirmed","not_run","","",&json!({"id":"b","required":true,"command":"check b","coverage":["src/b.ts"]}),Some(&accept.snapshot_id)).unwrap();
    let mut user_required_acceptance=accept.clone();user_required_acceptance.request_id="accept-user-required-unverified".into();user_required_acceptance.acknowledge_unverified=true;
    assert!(s.task_panel_accept(user_required_acceptance).is_err());
    check.request_id="correct-b".into();check.check_id=Some("b".into());check.command="actual check b".into();check.coverage=vec!["src/b.ts".into()];s.task_panel_check(check).unwrap();
    s.task_panel_accept(accept).unwrap();assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].check_state,"passed");
    std::fs::write(root.join("src/b.ts"),"export const b = 9;\n").unwrap();let snapshot=s.task_panel_snapshot().unwrap();
    assert_eq!(snapshot.tasks[0].check_state,"stale");assert!(snapshot.evidence.iter().filter(|e|e.kind=="check").all(|e|e.detail["validity"]["current"]==false));
}

#[test]
fn given_missing_task_worktree_when_loading_panel_then_other_project_stays_available(){
    let (base,mut s)=fixture();repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");second_project(&mut s,&base);
    let location=crate::task_panel_locations::ExecutionWorkspace{path:base.join("missing-worktree").to_string_lossy().into_owned(),branch:"fix/missing".into(),base:"fixture".into()};
    s.save_task_setting(&crate::task_panel_locations::key("task-a"),&serde_json::to_string(&location).unwrap()).unwrap();
    let snapshot=s.task_panel_snapshot().unwrap();let broken=snapshot.tasks.iter().find(|t|t.task.id=="task-a").unwrap();
    assert!(!broken.workspace_error.is_empty());assert!(!broken.allowed_actions.iter().any(|a|a=="dispatch"));
    assert!(snapshot.tasks.iter().any(|t|t.task.id=="task-b"&&t.workspace_error.is_empty()));
}

#[test]
fn given_editor_draft_when_store_reopens_then_input_restores_without_starting_execution(){
    use crate::task_panel_collaboration::{DraftInput,drafts};
    let (base,mut s)=fixture();let original=json!({"id":"draft-a","title":"待核对草案","goal":"保留自然语言","scope":"src","criteria":"本人核对","repositoryId":"","projectId":"","goalId":"","phase":"","source":"虚构草案","autoStart":true,"expectedRevision":null});
    s.task_panel_draft(DraftInput{id:"draft-a".into(),draft:Some(original)}).unwrap();drop(s);
    let mut reopened=Store::open(&base.join("data"),true).unwrap();let saved=drafts(&reopened.db).unwrap();
    assert_eq!(saved["draft-a"]["title"],"待核对草案");assert_eq!(saved["draft-a"]["autoStart"],false);
    assert!(reopened.task_panel_snapshot().unwrap().executions.is_empty());
    reopened.task_panel_draft(DraftInput{id:"draft-a".into(),draft:None}).unwrap();assert!(drafts(&reopened.db).unwrap()["draft-a"].is_null());
}

#[test]
fn given_live_execution_when_requirements_change_then_old_run_must_stop_and_old_receipt_is_history(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();let run=dispatch_fixture(&mut s,&root,&exchange,"task-a");
    let update=MutationInput{request_id:"revise".into(),expected_revision:Some(1),action:Mutation::SaveTask{plan:None,id:"task-a".into(),title:"新要求".into(),goal:"新的任务范围".into(),scope:vec!["src".into()],criteria:vec!["核对新交付".into()],repository_id:Some("repo-a".into()),source:"本人".into()}};
    assert!(s.task_panel_mutate(update.clone()).is_err());
    let release=crate::task_panel_execution::ExecutionActionInput{request_id:"release-revision".into(),execution_id:run.id.clone(),action:"release_for_revision".into(),reason:"本人核对停止".into(),approved:true};
    setup_herdr(&mut s,&root,"working");assert!(s.task_panel_execution_action(release.clone()).is_err());
    setup_herdr(&mut s,&root,"idle");assert_eq!(s.task_panel_execution_action(release).unwrap().state,"superseded");
    assert_eq!(s.task_panel_mutate(update).unwrap().revision,2);
    let path=result_file(&exchange,&run,"old-revision");let review=s.task_panel_result(ResultInput{request_id:"old-receipt".into(),execution_id:run.id,path:path.to_string_lossy().into_owned()}).unwrap();
    assert_eq!(review.status,"quarantined");assert_eq!(s.task_panel_snapshot().unwrap().tasks[0].task.revision,2);
}

#[test]
fn given_saved_feedback_when_original_agent_is_busy_then_it_waits_and_sent_retry_does_not_duplicate(){
    use crate::task_panel_collaboration::FeedbackInput;
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();let run=dispatch_fixture(&mut s,&root,&exchange,"task-a");
    let payload=|request_id:&str,action:&str|FeedbackInput{request_id:request_id.into(),task_id:"task-a".into(),expected_revision:1,execution_id:run.id.clone(),id:"opinion-a".into(),action:action.into(),body:if action=="save"{"请保留长文本可读性"}else{""}.into(),approved:true};
    s.task_panel_feedback(payload("save-opinion","save")).unwrap();setup_herdr(&mut s,&root,"working");
    assert_eq!(s.task_panel_feedback(payload("send-opinion","send")).unwrap().state,"pending");assert_eq!(crate::herdr_adapter::test_calls("agent.prompt"),0);
    setup_herdr(&mut s,&root,"idle");assert_eq!(s.task_panel_feedback(payload("send-opinion","send")).unwrap().state,"sent");
    s.task_panel_feedback(payload("send-opinion","send")).unwrap();assert_eq!(crate::herdr_adapter::test_calls("agent.prompt"),1);
    let received=crate::task_panel_collaboration::acknowledge_feedback(&s.db,"task-a",1,&run.id,"opinion-a","received","已收到","received-a").unwrap();assert_eq!(received.state,"received");
    assert!(crate::task_panel_collaboration::acknowledge_feedback(&s.db,"task-a",1,"other-run","opinion-a","addressed","不能串任务","bad-ack").is_err());
}

#[test]
fn given_tauri_sources_when_indexed_then_handler_manifest_capability_and_frontend_candidate_are_separate(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);std::fs::create_dir(root.join("capabilities")).unwrap();
    std::fs::write(root.join("src/command.rs"),"#[tauri::command]\nfn fixture_command() {}\n").unwrap();
    std::fs::write(root.join("src/main.rs"),"fn main() { generate_handler![fixture_command]; }\n").unwrap();
    std::fs::write(root.join("build.rs"),"fn main() { manifest.commands(&[\"fixture_command\"]); }\n").unwrap();
    std::fs::write(root.join("capabilities/main.json"),r#"{"permissions":["allow-fixture-command"]}"#).unwrap();
    std::fs::write(root.join("src/a.ts"),"import { b } from './b';\ninvoke('fixture_command');\ninvoke(dynamicCommand);\n").unwrap();
    let rev=s.task_panel_snapshot().unwrap().graph_revision;
    let report=s.task_panel_index(crate::task_panel_index::IndexInput{request_id:"tauri-index".into(),repository_id:"repo-a".into(),expected_graph_revision:rev,approved:true}).unwrap();
    let graph=s.task_panel_graph(GraphQuery::default()).unwrap();assert_eq!(graph.relations.iter().filter(|r|r.kind=="registers"&&r.evidence_level=="observed").count(),2);assert!(graph.relations.iter().any(|r|r.kind=="supported_by"&&r.evidence_level=="observed"));assert!(graph.relations.iter().any(|r|r.kind=="may_affect"&&r.evidence_level=="claim"));assert!(report.unknowns.iter().any(|s|s.contains("动态 invoke")));assert!(!graph.coverage.is_empty());
    assert_eq!(std::fs::read_to_string(root.join("src/command.rs")).unwrap(),"#[tauri::command]\nfn fixture_command() {}\n");
}

#[test]
fn given_an_unconfirmed_readonly_run_when_other_task_is_projected_then_workspace_busy_matches_dispatch_gate(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"task-a");repo_task(&mut s,"task-b");let exchange=base.join("exchange");std::fs::create_dir(&exchange).unwrap();dispatch_fixture(&mut s,&root,&exchange,"task-a");
    let snapshot=s.task_panel_snapshot().unwrap();let other=snapshot.tasks.iter().find(|t|t.task.id=="task-b").unwrap();assert_eq!(other.lane,"blocked");assert!(other.reason_codes.iter().any(|r|r=="workspace_busy"));assert!(!other.allowed_actions.iter().any(|a|a=="dispatch"));
}

#[test]
fn given_real_v12_layout_when_migrated_then_identity_records_and_old_module_receipts_remain(){
    let (base,s)=fixture();drop(s);let root=base.join("legacy-data");
    let db=crate::storage::integration_tests::legacy_database(&root,12,true,true,true);
    crate::news_reader_store::create_schema(&db).unwrap();crate::news_scope::create_schema(&db).unwrap();crate::news_reset::create_schema(&db).unwrap();crate::bookkeeping::create_schema(&db).unwrap();crate::projects::create_deletion_schema(&db).unwrap();drop(db);
    let s=Store::open(&root,false).unwrap();assert_eq!(s.db.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),crate::storage::SCHEMA_VERSION);
    assert_eq!(s.db.query_row("SELECT value FROM app_meta WHERE key='identity'",[],|r|r.get::<_,String>(0)).unwrap(),"0123456789abcdef0123456789abcdef");
    assert_eq!(s.db.query_row("SELECT title FROM todos LIMIT 1",[],|r|r.get::<_,String>(0)).unwrap(),"原待办");assert_eq!(s.db.query_row("SELECT result FROM idea_requests WHERE id='retained-request'",[],|r|r.get::<_,String>(0)).unwrap(),"original-receipt");assert!(s.task_panel_snapshot().unwrap().tasks.is_empty());
}

#[test]
fn given_three_linked_analysis_artifacts_when_imported_then_claim_level_stable_ids_and_partial_history_remain(){
    use crate::task_panel_graph_import::{ImportPreviewInput,ImportApplyInput};
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);let output=base.join("analysis");std::fs::create_dir(&output).unwrap();
    let candidate=json!({"schema_version":1,"diagram_type":"architecture","meta":{"title":"隔离虚构图","output":"architecture.html"},"components":[{"id":"component-a","name":"A","type":"frontend"},{"id":"component-b","name":"B","type":"frontend"}]});
    let html=b"<!doctype html><html lang=\"zh-CN\"><body>Explicit fixture, no scripts.</body></html>";
    let cb=serde_json::to_vec(&candidate).unwrap();std::fs::write(output.join("candidate.json"),&cb).unwrap();std::fs::write(output.join("architecture.html"),html).unwrap();
    let revision=s.task_panel_snapshot().unwrap().graph_revision;
    let mut pack=json!({"schema_version":1,"analysis_id":"analysis-fixture-1","run_id":null,"context_id":null,"repository_ref":"repo-a","revision":null,"workspace_snapshot_id":null,"scope":["src"],"exclusions":["credentials"],"coverage":{"read":["src/a.ts","src/b.ts"]},"unknowns":["没有运行模型"],"artifacts":{"candidate":{"path":"candidate.json","sha256":crate::task_panel_paths::hash(&cb)},"architecture":{"path":"architecture.html","sha256":crate::task_panel_paths::hash(html)},"render_status":"fixture","validation_status":"not_run"},"nodes":[{"id":"a","kind":"file","label":"A","path":"src/a.ts","symbol":"","archify_component_id":"component-a","sources":["source-a"]},{"id":"b","kind":"file","label":"B","path":"src/b.ts","symbol":"","archify_component_id":"component-b","sources":["source-b"]}],"relations":[{"id":"relation-a","from":"a","to":"b","kind":"imports","sources":["source-a"],"inference":null}],"sources":[{"id":"source-a","path":"src/a.ts","line_start":1,"line_end":1,"revision":null,"sha256":crate::task_panel_paths::hash(&std::fs::read(root.join("src/a.ts")).unwrap()),"statement":"A imports B"},{"id":"source-b","path":"src/b.ts","line_start":1,"line_end":1,"revision":null,"sha256":null,"statement":"B declaration"}],"proposals":[],"base_graph_revision":revision,"changes":[]});
    let facts=output.join("graph-facts.json");std::fs::write(&facts,serde_json::to_vec(&pack).unwrap()).unwrap();
    let preview=s.task_panel_import_preview(ImportPreviewInput{request_id:"preview-1".into(),repository_id:"repo-a".into(),facts_path:facts.to_string_lossy().into_owned(),source:"明确手工 fixture".into()}).unwrap();assert!(preview.errors.is_empty());assert!(preview.source_reviews.iter().all(|s|s.located));
    let repeated=s.task_panel_import_preview(ImportPreviewInput{request_id:"preview-repeat".into(),repository_id:"repo-a".into(),facts_path:facts.to_string_lossy().into_owned(),source:"同内容再次选择".into()}).unwrap();assert_eq!(preview.id,repeated.id);
    s.task_panel_import_apply(ImportApplyInput{request_id:"apply-1".into(),import_id:preview.id,expected_graph_revision:revision,relation_ids:vec!["relation-a".into()],approved:true}).unwrap();
    let graph=s.task_panel_graph(GraphQuery{layer:"code".into(),..Default::default()}).unwrap();assert_eq!(graph.nodes.len(),2);assert_eq!(graph.relations.len(),1);assert_eq!(graph.relations[0].evidence_level,"claim");let before=graph.nodes.iter().find(|n|n.path=="src/a.ts").unwrap().id.clone();
    pack["analysis_id"]=json!("analysis-fixture-2");pack["base_graph_revision"]=json!(graph.graph_revision);pack["nodes"][0]["id"]=json!("renamed-render-id");pack["nodes"][0]["label"]=json!("标题变化");pack["relations"]=json!([]);
    let facts2=output.join("graph-facts-2.json");std::fs::write(&facts2,serde_json::to_vec(&pack).unwrap()).unwrap();let draft=s.task_panel_import_preview(ImportPreviewInput{request_id:"preview-2".into(),repository_id:"repo-a".into(),facts_path:facts2.to_string_lossy().into_owned(),source:"部分分析".into()}).unwrap();
    s.task_panel_import_apply(ImportApplyInput{request_id:"apply-2".into(),import_id:draft.id,expected_graph_revision:graph.graph_revision,relation_ids:vec![],approved:true}).unwrap();let graph=s.task_panel_graph(GraphQuery{layer:"code".into(),..Default::default()}).unwrap();assert_eq!(graph.nodes.len(),2);assert_eq!(graph.relations.len(),1);assert_eq!(graph.nodes.iter().find(|n|n.path=="src/a.ts").unwrap().id,before);
    assert!(output.join("candidate.json").exists());
}

#[test]
fn given_nonempty_new_directory_when_goal_is_planned_then_original_file_is_untouched_and_initialization_is_separate(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);std::fs::create_dir(root.join("new-app")).unwrap();std::fs::write(root.join("new-app/retained.txt"),"keep original").unwrap();let rev=s.task_panel_snapshot().unwrap().graph_revision;
    let input=crate::task_panel_intake::GoalInput{project_id:None,request_id:"new-goal".into(),expected_graph_revision:rev,title:"新应用".into(),goal:"先补缺项".into(),requirements:vec![],decisions:vec![],tasks:vec![crate::task_panel_intake::PlanTask{title:"功能".into(),goal:"后续实现".into(),scope:vec!["src".into()],criteria:vec!["验收".into()]}],dependencies:vec![],designs:vec![],source:"本人规划".into(),approved:true,parent_repository_id:Some("repo-a".into()),new_directory:"new-app".into(),initialize_git:false,install_dependencies:false};
    let result=s.task_panel_goal(input).unwrap();assert!(result.initialization_task_id.is_some());assert!(!result.warnings.is_empty());assert_eq!(std::fs::read_to_string(root.join("new-app/retained.txt")).unwrap(),"keep original");assert!(!root.join("new-app/.git").exists());
    assert_eq!(s.task_panel_snapshot().unwrap().tasks.iter().find(|t|t.task.id==result.task_ids[0]).unwrap().lane,"blocked");
}

#[test]
fn given_terminal_blocked_or_idle_when_monitor_updates_then_receipt_and_acceptance_stay_separate(){
    let (base,mut s)=fixture();let root=repo_fixture(&mut s,&base);repo_task(&mut s,"observed-task");
    let run=dispatch_fixture(&mut s,&root,&base,"observed-task");
    for (state,lane) in [("blocked","human"),("working","running"),("idle","running"),("disconnected","human")] {
        let monitor=json!({"observedAt":crate::task_panel_store::now(),"error":"","sessions":[],"runs":{(run.id.clone()):{"state":state,"observedAt":crate::task_panel_store::now(),"stateSince":crate::task_panel_store::now(),"firstWorkingAt":null,"reason":"fixture"}},"git":{"branch":"fixture","head":"","path":"","changedFiles":0,"observedAt":"","error":""}});
        s.save_task_setting("task-panel:monitor",&monitor.to_string()).unwrap();
        let snapshot=s.task_panel_snapshot().unwrap();let task=snapshot.tasks.iter().find(|t|t.task.id=="observed-task").unwrap();
        assert_eq!(task.lane,lane);assert_eq!(task.execution_state.as_deref(),Some("awaiting_receipt"));assert_eq!(task.acceptance_state,"not_accepted");
    }
}

#[test]
fn given_analysis_profile_when_reloaded_then_render_authorization_is_retained_without_source_edits(){
    let (base,mut s)=fixture();let _root=repo_fixture(&mut s,&base);repo_task(&mut s,"analysis-profile");
    s.save_task_setting("task-panel:profile:analysis-profile","architecture").unwrap();
    let v=s.task_panel_snapshot().unwrap().tasks.into_iter().find(|t|t.task.id=="analysis-profile").unwrap();
    assert!(v.recommended_actions.iter().any(|a|a=="render_architecture"));assert!(!v.recommended_actions.iter().any(|a|a=="edit_task_files"));
}

#[test]
fn given_new_worktree_directory_when_converted_for_shell_then_parent_is_checked_without_creating_target(){
    let (base,_s)=fixture();let target=base.join("not-created-worktree");
    let text=crate::herdr_adapter::new_shell_path(&target).unwrap();
    assert!(!target.exists());assert!(text.ends_with("not-created-worktree"));assert!(!text.starts_with(r"\\?\"));
}
