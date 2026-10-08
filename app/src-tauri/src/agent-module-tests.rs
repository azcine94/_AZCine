use crate::{agent_store::{Source,Providers},storage::{Store,CreateTodo},projects::{ProjectContent,SaveProject},ideas::{IdeaContent,SaveIdea},bookkeeping::{Content,Mutation,Status}};
use rusqlite::params;
use serde_json::{Value,json};

fn uuid(n:u32)->String{format!("00000000-0000-4000-8000-{n:012}")}
fn source(module:&str,id:&str)->Source{Source{module:module.into(),page:format!("{module}/{id}"),object_id:Some(id.into())}}
fn setup()->(Store,Providers){
    let base=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
    let root=tempfile::Builder::new().prefix("agent-business-test-").tempdir_in(base).unwrap().keep().join("data");
    let mut s=Store::open(&root,true).unwrap();
    s.save_project(SaveProject{request_id:uuid(101),expected_revision:None,document:ProjectContent{id:uuid(1),name:"测试公司".into(),labels:vec![],blocks:vec![]}}).unwrap();
    s.create_todo(CreateTodo{id:uuid(2),title:"测试事项".into(),due_date:None,project_id:Some(uuid(1))}).unwrap();
    s.save_idea(SaveIdea{request_id:uuid(103),expected_revision:None,content:IdeaContent{id:uuid(3),title:"测试灵感".into(),body:"原始内容".into(),tags:vec![],project_id:Some(uuid(1))}}).unwrap();
    s.bookkeeping_mutate(Mutation::Save{request_id:uuid(104),expected_revision:None,content:Content{id:uuid(4),date:"2026-10-07".into(),purpose:"测试交通".into(),amount_fen:1000,note:"原备注".into(),status:Status::Pending,receipt_ids:vec![],exchange:None}}).unwrap();
    (s,crate::agent_modules::registered())
}
fn capture(s:&mut Store,p:&Providers,objects:&[Source],operations:Value)->Value{
    let key=s.agent_bind(Source{module:"agent".into(),page:"agent".into(),object_id:None},true).unwrap()["conversationKey"].as_str().unwrap().to_owned();
    let(id,context)=s.agent_prepare_input(&key,"explicit-model-fixture",1,0,objects,&[],p).unwrap();
    s.agent_input_status(&id,"accepted").unwrap();
    crate::agent_tests::prepared_fixture(s,p,&key,"explicit-model-fixture",context,operations)
}
fn op(module:&str,id:&str,action:&str,values:Value)->Value{json!({"module":module,"objectId":id,"action":action,"values":values})}
fn project_value(name:&str)->Value{json!({"id":uuid(1),"name":name,"labels":[],"blocks":[]})}
fn apply(s:&mut Store,p:&Providers,d:&Value)->Result<Value,crate::storage::StorageError>{s.agent_apply(d["id"].as_str().unwrap(),d["revision"].as_i64().unwrap(),p)}

