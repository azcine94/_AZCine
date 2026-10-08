//! Tool directory and dispatch. Module mutations use registered providers;
//! runtime tasks reuse the same application commands as their normal pages.
use crate::{agent_mcp::Binding,agent_store::{DraftPayload,Operation,Providers,Source},storage::{Store,StorageError}};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use rusqlite::{OptionalExtension,params};
use sha2::{Digest,Sha256};
use tauri::Manager as _;
fn error(message:&str)->StorageError{StorageError::new("agent_mcp_input",message)}
fn db(_:rusqlite::Error)->StorageError{error("MCP 业务记录读取或保存失败，输入与原记录保留。")}
fn decode<T:serde::de::DeserializeOwned>(value:&Value)->Result<T,StorageError>{serde_json::from_value(value.clone()).map_err(|_|error("参数缺失、类型错误或含有不支持的字段，请检查工具定义。"))}
fn value<T:Serialize>(v:T)->Result<Value,StorageError>{serde_json::to_value(v).map_err(|_|error("业务结果格式无效。"))}
fn schema(properties:Value,required:&[&str])->Value{json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})}
fn tool(name:&str,description:&str,input:Value,read_only:bool)->Value{json!({"name":name,"description":description,"inputSchema":input,"annotations":{"readOnlyHint":read_only,"destructiveHint":false,"idempotentHint":read_only,"openWorldHint":matches!(name,"preview_source"|"collect_news"|"organize_news"|"analyze_news"|"submit_job")}})}
pub fn tools()->Vec<Value>{
    let string=json!({"type":"string"});let empty=schema(json!({}),&[]);
    let nullable=json!({"type":["string","null"]});
    let source=schema(json!({"id":string,"name":string,"feedUrl":{"type":"string","format":"uri"},"identity":{"type":"string","enum":["official","research","media","individual"]},"domains":{"type":"array","maxItems":3,"uniqueItems":true,"items":{"type":"string","enum":["frontiers","industry","visual"]}},"usage":{"type":"string","enum":["editorial","watch"]},"intervalMinutes":{"type":"integer","minimum":15,"maximum":10080},"enabled":{"type":"boolean"}}),&["name","feedUrl","identity","domains","usage","intervalMinutes","enabled"]);
    let range=schema(json!({"period":{"type":"string","enum":["all","day","week","custom"]},"start":nullable,"end":nullable,"includeUndated":{"type":"boolean"}}),&["period"]);
    let scope=schema(json!({"start":nullable,"end":{"type":"string","description":"UTC RFC3339 时间，保留毫秒，如 2026-10-07T00:00:00.000Z"},"sourceId":nullable,"query":{"type":"string","maxLength":200},"includeUndated":{"type":"boolean"},"batchId":nullable}),&["end","query","includeUndated"]);
    let selection=schema(json!({"scope":{"type":"string","enum":["single","all"]},"materialId":nullable,"batchSize":{"type":"integer","minimum":1,"maximum":20},"filter":scope,"expectedIds":{"type":"array","items":string}}),&["scope","batchSize"]);
    vec![
        tool("list_capabilities","列出工作台实际开放的模块、动作、值结构及任务工具。新增模块通过注册 provider 自动进入此目录。",empty.clone(),true),
        tool("get_context","查询当前会话所在页面、用户本轮附加对象与文件引用。对象可通过 read_object 主动读取，其他模块通过 search_objects 检索。",empty.clone(),true),
        tool("search_objects","跨模块检索对象，支持正文关键词、分页、软删除状态和精确字段过滤（snapshot 中顶层字段，如 projectId/status/completed/dueDate）。返回稳定标识和实际版本；不需要手工附加。",schema(json!({"module":string,"query":{"type":"string","maxLength":200},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":100},"deleted":{"type":"boolean"},"filters":{"type":"object"}}),&[]),true),
        tool("describe_action","获取某模块动作接受的 values 字段、类型、数量限制和完整对象示例；项目动作同时返回 columnRules 与 constraints。正式写入使用 prepare_changes；描述没有列出的动作不可用。",schema(json!({"module":string,"action":string}),&["module","action"]),true),
        tool("read_object","读取实际业务对象内容、稳定ID、修订号、可用动作；大对象可用 JSON Pointer path 选择字段，数组或正文用 offset/limit 分页。请保留 revision，用于后续准备草案的 expectedRevision。",schema(json!({"module":string,"objectId":string,"path":{"type":"string","description":"可选 JSON Pointer，如 /blocks/0/rows，用于大对象分页读取"},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":1000}}),&["module","objectId"]),true),
        tool("prepare_changes","提交、校验并保存待本人核对的业务变更草案，不直接应用。values遵守describe_action返回的字段与constraints/columnRules。create省略objectId/expectedRevision/id，由应用生成；其他动作使用read_object的objectId和expectedRevision。每个对象一个完整动作，可含多个表格/行/单元格。同一requestKey重试返回同一草案，校验失败不创建草案。返回简短回执{id,status,revision,operationCount,changes,decisions,applied}；review仅表示草案已保存。完整内容和正式应用回执通过get_draft查询。",schema(json!({"requestKey":{"type":"string","minLength":1,"maxLength":200},"operations":{"type":"array","minItems":1,"maxItems":100,"items":schema(json!({"module":string,"objectId":string,"action":string,"expectedRevision":{"type":"integer","minimum":1},"values":{"type":"object"}}),&["module","action","values"])},"decisions":{"type":"array","maxItems":100,"items":{"type":"string","maxLength":2000}}}),&["requestKey","operations"]),false),
        tool("get_draft","读取本会话草案校验、状态、修订号和实际应用回执；review 表示待核对，只有 applied 及 receipt 才表示已正式保存。",schema(json!({"id":string}),&["id"]),true),
        tool("read_attachment","读取本会话曾附加的文件元数据；图片返回模型可查看的预览与原副本路径，文本支持有界分页；PDF/Excel 返回经过校验的应用副本路径供原生文件工具读取。",schema(json!({"id":string,"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":1,"maximum":65536}}),&["id"]),true),
        tool("bookkeeping_summary","按日期/状态查询开销及整数分合计，也可返回CSV文本；沿用记账页面查询与导出转换。",schema(json!({"filter":schema(json!({"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"},"status":{"type":"string","enum":["unclaimed","pending","submitted","paid"]}}),&[]),"csv":{"type":"boolean"}}),&[]),true),
        tool("model_sources","读取两张模型榜的官方来源与本地缓存状态；没有接入自动抓取，不把旧缓存当最新数据。",empty.clone(),true),
        tool("list_jobs","读取实际后台任务状态、日志与输出。",empty.clone(),true),
        tool("submit_job","提交已有后台任务：summarize-text、summarize-batch、draft-objects。draft-objects 使用同一MCP工具提交待核对草案。",schema(json!({"template":{"type":"string","enum":["summarize-text","summarize-batch","draft-objects"]},"content":string,"timeoutSeconds":{"type":"integer","minimum":10,"maximum":3600},"objects":{"type":"array","items":schema(json!({"module":string,"page":string,"objectId":nullable}),&["module","page"]),"maxItems":16}}),&["template","content","timeoutSeconds"]),false),
        tool("cancel_job","取消指定现有后台任务，仅停止本应用跟踪的任务进程。",schema(json!({"id":string}),&["id"]),false),
        tool("news_state","读取信源、采集运行状态以及整理/分析进度。",empty.clone(),true),
        tool("preview_source","预览公开RSS/Atom地址，验证返回的真实材料；不保存信源配置。新地址省略 source.id，应用生成预览编号，其余配置必须明确。",schema(json!({"source":source}),&["source"]),true),
        tool("collect_news","按已有信源采集公开资讯，sourceId 使用信源 snapshot.config.id（不带 source:）。复用模块的网络校验、占用控制和任务日志。自定义 range.start/end 为 RFC3339 时间。失败或超时可通过 news_state 核对，勿自动重复提交。",schema(json!({"sourceId":string,"range":range}),&[]),false),
        tool("organize_news","执行已有资讯整理流程，使用已保存模型与偏好，返回真实整理结果。scope=single 需 materialId；scope=all 不传 materialId，可用 filter 限定范围、expectedIds 核对实际队列。",schema(json!({"kind":{"type":"string","enum":["daily","organize"]},"selection":selection}),&["kind","selection"]),false),
        tool("analyze_news","分析实际资讯事件，id 使用 read_object 返回的 snapshot.id（不带 event: 前缀），revision 使用 snapshot.revision；复用现有分析与结果保存流程。",schema(json!({"id":string,"revision":{"type":"integer","minimum":1}}),&["id","revision"]),false),
        tool("cancel_news","取消正在执行的资讯采集或整理/分析，已完成部分按模块规则保留。",schema(json!({"kind":{"type":"string","enum":["capture","editorial"]}}),&["kind"]),false),
    ]
}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct ReadObject{module:String,object_id:String,path:Option<String>,#[serde(default)]offset:usize,limit:Option<usize>}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Describe{module:String,action:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Id{id:String}
#[derive(Deserialize,Default)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct Search{module:Option<String>,#[serde(default)]query:String,#[serde(default)]offset:usize,limit:Option<usize>,#[serde(default)]deleted:bool,#[serde(default)]filters:serde_json::Map<String,Value>}
#[derive(Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct Proposal{request_key:String,operations:Vec<Change>,#[serde(default)]decisions:Vec<String>}
#[derive(Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct Change{module:String,object_id:Option<String>,action:String,expected_revision:Option<i64>,values:Value}
fn context(store:&Store,owner:&Binding)->Result<Value,StorageError>{
    let raw:Option<String>=store.db.query_row("SELECT context FROM agent_inputs WHERE id=? AND conversation_id=? AND session_id=? AND status IN ('prepared','accepted')",params![owner.input_id,owner.key,owner.session],|r|r.get(0)).optional().map_err(db)?;
    if let Some(raw)=raw{let mut context:Value=serde_json::from_str(&raw).map_err(|_|error("当前上下文记录损坏。"))?;if let Some(index)=owner.message_index{context["messageCount"]=json!(index);}Ok(context)}else{let binding=store.agent_conversation(&owner.key)?;Ok(json!({"source":binding["source"],"objects":[],"attachments":[],"conversationKey":owner.key}))}
}
pub fn storage(store:&mut Store,providers:&Providers,owner:&Binding,name:&str,args:Value)->Result<Value,StorageError>{
    match name{
        "get_context"=>{let _:serde_json::Map<String,Value>=decode(&args)?;if args.as_object().is_some_and(|m|!m.is_empty()){return Err(error("该工具不接受参数。"));}context(store,owner)},
        "list_capabilities"=>{let mut modules=Vec::new();let mut names=providers.0.keys().collect::<Vec<_>>();names.sort();for name in names{let p=&providers.0[name];let actions=p.actions().into_iter().map(|action|json!({"action":action,"values":p.operation_schema(&action)})).collect::<Vec<_>>();modules.push(json!({"module":name,"actions":actions}));}Ok(json!({"modules":modules,"tools":tools(),"writes":"变更草案由本人核对应用；正式保存仅以 applied 回执为准。"}))},
        "describe_action"=>{let input:Describe=decode(&args)?;let provider=providers.module(&input.module)?;if !provider.actions().contains(&input.action){return Err(error("模块没有提供该动作。"));}Ok(provider.operation_schema(&input.action))},
        "read_object"=>{let input:ReadObject=decode(&args)?;let tx=store.db.transaction().map_err(db)?;let mut object=value(providers.module(&input.module)?.snapshot(&tx,&Source{page:input.module.clone(),module:input.module,object_id:Some(input.object_id)})?)?;if let Some(path)=input.path{let selected=object["snapshot"].pointer(&path).ok_or_else(||error("对象字段路径不存在。"))?.clone();let limit=input.limit.unwrap_or(100);if limit==0||limit>1000{return Err(error("分页读取最多1000项或字符。"));}let (selected,total)=match selected{Value::Array(items)=>{let total=items.len();(json!(items.into_iter().skip(input.offset).take(limit).collect::<Vec<_>>()),total)},Value::String(text)=>{let total=text.chars().count();(json!(text.chars().skip(input.offset).take(limit).collect::<String>()),total)},other=>{if input.offset!=0||input.limit.is_some(){return Err(error("该字段不能分页。"));}(other,1)}};object["snapshot"]=selected;object["selection"]=json!({"path":path,"offset":input.offset,"total":total,"hasMore":input.offset.saturating_add(limit)<total});}else if input.offset!=0||input.limit.is_some(){return Err(error("分页读取需指定 path。"));}if serde_json::to_vec(&object).map_err(|_|error("对象无法编码。"))?.len()>8*1024*1024{return Err(error("对象超过单次读取上限，请通过 path 读取字段，并对数组/正文使用 offset 和 limit 分页。"));}Ok(object)},
        "search_objects"=>{
            let input:Search=decode(&args)?;let limit=input.limit.unwrap_or(30);if limit==0||limit>100||input.query.chars().count()>200||input.filters.len()>12{return Err(error("查询参数超过上限。"));}
            if let Some(module)=&input.module{providers.module(module)?;}
            let tx=store.db.transaction().map_err(db)?;let query=input.query.to_lowercase();let mut found=Vec::new();let mut names=providers.0.keys().collect::<Vec<_>>();names.sort();
            for name in names{if input.module.as_ref().is_some_and(|m|m!=name){continue;}let provider=&providers.0[name];let entries=if input.deleted{provider.list_deleted(&tx)?}else{provider.list(&tx)?};
                for mut entry in entries{let source:Source=decode(&entry["source"])?;let object=provider.snapshot(&tx,&source)?;
                    let text=serde_json::to_string(&object.snapshot).map_err(|_|error("对象内容无法检索。"))?.to_lowercase();
                    if !query.is_empty()&&!text.contains(&query){continue;}if !input.filters.iter().all(|(key,value)|object.snapshot.get(key)==Some(value)){continue;}
                    entry["revision"]=json!(object.revision);entry["operations"]=json!(object.operations);found.push(entry);
                }
            }
            let total=found.len();let items=found.into_iter().skip(input.offset).take(limit).collect::<Vec<_>>();Ok(json!({"items":items,"total":total,"offset":input.offset,"limit":limit,"hasMore":input.offset.saturating_add(limit)<total}))
        },
        "prepare_changes"=>prepare(store,providers,owner,decode(&args)?),
        "get_draft"=>{let input:Id=decode(&args)?;draft(store,owner,&input.id)},
        "read_attachment"=>attachment(store,owner,args),
        "bookkeeping_summary"=>{#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct Filter{date_from:Option<String>,date_to:Option<String>,status:Option<crate::bookkeeping::Status>}#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Summary{filter:Option<Filter>,#[serde(default)]csv:bool}let input:Summary=decode(&args)?;let rows=store.bookkeeping_list()?;let filter=input.filter.unwrap_or(Filter{date_from:None,date_to:None,status:None});for date in [filter.date_from.as_deref(),filter.date_to.as_deref()].into_iter().flatten(){if !crate::storage::valid_date(date){return Err(error("日期筛选需为 YYYY-MM-DD。"));}}let rows=rows.into_iter().filter(|row|filter.date_from.as_ref().is_none_or(|d|&row.date>=d)&&filter.date_to.as_ref().is_none_or(|d|&row.date<=d)&&filter.status.is_none_or(|s|row.status==s)).collect::<Vec<_>>();let total=rows.iter().try_fold(0i64,|sum,row|sum.checked_add(row.amount_fen).ok_or_else(||error("合计金额超出范围。")))?;let mut result=json!({"items":rows,"totalFen":total,"count":rows.len()});if input.csv{result["csv"]=json!(crate::bookkeeping_commands::csv(&rows));}Ok(result)},
        "model_sources"=>{let states=store.ranking_boards();Ok(json!({"boards":states,"sources":[{"board":"agent","url":crate::model_ranking::Board::Agent.source_url()},{"board":"text-to-image","url":crate::model_ranking::Board::TextToImage.source_url()}],"update":"模型榜仅提供已保存的官方数据快照。"}))},
        _=>Err(error("工具尚未接入，未模拟执行。"))
    }
}
fn draft(store:&Store,owner:&Binding,id:&str)->Result<Value,StorageError>{store.agent_draft(&owner.key,&owner.session,id)}
// A submission returns a bounded acknowledgement. Full snapshots remain in
// get_draft and the application's review UI, rather than flooding model output.
fn proposal_receipt(result:Value)->Value {
    let changes=result["validation"]["items"].as_array().into_iter().flatten().map(|item|json!({"title":item["title"],"action":item["action"],"actionLabel":item["actionLabel"]})).collect::<Vec<_>>();
    json!({"id":result["id"],"status":result["status"],"revision":result["revision"],
        "operationCount":result["payload"]["operations"].as_array().map(Vec::len).unwrap_or(0),
        "changes":changes,"decisions":result["payload"]["decisions"],
        "applied":result["status"]=="applied","receiptAvailable":!result["receipt"].is_null(),
        "next":"review表示仅草案已保存，等待本人在AZCine核对；不等于正式写入。完整内容与后续保存回执可用get_draft(id)查询。"})
}
fn uuid(tx:&rusqlite::Transaction<'_>)->Result<String,StorageError>{tx.query_row("SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6)))",[],|r|r.get(0)).map_err(db)}
fn prepare(store:&mut Store,providers:&Providers,owner:&Binding,input:Proposal)->Result<Value,StorageError>{
    if input.request_key.is_empty()||input.request_key.len()>200||input.operations.is_empty()||input.operations.len()>100||input.decisions.len()>100||input.decisions.iter().any(|s|s.len()>8000){return Err(error("草案参数超过上限。"));}
    let current=context(store,owner)?;let parent=current["inputId"].as_str().ok_or_else(||error("没有本轮用户输入，未创建变更草案。"))?;
    let message_key=format!("mcp:{}:{}:{}",owner.session,parent,input.request_key);
    let existing:Option<(String,String)>=store.db.query_row("SELECT id,payload FROM agent_drafts WHERE message_key=?",[&message_key],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db)?;
    // Exact original proposal digest survives generated IDs and retry/reconnect.
    let proposal=value(&input)?;let digest=format!("{:x}",Sha256::digest(serde_json::to_vec(&proposal).map_err(|_|error("草案参数无法编码。"))?));
    if let Some((id,_))=existing{let result=draft(store,owner,&id)?;if result["context"]["proposalHash"]!=digest{return Err(error("requestKey 已用于不同草案内容；请使用新编号。"));}return Ok(proposal_receipt(result));}
    let draft_id=crate::agent_store::id(store)?;let input_id=crate::agent_store::id(store)?;let tx=store.db.transaction().map_err(db)?;let mut operations=Vec::new();let mut baselines=Vec::new();
    for change in input.operations{
        let provider=providers.module(&change.module)?;if !provider.actions().contains(&change.action){return Err(error("模块没有提供该动作；请先查询 describe_action。"));}
        let mut values=change.values;let object_id;
        if change.action=="create"{
            if change.object_id.is_some()||change.expected_revision.is_some()||values.get("id").is_some(){return Err(error("新对象的编号由应用生成，请省略 objectId、expectedRevision 和 values.id。"));}
            let id=uuid(&tx)?;object_id=provider.new_object_id(&id);
        }else{object_id=change.object_id.ok_or_else(||error("修改对象需要 objectId。"))?;if change.expected_revision.is_none(){return Err(error("请先 read_object，再提供 expectedRevision。"));}}
        values=provider.prepare_values(&change.action,&object_id,change.expected_revision,values)?;
        let op=Operation{module:change.module,object_id,action:change.action,values};
        let baseline=if op.action=="create"{provider.creation(&tx,&op)?}else{
            let source=Source{module:op.module.clone(),page:op.module.clone(),object_id:Some(op.object_id.clone())};let object=provider.snapshot(&tx,&source)?;
            if Some(object.revision)!=change.expected_revision{return Err(error(&format!("对象 {} 已变化，当前 revision={}；请重新 read_object 后重做。",op.object_id,object.revision)));}object
        };
        baselines.push(baseline);operations.push(op);
    }
    let payload=DraftPayload{version:1,operations,decisions:input.decisions};let context=json!({"version":2,"inputId":input_id,"parentInputId":parent,"messageCount":current["messageCount"],"conversationKey":owner.key,"sessionId":owner.session,"source":current["source"],"objects":baselines,"attachments":current["attachments"],"proposalHash":digest});
    let items=crate::agent_store::validate_payload(&tx,&payload,&context,providers)?;
    tx.execute("INSERT INTO agent_inputs(id,conversation_id,session_id,generation,message_count,context,status,created_at) VALUES(?,?,?,?,?,?,?,?)",params![input_id,owner.key,owner.session,owner.generation as i64,0,context.to_string(),"mcp-draft",chrono::Utc::now().to_rfc3339()]).map_err(db)?;
    tx.execute("INSERT INTO agent_drafts(id,conversation_id,input_id,message_key,payload,validation,status,created_at) VALUES(?,?,?,?,?,?,?,?)",params![draft_id,owner.key,input_id,message_key,value(payload)?.to_string(),json!({"items":items,"error":null}).to_string(),"review",chrono::Utc::now().to_rfc3339()]).map_err(db)?;
    tx.commit().map_err(db)?;draft(store,owner,&draft_id).map(proposal_receipt)
}
fn attachment(store:&Store,owner:&Binding,args:Value)->Result<Value,StorageError>{
    #[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Input{id:String,#[serde(default)]offset:usize,limit:Option<usize>}let input:Input=decode(&args)?;
    let owned:bool=store.db.query_row("SELECT EXISTS(SELECT 1 FROM agent_inputs i JOIN agent_conversations c ON c.id=i.conversation_id,json_each(i.context,'$.attachments') a WHERE i.session_id=? AND c.deleted_at IS NULL AND json_extract(a.value,'$.id')=?)",params![owner.session,input.id],|r|r.get(0)).map_err(db)?;if !owned{return Err(error("附件未加入本会话，不能读取。"));}
    crate::agent_commands::verify_attachments(store,std::slice::from_ref(&input.id))?;
    let (name,relative,hash,bytes,mime):(String,String,String,i64,String)=store.db.query_row("SELECT name,relative_path,hash,bytes,mime_type FROM agent_attachments WHERE id=?",[&input.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(db)?;
    let path=store.root.join(relative);let metadata=json!({"id":input.id,"name":name,"bytes":bytes,"mimeType":mime,"hash":hash,"path":path});
    if mime.starts_with("image/"){return Ok(json!({"metadata":metadata,"attachmentImage":{"path":path,"hash":hash,"bytes":bytes}}));}
    let mut result=metadata;if matches!(path.extension().and_then(|v|v.to_str()),Some("txt"|"md"|"json"|"csv"|"tsv")){
        let limit=input.limit.unwrap_or(32768);if limit==0||limit>65536{return Err(error("文本读取最多65536字符。"));}let text=std::fs::read_to_string(&path).map_err(|_|error("附件不是有效UTF-8文本。"))?;result["text"]=json!(text.chars().skip(input.offset).take(limit).collect::<String>());result["offset"]=json!(input.offset);result["hasMore"]=json!(text.chars().count()>input.offset.saturating_add(limit));
    }Ok(result)
}

pub fn task(app:&tauri::AppHandle,owner:&Binding,name:&str,args:&Value)->Option<Result<Value,StorageError>>{
    if !matches!(name,"list_jobs"|"submit_job"|"cancel_job"|"news_state"|"preview_source"|"collect_news"|"organize_news"|"analyze_news"|"cancel_news"){return None;}
    // These commands acquire their own storage lock; never invoke inside with_storage.
    Some((||{let window=app.get_webview_window("main").ok_or_else(||error("主窗口已关闭。"))?;
        tauri::async_runtime::block_on(async{
            match name{
                "list_jobs"=>crate::agent_jobs::agent_jobs(app.clone(),window).await,
                "submit_job"=>{if owner.background{return Err(error("后台任务不能递归提交后台任务。"));}let input=decode(args)?;value(crate::agent_jobs::agent_submit_job(app.clone(),window,input).await?)},
                "cancel_job"=>{let input:Id=decode(args)?;crate::agent_jobs::agent_cancel_job(app.clone(),window,input.id).await?;Ok(json!({"cancelRequested":true}))},
                "news_state"=>{let sources=crate::news_commands::news_snapshot(app.clone(),window.clone()).await?;let processing=crate::news_editorial_commands::news_processing_snapshot(app.clone(),window).await?;Ok(json!({"capture":sources,"processing":processing}))},
                "preview_source"=>{let mut source=args["source"].clone();let fields=source.as_object_mut().ok_or_else(||error("source 必须是对象。"))?;fields.entry("id").or_insert_with(||json!(crate::news_editorial_commands::uuid_value()));let source:crate::news_types::SourceConfig=decode(&source)?;if args.as_object().is_some_and(|v|v.len()!=1){return Err(error("预览工具只接受 source 参数。"));}value(crate::news_commands::preview_news_source(app.clone(),window,source).await?)},
                "collect_news"=>{#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct Input{source_id:Option<String>,range:Option<crate::news_scope::Range>}let input:Input=decode(args)?;value(crate::news_commands::collect_news(app.clone(),window,crate::news_editorial_commands::uuid_value(),input.source_id,input.range).await?)},
                "organize_news"=>{#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Input{kind:String,selection:crate::news_editorial_types::ProcessingSelection}let input:Input=decode(args)?;value(crate::news_editorial_commands::organize_news(app.clone(),window,crate::news_editorial_commands::uuid_value(),input.kind,input.selection).await?)},
                "analyze_news"=>{#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Input{id:String,revision:i64}let input:Input=decode(args)?;value(crate::news_editorial_commands::analyze_news_event(app.clone(),window,input.id,input.revision).await?)},
                "cancel_news"=>{#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Input{kind:String}let input:Input=decode(args)?;match input.kind.as_str(){"capture"=>crate::news_commands::cancel_news_capture(app.clone(),window).await?,"editorial"=>crate::news_editorial_commands::cancel_news_editorial(app.clone(),window).await?,_=>return Err(error("未知资讯任务类型。"))}Ok(json!({"cancelRequested":true}))},
                _=>Err(error("工具未接入。"))
            }
        })
    })())
}
