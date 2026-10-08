use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use crate::news_types::*;
use crate::storage::{StorageError, Store};

#[cfg(test)]
#[path = "news-tests.rs"]
mod tests;

fn db_error(_: rusqlite::Error) -> StorageError { StorageError::new("news_save_failed", "资讯数据库操作失败，未报告成功。原记录与表单保留，请检查磁盘、权限或占用后重试。") }
pub fn now() -> String { chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }
pub fn hash(value: &str) -> String { format!("{:x}", Sha256::digest(value.as_bytes())) }
#[derive(Deserialize)]
struct Seed { sources: Vec<SourceConfig> }

pub(crate) fn create_schema(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("CREATE TABLE news_sources (
        id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, config TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE news_source_requests (id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL) STRICT;
    CREATE TABLE news_batches (id TEXT PRIMARY KEY, target TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    CREATE TABLE news_runs (
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES news_batches(id), source_id TEXT NOT NULL REFERENCES news_sources(id),
        source_config TEXT NOT NULL, source_revision INTEGER NOT NULL, started_at TEXT NOT NULL, attempted_at TEXT NOT NULL,
        finished_at TEXT, status TEXT NOT NULL, fetched INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0, error TEXT, warning TEXT, feed_kind TEXT, parsed TEXT, fetched_at TEXT
    ) STRICT;
    CREATE INDEX news_runs_recent ON news_runs(attempted_at DESC);
    CREATE INDEX news_runs_source ON news_runs(source_id, attempted_at DESC);
    CREATE TABLE news_materials (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES news_sources(id), source_name TEXT NOT NULL,
        source_revision INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, published_at TEXT, published_raw TEXT,
        discovered_at TEXT NOT NULL, summary TEXT, summary_truncated INTEGER NOT NULL CHECK(summary_truncated IN (0,1))
    ) STRICT;
    CREATE INDEX news_materials_recent ON news_materials(discovered_at DESC, id DESC);
    CREATE INDEX news_materials_source ON news_materials(source_id, discovered_at DESC, id DESC);
    CREATE TABLE news_material_keys (
        source_id TEXT NOT NULL REFERENCES news_sources(id), key TEXT NOT NULL,
        material_id TEXT NOT NULL REFERENCES news_materials(id), PRIMARY KEY(source_id,key)
    ) STRICT;").map_err(db_error)?;
    let seed: Seed = serde_json::from_str(include_str!("../resources/news-sources.json")).map_err(|_| invalid_data())?;
    if seed.sources.len() != 18 { return Err(invalid_data()); }
    for source in seed.sources {
        validate_source(&source)?;
        let config = serde_json::to_string(&source).map_err(|_| invalid_data())?;
        db.execute("INSERT INTO news_sources(id,name_key,config,revision,created_at) VALUES (?1,?2,?3,1,?4)", params![source.id, source.name.trim().to_lowercase(), config, now()]).map_err(db_error)?;
    }
    Ok(())
}
pub(crate) fn validate_schema(db: &Connection) -> Result<(), StorageError> {
    db.prepare("SELECT id,name_key,config,revision,created_at FROM news_sources LIMIT 0").map_err(db_error)?;
    db.prepare("SELECT id,input,result FROM news_source_requests LIMIT 0").map_err(db_error)?;
    db.prepare("SELECT id,target,created_at FROM news_batches LIMIT 0").map_err(db_error)?;
    db.prepare("SELECT id,batch_id,source_id,source_config,source_revision,started_at,attempted_at,finished_at,status,fetched,added,skipped,error,warning,feed_kind,parsed,fetched_at FROM news_runs LIMIT 0").map_err(db_error)?;
    db.prepare("SELECT id,source_id,source_name,source_revision,title,url,published_at,published_raw,discovered_at,summary,summary_truncated FROM news_materials LIMIT 0").map_err(db_error)?;
    db.prepare("SELECT source_id,key,material_id FROM news_material_keys LIMIT 0").map_err(db_error)?;
    Ok(())
}
// Only at database open, before any live collection: crashes never become a reported success.
pub(crate) fn recover_runs(db: &Connection, root: &std::path::Path) -> Result<(), StorageError> {
    db.execute("UPDATE news_runs SET status='interrupted',finished_at=?1,error='上次采集中断，未报告成功；已保存资料与订阅响应保留。重试从已留存的步骤继续，没有留存输入时才重新抓取。' WHERE status IN ('queued','fetching','parsing','saving')", [now()]).map_err(db_error)?;
    let mut query=db.prepare("SELECT id FROM news_runs WHERE status='saveFailed' AND parsed IS NULL").map_err(db_error)?;
    let ids=query.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    for id in ids {
        if !crate::news_capture::path(root,&id)?.try_exists().map_err(|_| StorageError::new("news_capture_failed","无法核对上次采集输入，请检查目录权限。"))? {
            db.execute("UPDATE news_runs SET status='interrupted',error='上次订阅响应保存失败，退出后内存输入未能留存；原失败记录保留，需要明确重试抓取。新结果仍按原配置去重保存。' WHERE id=?1",[id]).map_err(db_error)?;
        }
    }
    Ok(())
}
pub(crate) fn source_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, i64, String)> { Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)) }
pub(crate) fn row_count(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<usize> {
    let value: i64 = row.get(index)?;
    usize::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(index, value))
}
pub(crate) fn decode_source((id, json, revision, created_at): (String, String, i64, String)) -> Result<Source, StorageError> {
    let config: SourceConfig = serde_json::from_str(&json).map_err(|_| invalid_data())?;
    validate_source(&config).map_err(|_| invalid_data())?;
    if id != config.id || !(1..=MAX_REVISION).contains(&revision) { return Err(invalid_data()); }
    Ok(Source { config, revision, created_at, feed_kind: None, last_attempt_at: None, last_success_at: None, last_status: None, last_error: None })
}
#[derive(Debug, Clone)]
pub struct RunWork { pub id: String, pub source: SourceConfig, pub revision: i64 }
fn run_work(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, i64)> { Ok((row.get(0)?, row.get(1)?, row.get(2)?)) }
fn decode_work((id, json, revision): (String, String, i64)) -> Result<RunWork, StorageError> {
    let source: SourceConfig = serde_json::from_str(&json).map_err(|_| invalid_data())?;
    validate_source(&source).map_err(|_| invalid_data())?;
    Ok(RunWork { id, source, revision })
}
fn kind(value: &str) -> Result<FeedKind, StorageError> { match value { "rss" => Ok(FeedKind::Rss), "atom" => Ok(FeedKind::Atom), _ => Err(invalid_data()) } }
fn run_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(CollectionRun, String)> {
    let raw: String = row.get(8)?;
    Ok((CollectionRun {
        id: row.get(0)?, source_id: row.get(1)?, source_name: row.get(2)?, source_revision: row.get(3)?,
        started_at: row.get(4)?, attempted_at: row.get(5)?, finished_at: row.get(6)?, status: RunStatus::Queued,
        fetched: row_count(row, 9)?, added: row_count(row, 10)?, skipped: row_count(row, 11)?, error: row.get(12)?, warning: row.get(13)?,
        retry_stage: if row.get::<_, bool>(7)? { Some(RetryStage::Save) } else { None },
    }, raw))
}
fn decode_run((mut run, status): (CollectionRun, String)) -> Result<CollectionRun, StorageError> {
    run.status = RunStatus::from_str(&status)?;
    run.retry_stage = match run.status {
        RunStatus::FetchFailed => Some(RetryStage::Fetch), RunStatus::ParseFailed => Some(RetryStage::Parse),
        RunStatus::SaveFailed => Some(RetryStage::Save), RunStatus::Interrupted => run.retry_stage,
        _ => None,
    };
    Ok(run)
}
const RUN_SELECT: &str = "SELECT id,source_id,json_extract(source_config,'$.name'),source_revision,started_at,attempted_at,finished_at,parsed IS NOT NULL,status,fetched,added,skipped,error,warning FROM news_runs";
fn canonical_url(value: &str) -> Result<String, StorageError> {
    let mut url = crate::news_http::public_url(value)?;
    let pairs = url.query_pairs().filter(|(key, _)| !key.starts_with("utm_") && !matches!(key.as_ref(), "fbclid" | "gclid" | "mc_cid" | "mc_eid"))
        .map(|(key, value)| (key.into_owned(), value.into_owned())).collect::<Vec<_>>();
    url.set_query(None);
    if !pairs.is_empty() { url.query_pairs_mut().extend_pairs(pairs); }
    Ok(url.into())
}
impl Store {
    pub fn news_source(&self, id: &str) -> Result<Option<Source>, StorageError> {
        self.db.query_row("SELECT id,config,revision,created_at FROM news_sources WHERE id=?1", [id], source_row).optional().map_err(db_error)?.map(decode_source).transpose()
    }
    pub fn news_sources(&self) -> Result<Vec<Source>, StorageError> {
        let mut statement = self.db.prepare("SELECT id,config,revision,created_at FROM news_sources ORDER BY created_at,id").map_err(db_error)?;
        let rows = statement.query_map([], source_row).map_err(db_error)?.collect::<Result<Vec<_>, _>>().map_err(db_error)?;
        let mut sources = rows.into_iter().map(decode_source).collect::<Result<Vec<_>, _>>()?;
        for source in &mut sources {
            let last: Option<(String, String, Option<String>)> = self.db.query_row("SELECT attempted_at,status,error FROM news_runs WHERE source_id=?1 ORDER BY attempted_at DESC,rowid DESC LIMIT 1", [&source.config.id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional().map_err(db_error)?;
            if let Some((attempted_at, status, error)) = last { source.last_attempt_at = Some(attempted_at); source.last_status = Some(RunStatus::from_str(&status)?); source.last_error = error; }
            source.last_success_at = self.db.query_row("SELECT max(finished_at) FROM news_runs WHERE source_id=?1 AND status IN ('added','noNew')", [&source.config.id], |row| row.get(0)).map_err(db_error)?;
            let feed_kind: Option<String> = self.db.query_row("SELECT feed_kind FROM news_runs WHERE source_id=?1 AND feed_kind IS NOT NULL ORDER BY attempted_at DESC,rowid DESC LIMIT 1", [&source.config.id], |row| row.get(0)).optional().map_err(db_error)?;
            source.feed_kind = feed_kind.as_deref().map(kind).transpose()?;
        }
        Ok(sources)
    }
    pub fn news_source_request(&self, request_id: &str) -> Result<Option<Source>, StorageError> {
        if !uuid(request_id) { return Err(StorageError::new("invalid_id", "信源保存请求编号无效。")); }
        let saved: Option<String> = self.db.query_row("SELECT result FROM news_source_requests WHERE id=?1", [request_id], |row| row.get(0)).optional().map_err(db_error)?;
        saved.map(|json| serde_json::from_str(&json).map_err(|_| invalid_data())).transpose()
    }
    pub fn save_news_source(&mut self, input: SaveSource) -> Result<Source, StorageError> {
        let tx = self.db.transaction().map_err(db_error)?;
        let result = save_source_in(&tx, input)?;
        tx.commit().map_err(db_error)?;
        Ok(result)
    }
    pub fn news_snapshot(&self) -> Result<NewsSnapshot, StorageError> {
        let mut query = self.db.prepare(&format!("{RUN_SELECT} ORDER BY attempted_at DESC,rowid DESC LIMIT 100")).map_err(db_error)?;
        let rows = query.query_map([], run_row).map_err(db_error)?.collect::<Result<Vec<_>, _>>().map_err(db_error)?;
        let runs = rows.into_iter().map(|row| self.resolve_retry(decode_run(row)?)).collect::<Result<Vec<_>, _>>()?;
        Ok(NewsSnapshot { sources: self.news_sources()?, runs })
    }
    fn resolve_retry(&self, mut run: CollectionRun) -> Result<CollectionRun, StorageError> {
        if run.status == RunStatus::Interrupted && run.retry_stage.is_none() {
            let capture = crate::news_capture::path(&self.root, &run.id)?;
            // A response persisted before parsing is enough to resume without another GET.
            run.retry_stage = Some(if capture.try_exists().map_err(|_| StorageError::new("news_capture_failed", "无法检查中断任务的订阅响应，未重新抓取。请检查数据目录权限后重新读取。"))? {
                RetryStage::Parse
            } else { RetryStage::Fetch });
        }
        Ok(run)
    }
    pub fn news_retry_stage(&self, id: &str) -> Result<RetryStage, StorageError> {
        let row = self.db.query_row(&format!("{RUN_SELECT} WHERE id=?1"), [id], run_row).map_err(db_error)?;
        self.resolve_retry(decode_run(row)?)?.retry_stage.ok_or_else(|| StorageError::new("news_retry_not_failed", "这条记录不是待重试的失败步骤，没有重复采集。"))
    }
    pub fn news_materials(&self, source_id: Option<&str>, page: usize) -> Result<MaterialPage, StorageError> {
        if source_id.is_some_and(|id| !crate::news_types::source_id(id)) || page > 1_000_000 { return Err(StorageError::new("invalid_news_filter", "资料筛选或页码无效。")); }
        let total: usize = self.db.query_row("SELECT count(*) FROM news_materials WHERE (?1 IS NULL OR source_id=?1)", [source_id], |row| row_count(row, 0)).map_err(db_error)?;
        let page = page.min(total.saturating_sub(1) / PAGE_SIZE);
        let mut query = self.db.prepare("SELECT id,source_id,source_name,source_revision,title,url,published_at,published_raw,discovered_at,summary,summary_truncated FROM news_materials WHERE (?1 IS NULL OR source_id=?1) ORDER BY discovered_at DESC,id DESC LIMIT ?2 OFFSET ?3").map_err(db_error)?;
        let items = query.query_map(params![source_id, PAGE_SIZE as i64, (page * PAGE_SIZE) as i64], |row| Ok(Material {
            id: row.get(0)?, source_id: row.get(1)?, source_name: row.get(2)?, source_revision: row.get(3)?, title: row.get(4)?, url: row.get(5)?,
            published_at: row.get(6)?, published_raw: row.get(7)?, discovered_at: row.get(8)?, summary: row.get(9)?, summary_truncated: row.get(10)?,
        })).map_err(db_error)?.collect::<Result<Vec<_>, _>>().map_err(db_error)?;
        Ok(MaterialPage { items, total, page, page_size: PAGE_SIZE })
    }
    pub fn begin_news_batch(&mut self, request_id: &str, target: Option<&str>) -> Result<Option<Vec<RunWork>>, StorageError> {
        self.begin_news_batch_scoped(request_id,target,&crate::news_scope::Range::default())
    }
    pub fn begin_news_batch_scoped(&mut self, request_id: &str, target: Option<&str>,range:&crate::news_scope::Range) -> Result<Option<Vec<RunWork>>, StorageError> {
        if !uuid(request_id) { return Err(StorageError::new("invalid_id", "采集请求编号无效。")); }
        let target_key = target.unwrap_or("all");
        let scope=crate::news_scope::resolve(&self.db,range,target.map(str::to_owned),String::new(),true)?;
        let sources = self.news_sources()?;
        let tx = self.db.transaction().map_err(db_error)?;
        let previous: Option<String> = tx.query_row("SELECT target FROM news_batches WHERE id=?1", [request_id], |row| row.get(0)).optional().map_err(db_error)?;
        if let Some(previous) = previous {
            if previous != target_key { return Err(StorageError::new("request_conflict", "采集请求编号已有不同范围，未重复执行。")); }
            let saved:Option<String>=tx.query_row("SELECT scope FROM news_batch_ranges WHERE batch_id=?1",[request_id],|r|r.get(0)).optional().map_err(db_error)?;
            if let Some(saved)=saved{let saved:serde_json::Value=serde_json::from_str(&saved).map_err(|_|invalid_data())?;
                if saved["range"]!=serde_json::to_value(range).map_err(|_|invalid_data())?{return Err(StorageError::new("request_conflict","采集请求编号已有不同时间范围，未重复采集。"));}
            }else if range.period!="all"{return Err(StorageError::new("request_conflict","旧采集请求没有此时间范围，未重复采集。"));}
            return Ok(None);
        }
        let sources = sources.into_iter().filter(|source| source.config.enabled && target.is_none_or(|id| id == source.config.id)).collect::<Vec<_>>();
        if sources.is_empty() { return Err(StorageError::new("no_enabled_sources", "没有可采集的已启用信源；暂停来源不会因手动采集而恢复。")); }
        let unfinished: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM news_runs WHERE status IN ('queued','fetching','parsing','saving'))", [], |row| row.get(0)).map_err(db_error)?;
        if unfinished { return Err(StorageError::new("news_unfinished_runs", "还有未结束的采集记录，请先退出并重新打开应用核对中断状态；没有重复启动。")); }
        let started = now();
        tx.execute("INSERT INTO news_batches(id,target,created_at) VALUES (?1,?2,?3)", params![request_id, target_key, started]).map_err(db_error)?;
        tx.execute("INSERT INTO news_batch_ranges(batch_id,scope) VALUES(?1,?2)",params![request_id,serde_json::json!({"range":range,"scope":scope}).to_string()]).map_err(db_error)?;
        let mut work = Vec::new();
        for source in sources {
            let id = hash(&format!("{request_id}\n{}", source.config.id));
            tx.execute("INSERT INTO news_runs(id,batch_id,source_id,source_config,source_revision,started_at,attempted_at,status) VALUES (?1,?2,?3,?4,?5,?6,?6,'queued')", params![id, request_id, source.config.id, serde_json::to_string(&source.config).map_err(|_| invalid_data())?, source.revision, started]).map_err(db_error)?;
            work.push(RunWork { id, source: source.config, revision: source.revision });
        }
        tx.commit().map_err(db_error)?;
        Ok(Some(work))
    }
    pub fn news_run_work(&self, id: &str) -> Result<RunWork, StorageError> {
        self.db.query_row("SELECT id,source_config,source_revision FROM news_runs WHERE id=?1", [id], run_work).map_err(db_error).and_then(decode_work)
    }
    pub fn news_run_status(&self, id: &str) -> Result<RunStatus, StorageError> {
        let status: String = self.db.query_row("SELECT status FROM news_runs WHERE id=?1", [id], |row| row.get(0)).map_err(db_error)?;
        RunStatus::from_str(&status)
    }
    pub fn news_run_stage(&mut self, id: &str, status: RunStatus, retry: bool) -> Result<(), StorageError> {
        let affected = self.db.execute("UPDATE news_runs SET status=?1,finished_at=NULL,error=NULL,attempted_at=CASE WHEN ?2 THEN ?3 ELSE attempted_at END WHERE id=?4", params![status.as_str(), retry, now(), id]).map_err(db_error)?;
        if affected != 1 { return Err(invalid_data()); } Ok(())
    }
    pub fn news_run_failure(&mut self, id: &str, status: RunStatus, error: &str) -> Result<(), StorageError> {
        self.db.execute("UPDATE news_runs SET status=?1,finished_at=?2,error=?3 WHERE id=?4", params![status.as_str(), now(), error, id]).map_err(db_error)?; Ok(())
    }
    pub fn news_cache_parsed(&mut self, id: &str, parsed: &ParsedFeed, fetched_at: &str) -> Result<(), StorageError> {
        let kind = match parsed.kind { FeedKind::Rss => "rss", FeedKind::Atom => "atom" };
        self.db.execute("UPDATE news_runs SET status='saving',parsed=?1,fetched_at=?2,feed_kind=?3,fetched=?4,skipped=?5,warning=?6 WHERE id=?7", params![serde_json::to_string(parsed).map_err(|_| invalid_data())?, fetched_at, kind, (parsed.entries.len() + parsed.skipped) as i64, parsed.skipped as i64, parsed.warning, id]).map_err(db_error)?; Ok(())
    }
    pub fn news_parsed(&self, id: &str) -> Result<(ParsedFeed, String), StorageError> {
        let (json, fetched_at): (String, String) = self.db.query_row("SELECT parsed,fetched_at FROM news_runs WHERE id=?1 AND parsed IS NOT NULL", [id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(db_error)?.ok_or_else(||StorageError::new("news_parsed_missing","尚无已解析缓存，保留订阅响应可继续解析。"))?;
        Ok((serde_json::from_str(&json).map_err(|_| invalid_data())?, fetched_at))
    }
    pub fn save_news_materials(&mut self, work: &RunWork, parsed: &ParsedFeed, fetched_at: &str) -> Result<(), StorageError> {
        let tx = self.db.transaction().map_err(db_error)?;
        let (batch_id,scope):(String,Option<String>)=tx.query_row("SELECT r.batch_id,b.scope FROM news_runs r LEFT JOIN news_batch_ranges b ON b.batch_id=r.batch_id WHERE r.id=?1",[&work.id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
        let scope=scope.map(|s|{let value:serde_json::Value=serde_json::from_str(&s).map_err(|_|invalid_data())?;serde_json::from_value::<crate::news_scope::Scope>(value["scope"].clone()).map_err(|_|invalid_data())}).transpose()?;
        let mut added = 0;
        let mut outside=0;
        for entry in &parsed.entries {
            if scope.as_ref().is_some_and(|s|!s.includes(entry.published_at.as_deref())){outside+=1;continue;}
            let url_key = format!("url:{}", canonical_url(&entry.url)?);
            let id_key = entry.external_id.as_deref().map(|id| format!("id:{id}"));
            let existing: Option<String> = tx.query_row("SELECT material_id FROM news_material_keys WHERE source_id=?1 AND (key=?2 OR key=?3) LIMIT 1", params![work.source.id, url_key, id_key], |row| row.get(0)).optional().map_err(db_error)?;
            let material_id = if let Some(existing) = existing { existing } else {
                let material_id: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0)).map_err(db_error)?;
                tx.execute("INSERT INTO news_materials(id,source_id,source_name,source_revision,title,url,published_at,published_raw,discovered_at,summary,summary_truncated) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)", params![material_id, work.source.id, work.source.name, work.revision, entry.title, entry.url, entry.published_at, entry.published_raw, fetched_at, entry.summary, entry.summary_truncated]).map_err(db_error)?;
                tx.execute("INSERT INTO news_material_batches(material_id,batch_id) VALUES(?1,?2)",params![material_id,batch_id]).map_err(db_error)?;
                added += 1; material_id
            };
            for key in std::iter::once(url_key).chain(id_key) {
                tx.execute("INSERT INTO news_material_keys(source_id,key,material_id) VALUES (?1,?2,?3) ON CONFLICT(source_id,key) DO NOTHING", params![work.source.id, key, material_id]).map_err(db_error)?;
            }
            if let Some(body)=&entry.body {
                tx.execute("INSERT INTO news_bodies(material_id,body,kind,fetched_at) VALUES(?1,?2,?3,?4) ON CONFLICT(material_id) DO UPDATE SET body=excluded.body,kind=excluded.kind,fetched_at=excluded.fetched_at,error=CASE WHEN excluded.kind='feed' THEN NULL ELSE news_bodies.error END WHERE news_bodies.kind='summary' OR (news_bodies.kind='feed' AND length(news_bodies.body)<300)",params![material_id,body,if entry.body_full{"feed"}else{"summary"},fetched_at]).map_err(db_error)?;
            }
        }
        if outside>0{tx.execute("UPDATE news_runs SET skipped=skipped+?1,warning=CASE WHEN warning IS NULL THEN ?2 ELSE warning||'；'||?2 END WHERE id=?3",params![outside,format!("按已选采集范围跳过 {outside} 条（包含未纳入的日期不明资料）"),work.id]).map_err(db_error)?;}
        tx.execute("UPDATE news_runs SET status=?1,finished_at=?2,added=?3,error=NULL,parsed=NULL WHERE id=?4", params![if added > 0 { "added" } else { "noNew" }, now(), added, work.id]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
}


pub(crate) fn save_source_in(tx: &rusqlite::Transaction<'_>, mut input: SaveSource) -> Result<Source, StorageError> {
        if !uuid(&input.request_id) { return Err(StorageError::new("invalid_id", "信源保存请求编号无效。")); }
        input.source.name = input.source.name.trim().to_owned(); input.source.feed_url = input.source.feed_url.trim().to_owned();
        input.source.feed_url = crate::news_http::public_url(&input.source.feed_url)?.to_string();
        validate_source(&input.source)?;
        if input.expected_revision.is_some_and(|revision| !(1..MAX_REVISION).contains(&revision)) { return Err(invalid_data()); }
        let json = serde_json::to_string(&input).map_err(|_| invalid_data())?;
        let config = serde_json::to_string(&input.source).map_err(|_| invalid_data())?;

        let previous: Option<(String, String)> = tx.query_row("SELECT input,result FROM news_source_requests WHERE id=?1", [&input.request_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(db_error)?;
        if let Some((old, result)) = previous {
            if old != json { return Err(StorageError::new("request_conflict", "这个请求编号已保存不同内容，未覆盖配置。请先核对保存结果。")); }
            return serde_json::from_str(&result).map_err(|_| invalid_data());
        }
        let old = tx.query_row("SELECT id,config,revision,created_at FROM news_sources WHERE id=?1", [&input.source.id], source_row).optional().map_err(db_error)?.map(decode_source).transpose()?;
        let duplicate: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM news_sources WHERE name_key=?1 AND id!=?2)", params![input.source.name.to_lowercase(), input.source.id], |row| row.get(0)).map_err(db_error)?;
        if duplicate { return Err(StorageError::new("duplicate_source_name", "已有相同名称的信源，请换一个名称；输入已保留。")); }
        let (revision, created_at) = match (old, input.expected_revision) {
            (None, None) if uuid(&input.source.id) && !input.source.enabled => (1, now()),
            (Some(old), Some(expected)) if old.revision == expected => (expected + 1, old.created_at),
            (None, None) => return Err(StorageError::new("new_source_paused", "新信源必须先保存为暂停状态，预览核对后才能启用。")),
            _ => return Err(StorageError::new("stale_record", "信源配置已改变，未覆盖。草稿保留，请重新读取并核对版本。")),
        };
        tx.execute("INSERT INTO news_sources(id,name_key,config,revision,created_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name_key=excluded.name_key,config=excluded.config,revision=excluded.revision", params![input.source.id, input.source.name.to_lowercase(), config, revision, created_at]).map_err(db_error)?;
        let result = Source { config: input.source, revision, created_at, feed_kind: None, last_attempt_at: None, last_success_at: None, last_status: None, last_error: None };
        tx.execute("INSERT INTO news_source_requests(id,input,result) VALUES (?1,?2,?3)", params![input.request_id, json, serde_json::to_string(&result).map_err(|_| invalid_data())?]).map_err(db_error)?;

        Ok(result)

}