fn shot_project()->ProjectContent{serde_json::from_value(json!({"id":uuid(1),"name":"测试公司","labels":[],"blocks":[{"kind":"text","id":uuid(8),"title":"保留说明","body":"本人手写内容"},{"kind":"list","id":uuid(10),"title":"镜头表","included":true,"columns":[{"id":uuid(11),"name":"镜头","kind":"shot"},{"id":uuid(12),"name":"内容","kind":"text"},{"id":uuid(13),"name":"交期","kind":"date"}],"rows":[{"id":uuid(20),"cells":{uuid(11):"WOW_0220",uuid(12):"原描述",uuid(13):"2026-10-20"}},{"id":uuid(21),"cells":{uuid(11):"WOW_0230"}},{"id":uuid(22),"cells":{uuid(11):"WOW_0240"}}]}]})).unwrap()}
#[test]fn screenshot_table_patch_updates_three_shots_appends_two_and_keeps_unrelated_document(){
    let(mut s,p)=setup();s.save_project(SaveProject{request_id:uuid(301),expected_revision:Some(1),document:shot_project()}).unwrap();
    let rows=(0..5).map(|i|json!({"rowId":if i<3{Some(uuid(20+i))}else{None},"cells":{uuid(11):(["WOW_0220","WOW_0230","WOW_0240","WOW_0241","WOW_0250"][i as usize]),uuid(12):"WOW / 9.29 BCOPY / 10.14 BCOPY+ / 10.20 FINAL","vfx":"VFX明确编号"}})).collect::<Vec<_>>();
    let d=capture(&mut s,&p,&[source("projects",&uuid(1))],json!([op("projects",&uuid(1),"patchTables",json!({"tables":[{"blockId":uuid(10),"newColumns":[{"key":"vfx","name":"VFX编号","kind":"text"}],"rows":rows}]}))]));
    assert_eq!(d["status"],"review", "{}",d["validation"]);assert_eq!(s.projects().unwrap()[0].revision,2);let preview=d["validation"]["items"][0]["after"].clone();
    let receipt=apply(&mut s,&p,&d).unwrap();let doc=&s.projects().unwrap()[0];assert_eq!(doc.revision,3);assert_eq!(serde_json::to_value(&doc.content).unwrap(),preview);
    assert_eq!(preview["blocks"][0]["body"],"本人手写内容");assert_eq!(preview["blocks"][1]["rows"].as_array().unwrap().len(),5);assert_eq!(preview["blocks"][1]["rows"][0]["cells"][uuid(13)],"2026-10-20");assert_eq!(receipt,apply(&mut s,&p,&d).unwrap());assert_eq!(s.projects().unwrap()[0].revision,3);
}
#[test]fn table_patch_rejects_wrong_row_column_dates_and_duplicate_targets_without_writing(){
    let(mut s,p)=setup();s.save_project(SaveProject{request_id:uuid(302),expected_revision:Some(1),document:shot_project()}).unwrap();
    for rows in [json!([{"rowId":uuid(999),"cells":{uuid(12):"不能错行"}}]),json!([{"rowId":uuid(20),"cells":{uuid(999):"不能猜列"}}]),json!([{"rowId":uuid(20),"cells":{uuid(13):"2026-02-30"}}]),json!([{"rowId":uuid(20),"cells":{uuid(12):"一次"}},{"rowId":uuid(20),"cells":{uuid(12):"重复"}}])]{
        let d=capture(&mut s,&p,&[source("projects",&uuid(1))],json!([op("projects",&uuid(1),"patchTables",json!({"tables":[{"blockId":uuid(10),"rows":rows}]}))]));assert_eq!(d["status"],"blocked");assert!(apply(&mut s,&p,&d).is_err());assert_eq!(s.projects().unwrap()[0].revision,2);
    }
}
#[test]fn table_patch_never_overwrites_changes_made_after_draft_generation(){
    let(mut s,p)=setup();s.save_project(SaveProject{request_id:uuid(303),expected_revision:Some(1),document:shot_project()}).unwrap();
    let d=capture(&mut s,&p,&[source("projects",&uuid(1))],json!([op("projects",&uuid(1),"patchTables",json!({"tables":[{"blockId":uuid(10),"rows":[{"rowId":uuid(20),"cells":{uuid(12):"建议"}}]}]}))]));
    let mut manual=shot_project();manual.name="本人修改".into();s.save_project(SaveProject{request_id:uuid(304),expected_revision:Some(2),document:manual.clone()}).unwrap();assert_eq!(apply(&mut s,&p,&d).unwrap_err().code,"agent_baseline_conflict");assert_eq!(s.projects().unwrap()[0].content,manual);
}

#[test]fn actual_catalog_reads_registered_business_objects_without_authentication(){let(mut s,p)=setup();let tx=s.db.transaction().unwrap();let catalog=p.catalog(&tx,"").unwrap();assert_eq!(catalog["modules"].as_array().unwrap().len(),7);for(module,id)in[("projects",uuid(1)),("today",uuid(2)),("ideas",uuid(3)),("bookkeeping",uuid(4))]{let rows=catalog["modules"].as_array().unwrap().iter().find(|m|m["id"]==module).unwrap();assert!(rows["objects"].as_array().unwrap().iter().any(|o|o["source"]["objectId"]==id));}let serialized=catalog.to_string();assert!(!serialized.contains("auth.json")&&!serialized.contains("apiKey"));}

