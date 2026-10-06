//! AIHOT daily selection is deterministic; period editions ask a model only for introductions.
use std::collections::{BTreeMap,BTreeSet};
use chrono::{Datelike,Timelike};
use serde_json::{Value,json};
use rusqlite::{params,OptionalExtension};
use crate::{storage::{Store,StorageError},news_editorial_types::{EditorialRun,invalid_reply},news_reader_types::Article,news_reader_store::{db_error,encode,decode}};
fn cutoff(at:chrono::DateTime<chrono::Utc>)->chrono::DateTime<chrono::Utc>{let local=at+chrono::Duration::hours(8);let date=local.date_naive()-chrono::Duration::days(if local.hour()<8{1}else{0});date.and_hms_opt(8,0,0).expect("daily cutoff").and_utc()-chrono::Duration::hours(8)}
fn articles(s:&Store)->Result<Vec<Article>,StorageError>{let mut q=s.db.prepare("SELECT payload FROM news_articles WHERE json_extract(payload,'$.status')='ready'").map_err(db_error)?;let rows=q.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;rows.iter().map(|v|decode(v)).collect()}
fn time(s:&str)->Option<chrono::DateTime<chrono::Utc>>{chrono::DateTime::parse_from_rfc3339(s).ok().map(|v|v.with_timezone(&chrono::Utc))}
fn listed(a:&Article,start:chrono::DateTime<chrono::Utc>,end:chrono::DateTime<chrono::Utc>)->bool{let arrival=time(a.material.published_at.as_deref().unwrap_or(&a.material.discovered_at));let release=time(&a.processed_at);arrival.zip(release).is_some_and(|(arrival,release)|arrival>=start-chrono::Duration::days(1)&&arrival.max(release)>=start&&arrival.max(release)<end)}
fn short(a:&Article)->Value{json!({"id":a.id,"titleZh":a.title_zh,"summaryZh":a.summary_zh,"sourceName":a.material.source_name,"sourceId":a.material.source_id,"url":a.material.url,"publishedAt":a.material.published_at,"category":a.category,"tags":a.tags,"score":a.score,"storyId":a.story_id,"occurrenceId":a.occurrence_id,"official":a.tier=="T1"})}
fn representative(rows:&[Article])->&Article{rows.iter().min_by(|a,b|(if a.tier=="T1"{0}else if a.tier=="T1_5"{1}else{2}).cmp(&(if b.tier=="T1"{0}else if b.tier=="T1_5"{1}else{2})).then(b.selected.cmp(&a.selected)).then(b.score.unwrap_or(0.).total_cmp(&a.score.unwrap_or(0.))).then(a.id.cmp(&b.id))).expect("nonempty reports")}
pub fn daily(s:&mut Store,run:&EditorialRun)->Result<Value,StorageError>{
    if let Some(v)=s.db.query_row("SELECT payload FROM news_reader_editions WHERE id=?1",[&run.id],|r|r.get::<_,String>(0)).optional().map_err(db_error)?{return decode(&v);}
    let end=cutoff(time(&run.started_at).ok_or_else(invalid_reply)?);let start=end-chrono::Duration::days(1);let date=(end+chrono::Duration::hours(8)).format("%Y-%m-%d").to_string();let pool=articles(s)?;
    let mut memory=BTreeMap::<String,BTreeSet<String>>::new();let mut prior=s.db.prepare("SELECT payload FROM news_reader_editions WHERE kind='daily' AND date>=?1 AND date<?2").map_err(db_error)?;let since=(end-chrono::Duration::days(7)+chrono::Duration::hours(8)).format("%Y-%m-%d").to_string();
    for raw in prior.query_map(params![since,date],|r|r.get::<_,String>(0)).map_err(db_error)?{let v:Value=decode(&raw.map_err(db_error)?)?;for key in ["main","flashes"]{if let Some(entries)=v[key].as_array(){for e in entries{if let (Some(story),Some(occurrence))=(e["storyId"].as_str(),e["occurrenceId"].as_str()){memory.entry(story.into()).or_default().insert(occurrence.into());}}}}}drop(prior);
    let mut groups=BTreeMap::<String,Vec<Article>>::new();for a in pool.iter().filter(|a|listed(a,start,end)&&a.tier!="EXCLUDE_MP"){groups.entry(a.story_id.clone()).or_default().push(a.clone());}
    let mut ranked=Vec::<(f64,Value,bool)>::new();let mut suppressed=0;
    for (story,rows) in groups {let sources=rows.iter().map(|a|a.material.source_id.clone()).collect::<BTreeSet<_>>();let official=rows.iter().any(|a|a.tier=="T1");let selected=rows.iter().any(|a|a.selected);if !selected&&!(official&&sources.len()>=3){continue;}
        let previous=memory.get(&story);let mut eligible=rows.iter().filter(|a|previous.is_none_or(|seen|!seen.contains(&a.occurrence_id))).cloned().collect::<Vec<_>>();
        if eligible.is_empty(){suppressed+=1;continue;}let rep=representative(&eligible);let score=rows.iter().filter(|a|a.selected).filter_map(|a|a.score).max_by(f64::total_cmp).unwrap_or(50.);
        let importance=score+5.*(1.+sources.len() as f64).log2()+if official{5.}else{0.}-if previous.is_some(){6.}else{0.};
        let full=previous.is_none()||sources.len()>=4||(rep.tier=="T1"&&!matches!(rep.category.as_deref(),Some("tip"|"opinion")));
        let mut entry=short(rep);entry["sources"]=json!(sources.len());entry["followUp"]=json!(previous.is_some());entry["fillIn"]=json!(!selected);entry["related"]=json!(rows.iter().filter(|a|a.id!=rep.id).map(short).collect::<Vec<_>>());ranked.push((importance,entry,full));eligible.clear();
    }
    ranked.sort_by(|a,b|b.0.total_cmp(&a.0).then(a.1["id"].as_str().cmp(&b.1["id"].as_str())));let mut main=Vec::new();let mut rest=Vec::new();let mut per_source=BTreeMap::<String,usize>::new();
    for (_,entry,full) in ranked {let source=entry["sourceId"].as_str().unwrap_or_default().to_owned();let count=per_source.entry(source).or_default();if full&&main.len()<12&&*count<2{*count+=1;main.push(entry);}else{rest.push(entry);}}
    let flashes=rest.into_iter().take(10).collect::<Vec<_>>();let gaps=run.sources.iter().filter(|src|src.config.enabled&&src.last_success_at.as_ref().is_none_or(|v|time(v).is_none_or(|v|v<start))).map(|src|format!("{}：本窗口内未确认成功采集",src.config.name)).collect::<Vec<_>>();
    let v=json!({"id":run.id,"kind":"daily","date":date,"windowStart":start.to_rfc3339(),"windowEnd":end.to_rfc3339(),"generatedAt":crate::news_store::now(),"overview":"","sections":{},"main":main,"flashes":flashes,"suppressed":suppressed,"gaps":gaps,"upstream":crate::news_prompts::UPSTREAM});
    s.db.execute("INSERT INTO news_reader_editions(id,date,kind,payload) VALUES(?1,?2,'daily',?3)",params![run.id,date,encode(&v)?]).map_err(db_error)?;Ok(v)
}
pub async fn period(session:&mut crate::news_pipeline::Session,kind:&str)->Result<Value,StorageError>{
    let existing_id=session.run.id.clone();if let Some(raw)=crate::with_storage(session.app.clone(),move|m|m.store()?.db.query_row("SELECT payload FROM news_reader_editions WHERE id=?1",[existing_id],|r|r.get::<_,String>(0)).optional().map_err(db_error)).await?{return decode(&raw);}
    if !["weekly","monthly"].contains(&kind){return Err(invalid_reply());}let today=(time(&session.run.started_at).ok_or_else(invalid_reply)?+chrono::Duration::hours(8)).date_naive();
    let (start,end,limit)=if kind=="weekly"{let end=today-chrono::Duration::days(i64::from(today.weekday().num_days_from_monday()));(end-chrono::Duration::days(7),end,20)}else{let end=today.with_day(1).ok_or_else(invalid_reply)?;let previous=end-chrono::Duration::days(1);(previous.with_day(1).ok_or_else(invalid_reply)?,end,30)};
    let start_at=start.and_hms_opt(8,0,0).ok_or_else(invalid_reply)?.and_utc()-chrono::Duration::hours(8);let end_at=end.and_hms_opt(8,0,0).ok_or_else(invalid_reply)?.and_utc()-chrono::Duration::hours(8);
    let candidates=crate::with_storage(session.app.clone(),move|m|articles(m.store()?)).await?;let mut selected=candidates.into_iter().filter(|a|a.selected&&listed(a,start_at,end_at)).collect::<Vec<_>>();selected.sort_by(|a,b|b.score.unwrap_or(0.).total_cmp(&a.score.unwrap_or(0.)));let mut occurrences=BTreeSet::new();selected.retain(|a|occurrences.insert(a.occurrence_id.clone()));selected.truncate(limit);for a in &mut selected{a.original_body.clear();a.translated_body=None;}
    let selected_path=crate::news_editorial_commands::cache_path(&session.root,&session.run.id,"period-selected.json")?;if selected_path.try_exists().map_err(|_|invalid_reply())?{selected=crate::news_editorial_commands::read(&selected_path)?;}else{crate::news_editorial_commands::retain(&selected_path,&selected)?;}
    let mut overview=String::new();let mut sections=json!({});
    if !selected.is_empty(){let mut vars=crate::news_prompts::variables();vars["kindName"]=json!(if kind=="weekly"{"周报"}else{"月报"});vars["span"]=json!(if kind=="weekly"{"一周"}else{"一月"});vars["sentences"]=json!(if kind=="weekly"{"3–5句"}else{"4–6句"});vars["chars"]=json!(if kind=="weekly"{300}else{450});vars["sections"]=json!(crate::news_prompts::source("report-period-no-sections")?);vars["sectionsExample"]=json!("{}");
        let response=session.call(&format!("period:{kind}:{start}:{end}"),"periodIntroduction","period","report-period",vars,encode(&selected.iter().map(short).collect::<Vec<_>>())?).await?;let output:Value=crate::news_ai::parse_json(&response)?;
        overview=output["overview"].as_str().filter(|v|v.chars().count()<=2000).ok_or_else(invalid_reply)?.into();sections=output.get("sections").filter(|v|v.is_object()).cloned().ok_or_else(invalid_reply)?;
    }
    let value=json!({"id":session.run.id,"kind":kind,"date":end.to_string(),"windowStart":start_at.to_rfc3339(),"windowEnd":end_at.to_rfc3339(),"generatedAt":crate::news_store::now(),"overview":overview,"sections":sections,"main":selected.iter().map(short).collect::<Vec<_>>(),"flashes":[],"gaps":[],"upstream":crate::news_prompts::UPSTREAM});
    session.cancelled()?;let stored=value.clone();let id=session.run.id.clone();let date=end.to_string();let kind=kind.to_owned();crate::with_storage(session.app.clone(),move|m|{m.store()?.db.execute("INSERT INTO news_reader_editions(id,date,kind,payload) VALUES(?1,?2,?3,?4)",params![id,date,kind,encode(&stored)?]).map_err(db_error)?;Ok(())}).await?;Ok(value)
}
#[derive(serde::Serialize,serde::Deserialize)]
struct PeriodInput {run:EditorialRun,preferences:crate::news_editorial_types::Preferences,kind:String}
pub async fn run_period(app:tauri::AppHandle,kind:String,retry_id:Option<String>)->Result<Value,StorageError>{
    use tauri::Manager as _;
    let _guard=crate::news_editorial_commands::claim(&app)?;
    let (root,prefs,sources)=crate::with_storage(app.clone(),|m|{let s=m.store()?;Ok((s.root.clone(),s.news_preferences()?,s.news_sources()?))}).await?;
    let retry=retry_id.is_some();let id=retry_id.unwrap_or_else(crate::news_editorial_commands::uuid_value);
    if retry{let copy=id.clone();crate::with_storage(app.clone(),move|m|{let s=m.store()?;if s.news_history_hidden(&copy)?{return Err(StorageError::new("news_history_removed","这条处理记录已删除，未重新执行。"));}let run=s.editorial_run(&copy)?;if !matches!(run.status.as_str(),"failed"|"cancelled"|"interrupted"|"awaitingModel"){return Err(StorageError::new("news_retry_not_failed","这个报告任务无需重试。"));}Ok(())}).await?;}
    let path=crate::news_editorial_commands::cache_path(&root,&id,"period-input.json")?;
    let input:PeriodInput=if retry{crate::news_editorial_commands::read(&path)?}else{let at=crate::news_store::now();let run=EditorialRun{id,kind:"organize".into(),status:"running".into(),started_at:at.clone(),finished_at:None,window_start:at.clone(),window_end:at,config_revision:prefs.revision,config:prefs.config.clone(),sources,event_id:None,event_revision:None,total:0,processed:0,error:None,schedule_date:None};let input=PeriodInput{run,preferences:prefs,kind};crate::news_editorial_commands::retain(&path,&input)?;input};
    let mut run=input.run;run.status="running".into();run.error=None;run.finished_at=None;
    let copy=run.clone();crate::with_storage(app.clone(),move|m|m.store()?.save_editorial_run(&copy)).await?;crate::news_processing::begin(&app,&run,1);
    let resources=app.path().resource_dir().map_err(|_|invalid_reply())?;let mut session=crate::news_pipeline::Session::new(app.clone(),root,resources,run.clone(),input.preferences,retry);let mut result=period(&mut session,&input.kind).await;
    if app.state::<crate::news_ai::AiControl>().cancel.load(std::sync::atomic::Ordering::Acquire){result=Err(StorageError::new("news_cancelled","报告生成已取消，已保存内容保留，未报告成功。"));}
    app.state::<crate::news_ai::AiControl>().active.lock().map_err(|_|invalid_reply())?.take();
    match &result {Ok(_)=>crate::news_editorial_commands::finish(&app,&mut run,"completed",None).await?,Err(e)=>{let status=if e.code=="news_cancelled"{"cancelled"}else if e.code=="news_model_unavailable"{"awaitingModel"}else{"failed"};crate::news_editorial_commands::finish(&app,&mut run,status,Some(e.message.clone())).await?;}}
    result
}
#[tauri::command]
pub async fn news_reader_period(app:tauri::AppHandle,window:tauri::WebviewWindow,kind:String)->Result<Value,StorageError>{crate::main_window(&window)?;if !["weekly","monthly"].contains(&kind.as_str()){return Err(invalid_reply());}run_period(app,kind,None).await}
