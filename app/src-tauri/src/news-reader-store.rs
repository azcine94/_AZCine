use rusqlite::{Connection,OptionalExtension,params};
use serde_json::{Value,json};
use crate::{storage::{Store,StorageError},news_reader_types::{Article,PipelineConfig},news_editorial_types::EditorialRun,news_store::now};
pub fn db_error(_:rusqlite::Error)->StorageError{StorageError::new("news_reader_save_failed","文章或步骤回执保存失败，已有内容保留。")}
pub fn encode<T:serde::Serialize>(v:&T)->Result<String,StorageError>{serde_json::to_string(v).map_err(|_|crate::news_editorial_types::invalid_reply())}
pub fn decode<T:serde::de::DeserializeOwned>(v:&str)->Result<T,StorageError>{serde_json::from_str(v).map_err(|_|crate::news_editorial_types::invalid_reply())}
pub fn create_schema(db:&Connection)->Result<(),StorageError>{db.execute_batch("CREATE TABLE news_bodies(material_id TEXT PRIMARY KEY REFERENCES news_materials(id),body TEXT NOT NULL,kind TEXT NOT NULL,error TEXT,fetched_at TEXT NOT NULL) STRICT;
    CREATE TABLE news_articles(id TEXT PRIMARY KEY REFERENCES news_materials(id),payload TEXT NOT NULL,bookmarked INTEGER NOT NULL DEFAULT 0,reading_position REAL NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE news_step_receipts(id INTEGER PRIMARY KEY,cache_key TEXT NOT NULL,attempt INTEGER NOT NULL,run_id TEXT NOT NULL,material_id TEXT NOT NULL,stage TEXT NOT NULL,model TEXT NOT NULL,prompt_hash TEXT NOT NULL,input TEXT NOT NULL,response TEXT,usage TEXT,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,error TEXT,UNIQUE(cache_key,attempt)) STRICT;
    CREATE INDEX news_steps_run ON news_step_receipts(run_id,material_id,id);
    CREATE INDEX news_steps_budget ON news_step_receipts(started_at);
    CREATE INDEX news_articles_story ON news_articles(json_extract(payload,'$.storyId'));
    CREATE TABLE news_story_digests(id TEXT PRIMARY KEY,payload TEXT NOT NULL) STRICT;
    CREATE TABLE news_reader_editions(id TEXT PRIMARY KEY,date TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL) STRICT;").map_err(db_error)}
pub fn validate_schema(db:&Connection)->Result<(),StorageError>{for sql in ["SELECT material_id,body,kind,error,fetched_at FROM news_bodies LIMIT 0","SELECT id,payload,bookmarked,reading_position FROM news_articles LIMIT 0","SELECT id,cache_key,attempt,run_id,material_id,stage,model,prompt_hash,input,response,usage,status,started_at,finished_at,error FROM news_step_receipts LIMIT 0","SELECT id,payload FROM news_story_digests LIMIT 0","SELECT id,date,kind,payload FROM news_reader_editions LIMIT 0"]{db.prepare(sql).map_err(db_error)?;}Ok(())}
pub fn recover(db:&Connection)->Result<(),StorageError>{db.execute("UPDATE news_step_receipts SET status='interrupted',finished_at=?1,error='应用退出时请求尚未确认结束；需要手动重试，未自动重复付费。' WHERE status='running'",[now()]).map_err(db_error)?;Ok(())}
impl Store {
    // Project saved older results into the same reader, without model calls or deleting original records.
    fn reader_sync_legacy(&self)->Result<(),StorageError>{
        let events=self.editorial_events()?;
        if events.is_empty(){return Ok(());}
        let tx=self.db.unchecked_transaction().map_err(db_error)?;
        for event in events{
            if event.materials.is_empty(){continue;}
            let previous:Option<String>=tx.query_row("SELECT payload FROM news_articles WHERE json_extract(payload,'$.legacyEventId')=?1 LIMIT 1",[&event.id],|r|r.get(0)).optional().map_err(db_error)?;
            if previous.as_deref().map(decode::<Article>).transpose()?.is_some_and(|a|a.processed_at==event.generated_at){continue;}
            // A material that already has an article keeps that article and its reader state.
            let mut representative=None;
            for material in &event.materials{
                let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM news_articles WHERE id=?1 AND COALESCE(json_extract(payload,'$.legacyEventId'),'')<>?2)",params![material.id,event.id],|r|r.get(0)).map_err(db_error)?;
                if !exists{representative=Some(material.clone());break;}
            }
            let Some(material)=representative else{continue;};
            let (body,kind,error)=self.reader_body(&material.id)?.unwrap_or_else(||(material.summary.clone().unwrap_or_default(),"summary".into(),None));
            let article=Article{legacy_event_id:Some(event.id.clone()),id:material.id.clone(),material,title_zh:event.draft.title,summary_zh:event.draft.summary,reason:event.draft.reason,category:None,tags:event.draft.tags,subjects:vec![],scope:"unknown".into(),fact:Value::Null,score_first:None,score_second:None,score:Some(f64::from(event.draft.score)),tier:"legacy".into(),selected:event.featured,adds_value:event.draft.has_new_facts,selection_reason:String::new(),occurrence_id:event.id.clone(),story_id:event.id,original_body:body,translated_body:None,body_kind:kind,body_error:error,display_body:true,translation_complete:false,translation_error:None,status:"ready".into(),processed_at:event.generated_at,config_revision:event.config_revision,upstream:format!("saved-editorial-v{}",event.prompt_version)};
            tx.execute("INSERT INTO news_articles(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE json_extract(news_articles.payload,'$.legacyEventId')=?3",params![article.id,encode(&article)?,article.legacy_event_id]).map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;Ok(())
    }

    pub fn reader_body(&self,id:&str)->Result<Option<(String,String,Option<String>)>,StorageError>{self.db.query_row("SELECT body,kind,error FROM news_bodies WHERE material_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_error)}
    pub fn reader_save_body(&self,id:&str,body:&str,kind:&str,error:Option<&str>)->Result<(),StorageError>{self.db.execute("INSERT INTO news_bodies(material_id,body,kind,error,fetched_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(material_id) DO UPDATE SET body=excluded.body,kind=excluded.kind,error=excluded.error,fetched_at=excluded.fetched_at",params![id,body,kind,error,now()]).map_err(db_error)?;Ok(())}
    pub fn reader_article(&self,id:&str)->Result<Article,StorageError>{
        self.reader_sync_legacy()?;
        let raw:Option<String>=self.db.query_row("SELECT payload FROM news_articles WHERE id=?1 OR json_extract(payload,'$.legacyEventId')=?1 LIMIT 1",[id],|r|r.get(0)).optional().map_err(db_error)?;
        if let Some(raw)=raw{return decode(&raw);}
        if id.len()==64{if let Ok(event)=self.editorial_event(id){for material in event.materials{let raw:Option<String>=self.db.query_row("SELECT payload FROM news_articles WHERE id=?1",[material.id],|r|r.get(0)).optional().map_err(db_error)?;if let Some(raw)=raw{return decode(&raw);}}}}
        Err(StorageError::new("news_article_missing","文章尚未完成整理或已不在当前数据目录。"))
    }
    pub fn reader_candidates(&self)->Result<Vec<Article>,StorageError>{let cutoff=(chrono::Utc::now()-chrono::Duration::days(14)).to_rfc3339();let mut q=self.db.prepare("SELECT payload FROM news_articles WHERE json_extract(payload,'$.status')='ready' AND json_extract(payload,'$.processedAt')>=?1 ORDER BY json_extract(payload,'$.processedAt') DESC LIMIT 600").map_err(db_error)?;let rows=q.query_map([cutoff],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;rows.iter().map(|r|decode(r)).collect()}
    pub fn reader_cached_step(&self,key:&str)->Result<Option<String>,StorageError>{self.db.query_row("SELECT response FROM news_step_receipts WHERE cache_key=?1 AND status='completed' ORDER BY attempt DESC LIMIT 1",[key],|r|r.get(0)).optional().map_err(db_error)}
    pub fn reader_failed_response(&self,key:&str)->Result<Option<String>,StorageError>{self.db.query_row("SELECT response FROM news_step_receipts WHERE cache_key=?1 AND status='failed' AND response IS NOT NULL ORDER BY attempt DESC LIMIT 1",[key],|r|r.get(0)).optional().map_err(db_error)}
    pub fn reader_update_translation(&self,article:&Article)->Result<(),StorageError>{
        // Only enrichment fields change. Preserve saved reporting, its date and reading state.
        let updated=self.db.execute("UPDATE news_articles SET payload=json_set(payload,'$.translatedBody',json(?1),'$.translationComplete',json(?2),'$.translationError',json(?3)) WHERE id=?4",params![encode(&article.translated_body)?,encode(&article.translation_complete)?,encode(&article.translation_error)?,article.id]).map_err(db_error)?;
        if updated!=1{return Err(StorageError::new("news_article_missing","待补翻译的报道不存在，未创建替代记录。"));}Ok(())
    }
    pub fn reader_start_step(&mut self,key:&str,run:&str,material:&str,stage:&str,model:&Value,prompt_hash:&str,input:&str,limits:&PipelineConfig,retry:bool)->Result<i64,StorageError>{
        let tx=self.db.transaction().map_err(db_error)?;
        let old:Option<String>=tx.query_row("SELECT status FROM news_step_receipts WHERE cache_key=?1 ORDER BY attempt DESC LIMIT 1",[key],|r|r.get(0)).optional().map_err(db_error)?;
        if old.as_deref()==Some("running"){return Err(StorageError::new("news_step_running","这个步骤仍在执行，没有重复调用模型；请等待任务结束。"));}
        if old.is_some()&&!retry{return Err(StorageError::new("news_step_retry_required","这个步骤已有失败或中断回执，请从原任务手动重试；未自动再次调用模型。"));}
        let at=chrono::Utc::now();for (n,seconds) in [(limits.requests_per_minute,60),(limits.requests_per_hour,3600),(limits.requests_per_day,86400)]{if n>0{let since=(at-chrono::Duration::seconds(seconds)).to_rfc3339_opts(chrono::SecondsFormat::Millis,true);let count:i64=tx.query_row("SELECT count(*) FROM news_step_receipts WHERE started_at>=?1",[since],|r|r.get(0)).map_err(db_error)?;if count>=i64::from(n){return Err(StorageError::new("news_request_quota","模型请求已到所设额度，已完成步骤保留；稍后手动重试或调整额度。"));}}}
        let attempt:i64=tx.query_row("SELECT COALESCE(max(attempt),0)+1 FROM news_step_receipts WHERE cache_key=?1",[key],|r|r.get(0)).map_err(db_error)?;
        tx.execute("INSERT INTO news_step_receipts(cache_key,attempt,run_id,material_id,stage,model,prompt_hash,input,status,started_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'running',?9)",params![key,attempt,run,material,stage,encode(model)?,prompt_hash,input,now()]).map_err(db_error)?;let id=tx.last_insert_rowid();tx.commit().map_err(db_error)?;Ok(id)
    }
    pub fn reader_finish_step(&self,id:i64,response:Option<&str>,usage:&Value,error:Option<&str>)->Result<(),StorageError>{self.db.execute("UPDATE news_step_receipts SET response=?1,usage=?2,status=?3,finished_at=?4,error=?5 WHERE id=?6 AND status='running'",params![response,encode(usage)?,if error.is_some(){"failed"}else{"completed"},now(),error,id]).map_err(db_error)?;Ok(())}
    pub fn reader_commit(&mut self,article:&Article,run:&mut EditorialRun)->Result<(),StorageError>{
        let tx=self.db.transaction().map_err(db_error)?;
        let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM news_processed WHERE material_id=?1)",[&article.id],|r|r.get(0)).map_err(db_error)?;
        if exists{return Ok(());}
        tx.execute("INSERT INTO news_articles(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",params![article.id,encode(article)?]).map_err(db_error)?;
        tx.execute("INSERT INTO news_processed(material_id,event_id,run_id,decision) VALUES(?1,?2,?3,?4)",params![article.id,if article.status=="ready"{Some(&article.occurrence_id)}else{None},run.id,encode(article)?]).map_err(db_error)?;
        let mut next=run.clone();next.processed+=1;tx.execute("UPDATE news_editorial_runs SET payload=?1 WHERE id=?2",params![encode(&next)?,run.id]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;*run=next;Ok(())
    }
    pub fn reader_detail(&self,id:&str)->Result<Value,StorageError>{let article=self.reader_article(id)?;let legacy=article.legacy_event_id.as_deref().map(|id|self.editorial_event(id)).transpose()?;let id=article.id.as_str();let (bookmarked,position):(bool,f64)=self.db.query_row("SELECT bookmarked,reading_position FROM news_articles WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;let mut q=self.db.prepare("SELECT payload FROM news_articles WHERE json_extract(payload,'$.storyId')=?1 AND id<>?2 AND json_extract(payload,'$.status')='ready' ORDER BY json_extract(payload,'$.material.publishedAt'),json_extract(payload,'$.processedAt')").map_err(db_error)?;let related=q.query_map(params![article.story_id,id],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?.iter().map(|raw|{let mut v:Value=decode(raw)?;v.as_object_mut().map(|o|{o.remove("originalBody");o.remove("translatedBody");});Ok(v)}).collect::<Result<Vec<Value>,StorageError>>()?;Ok(json!({"article":article,"legacy":legacy,"bookmarked":bookmarked,"position":position,"related":related,"steps":self.reader_steps(None,Some(id))?}))}
    pub fn reader_steps(&self,run:Option<&str>,material:Option<&str>)->Result<Value,StorageError>{let mut q=self.db.prepare("SELECT id,run_id,material_id,stage,model,prompt_hash,status,started_at,finished_at,usage,error,length(input),length(response) FROM news_step_receipts WHERE (?1 IS NULL OR run_id=?1) AND (?2 IS NULL OR material_id=?2) ORDER BY id DESC LIMIT 300").map_err(db_error)?;let rows=q.query_map(params![run,material],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"runId":r.get::<_,String>(1)?,"materialId":r.get::<_,String>(2)?,"stage":r.get::<_,String>(3)?,"model":r.get::<_,String>(4)?,"promptHash":r.get::<_,String>(5)?,"status":r.get::<_,String>(6)?,"startedAt":r.get::<_,String>(7)?,"finishedAt":r.get::<_,Option<String>>(8)?,"usage":r.get::<_,Option<String>>(9)?,"error":r.get::<_,Option<String>>(10)?,"inputChars":r.get::<_,i64>(11)?,"responseChars":r.get::<_,Option<i64>>(12)?}))).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;Ok(Value::Array(rows))}
    pub fn reader_snapshot(&self,tab:&str,category:&str,query:&str,limit:usize)->Result<Value,StorageError>{
        if !["featured","all","hot","bookmarks"].contains(&tab)||limit>1000||query.chars().count()>300{return Err(crate::news_editorial_types::invalid_reply());}
        self.reader_sync_legacy()?;
        let conditions="json_extract(payload,'$.status')='ready' AND (?1<>'featured' OR json_extract(payload,'$.selected')=1) AND (?1<>'bookmarks' OR bookmarked=1) AND (?2='' OR json_extract(payload,'$.category')=?2 OR EXISTS(SELECT 1 FROM json_each(payload,'$.tags') WHERE value=?2)) AND (?3='' OR instr(lower(json_extract(payload,'$.titleZh')||' '||json_extract(payload,'$.summaryZh')||' '||json_extract(payload,'$.material.sourceName')),lower(?3))>0)";
        let total:i64=self.db.query_row(&format!("SELECT count(*) FROM news_articles WHERE {conditions}"),params![tab,category,query],|r|r.get(0)).map_err(db_error)?;
        let mut q=self.db.prepare(&format!("SELECT json_remove(payload,'$.originalBody','$.translatedBody'),bookmarked FROM news_articles WHERE {conditions} ORDER BY COALESCE(json_extract(payload,'$.material.publishedAt'),json_extract(payload,'$.material.discoveredAt')) DESC,id DESC LIMIT ?4")).map_err(db_error)?;
        let items=q.query_map(params![tab,category,query,limit as i64],|r|Ok((r.get::<_,String>(0)?,r.get::<_,bool>(1)?))).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?.iter().map(|(raw,bookmark)|{let mut v:Value=decode(raw)?;v["bookmarked"]=json!(bookmark);Ok(v)}).collect::<Result<Vec<Value>,StorageError>>()?;
        let mut e=self.db.prepare("SELECT payload FROM news_reader_editions ORDER BY date DESC,rowid DESC LIMIT 60").map_err(db_error)?;let editions=e.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?.iter().map(|r|decode::<Value>(r)).collect::<Result<Vec<_>,_>>()?;
        Ok(json!({"items":items,"total":total,"stories":self.reader_stories()?,"editions":editions,"taxonomy":crate::news_prompts::taxonomy(),"upstream":crate::news_prompts::UPSTREAM}))
    }
    pub fn reader_stories(&self)->Result<Vec<Value>,StorageError>{
        let mut groups=std::collections::BTreeMap::<String,Vec<Article>>::new();for a in self.reader_candidates()?{groups.entry(a.story_id.clone()).or_default().push(a);}
        let mut stories=Vec::new();let at=chrono::Utc::now();for (id,articles) in groups {
            let mut sources=std::collections::BTreeMap::<String,f64>::new();for a in &articles{if let Some(time)=a.material.published_at.as_ref().and_then(|s|chrono::DateTime::parse_from_rfc3339(s).ok()){let age=(at-time.with_timezone(&chrono::Utc)).num_minutes() as f64/60.;if (0.0..=48.0).contains(&age){let weight=2f64.powf(-age/24.);let slot=sources.entry(a.material.source_id.clone()).or_default();*slot=slot.max(weight);}}}
            let heat:f64=sources.values().sum();let digest:Option<String>=self.db.query_row("SELECT payload FROM news_story_digests WHERE id=?1",[&id],|r|r.get(0)).optional().map_err(db_error)?;
            let title=articles.iter().find(|a|a.selected).unwrap_or(&articles[0]).title_zh.clone();
            stories.push(json!({"id":id,"title":title,"digest":digest.map(|v|decode::<Value>(&v)).transpose()?,"heat":heat,"sources":sources.len(),"latestAt":articles.iter().filter_map(|a|a.material.published_at.clone()).max(),"articles":articles.iter().map(|a|json!({"id":a.id,"titleZh":a.title_zh,"summaryZh":a.summary_zh,"sourceName":a.material.source_name,"publishedAt":a.material.published_at,"occurrenceId":a.occurrence_id,"selected":a.selected})).collect::<Vec<_>>()}));
        }stories.sort_by(|a,b|b["heat"].as_f64().unwrap_or(0.).total_cmp(&a["heat"].as_f64().unwrap_or(0.)));Ok(stories)
    }
}
#[tauri::command]
pub async fn news_reader_snapshot(app:tauri::AppHandle,window:tauri::WebviewWindow,tab:String,category:String,query:String,limit:usize)->Result<Value,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|m.store()?.reader_snapshot(&tab,&category,&query,limit)).await}
#[tauri::command]
pub async fn news_article_detail(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String)->Result<Value,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|m.store()?.reader_detail(&id)).await}
#[tauri::command]
pub async fn news_reader_steps(app:tauri::AppHandle,window:tauri::WebviewWindow,run_id:Option<String>)->Result<Value,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|m.store()?.reader_steps(run_id.as_deref(),None)).await}
#[tauri::command]
pub async fn news_reader_step_detail(app:tauri::AppHandle,window:tauri::WebviewWindow,id:i64)->Result<Value,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|m.store()?.db.query_row("SELECT input,response,usage,status,error FROM news_step_receipts WHERE id=?1",[id],|r|Ok(json!({"input":r.get::<_,String>(0)?,"response":r.get::<_,Option<String>>(1)?,"usage":r.get::<_,Option<String>>(2)?,"status":r.get::<_,String>(3)?,"error":r.get::<_,Option<String>>(4)?}))).map_err(db_error)).await}
#[tauri::command]
pub async fn news_reader_mark(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String,bookmarked:Option<bool>,position:Option<f64>)->Result<(),StorageError>{crate::main_window(&window)?;if position.is_some_and(|p|!p.is_finite()||!(0.0..=1.0).contains(&p)){return Err(crate::news_editorial_types::invalid_reply());}crate::with_storage(app,move|m|{let s=m.store()?;let article=s.reader_article(&id)?;let count=s.db.execute("UPDATE news_articles SET bookmarked=COALESCE(?1,bookmarked),reading_position=COALESCE(?2,reading_position) WHERE id=?3",params![bookmarked,position,article.id]).map_err(db_error)?;if count!=1{return Err(StorageError::new("news_article_missing","文章不存在，未保存阅读状态。"));}Ok(())}).await}