#[test]fn five_module_draft_requires_confirmation_then_commits_and_replays_one_receipt(){
    let(mut s,p)=setup();let mut news=s.news_sources().unwrap().remove(0).config;let source_id=format!("source:{}",news.id);news.name="本人核对后的测试信源".into();
    let objects=vec![source("projects",&uuid(1)),source("today",&uuid(2)),source("ideas",&uuid(3)),source("bookkeeping",&uuid(4)),source("news",&source_id)];
    let operations=json!([op("projects",&uuid(1),"update",project_value("核对后的公司")),op("today",&uuid(2),"setCompleted",json!({"completed":true})),op("ideas",&uuid(3),"update",json!({"id":uuid(3),"title":"测试灵感","body":"核对后的正文","tags":["测试"],"projectId":uuid(1)})),op("bookkeeping",&uuid(4),"update",json!({"id":uuid(4),"date":"2026-10-07","purpose":"测试交通","amountFen":1000,"note":"核对后的备注","status":"pending","receiptIds":[],"exchange":null})),op("news",&source_id,"updateSource",serde_json::to_value(news).unwrap())]);
    let draft=capture(&mut s,&p,&objects,operations);assert_eq!(draft["status"],"review");assert_eq!(s.projects().unwrap()[0].content.name,"测试公司");assert!(!s.todos().unwrap()[0].completed);
    let receipt=apply(&mut s,&p,&draft).unwrap();assert_eq!(receipt["items"].as_array().unwrap().len(),5);assert_eq!(receipt,apply(&mut s,&p,&draft).unwrap());assert_eq!(s.projects().unwrap()[0].revision,2);assert!(s.todos().unwrap()[0].completed);assert_eq!(s.ideas().unwrap()[0].body,"核对后的正文");assert_eq!(s.bookkeeping_list().unwrap()[0].note,"核对后的备注");assert!(s.news_sources().unwrap().iter().any(|n|n.config.name=="本人核对后的测试信源"&&n.revision==2));
}

#[test]fn manual_edit_in_another_module_rejects_entire_batch_and_preserves_review(){let(mut s,p)=setup();let draft=capture(&mut s,&p,&[source("projects",&uuid(1)),source("ideas",&uuid(3))],json!([op("projects",&uuid(1),"update",project_value("AI建议")),op("ideas",&uuid(3),"update",json!({"id":uuid(3),"title":"测试灵感","body":"AI建议","tags":[],"projectId":uuid(1)}))]));s.save_idea(SaveIdea{request_id:uuid(202),expected_revision:Some(1),content:IdeaContent{id:uuid(3),title:"测试灵感".into(),body:"本人手改".into(),tags:vec![],project_id:Some(uuid(1))}}).unwrap();assert_eq!(apply(&mut s,&p,&draft).unwrap_err().code,"agent_baseline_conflict");assert_eq!(s.projects().unwrap()[0].content.name,"测试公司");let conflict=s.agent_drafts().unwrap().remove(0);assert_eq!(conflict["status"],"conflict");assert_eq!(conflict["validation"]["items"].as_array().unwrap().len(),2);assert_eq!(s.ideas().unwrap()[0].body,"本人手改");}

#[test]fn write_failure_rolls_back_business_changes_and_normal_module_request_receipts(){let(mut s,p)=setup();let draft=capture(&mut s,&p,&[source("projects",&uuid(1)),source("today",&uuid(2))],json!([op("projects",&uuid(1),"update",project_value("AI建议")),op("today",&uuid(2),"setCompleted",json!({"completed":true}))]));s.db.execute_batch("CREATE TRIGGER explicit_failure BEFORE UPDATE ON todos BEGIN SELECT RAISE(ABORT,'explicit fixture');END;").unwrap();assert!(apply(&mut s,&p,&draft).is_err());assert_eq!(s.projects().unwrap()[0].content.name,"测试公司");assert_eq!(s.db.query_row("SELECT count(*) FROM project_requests",[],|r|r.get::<_,i64>(0)).unwrap(),1);assert_eq!(s.agent_drafts().unwrap()[0]["status"],"review");}

