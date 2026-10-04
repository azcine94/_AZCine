use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use crate::{news_editorial_types::*, news_types::{Material, MAX_REVISION, uuid}, news_store::{now, hash, row_count}, storage::{Store, StorageError}};

fn db_error(_: rusqlite::Error) -> StorageError { StorageError::new("news_editorial_save_failed", "资讯整理记录未能保存，已有事件与刊期保留；请检查磁盘或权限后重试保存。") }
fn encode<T: Serialize>(value: &T) -> Result<String, StorageError> { serde_json::to_string(value).map_err(|_| invalid_reply()) }
fn decode<T: DeserializeOwned>(value: &str) -> Result<T, StorageError> { serde_json::from_str(value).map_err(|_| invalid_reply()) }
pub fn create_schema(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("CREATE TABLE news_preferences(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,config TEXT NOT NULL) STRICT;
    CREATE TABLE news_preference_requests(id TEXT PRIMARY KEY,input TEXT NOT NULL,result TEXT NOT NULL) STRICT;
    CREATE TABLE news_editorial_runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL) STRICT;
    CREATE TABLE news_events(id TEXT PRIMARY KEY,payload TEXT NOT NULL) STRICT;
    CREATE TABLE news_event_versions(id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(id,revision)) STRICT;
    CREATE TABLE news_processed(material_id TEXT PRIMARY KEY REFERENCES news_materials(id),event_id TEXT,run_id TEXT NOT NULL,decision TEXT NOT NULL) STRICT;
    CREATE TABLE news_editions(id TEXT PRIMARY KEY,date TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(date,version)) STRICT;
    CREATE TABLE news_automation_sources(source_id TEXT PRIMARY KEY,last_attempt_at TEXT NOT NULL) STRICT;").map_err(db_error)?;
    db.execute("INSERT INTO news_preferences(id,revision,config) VALUES(1,1,?1)",[encode(&EditorialConfig::default())?]).map_err(db_error)?; Ok(())
}
pub fn validate_schema(db: &Connection) -> Result<(), StorageError> {
    for sql in ["SELECT revision,config FROM news_preferences LIMIT 0", "SELECT id,input,result FROM news_preference_requests LIMIT 0",
        "SELECT id,payload FROM news_editorial_runs LIMIT 0", "SELECT id,payload FROM news_events LIMIT 0",
        "SELECT id,revision,payload FROM news_event_versions LIMIT 0", "SELECT material_id,event_id,run_id,decision FROM news_processed LIMIT 0",
        "SELECT id,date,version,payload FROM news_editions LIMIT 0", "SELECT source_id,last_attempt_at FROM news_automation_sources LIMIT 0"] {
        db.prepare(sql).map_err(db_error)?;
    } Ok(())
}
pub fn recover(db: &Connection) -> Result<(), StorageError> {
    let mut query=db.prepare("SELECT id,payload FROM news_editorial_runs").map_err(db_error)?;
    let rows=query.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    for (id,payload) in rows { let mut run: EditorialRun=decode(&payload)?;
        if matches!(run.status.as_str(),"running"|"saving") { run.status="interrupted".into();run.finished_at=Some(now());run.error=Some("上次资讯任务中断或终态未保存；已完成结果保留，未发布结果保留在快照中，请核对后手动重试。".into());
            db.execute("UPDATE news_editorial_runs SET payload=?1 WHERE id=?2",params![encode(&run)?,id]).map_err(db_error)?; }
    } Ok(())
}
fn material(row:&rusqlite::Row<'_>)->rusqlite::Result<Material> { Ok(Material {
    id:row.get(0)?,source_id:row.get(1)?,source_name:row.get(2)?,source_revision:row.get(3)?,title:row.get(4)?,url:row.get(5)?,
    published_at:row.get(6)?,published_raw:row.get(7)?,discovered_at:row.get(8)?,summary:row.get(9)?,summary_truncated:row.get(10)?,
}) }
const MATERIAL_SELECT:&str="SELECT m.id,m.source_id,m.source_name,m.source_revision,m.title,m.url,m.published_at,m.published_raw,m.discovered_at,m.summary,m.summary_truncated FROM news_materials m";
fn nonempty(value:&str,max:usize)->bool{!value.trim().is_empty()&&value.chars().count()<=max&&!value.contains('\0')}
pub fn validate_reply(reply:&EditorialReply,input:&[Material])->Result<(),StorageError>{
    let ids=input.iter().map(|m|m.id.as_str()).collect::<std::collections::HashSet<_>>();let mut assigned=std::collections::HashSet::new();let mut keys=std::collections::HashSet::new();
    if reply.events.len()>input.len(){return Err(invalid_reply());}
    for event in &reply.events {
        if !keys.insert(&event.event_key)||event.event_key.is_empty()||event.event_key.len()>128||!event.event_key.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-')
            || event.material_ids.is_empty()||event.material_ids.iter().any(|id|!ids.contains(id.as_str())||!assigned.insert(id.as_str()))
            || !nonempty(&event.title,300)||!nonempty(&event.summary,4000)||!nonempty(&event.reason,2000)||event.score>100
            || event.tags.len()>12||event.tags.iter().any(|t|!nonempty(t,60))||event.limitations.len()>20||event.limitations.iter().any(|t|!nonempty(t,2000))
            || event.facts.len()>40||event.domain.is_some()&&event.facts.is_empty()
            || event.facts.iter().any(|f|!nonempty(&f.text,2000)||f.material_ids.is_empty()||f.material_ids.iter().any(|id|!event.material_ids.contains(id))){return Err(invalid_reply());}
    }
    if assigned.len()!=ids.len(){return Err(invalid_reply());} Ok(())
}
pub fn validate_context(reply:&EditorialReply,input:&[Material],sources:&[crate::news_types::Source],known:&[Event])->Result<(),StorageError>{
    validate_reply(reply,input)?;
    for draft in &reply.events {if draft.domain.is_some()&&!draft.has_new_facts&&!known.iter().any(|e|e.draft.event_key==draft.event_key){return Err(invalid_reply());}
        if let Some(domain)=draft.domain{for material in input.iter().filter(|m|draft.material_ids.contains(&m.id)){if sources.iter().find(|s|s.config.id==material.source_id).is_some_and(|s|!s.config.domains.is_empty()&&!s.config.domains.contains(&domain)){return Err(StorageError::new("news_domain_conflict","模型领域与任务开始时的覆盖配置冲突，未缓存或发布此结果；请手动重试。"));}}}
    }Ok(())
}
pub fn validate_analysis(event:&Event,analysis:&EventAnalysis)->Result<(),StorageError>{
    let ids=event.materials.iter().map(|m|&m.id).collect::<Vec<_>>();
    if analysis.judgments.is_empty()||analysis.judgments.len()>30||analysis.limitations.is_empty()||analysis.limitations.len()>20||analysis.limitations.iter().any(|v|!nonempty(v,2000))
        ||analysis.judgments.iter().any(|f|!nonempty(&f.text,3000)||f.material_ids.is_empty()||f.material_ids.iter().any(|id|!ids.contains(&id))){return Err(invalid_reply());}Ok(())
}
impl Store {
    pub fn news_preferences(&self)->Result<Preferences,StorageError>{
        let (revision,config):(i64,String)=self.db.query_row("SELECT revision,config FROM news_preferences WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
        let config=decode(&config)?;validate_config(&config)?;if !(1..=MAX_REVISION).contains(&revision){return Err(invalid_reply());}Ok(Preferences{config,revision})
    }
    pub fn save_news_preferences(&mut self,input:SavePreferences)->Result<Preferences,StorageError>{
        if !uuid(&input.request_id)||!(1..MAX_REVISION).contains(&input.expected_revision){return Err(invalid_reply());}validate_config(&input.config)?;
        let json=encode(&input)?;let tx=self.db.transaction().map_err(db_error)?;
        let previous:Option<(String,String)>=tx.query_row("SELECT input,result FROM news_preference_requests WHERE id=?1",[&input.request_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        if let Some((old,result))=previous {if old!=json{return Err(StorageError::new("request_conflict","请求编号已对应其他配置，未覆盖。请先核对保存。"));}return decode(&result);}
        let result=Preferences{config:input.config,revision:input.expected_revision+1};
        if tx.execute("UPDATE news_preferences SET revision=?1,config=?2 WHERE id=1 AND revision=?3",params![result.revision,encode(&result.config)?,input.expected_revision]).map_err(db_error)?!=1{return Err(StorageError::new("stale_record","资讯规则已更新，草稿保留；请对照最新版本后再保存。"));}
        tx.execute("INSERT INTO news_preference_requests(id,input,result) VALUES(?1,?2,?3)",params![input.request_id,json,encode(&result)?]).map_err(db_error)?;tx.commit().map_err(db_error)?;Ok(result)
    }
    pub fn news_preference_request(&self,id:&str)->Result<Option<Preferences>,StorageError>{
        if !uuid(id){return Err(invalid_reply());}
        self.db.query_row("SELECT result FROM news_preference_requests WHERE id=?1",[id],|r|r.get::<_,String>(0)).optional().map_err(db_error)?.map(|v|decode(&v)).transpose()
    }
    pub fn editorial_candidates(&self,start:&str,end:&str)->Result<Vec<Material>,StorageError>{
        let sql=format!("{MATERIAL_SELECT} WHERE COALESCE(m.published_at,m.discovered_at)>=?1 AND COALESCE(m.published_at,m.discovered_at)<=?2 AND EXISTS(SELECT 1 FROM news_sources s WHERE s.id=m.source_id AND json_extract(s.config,'$.usage')='editorial') AND NOT EXISTS(SELECT 1 FROM news_processed p WHERE p.material_id=m.id) ORDER BY m.discovered_at,m.id");
        let mut query=self.db.prepare(&sql).map_err(db_error)?;
        query.query_map(params![start,end],material).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
    }
    pub fn pending_materials(&self,page:usize,source_id:Option<&str>,query:&str)->Result<crate::news_types::MaterialPage,StorageError>{
        if page>100000||query.chars().count()>200{return Err(invalid_reply());}
        let at=now();let condition="EXISTS(SELECT 1 FROM news_sources s WHERE s.id=m.source_id AND json_extract(s.config,'$.usage')='editorial') AND NOT EXISTS(SELECT 1 FROM news_processed p WHERE p.material_id=m.id) AND (?1 IS NULL OR m.source_id=?1) AND (?2='' OR instr(lower(m.title),lower(?2))>0 OR instr(lower(COALESCE(m.summary,'')),lower(?2))>0) AND COALESCE(m.published_at,m.discovered_at)<=?3";
        let total:usize=self.db.query_row(&format!("SELECT count(*) FROM news_materials m WHERE {condition}"),params![source_id,query,at],|r|row_count(r,0)).map_err(db_error)?;
        let mut rows=self.db.prepare(&format!("{MATERIAL_SELECT} WHERE {condition} ORDER BY m.discovered_at DESC,m.id LIMIT 6 OFFSET ?4")).map_err(db_error)?;
        let items=rows.query_map(params![source_id,query,at,(page*6) as i64],material).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
        Ok(crate::news_types::MaterialPage{items,total,page,page_size:6})
    }
    pub fn pending_daily_total(&self)->Result<usize,StorageError>{
        let end=chrono::Utc::now();let start=end-chrono::Duration::hours(24);
        self.db.query_row("SELECT count(*) FROM news_materials m WHERE COALESCE(m.published_at,m.discovered_at)>=?1 AND COALESCE(m.published_at,m.discovered_at)<=?2 AND EXISTS(SELECT 1 FROM news_sources s WHERE s.id=m.source_id AND json_extract(s.config,'$.usage')='editorial') AND NOT EXISTS(SELECT 1 FROM news_processed p WHERE p.material_id=m.id)",params![start.to_rfc3339_opts(chrono::SecondsFormat::Millis,true),end.to_rfc3339_opts(chrono::SecondsFormat::Millis,true)],|r|row_count(r,0)).map_err(db_error)
    }
    pub fn editorial_events(&self)->Result<Vec<Event>,StorageError>{
        let mut query=self.db.prepare("SELECT payload FROM news_events ORDER BY json_extract(payload,'$.latestAt') DESC,id").map_err(db_error)?;
        let rows=query.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;rows.iter().map(|v|decode(v)).collect()
    }
    pub fn editorial_event(&self,id:&str)->Result<Event,StorageError>{
        let json:String=self.db.query_row("SELECT payload FROM news_events WHERE id=?1",[id],|r|r.get(0)).map_err(db_error)?;decode(&json)
    }
    pub fn editorial_event_version(&self,id:&str,revision:i64)->Result<Event,StorageError>{
        let json:String=self.db.query_row("SELECT payload FROM news_event_versions WHERE id=?1 AND revision=?2",params![id,revision],|r|r.get(0)).map_err(db_error)?;decode(&json)
    }
    pub fn editorial_run(&self,id:&str)->Result<EditorialRun,StorageError>{let value:String=self.db.query_row("SELECT payload FROM news_editorial_runs WHERE id=?1",[id],|r|r.get(0)).map_err(db_error)?;decode(&value)}
    pub fn editorial_run_exists(&self,id:&str)->Result<bool,StorageError>{self.db.query_row("SELECT EXISTS(SELECT 1 FROM news_editorial_runs WHERE id=?1)",[id],|r|r.get(0)).map_err(db_error)}
    pub fn save_editorial_run(&self,run:&EditorialRun)->Result<(),StorageError>{self.db.execute("INSERT INTO news_editorial_runs(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",params![run.id,encode(run)?]).map_err(db_error)?;Ok(())}
    pub fn start_editorial_run(&self,id:&str,kind:&str,date:Option<String>)->Result<(EditorialRun,Preferences,Vec<Material>),StorageError>{
        self.start_selected_editorial_run(id,kind,date,None)
    }
    pub fn start_selected_editorial_run(&self,id:&str,kind:&str,date:Option<String>,selection:Option<&ProcessingSelection>)->Result<(EditorialRun,Preferences,Vec<Material>),StorageError>{
        if let Some(s)=selection{s.validate()?;}
        if !uuid(id)||!matches!(kind,"organize"|"daily"){return Err(invalid_reply());}
        let end=chrono::Utc::now();let start=if kind=="daily"{end-chrono::Duration::hours(24)}else{chrono::DateTime::parse_from_rfc3339("0001-01-01T00:00:00Z").map_err(|_|invalid_reply())?.with_timezone(&chrono::Utc)};let preferences=self.news_preferences()?;
        let mut run=EditorialRun{id:id.into(),kind:kind.into(),status:"running".into(),started_at:now(),finished_at:None,window_start:start.to_rfc3339_opts(chrono::SecondsFormat::Millis,true),window_end:end.to_rfc3339_opts(chrono::SecondsFormat::Millis,true),config_revision:preferences.revision,config:preferences.config.clone(),sources:self.news_sources()?,event_id:None,event_revision:None,total:0,processed:0,error:None,schedule_date:date};
        let mut input=self.editorial_candidates(&run.window_start,&run.window_end)?;
        if let Some(s)=selection { if s.scope=="single" {input.retain(|m|Some(&m.id)==s.material_id.as_ref());if input.len()!=1{return Err(StorageError::new("news_material_not_pending","所选资料已处理或不属于当前待处理范围，请重新读取；没有启动其他资料。"));}} }
        run.total=input.len();self.save_editorial_run(&run)?;Ok((run,preferences,input))
    }
    pub fn save_editorial_batch(&mut self,run:&mut EditorialRun,preferences:&Preferences,input:&[Material],reply:&EditorialReply,model:&ModelChoice)->Result<(),StorageError>{
        validate_reply(reply,input)?;let mut processed=run.processed;let tx=self.db.transaction().map_err(db_error)?;
        for draft in &reply.events {
            // A retained reply can be applied repeatedly without creating another event/version.
            let mut pending=Vec::new();
            for id in &draft.material_ids { if !tx.query_row("SELECT EXISTS(SELECT 1 FROM news_processed WHERE material_id=?1)",[id],|r|r.get::<_,bool>(0)).map_err(db_error)? { pending.push(id.clone()); } }
            if pending.is_empty(){continue;}
            if let Some(domain)=draft.domain {for material in input.iter().filter(|m|draft.material_ids.contains(&m.id)){if preferences.config.domains.iter().any(|r|r.domain==domain&&r.enabled)&&run.sources.iter().find(|s|s.config.id==material.source_id).is_some_and(|s|!s.config.domains.is_empty()&&!s.config.domains.contains(&domain)){return Err(StorageError::new("news_domain_conflict","模型领域与本轮信源覆盖配置冲突，没有发布；请核对规则后重试。"));}}}
            let id=hash(&draft.event_key);let publish=draft.domain.is_some_and(|domain|preferences.config.domains.iter().any(|r|r.domain==domain&&r.enabled));
            if publish {
                let old:Option<String>=tx.query_row("SELECT payload FROM news_events WHERE id=?1",[&id],|r|r.get(0)).optional().map_err(db_error)?;let old=old.map(|v|decode::<Event>(&v)).transpose()?;if old.is_none()&&!draft.has_new_facts{return Err(invalid_reply());}
                let mut materials=old.as_ref().map(|e|e.materials.clone()).unwrap_or_default();for m in input.iter().filter(|m|draft.material_ids.contains(&m.id)){if !materials.iter().any(|v|v.id==m.id){materials.push(m.clone());}}
                let mut combined=draft.clone();combined.material_ids=materials.iter().map(|m|m.id.clone()).collect();
                if let Some(old)=&old {let mut facts=old.draft.facts.clone();for fact in &combined.facts{if let Some(existing)=facts.iter_mut().find(|f|f.text==fact.text){for id in &fact.material_ids{if !existing.material_ids.contains(id){existing.material_ids.push(id.clone());}}}else{facts.push(fact.clone());}}combined.facts=facts;
                    if !draft.has_new_facts{combined=old.draft.clone();combined.material_ids=materials.iter().map(|m|m.id.clone()).collect();}
                }
                let latest_at=if !draft.has_new_facts&&old.is_some(){old.as_ref().unwrap().latest_at.clone()}else{materials.iter().map(|m|m.published_at.as_ref().unwrap_or(&m.discovered_at)).max().cloned().unwrap_or_else(now)};
                let event=Event{id:id.clone(),revision:old.as_ref().map(|e|e.revision+1).unwrap_or(1),draft:combined,materials,generated_at:now(),latest_at,config_revision:preferences.revision,model:model.clone(),prompt_version:PROMPT_VERSION,featured:if !draft.has_new_facts{old.as_ref().is_some_and(|e|e.featured)}else{draft.score>=preferences.config.featured_score},analysis:if !draft.has_new_facts{old.as_ref().and_then(|e|e.analysis.clone())}else{None}};
                let payload=encode(&event)?;tx.execute("INSERT INTO news_event_versions(id,revision,payload) VALUES(?1,?2,?3)",params![id,event.revision,payload]).map_err(db_error)?;
                tx.execute("INSERT INTO news_events(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",params![id,payload]).map_err(db_error)?;
            }
            for material in pending {tx.execute("INSERT INTO news_processed(material_id,event_id,run_id,decision) VALUES(?1,?2,?3,?4)",params![material,if publish{Some(id.clone())}else{None},run.id,encode(draft)?]).map_err(db_error)?;processed+=1;}
        }
        let mut next=run.clone();next.processed=processed;tx.execute("UPDATE news_editorial_runs SET payload=?1 WHERE id=?2",params![encode(&next)?,run.id]).map_err(db_error)?;tx.commit().map_err(db_error)?;*run=next;Ok(())
    }
    pub fn save_event_analysis(&mut self,id:&str,expected:i64,analysis:EventAnalysis)->Result<Event,StorageError>{
        let mut event=self.editorial_event(id)?;if event.revision!=expected{
            if event.revision==expected+1&&event.analysis.as_ref().is_some_and(|previous|encode(previous).ok()==encode(&analysis).ok()){return Ok(event);}
            return Err(StorageError::new("stale_record","事件已有新进展，本次分析未覆盖；请打开新版再分析。"));}
        validate_analysis(&event,&analysis)?;if event.revision>=MAX_REVISION{return Err(invalid_reply());}
        event.analysis=Some(analysis);event.revision+=1;let tx=self.db.transaction().map_err(db_error)?;let payload=encode(&event)?;
        tx.execute("INSERT INTO news_event_versions(id,revision,payload) VALUES(?1,?2,?3)",params![id,event.revision,payload]).map_err(db_error)?;
        tx.execute("UPDATE news_events SET payload=?1 WHERE id=?2",params![payload,id]).map_err(db_error)?;tx.commit().map_err(db_error)?;Ok(event)
    }
    pub fn create_edition(&mut self,run:&EditorialRun,preferences:&Preferences)->Result<Edition,StorageError>{
        if let Some(json)=self.db.query_row("SELECT payload FROM news_editions WHERE id=?1",[&run.id],|r|r.get::<_,String>(0)).optional().map_err(db_error)?{return decode(&json);}
        let mut events=self.editorial_events()?.into_iter().filter(|e|e.latest_at>=run.window_start&&e.latest_at<=run.window_end).collect::<Vec<_>>();
        events.sort_by(|a,b|b.draft.score.cmp(&a.draft.score).then(b.latest_at.cmp(&a.latest_at)).then(a.id.cmp(&b.id)));
        let mut selected=Vec::new();for rule in &preferences.config.domains {if rule.enabled{selected.extend(events.iter().filter(|e|e.draft.domain==Some(rule.domain)&&e.draft.score>=rule.min_score).take(rule.daily_limit).cloned());}}
        let mut ranked=selected.iter().collect::<Vec<_>>();ranked.sort_by(|a,b|b.draft.score.cmp(&a.draft.score).then(b.latest_at.cmp(&a.latest_at)));let overview_ids=ranked.iter().take(preferences.config.overview_limit).map(|e|e.id.clone()).collect();
        let date=run.schedule_date.clone().unwrap_or_else(||(chrono::Utc::now()+chrono::Duration::hours(8)).format("%Y-%m-%d").to_string());
        let mut gaps=run.sources.iter().filter(|s|s.config.enabled&&s.last_status.is_none_or(|v|!matches!(v,crate::news_types::RunStatus::Added|crate::news_types::RunStatus::NoNew))
            ||s.config.enabled&&s.last_success_at.as_ref().is_none_or(|t|t<&run.window_start)).map(|s|format!("{}：{}",s.config.name,s.last_error.as_deref().unwrap_or("本窗口内未有成功采集，覆盖可能不完整"))).collect::<Vec<_>>();
        if !run.sources.iter().any(|s|s.config.enabled){gaps.push("本任务开始时没有启用信源，只依据本机已有材料成刊，未进行新的联网采集。".into());}
        let tx=self.db.transaction().map_err(db_error)?;let version:i64=tx.query_row("SELECT COALESCE(max(version),0)+1 FROM news_editions WHERE date=?1",[&date],|r|r.get(0)).map_err(db_error)?;
        let edition=Edition{id:run.id.clone(),date:date.clone(),version,generated_at:now(),window_start:run.window_start.clone(),window_end:run.window_end.clone(),config_revision:preferences.revision,overview_ids,events:selected,incomplete:!gaps.is_empty(),gaps};
        tx.execute("INSERT INTO news_editions(id,date,version,payload) VALUES(?1,?2,?3,?4)",params![run.id,date,version,encode(&edition)?]).map_err(db_error)?;tx.commit().map_err(db_error)?;Ok(edition)
    }
    pub fn editorial_snapshot(&self)->Result<EditorialSnapshot,StorageError>{
        let preferences=self.news_preferences()?;
        let mut q=self.db.prepare("SELECT payload FROM news_editions ORDER BY date DESC,version DESC").map_err(db_error)?;
        let editions=q.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?.iter().map(|v|decode(v)).collect::<Result<Vec<_>,_>>()?;
        let mut q=self.db.prepare("SELECT payload FROM news_editorial_runs ORDER BY json_extract(payload,'$.startedAt') DESC LIMIT 100").map_err(db_error)?;
        let runs=q.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?.iter().map(|v|decode(v)).collect::<Result<Vec<_>,_>>()?;
        let end=chrono::Utc::now();let pending=self.editorial_candidates("0001-01-01T00:00:00.000Z",&end.to_rfc3339_opts(chrono::SecondsFormat::Millis,true))?.len();
        let next_daily_at=if preferences.config.auto_daily{Some(crate::news_schedule::next_daily(&preferences.config.daily_time,end)?)}else{None};
        Ok(EditorialSnapshot{preferences,events:self.editorial_events()?,editions,runs,pending,next_daily_at})
    }
    pub fn scheduled_today(&self,date:&str)->Result<bool,StorageError>{self.db.query_row("SELECT EXISTS(SELECT 1 FROM news_editorial_runs WHERE json_extract(payload,'$.scheduleDate')=?1)",[date],|r|r.get(0)).map_err(db_error)}
    pub fn automatic_source_due(&self,id:&str,minutes:u32,at:&str)->Result<bool,StorageError>{
        let previous:Option<String>=self.db.query_row("SELECT last_attempt_at FROM news_automation_sources WHERE source_id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?.or(self.news_source(id)?.and_then(|s|s.last_attempt_at));
        Ok(previous.is_none_or(|previous|chrono::DateTime::parse_from_rfc3339(&previous).ok().zip(chrono::DateTime::parse_from_rfc3339(at).ok()).is_some_and(|(a,b)|(b-a).num_minutes()>=i64::from(minutes))))
    }
    pub fn mark_automatic_source(&self,id:&str,at:&str)->Result<(),StorageError>{self.db.execute("INSERT INTO news_automation_sources(source_id,last_attempt_at) VALUES(?1,?2) ON CONFLICT(source_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at",params![id,at]).map_err(db_error)?;Ok(())}
}

#[cfg(test)]
#[path="news-editorial-tests.rs"] mod tests;
