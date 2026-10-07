//! Business objects exposed to Agent. All writes use the same validation and
//! transaction helpers as the normal pages, inside the draft's single transaction.
use crate::{agent_store::{ModuleProvider,ObjectContext,Operation,Providers,Source},storage::StorageError};
use rusqlite::{Connection,OptionalExtension,Transaction,params};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::sync::Arc;

fn invalid(message:&str)->StorageError{StorageError::new("agent_operation_invalid",message)}
fn db(_:rusqlite::Error)->StorageError{StorageError::new("agent_business_storage","业务对象读取或保存失败，原记录与草案保留。")}
fn missing()->StorageError{StorageError::new("agent_baseline_conflict","对象已被修改、移除或不在当前目录，整批草案未应用；请重新读取。")}
fn value<T:serde::Serialize>(v:T)->Result<Value,StorageError>{serde_json::to_value(v).map_err(|_|invalid("业务对象格式无效。"))}
fn decode<T:serde::de::DeserializeOwned>(v:&Value)->Result<T,StorageError>{serde_json::from_value(v.clone()).map_err(|_|invalid("建议字段不完整、类型错误或含有不支持的字段；未保存。"))}
fn request_id(db:&Connection)->Result<String,StorageError>{let s:String=db.query_row("SELECT lower(hex(randomblob(16)))",[],|r|r.get(0)).map_err(self::db)?;Ok(format!("{}-{}-{}-{}-{}",&s[..8],&s[8..12],&s[12..16],&s[16..20],&s[20..]))}
fn ids(db:&Connection,sql:&str)->Result<Vec<(String,String)>,StorageError>{db.prepare(sql).map_err(self::db)?.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).map_err(self::db)?.collect::<Result<Vec<_>,_>>().map_err(self::db)}
fn entry(module:&str,page:String,id:String,title:String)->Value{json!({"source":{"module":module,"page":page,"objectId":id},"title":title})}
fn active_project(tx:&Transaction<'_>,id:Option<&str>)->Result<(),StorageError>{if let Some(id)=id{let found:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id AND deleted=1))",[id],|r|r.get(0)).map_err(db)?;if !found{return Err(invalid("关联公司项目不存在或已移除。"));}}Ok(())}
fn hashed_revision(snapshot:&Value)->Result<i64,StorageError>{let bytes=serde_json::to_vec(snapshot).map_err(|_|invalid("对象版本无法读取。"))?;let hash=Sha256::digest(bytes);let n=u64::from_be_bytes(hash[..8].try_into().unwrap())&((1u64<<52)-1);Ok(n as i64+1)}
fn context(source:&Source,snapshot:Value,operations:&[&str])->Result<ObjectContext,StorageError>{let revision=snapshot["revision"].as_i64().unwrap_or(hashed_revision(&snapshot)?);if !(1..9_007_199_254_740_991).contains(&revision){return Err(invalid("对象版本无效。"));}Ok(ObjectContext{source:source.clone(),revision,snapshot,operations:operations.iter().map(|s|(*s).into()).collect()})}

pub fn registered()->Providers{
    let mut p=Providers::default();
    for module in ["projects","today","ideas","bookkeeping","news","models","jobs"]{p.0.insert(module.into(),Arc::new(BusinessModule(module)));}
    p
}
struct BusinessModule(&'static str);
// This is the application's existing ProjectContent contract, not an Agent
// workflow or prompt. All three project writes expose the same field rules.
fn project_contract(mut description:Value)->Value {
    description["columnRules"]=json!({
        "text":{"maxPerTable":64,"cell":"字符串，最多10000字；允许多列，包括多条版本记录、人员和未明确年份的日期原文"},
        "shot":{"maxPerTable":1,"cell":"字符串，最多200字；其他编号列可使用text"},
        "stage":{"maxPerTable":1,"cell":"空字符串或本项目labels.id；不能填写阶段名称或版本原文"},
        "date":{"maxPerTable":1,"cell":"空字符串或有效完整日期YYYY-MM-DD"},
        "delivered":{"maxPerTable":1,"cell":"只能是空字符串、字符串true或字符串false"},
        "scope":"每张list独立计数；patchTables的新增列与该表已有列一起计数。普通text列可重复使用，不要求合并截图中的版本列。"
    });
    description["constraints"]=json!({
        "name":"非空，最多200字", "labels":"最多100个；名称非空、最多80字，同项目去除首尾空白后不得重名",
        "blocks":"最多200个；title非空、最多200字；kind只允许text、checklist、list",
        "textBlock":"body最多100000字", "checklist":"最多10000项；item.text最多10000字，checked为布尔值",
        "list":"最多64列、10000行；column.name非空、最多200字；可选width为112–640整数",
        "ids":"标签、块、列、行、清单项的id在整个项目内唯一；新id可用本次唯一别名，由应用转换；cells键必须引用本表列id，stage值必须引用本项目标签id",
        "cells":"所有值均为字符串；缺失或空字符串代表未填写，不能用null、数字、布尔值或嵌入图片对象代替",
        "documentBytes":16*1024*1024,
        "patchTables":"1–200张不同的已有表；每表单批最多1000条行修改和64个新列；rowId只能是已有行id或null（追加），每条修改至少一个单元格，同一已有行不能重复；newColumns.key非空最多100 UTF-8字节，不能和已有列id或本次新key重复；新列名称去除首尾空白后不能和该表已有/本次新增列重复"
    });
    description
}
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct TablePatch { tables: Vec<TableEdit> }
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct TableEdit { block_id:String, #[serde(default)] new_columns:Vec<NewColumn>, rows:Vec<RowEdit> }
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct NewColumn { key:String, name:String, kind:crate::projects::ColumnKind }
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct RowEdit { row_id:Option<String>, cells:std::collections::BTreeMap<String,String> }
// Stable generated entity IDs keep the reviewed document identical to the saved document.
fn patch_id(baseline:&ObjectContext,block:&str,kind:&str,index:usize)->String {
    let mut bytes=Sha256::digest(format!("azcine-table:{}:{}:{block}:{kind}:{index}",baseline.source.object_id.as_deref().unwrap_or(""),baseline.revision)).to_vec();
    bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
    let s=bytes[..16].iter().map(|b|format!("{b:02x}")).collect::<String>();
    format!("{}-{}-{}-{}-{}",&s[..8],&s[8..12],&s[12..16],&s[16..20],&s[20..])
}
fn patch_tables(op:&Operation,baseline:&ObjectContext)->Result<Value,StorageError>{
    let patch:TablePatch=decode(&op.values)?;
    if patch.tables.is_empty()||patch.tables.len()>200{return Err(invalid("请指定现有表格，单批最多200张表。"));}
    let mut snapshot=baseline.snapshot.clone();
    if let Some(object)=snapshot.as_object_mut(){object.remove("revision");object.remove("createdAt");object.remove("deleted");}
    let mut doc:crate::projects::ProjectContent=decode(&snapshot)?;
    let mut seen=std::collections::HashSet::new();
    for table in patch.tables {
        if !seen.insert(table.block_id.clone())||table.rows.len()>1000||table.new_columns.len()>64{return Err(invalid("表格不能重复，单批每表最多1000行和64个新增列。"));}
        let block=doc.blocks.iter_mut().find(|b|matches!(b,crate::projects::ProjectBlock::List{id,..} if id==&table.block_id)).ok_or_else(||invalid("目标表格不存在，未写入其他表格。"))?;
        let crate::projects::ProjectBlock::List{columns,rows,..}=block else{unreachable!()};
        let mut aliases=std::collections::BTreeMap::new();
        for (index,column) in table.new_columns.into_iter().enumerate(){
            if column.key.is_empty()||column.key.len()>100||aliases.contains_key(&column.key)||columns.iter().any(|c|c.id==column.key||c.name.trim()==column.name.trim()){return Err(invalid("新增列标识或名称重复，请使用现有列编号；未自行替换列。"));}
            let id=patch_id(baseline,&table.block_id,"column",index);
            aliases.insert(column.key,id.clone());columns.push(crate::projects::ListColumn{id,name:column.name,kind:column.kind,width:None});
        }
        let mut changed=std::collections::HashSet::new();
        for (index,row) in table.rows.into_iter().enumerate(){
            if row.cells.is_empty(){return Err(invalid("行修改需要至少一个明确的单元格。"));}
            let mut cells=std::collections::BTreeMap::new();
            for (key,value) in row.cells {let id=aliases.get(&key).cloned().unwrap_or(key);if !columns.iter().any(|c|c.id==id)||cells.insert(id,value).is_some(){return Err(invalid("单元格列不存在或重复，未猜测列。"));}}
            if let Some(id)=row.row_id {
                if !changed.insert(id.clone()){return Err(invalid("同一行不能重复修改。"));}
                let target=rows.iter_mut().find(|r|r.id==id).ok_or_else(||invalid("目标行不存在，未按行号猜测或覆盖。"))?;target.cells.extend(cells);
            }else{rows.push(crate::projects::ListRow{id:patch_id(baseline,&table.block_id,"row",index),cells});}
        }
    }
    crate::projects::validate_content(&doc)?;value(doc)
}
impl BusinessModule{
    fn project(&self,db:&Connection,id:&str)->Result<crate::projects::ProjectDocument,StorageError>{
        db.query_row("SELECT id,name,content,revision,created_at FROM projects WHERE id=?",[id],crate::projects::document_row).optional().map_err(self::db)?.map(crate::projects::decode_row).transpose()?.ok_or_else(missing)
    }
    fn source(&self,db:&Connection,id:&str)->Result<crate::news_types::Source,StorageError>{db.query_row("SELECT id,config,revision,created_at FROM news_sources WHERE id=?",[id],crate::news_store::source_row).optional().map_err(self::db)?.map(crate::news_store::decode_source).transpose()?.ok_or_else(missing)}
    fn writable_id<'a>(&self,op:&'a Operation,baseline:&ObjectContext)->Result<&'a str,StorageError>{
        if op.module!=self.0||baseline.source.module!=self.0||baseline.source.object_id.as_deref()!=Some(op.object_id.as_str())||!baseline.operations.contains(&op.action){return Err(invalid("操作与附加对象不一致。"));}
        if self.0=="news"{op.object_id.strip_prefix("source:").ok_or_else(||invalid("资讯正文为只读对象，不能改写原文。"))}else{Ok(&op.object_id)}
    }
    fn validate_proposed(&self,tx:&Transaction<'_>,op:&Operation,baseline:&ObjectContext)->Result<Value,StorageError>{
        let id=self.writable_id(op,baseline)?;
        match (self.0,op.action.as_str()){
            (_,"delete"|"restore") if matches!(self.0,"projects"|"today"|"ideas"|"bookkeeping")=>{
                if !op.values.as_object().is_some_and(|v|v.is_empty()){return Err(invalid("删除或恢复不接受其他字段。"));}
                let deleted=baseline.snapshot["deleted"].as_bool().unwrap_or(false);if deleted==(op.action=="delete"){return Err(invalid("对象已经处于该状态，请重新读取。"));}Ok(json!({"deleted":op.action=="delete"}))
            },
            ("ideas","convertToTodo")=>{if !op.values.as_object().is_some_and(|v|v.is_empty())||baseline.snapshot["todoId"].is_string(){return Err(invalid("灵感已转为待办，或参数包含其他字段。"));}Ok(json!({"convertToTodo":true}))},
            ("projects","create")=>{let content:crate::projects::ProjectContent=decode(&op.values)?;if content.id!=id{return Err(invalid("项目编号无效。"));}crate::projects::validate_content(&content)?;value(content)},
            ("ideas","create")=>{let content:crate::ideas::IdeaContent=decode(&op.values)?;if content.id!=id{return Err(invalid("灵感编号无效。"));}crate::ideas::validate(&crate::ideas::SaveIdea{request_id:id.into(),expected_revision:None,content:content.clone()})?;active_project(tx,content.project_id.as_deref())?;value(content)},
            ("today","create")=>{let input:crate::storage::CreateTodo=decode(&op.values)?;if input.id!=id{return Err(invalid("待办编号无效。"));}crate::storage::validate_todo_creation(tx,&input)?;Ok(op.values.clone())},
            ("bookkeeping","create")=>{let content:crate::bookkeeping::Content=decode(&op.values)?;if content.id!=id{return Err(invalid("开销编号无效。"));}crate::bookkeeping::validate_save(tx,None,&content)?;value(content)},
            ("news","create")=>{let mut source:crate::news_types::SourceConfig=decode(&op.values)?;if source.id!=id{return Err(invalid("信源编号无效。"));}source.name=source.name.trim().into();source.feed_url=crate::news_http::public_url(source.feed_url.trim())?.to_string();crate::news_types::validate_source(&source)?;let duplicate:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM news_sources WHERE name_key=?)",[source.name.to_lowercase()],|r|r.get(0)).map_err(db)?;if duplicate{return Err(invalid("已有同名信源。"));}value(source)},
            ("projects","patchTables")=>patch_tables(op,baseline),
            ("projects","update")=>{let doc:crate::projects::ProjectContent=decode(&op.values)?;if doc.id!=id{return Err(invalid("不能替换公司项目编号。"));}crate::projects::validate_content(&doc)?;value(doc)},
            ("ideas","update")=>{let content:crate::ideas::IdeaContent=decode(&op.values)?;if content.id!=id{return Err(invalid("不能替换灵感编号。"));}crate::ideas::validate(&crate::ideas::SaveIdea{request_id:id.into(),expected_revision:Some(baseline.revision),content:content.clone()})?;if let Some(project)=&content.project_id{let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id AND deleted=1))",[project],|r|r.get(0)).map_err(db)?;if !exists{return Err(invalid("关联公司不存在或已移除。"));}}value(content)},
            ("today","setCompleted")=>{#[derive(serde::Deserialize,serde::Serialize)]#[serde(deny_unknown_fields)]struct Completed{completed:bool}let completed:Completed=decode(&op.values)?;value(completed)},
            ("bookkeeping","update")=>{let content:crate::bookkeeping::Content=decode(&op.values)?;if content.id!=id{return Err(invalid("不能替换开销编号。"));}crate::bookkeeping::validate_save(tx,Some(baseline.revision),&content)?;value(content)},
            ("bookkeeping","setStatus")=>{#[derive(serde::Deserialize,serde::Serialize)]#[serde(deny_unknown_fields)]struct State{status:crate::bookkeeping::Status}let state:State=decode(&op.values)?;crate::bookkeeping::validate_status(tx,&crate::bookkeeping::Target{id:id.into(),revision:baseline.revision},state.status)?;value(state)},
            ("news","updateSource")=>{let mut source:crate::news_types::SourceConfig=decode(&op.values)?;if source.id!=id{return Err(invalid("不能替换信源编号。"));}source.name=source.name.trim().into();source.feed_url=crate::news_http::public_url(source.feed_url.trim())?.to_string();crate::news_types::validate_source(&source)?;let duplicate:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM news_sources WHERE name_key=? AND id!=?)",params![source.name.to_lowercase(),id],|r|r.get(0)).map_err(db)?;if duplicate{return Err(invalid("已有相同名称的信源。"));}value(source)},
            _=>Err(invalid("此对象没有提供该操作。"))
        }
    }
}
impl ModuleProvider for BusinessModule{
    fn new_object_id(&self,id:&str)->String{if self.0=="news"{format!("source:{id}")}else{id.into()}}
    fn prepare_values(&self,action:&str,object_id:&str,revision:Option<i64>,mut values:Value)->Result<Value,StorageError>{
        if action=="create"{let id=if self.0=="news"{object_id.strip_prefix("source:").ok_or_else(||invalid("信源标识无效。"))?}else{object_id};values.as_object_mut().ok_or_else(||invalid("values 必须是对象。"))?.insert("id".into(),json!(id));}
        if self.0=="projects"&&matches!(action,"create"|"update"){if action=="update"{if let Some(fields)=values.as_object_mut(){for key in ["revision","createdAt","deleted"]{fields.remove(key);}}}normalize_project(&mut values,&format!("{object_id}:{}",revision.unwrap_or(0)))?;}
        Ok(values)
    }
    fn actions(&self)->Vec<String>{match self.0{"projects"=>vec!["create","update","patchTables","delete","restore"],"today"=>vec!["create","setCompleted","delete","restore"],"ideas"=>vec!["create","update","convertToTodo","delete","restore"],"bookkeeping"=>vec!["create","update","setStatus","delete","restore"],"news"=>vec!["create","updateSource"],_=>vec![]}.into_iter().map(str::to_owned).collect()}
    fn creation(&self,tx:&Transaction<'_>,op:&Operation)->Result<ObjectContext,StorageError>{
        if op.action!="create"||op.module!=self.0||!self.actions().contains(&op.action){return Err(invalid("此模块没有提供创建操作。"));}
        let id=if self.0=="news"{op.object_id.strip_prefix("source:").ok_or_else(||invalid("新信源标识无效。"))?}else{op.object_id.as_str()};
        let sql=match self.0{"projects"=>"SELECT EXISTS(SELECT 1 FROM projects WHERE id=?)","today"=>"SELECT EXISTS(SELECT 1 FROM todos WHERE id=?)","ideas"=>"SELECT EXISTS(SELECT 1 FROM ideas WHERE id=?)","bookkeeping"=>"SELECT EXISTS(SELECT 1 FROM bookkeeping_expenses WHERE id=?)","news"=>"SELECT EXISTS(SELECT 1 FROM news_sources WHERE id=?)",_=>return Err(invalid("此模块没有提供创建操作。"))};
        let exists:bool=tx.query_row(sql,[id],|r|r.get(0)).map_err(db)?;if exists{return Err(missing());}
        Ok(ObjectContext{source:Source{module:self.0.into(),page:self.0.into(),object_id:Some(op.object_id.clone())},revision:0,snapshot:Value::Null,operations:vec!["create".into()]})
    }
    fn list_deleted(&self,tx:&Transaction<'_>)->Result<Vec<Value>,StorageError>{
        let sql=match self.0{"projects"=>"SELECT id,name FROM projects WHERE EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id AND deleted=1) ORDER BY created_at DESC,id","today"=>"SELECT id,title FROM todos WHERE deleted=1 ORDER BY created_at DESC,id","ideas"=>"SELECT id,CASE WHEN length(trim(title))>0 THEN title ELSE substr(body,1,80) END FROM ideas WHERE deleted=1 ORDER BY updated_at DESC,id","bookkeeping"=>"SELECT id,date||' · '||purpose FROM bookkeeping_expenses WHERE deleted=1 ORDER BY date DESC,created_at DESC,id",_=>return Ok(vec![])};
        Ok(ids(tx,sql)?.into_iter().map(|(id,title)|{let mut v=entry(self.0,format!("{}/{id}",self.0),id,title);v["deleted"]=json!(true);v}).collect())
    }
    fn list(&self,tx:&Transaction<'_>)->Result<Vec<Value>,StorageError>{
        let mut out=Vec::new();
        match self.0{
            "projects"=>for(id,title)in ids(tx,"SELECT id,name FROM projects WHERE NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=projects.id AND deleted=1) ORDER BY created_at DESC,id")?{out.push(entry(self.0,format!("projects/{id}"),id,title));},
            "today"=>for(id,title)in ids(tx,"SELECT id,title FROM todos WHERE deleted=0 ORDER BY completed,due_date,created_at DESC,id")?{out.push(entry(self.0,format!("today/{id}"),id,title));},
            "ideas"=>for(id,title)in ids(tx,"SELECT id,CASE WHEN length(trim(title))>0 THEN title ELSE substr(body,1,80) END FROM ideas WHERE deleted=0 ORDER BY updated_at DESC,id")?{out.push(entry(self.0,format!("ideas/{id}"),id,title));},
            "bookkeeping"=>for(id,title)in ids(tx,"SELECT id,date||' · '||purpose FROM bookkeeping_expenses WHERE deleted=0 ORDER BY date DESC,created_at DESC,id")?{out.push(entry(self.0,format!("bookkeeping/{id}"),id,title));},
            "news"=>{
                for(id,title)in ids(tx,"SELECT id,json_extract(config,'$.name') FROM news_sources ORDER BY created_at,id")?{out.push(entry(self.0,format!("settings/news/sources/{id}"),format!("source:{id}"),format!("信源 · {title}")));}
                for(id,title)in ids(tx,"SELECT id,COALESCE(json_extract(payload,'$.titleZh'),json_extract(payload,'$.material.title'),'文章') FROM news_articles ORDER BY json_extract(payload,'$.processedAt') DESC,id")?{out.push(entry(self.0,format!("news/items/{id}"),format!("article:{id}"),title));}
                for(id,title)in ids(tx,"SELECT id,title FROM news_materials WHERE NOT EXISTS(SELECT 1 FROM news_articles WHERE news_articles.id=news_materials.id) ORDER BY discovered_at DESC,id")?{out.push(entry(self.0,"news".into(),format!("material:{id}"),format!("原始材料 · {title}")));}
                for(id,title)in ids(tx,"SELECT id,COALESCE(json_extract(payload,'$.title'),'事件梳理') FROM news_story_digests ORDER BY id")?{out.push(entry(self.0,format!("news/stories/{id}"),format!("story:{id}"),title));}
                for(id,title)in ids(tx,"SELECT id,COALESCE(json_extract(payload,'$.title'),'资讯事件') FROM news_events ORDER BY json_extract(payload,'$.latestAt') DESC,id")?{out.push(entry(self.0,format!("news/events/{id}"),format!("event:{id}"),title));}
            },
            "models"=>for(board,title)in[(crate::model_ranking::Board::Agent,"Agent榜"),(crate::model_ranking::Board::TextToImage,"文生图榜")]{if crate::model_ranking::agent_snapshot(tx,board)?.is_some(){out.push(entry(self.0,"models".into(),board.key().into(),title.into()));}},
            "jobs"=>for(id,title)in ids(tx,"SELECT id,template||' · '||substr(input,1,60) FROM agent_jobs ORDER BY created_at DESC,id")?{out.push(entry(self.0,"jobs".into(),id,title));},
            _=>{}
        }Ok(out)
    }
    fn snapshot(&self,tx:&Transaction<'_>,source:&Source)->Result<ObjectContext,StorageError>{
        source.validate()?;if source.module!=self.0{return Err(invalid("对象模块不匹配。"));}let id=source.object_id.as_deref().ok_or_else(missing)?;
        let (snapshot,actions): (Value,&[&str])=match self.0{
            "projects"=>{let mut doc=value(self.project(tx,id)?)?;let deleted:bool=tx.query_row("SELECT deleted FROM project_deletions WHERE project_id=?",[id],|r|r.get(0)).optional().map_err(db)?.unwrap_or(false);doc["deleted"]=json!(deleted);(doc,if deleted{&["restore"]}else{&["update","patchTables","delete"]})},
            "today"=>{let todo=crate::storage::todo_in(tx,id)?.ok_or_else(missing)?;let deleted:bool=tx.query_row("SELECT deleted FROM todos WHERE id=?",[id],|r|r.get(0)).map_err(db)?;let mut todo=value(todo)?;todo["deleted"]=json!(deleted);(todo,if deleted{&["restore"]}else{&["setCompleted","delete"]})},
            "ideas"=>{let idea=crate::ideas::get(tx,id)?.ok_or_else(missing)?;let deleted=idea.deleted;(value(idea)?,if deleted{&["restore"]}else{&["update","convertToTodo","delete"]})},
            "bookkeeping"=>{let expense=crate::bookkeeping::read(tx,id)?.ok_or_else(missing)?;let deleted=expense.deleted;(value(expense)?,if deleted{&["restore"]}else{&["update","setStatus","delete"]})},
            "news"=>{
                if let Some(id)=id.strip_prefix("source:"){let source=self.source(tx,id)?;(json!({"config":source.config,"revision":source.revision,"createdAt":source.created_at}),&["updateSource"])}else{
                    let (table,key)=if let Some(key)=id.strip_prefix("event:"){("news_events",key)}else if let Some(key)=id.strip_prefix("story:"){("news_story_digests",key)}else if let Some(key)=id.strip_prefix("article:"){("news_articles",key)}else if let Some(key)=id.strip_prefix("material:"){("news_materials",key)}else if source.page.starts_with("news/stories/"){("news_story_digests",id)}else{("news_articles",id)};
                    let snapshot=if table=="news_materials"{tx.query_row("SELECT id,source_id,source_name,title,url,published_at,published_raw,summary,discovered_at FROM news_materials WHERE id=?",[key],|r|Ok(json!({"id":r.get::<_,String>(0)?,"sourceId":r.get::<_,String>(1)?,"sourceName":r.get::<_,String>(2)?,"title":r.get::<_,String>(3)?,"url":r.get::<_,String>(4)?,"publishedAt":r.get::<_,Option<String>>(5)?,"publishedRaw":r.get::<_,Option<String>>(6)?,"summary":r.get::<_,Option<String>>(7)?,"discoveredAt":r.get::<_,String>(8)?}))).optional().map_err(db)?.ok_or_else(missing)?}else{let sql=if table=="news_articles"{"SELECT payload FROM news_articles WHERE id=?1 OR json_extract(payload,'$.legacyEventId')=?1 LIMIT 1".to_owned()}else{format!("SELECT payload FROM {table} WHERE id=?")};let raw:Option<String>=tx.query_row(&sql,[key],|r|r.get(0)).optional().map_err(db)?;serde_json::from_str(&raw.ok_or_else(missing)?).map_err(|_|invalid("资讯记录格式损坏，未用空内容替代。"))?};(snapshot,&[])
                }
            },
            "models"=>{let board=match id{"agent"=>crate::model_ranking::Board::Agent,"text-to-image"=>crate::model_ranking::Board::TextToImage,_=>return Err(missing())};(crate::model_ranking::agent_snapshot(tx,board)?.ok_or_else(missing)?,&[])},
            "jobs"=>{let job=tx.query_row("SELECT id,template,input,parent_id,status,output,error,created_at,finished_at FROM agent_jobs WHERE id=?",[id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"template":r.get::<_,String>(1)?,"input":r.get::<_,String>(2)?,"parentId":r.get::<_,Option<String>>(3)?,"status":r.get::<_,String>(4)?,"output":r.get::<_,Option<String>>(5)?,"error":r.get::<_,Option<String>>(6)?,"createdAt":r.get::<_,String>(7)?,"finishedAt":r.get::<_,Option<String>>(8)?}))).optional().map_err(db)?.ok_or_else(missing)?;(job,&[])},
            _=>return Err(missing())
        };context(source,snapshot,actions)
    }
    fn operation_schema(&self,action:&str)->Value{match(self.0,action){
        (_,"delete"|"restore")=>json!({"values":{},"description":"软删除或恢复记录；需先读取真实对象版本，最终由本人核对应用。"}),
        ("ideas","convertToTodo")=>json!({"values":{},"description":"按现有灵感标题/正文创建关联待办，并保留灵感；不会重复转化。"}),
        ("projects","create")=>project_contract(json!({"values":{"name":"公司项目名","labels":[],"blocks":[]},"required":["name","labels","blocks"],"description":"省略根id，应用生成。labels为{id,name}；blocks：{kind:text,id,title,body}，{kind:checklist,id,title,items:[{id,text,checked}]}，{kind:list,id,title,included,columns:[{id,name,kind,width?}],rows:[{id,cells:{列id:字符串}}]}。included和checked为布尔值。先按columnRules选择类型，保留用户原表列结构：多条版本/日期原文可以分别建text列，只有明确的当前阶段才用stage列。新实体id可用本次别名，应用统一换为稳定UUID；cells与阶段引用使用对应别名。"})),
        ("today","create")=>json!({"values":{"title":"待办标题","dueDate":"YYYY-MM-DD或null","projectId":"已有项目id或null"}}),
        ("ideas","create")=>json!({"values":{"title":"标题，可空","body":"必填正文","tags":[],"projectId":null}}),
        ("bookkeeping","create")=>json!({"values":{"date":"YYYY-MM-DD","purpose":"用途","amountFen":"整数人民币分","note":"备注","status":"unclaimed/pending","receiptIds":[],"exchange":null}}),
        ("news","create")=>json!({"values":{"name":"信源名","feedUrl":"公开RSS/Atom URL","identity":"official/research/media/individual","domains":["frontiers/industry/visual"],"usage":"editorial/watch","intervalMinutes":"合法频率整数","enabled":"boolean"}}),
        ("projects","patchTables")=>project_contract(json!({"description":"修改已有镜头表，无关块、行和单元格自动保留。blockId、rowId、已有列的cells键必须使用snapshot中的稳定id，不用行号或列名。rowId为null表示追加行；已有空行可指定原rowId。cells可使用newColumns.key引用新列，类型与已有列一起遵守columnRules；不为了限制而合并用户的原文列，可分别使用text。新增内部UUID由应用生成。无法确认的字段保留并放入decisions。", "values":{"tables":[{"blockId":"snapshot已有list块id","newColumns":[{"key":"本次新列别名","name":"列名","kind":"text/shot/stage/date/delivered"}],"rows":[{"rowId":"已有行id或null","cells":{"已有列id或新列key":"明确的单元格字符串"}}]}]}})),
        ("projects","update")=>project_contract(json!({"description":"完整 ProjectContent：{id,name,labels:[{id,name}],blocks:[文字/清单/list]}。保留未修改字段和稳定ID；新增实体可用本次唯一别名，由应用换为稳定UUID。结构与类型遵守columnRules和constraints；多条版本原文可分别用text列，不能猜日期/阶段/编号。","required":["id","name","labels","blocks"],"values":"snapshot 去掉 revision、createdAt、deleted；按明确请求修改"})),
        ("ideas","update")=>json!({"values":{"id":"原id","title":"标题，可空","body":"必填正文","tags":["标签"],"projectId":"已有公司id或null"}}),
        ("today","setCompleted")=>json!({"values":{"completed":"boolean"}}),
        ("bookkeeping","update")=>json!({"values":{"id":"原id","date":"YYYY-MM-DD","purpose":"用途","amountFen":"整数人民币分","note":"备注","status":"unclaimed/pending/submitted/paid","receiptIds":["现有票据id"],"exchange":"原有汇率快照或null"},"description":"沿用原记账校验；不能伪造票据/汇率，已提交或到账修改金额需先退回待提交。"}),
        ("bookkeeping","setStatus")=>json!({"values":{"status":"pending/submitted/paid"},"description":"仅允许原报销状态转换；到账表示本人记录到账，不执行转账。"}),
        ("news","updateSource")=>json!({"values":{"id":"snapshot.config.id","name":"信源名","feedUrl":"公开RSS/Atom URL","identity":"official/research/media/individual","domains":["frontiers/industry/visual"],"usage":"editorial/watch","intervalMinutes":"合法频率整数","enabled":"boolean"},"description":"只改下一轮配置，不采集、不重写历史刊期。"}),
        _=>Value::Null
    }}
    fn validate(&self,tx:&Transaction<'_>,op:&Operation,baseline:&ObjectContext)->Result<Value,StorageError>{let proposed=self.validate_proposed(tx,op,baseline)?;Ok(json!({"title":baseline.snapshot["name"].as_str().or(baseline.snapshot["title"].as_str()).or(baseline.snapshot["purpose"].as_str()).or(baseline.snapshot["config"]["name"].as_str()).or(proposed["name"].as_str()).or(proposed["title"].as_str()).or(proposed["purpose"].as_str()).unwrap_or(&op.object_id),"actionLabel":match op.action.as_str(){"create"=>"新建记录","delete"=>"移入回收站","restore"=>"恢复记录","convertToTodo"=>"转为待办","update"=>"更新内容","patchTables"=>"修改镜头表","setCompleted"=>"更改待办完成状态","setStatus"=>"更改报销状态","updateSource"=>"更新信源配置",_=>"变更"},"after":proposed}))}
    fn apply(&self,tx:&Transaction<'_>,op:&Operation,baseline:&ObjectContext)->Result<Value,StorageError>{
        let proposed=self.validate_proposed(tx,op,baseline)?;let request=request_id(tx)?;
        let saved=match(self.0,op.action.as_str()){
            ("projects","create")=>value(crate::projects::save_project_in(tx,crate::projects::SaveProject{request_id:request,expected_revision:None,document:decode(&proposed)?})?)?,
            ("today","create")=>value(crate::storage::create_todo_in(tx,decode(&proposed)?)?)?,
            ("ideas","create")=>value(crate::ideas::save_idea_in(tx,crate::ideas::SaveIdea{request_id:request,expected_revision:None,content:decode(&proposed)?})?)?,
            ("bookkeeping","create")=>value(crate::bookkeeping::mutate_in(tx,crate::bookkeeping::Mutation::Save{request_id:request,expected_revision:None,content:decode(&proposed)?})?)?,
            ("news","create")=>value(crate::news_store::save_source_in(tx,crate::news_types::SaveSource{request_id:request,expected_revision:None,source:decode(&proposed)?})?)?,
            ("projects","delete"|"restore")=>value(crate::projects::set_project_deleted_in(tx,crate::projects::DeleteProject{request_id:request,project_id:op.object_id.clone(),expected_revision:baseline.revision,deleted:op.action=="delete"})?)?,
            ("today","delete"|"restore")=>crate::storage::set_todo_deleted_in(tx,&op.object_id,baseline.revision,op.action=="delete")?,
            ("ideas","delete"|"restore")=>value(crate::ideas::set_idea_deleted_in(tx,&op.object_id,baseline.revision,op.action=="delete")?)?,
            ("ideas","convertToTodo")=>value(crate::ideas::convert_idea_in(tx,&op.object_id,baseline.revision)?)?,
            ("bookkeeping","delete"|"restore")=>value(crate::bookkeeping::mutate_in(tx,crate::bookkeeping::Mutation::Delete{request_id:request,target:crate::bookkeeping::Target{id:op.object_id.clone(),revision:baseline.revision},deleted:op.action=="delete"})?)?,
            ("projects","update"|"patchTables")=>value(crate::projects::save_project_in(tx,crate::projects::SaveProject{request_id:request,expected_revision:Some(baseline.revision),document:decode(&proposed)?})?)?,
            ("ideas","update")=>value(crate::ideas::save_idea_in(tx,crate::ideas::SaveIdea{request_id:request,expected_revision:Some(baseline.revision),content:decode(&proposed)?})?)?,
            ("today","setCompleted")=>value(crate::storage::complete_todo_in(tx,&op.object_id,baseline.revision,proposed["completed"].as_bool().ok_or_else(||invalid("完成状态无效。"))?)?)?,
            ("bookkeeping","update")=>value(crate::bookkeeping::mutate_in(tx,crate::bookkeeping::Mutation::Save{request_id:request,expected_revision:Some(baseline.revision),content:decode(&proposed)?})?)?,
            ("bookkeeping","setStatus")=>value(crate::bookkeeping::mutate_in(tx,crate::bookkeeping::Mutation::Status{request_id:request,targets:vec![crate::bookkeeping::Target{id:op.object_id.clone(),revision:baseline.revision}],status:decode(&proposed["status"])?})?)?,
            ("news","updateSource")=>value(crate::news_store::save_source_in(tx,crate::news_types::SaveSource{request_id:request,expected_revision:Some(baseline.revision),source:decode(&proposed)?})?)?,
            _=>return Err(invalid("此对象没有提供该操作。"))
        };Ok(json!({"module":op.module,"objectId":op.object_id,"action":op.action,"saved":saved}))
    }
}

fn normalize_project(value:&mut Value,root:&str)->Result<(),StorageError>{
    let mut aliases=std::collections::BTreeMap::new();
    fn visit(value:&mut Value,path:&str,root:&str,aliases:&mut std::collections::BTreeMap<String,String>)->Result<(),StorageError>{
        match value{Value::Object(object)=>{if path!="root"&&path.rsplit('.').next().is_some_and(|s|s.parse::<usize>().is_ok()){object.entry("id").or_insert_with(||json!(format!("@{path}")));if let Some(id)=object.get_mut("id"){let alias=id.as_str().ok_or_else(||invalid("新实体标识必须是字符串别名。"))?.to_owned();if crate::bookkeeping::uuid(&alias){aliases.insert(alias.clone(),alias.clone());}else{if aliases.contains_key(&alias){return Err(invalid("新实体别名重复。"));}let bytes=Sha256::digest(format!("{root}:{path}"));let text=bytes[..16].iter().map(|b|format!("{b:02x}")).collect::<String>();let generated=format!("{}-{}-{}-{}-{}",&text[..8],&text[8..12],&text[12..16],&text[16..20],&text[20..]);aliases.insert(alias,generated.clone());*id=json!(generated);}}}for (key,item) in object{visit(item,&format!("{path}.{key}"),root,aliases)?;}},Value::Array(items)=>for(index,item)in items.iter_mut().enumerate(){visit(item,&format!("{path}.{index}"),root,aliases)?;},_=>{}}Ok(())
    }
    visit(value,"root",root,&mut aliases)?;
    if let Some(blocks)=value.get_mut("blocks").and_then(Value::as_array_mut){
        for block in blocks{
            if block["kind"]!="list"{continue;}
            let stages=block["columns"].as_array().into_iter().flatten()
                .filter(|column|column["kind"]=="stage")
                .filter_map(|column|column["id"].as_str().map(str::to_owned))
                .collect::<std::collections::HashSet<_>>();
            if let Some(rows)=block.get_mut("rows").and_then(Value::as_array_mut){
                for row in rows{
                    if let Some(cells)=row.get_mut("cells").and_then(Value::as_object_mut){
                        for(key,mut val)in std::mem::take(cells){
                            let key=aliases.get(&key).cloned().unwrap_or(key);
                            if stages.contains(&key){if let Some(id)=val.as_str().and_then(|s|aliases.get(s)){val=json!(id);}}
                            if cells.insert(key,val).is_some(){return Err(invalid("单元格重复引用同一列。"));}
                        }
                    }
                }
            }
        }
    }Ok(())
}