#[test]fn invalid_project_date_or_target_identity_is_blocked_before_any_write(){let(mut s,p)=setup();let mut values=project_value("建议");values["id"]=json!(uuid(999));let d=capture(&mut s,&p,&[source("projects",&uuid(1))],json!([op("projects",&uuid(1),"update",values)]));assert_eq!(d["status"],"blocked");assert_eq!(s.projects().unwrap()[0].revision,1);let mut values=project_value("建议");values["blocks"]=json!([{"kind":"list","id":uuid(10),"title":"交付","included":true,"columns":[{"id":uuid(11),"name":"日期","kind":"date","width":null}],"rows":[{"id":uuid(12),"cells":{uuid(11):"2026-02-30"}}]}]);let d=capture(&mut s,&p,&[source("projects",&uuid(1))],json!([op("projects",&uuid(1),"update",values)]));assert_eq!(d["status"],"blocked");}

#[test]fn deleted_object_is_conflict_and_cannot_be_recreated_by_old_draft(){let(mut s,p)=setup();let d=capture(&mut s,&p,&[source("ideas",&uuid(3))],json!([op("ideas",&uuid(3),"update",json!({"id":uuid(3),"title":"测试灵感","body":"AI建议","tags":[],"projectId":uuid(1)}))]));s.set_idea_deleted(&uuid(3),1,true).unwrap();assert_eq!(apply(&mut s,&p,&d).unwrap_err().code,"agent_baseline_conflict");assert!(s.ideas().unwrap()[0].deleted);}

#[test]fn catalog_search_reaches_objects_beyond_first_two_hundred(){let(mut s,p)=setup();for n in 500..706{s.db.execute("INSERT INTO todos(id,title) VALUES(?,?)",params![uuid(n),if n==705{"最后一条目标".to_owned()}else{format!("批量待办{n}")}]).unwrap();}let tx=s.db.transaction().unwrap();let all=p.catalog(&tx,"").unwrap();let todos=all["modules"].as_array().unwrap().iter().find(|m|m["id"]=="today").unwrap();assert_eq!(todos["total"],207);assert_eq!(todos["objects"].as_array().unwrap().len(),200);assert_eq!(todos["hasMore"],true);let filtered=p.catalog(&tx,"最后一条").unwrap();let todos=filtered["modules"].as_array().unwrap().iter().find(|m|m["id"]=="today").unwrap();assert_eq!(todos["total"],1);assert_eq!(todos["objects"][0]["source"]["objectId"],uuid(705));}

#[test]fn readonly_material_provides_real_provenance_and_no_write_operation(){let(mut s,p)=setup();let source_id=s.news_sources().unwrap()[0].config.id.clone();s.db.execute("INSERT INTO news_materials(id,source_id,source_name,source_revision,title,url,published_at,published_raw,discovered_at,summary,summary_truncated) VALUES('fixture-material',?,'明确测试来源',1,'明确原始标题','https://example.com/item',NULL,'未确定日期','2026-10-07T00:00:00Z','明确测试摘要',0)",[source_id]).unwrap();let tx=s.db.transaction().unwrap();let context=p.module("news").unwrap().snapshot(&tx,&source("news","material:fixture-material")).unwrap();assert_eq!(context.snapshot["publishedRaw"],"未确定日期");assert!(context.operations.is_empty());assert!(context.revision>0);}

#[test]fn source_duplicate_name_and_private_url_are_rejected(){let(mut s,p)=setup();let sources=s.news_sources().unwrap();let mut config=sources[0].config.clone();let id=format!("source:{}",config.id);config.name=sources[1].config.name.clone();let d=capture(&mut s,&p,&[source("news",&id)],json!([op("news",&id,"updateSource",serde_json::to_value(config.clone()).unwrap())]));assert_eq!(d["status"],"blocked");config.name="合法测试名称".into();config.feed_url="http://127.0.0.1/private".into();let d=capture(&mut s,&p,&[source("news",&id)],json!([op("news",&id,"updateSource",serde_json::to_value(config).unwrap())]));assert_eq!(d["status"],"blocked");}

#[test]fn bookkeeping_uses_existing_transition_rules_and_preserves_receipts(){let(mut s,p)=setup();let d=capture(&mut s,&p,&[source("bookkeeping",&uuid(4))],json!([op("bookkeeping",&uuid(4),"setStatus",json!({"status":"paid"}))]));assert_eq!(d["status"],"blocked");let d=capture(&mut s,&p,&[source("bookkeeping",&uuid(4))],json!([op("bookkeeping",&uuid(4),"setStatus",json!({"status":"submitted"}))]));assert_eq!(d["status"],"review");apply(&mut s,&p,&d).unwrap();assert_eq!(s.bookkeeping_list().unwrap()[0].status,Status::Submitted);}

#[test]fn same_object_multiple_actions_are_blocked_and_provider_describes_actions(){let(mut s,p)=setup();let d=capture(&mut s,&p,&[source("bookkeeping",&uuid(4))],json!([op("bookkeeping",&uuid(4),"setStatus",json!({"status":"submitted"})),op("bookkeeping",&uuid(4),"update",json!({}))]));assert_eq!(d["status"],"blocked");assert!(!p.module("bookkeeping").unwrap().operation_schema("setStatus").is_null());assert!(d["context"].get("draftProtocol").is_none());}

#[test]fn actual_applied_receipt_and_objects_survive_storage_reopen(){let(mut s,p)=setup();let d=capture(&mut s,&p,&[source("today",&uuid(2))],json!([op("today",&uuid(2),"setCompleted",json!({"completed":true}))]));let receipt=apply(&mut s,&p,&d).unwrap();let root=s.root.clone();drop(s);let mut s=Store::open(&root,false).unwrap();assert!(s.todos().unwrap()[0].completed);assert_eq!(receipt,apply(&mut s,&p,&d).unwrap());assert_eq!(s.todos().unwrap()[0].revision,2);}

#[test]fn model_rankings_and_jobs_expose_persisted_results_but_reject_business_writes(){
    let(mut s,p)=setup();let board=crate::model_ranking::Board::Agent;
    let rows=(1..=50).map(|rank|json!({"kind":"agent","rank":rank,"organization":null,"license":null,"model":format!("Explicit fixture {rank}"),"netImprovement":{"value":1.0,"lower":0.0,"upper":2.0},"confirmedSuccess":{"value":1.0,"lower":0.0,"upper":2.0},"praiseVsComplaint":{"value":1.0,"lower":0.0,"upper":2.0},"steerability":{"value":1.0,"lower":0.0,"upper":2.0}})).collect::<Vec<_>>();
    let snapshot=json!({"version":2,"board":"agent","category":"overall","sourceUrl":board.source_url(),"datasetUrl":"https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset","datasetRevision":"1".repeat(40),"datasetLicense":"CC BY 4.0","dataUpdatedAt":"2026-10-02","capturedAt":"2026-10-04T01:00:00Z","totalModels":50,"totalSamples":null,"rows":rows});
    s.update_ranking(crate::model_ranking::UpdateSnapshot{board,json:snapshot.to_string(),expected_snapshot_id:None,expected_root:s.root.to_string_lossy().into_owned()}).unwrap();
    s.db.execute("INSERT INTO agent_jobs(id,template,input,status,output,timeout_ms,created_at) VALUES('fixture-job','summarize-text','明确测试输入','completed','已保存测试结果',10000,'2026-10-07T00:00:00Z')",[]).unwrap();
    {let tx=s.db.transaction().unwrap();let models=p.module("models").unwrap().snapshot(&tx,&source("models","agent")).unwrap();let job=p.module("jobs").unwrap().snapshot(&tx,&source("jobs","fixture-job")).unwrap();assert!(models.operations.is_empty());assert!(job.operations.is_empty());assert_eq!(job.snapshot["output"],"已保存测试结果");assert!(models.snapshot.to_string().contains("Explicit fixture 1"));}
    for(module,id)in[("models","agent"),("jobs","fixture-job")]{let d=capture(&mut s,&p,&[source(module,id)],json!([op(module,id,"update",json!({"status":"completed"}))]));assert_eq!(d["status"],"blocked");}
}
