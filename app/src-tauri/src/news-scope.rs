//! Explicit collection windows and a retained, non-destructive pending queue.
use serde::{Deserialize,Serialize};
use rusqlite::{Connection,OptionalExtension,params};
use crate::{storage::{Store,StorageError},news_store::{now,row_count},news_types::uuid};

fn invalid()->StorageError{StorageError::new("news_range_invalid","请选择有效时间范围；自定义范围需要开始和结束日期，开始不能晚于结束。")}
fn db_error(_:rusqlite::Error)->StorageError{StorageError::new("news_queue_failed","待处理范围操作未完成，原始资料与报道保留。请重新读取后重试。")}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Range {
    pub period:String,#[serde(default)]pub start:Option<String>,#[serde(default)]pub end:Option<String>,
    #[serde(default)]pub include_undated:bool,
}

#[cfg(test)]mod tests{
    use super::*;
    fn store()->Store{
        let base=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");std::fs::create_dir_all(&base).unwrap();
        let root=tempfile::Builder::new().prefix("news-scope-").tempdir_in(base).unwrap().keep().join("data");Store::open(&root,true).unwrap()
    }
    fn source(s:&Store)->String{s.db.query_row("SELECT id FROM news_sources WHERE json_extract(config,'$.usage')='editorial' ORDER BY id LIMIT 1",[],|r|r.get(0)).unwrap()}
    fn material(s:&Store,id:&str,published:Option<&str>){let source=source(s);s.db.execute("INSERT INTO news_materials(id,source_id,source_name,source_revision,title,url,published_at,discovered_at,summary_truncated) VALUES(?1,?2,'EXPLICIT scope fixture',1,'EXPLICIT Reader news','https://example.org/fixture',?3,?4,0)",params![id,source,published,now()]).unwrap();s.db.execute("INSERT INTO news_material_keys(source_id,key,material_id) VALUES(?1,?2,?3)",params![source,format!("fixture:{id}"),id]).unwrap();}
    #[test]fn selected_publication_window_excludes_old_and_undated_material_without_using_discovery_time(){
        let s=store();let fresh=now();let old=(chrono::Utc::now()-chrono::Duration::days(8)).to_rfc3339();
        material(&s,"00000000000000000000000000000001",Some(&fresh));material(&s,"00000000000000000000000000000002",Some(&old));material(&s,"00000000000000000000000000000003",None);
        let range=Range{period:"day".into(),include_undated:false,..Range::default()};let scope=resolve(&s.db,&range,None,String::new(),false).unwrap();assert_eq!(s.scoped_pending_ids(&scope).unwrap(),vec!["00000000000000000000000000000001"]);
        let mut scope=scope;scope.include_undated=true;assert_eq!(s.scoped_pending_ids(&scope).unwrap().len(),2);assert_eq!(s.db.query_row("SELECT COUNT(*) FROM news_materials",[],|r|row_count(r,0)).unwrap(),3);
    }
    #[test]fn clearing_selected_pending_scope_preserves_source_records_dedupe_and_processed_statistics(){
        let mut s=store();let at=now();material(&s,"00000000000000000000000000000001",Some(&at));material(&s,"00000000000000000000000000000002",Some(&at));
        let mut scope=resolve(&s.db,&Range::default(),None,"EXPLICIT".into(),false).unwrap();scope.source_id=Some(source(&s));let ids=s.scoped_pending_ids(&scope).unwrap();
        assert_eq!(s.dismiss_pending("aabbccdd-1111-2222-3333-000000000001",&scope,&ids).unwrap(),2);
        assert_eq!(s.dismiss_pending("aabbccdd-1111-2222-3333-000000000001",&scope,&ids).unwrap(),2);assert!(s.scoped_pending_ids(&scope).unwrap().is_empty());
        for table in ["news_materials","news_material_keys"]{assert_eq!(s.db.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|r|row_count(r,0)).unwrap(),2);}
        assert_eq!(s.db.query_row("SELECT COUNT(*) FROM news_processed",[],|r|row_count(r,0)).unwrap(),0);assert_eq!(s.db.query_row("SELECT COUNT(*) FROM news_step_receipts",[],|r|row_count(r,0)).unwrap(),0);
    }
    #[test]fn changed_queue_requires_new_confirmation_and_empty_latest_batch_never_selects_older_material(){
        let mut s=store();let at=now();material(&s,"00000000000000000000000000000001",Some(&at));let scope=resolve(&s.db,&Range::default(),None,String::new(),false).unwrap();let ids=s.scoped_pending_ids(&scope).unwrap();material(&s,"00000000000000000000000000000002",Some(&at));
        assert_eq!(s.dismiss_pending("aabbccdd-1111-2222-3333-000000000001",&scope,&ids).unwrap_err().code,"news_scope_changed");
        s.db.execute("INSERT INTO news_batches VALUES('aabbccdd-1111-2222-3333-000000000002','all',?1)",[now()]).unwrap();let range=Range{period:"latest".into(),..Range::default()};let latest=resolve(&s.db,&range,None,String::new(),false).unwrap();assert!(s.scoped_pending_ids(&latest).unwrap().is_empty());assert_eq!(s.scoped_pending_ids(&scope).unwrap().len(),2);
    }
}
impl Default for Range{fn default()->Self{Self{period:"all".into(),start:None,end:None,include_undated:true}}}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Scope{pub start:Option<String>,pub end:String,pub source_id:Option<String>,pub query:String,pub include_undated:bool,pub batch_id:Option<String>}
fn date(value:&str)->Result<String,StorageError>{chrono::DateTime::parse_from_rfc3339(value).map(|d|d.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis,true)).map_err(|_|invalid())}
impl Scope{
    pub fn validate(&self)->Result<(),StorageError>{
        if date(&self.end)?!=self.end||self.start.as_ref().is_some_and(|s|date(s).ok().as_ref()!=Some(s)||s>&self.end)
            ||self.source_id.as_ref().is_some_and(|id|!crate::news_types::source_id(id))||self.query.chars().count()>200
            ||self.batch_id.as_ref().is_some_and(|id|!uuid(id)){return Err(invalid());}Ok(())
    }
    pub fn includes(&self,published:Option<&str>)->bool{match published{
        Some(d)=>date(d).is_ok_and(|d|self.start.as_ref().is_none_or(|s|&d>=s)&&d<=self.end),
        None=>self.include_undated,
    }}
}
pub fn resolve(db:&Connection,range:&Range,source_id:Option<String>,query:String,collection:bool)->Result<Scope,StorageError>{
    let at=chrono::Utc::now();let end=at.to_rfc3339_opts(chrono::SecondsFormat::Millis,true);
    let mut scope=Scope{start:None,end,source_id,query,include_undated:range.include_undated,batch_id:None};
    match range.period.as_str(){
        "all"=>{},
        "day"|"week"=>scope.start=Some((at-chrono::Duration::hours(if range.period=="day"{24}else{168})).to_rfc3339_opts(chrono::SecondsFormat::Millis,true)),
        "custom"=>{scope.start=Some(date(range.start.as_deref().ok_or_else(invalid)?)?);scope.end=date(range.end.as_deref().ok_or_else(invalid)?)?;},
        "latest" if !collection=>{
            scope.include_undated=true;
            // An empty latest batch is still the latest; never silently fall back to older news.
            scope.batch_id=Some(db.query_row("SELECT b.id FROM news_batches b WHERE (?1 IS NULL OR EXISTS(SELECT 1 FROM news_runs r WHERE r.batch_id=b.id AND r.source_id=?1)) ORDER BY b.created_at DESC,b.rowid DESC LIMIT 1",[&scope.source_id],|r|r.get::<_,String>(0)).optional().map_err(db_error)?.unwrap_or_else(||"00000000-0000-4000-8000-000000000000".into()));
        },
        _=>return Err(invalid()),
    }
    scope.validate()?;Ok(scope)
}
pub fn create_schema(db:&Connection)->Result<(),StorageError>{db.execute_batch("CREATE TABLE news_batch_ranges(batch_id TEXT PRIMARY KEY REFERENCES news_batches(id),scope TEXT NOT NULL) STRICT;
CREATE TABLE news_material_batches(material_id TEXT PRIMARY KEY REFERENCES news_materials(id),batch_id TEXT NOT NULL REFERENCES news_batches(id)) STRICT;
CREATE INDEX news_material_batches_batch ON news_material_batches(batch_id,material_id);
CREATE TABLE news_pending_dismissals(material_id TEXT PRIMARY KEY REFERENCES news_materials(id),request_id TEXT NOT NULL,dismissed_at TEXT NOT NULL) STRICT;
CREATE TABLE news_queue_requests(id TEXT PRIMARY KEY,input TEXT NOT NULL,total INTEGER NOT NULL) STRICT;").map_err(db_error)}
pub fn validate_schema(db:&Connection)->Result<(),StorageError>{for sql in ["SELECT batch_id,scope FROM news_batch_ranges LIMIT 0","SELECT material_id,batch_id FROM news_material_batches LIMIT 0","SELECT material_id,request_id,dismissed_at FROM news_pending_dismissals LIMIT 0","SELECT id,input,total FROM news_queue_requests LIMIT 0"]{db.prepare(sql).map_err(db_error)?;}Ok(())}
impl Store{
    pub fn scoped_pending_ids(&self,scope:&Scope)->Result<Vec<String>,StorageError>{
        self.scoped_material_ids(scope,true)
    }
    pub fn scoped_material_ids(&self,scope:&Scope,pending:bool)->Result<Vec<String>,StorageError>{
        scope.validate()?;
        let mut query=self.db.prepare("SELECT m.id FROM news_materials m WHERE (?7=0 OR (NOT EXISTS(SELECT 1 FROM news_processed p WHERE p.material_id=m.id) AND NOT EXISTS(SELECT 1 FROM news_pending_dismissals d WHERE d.material_id=m.id)
AND EXISTS(SELECT 1 FROM news_sources s WHERE s.id=m.source_id AND json_extract(s.config,'$.usage')='editorial')))
AND (?1 IS NULL OR m.source_id=?1) AND (?2='' OR instr(lower(m.title),lower(?2))>0 OR instr(lower(COALESCE(m.summary,'')),lower(?2))>0)
AND ((m.published_at IS NOT NULL AND (?3 IS NULL OR m.published_at>=?3) AND m.published_at<=?4) OR (m.published_at IS NULL AND ?5=1 AND m.discovered_at<=?4))
AND (?6 IS NULL OR EXISTS(SELECT 1 FROM news_material_batches b WHERE b.material_id=m.id AND b.batch_id=?6)) ORDER BY m.discovered_at DESC,m.id").map_err(db_error)?;
        query.query_map(params![scope.source_id,scope.query,scope.start,scope.end,scope.include_undated,scope.batch_id,pending],|r|r.get(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)
    }
    pub fn dismiss_pending(&mut self,request_id:&str,scope:&Scope,ids:&[String])->Result<usize,StorageError>{
        if !uuid(request_id)||ids.is_empty()||ids.len()>100000{return Err(invalid());}
        scope.validate()?;
        let input=serde_json::to_string(&(scope,ids)).map_err(|_|invalid())?;
        if let Some((old,total))=self.db.query_row("SELECT input,total FROM news_queue_requests WHERE id=?1",[request_id],|r|Ok((r.get::<_,String>(0)?,row_count(r,1)?))).optional().map_err(db_error)?{
            if old!=input{return Err(StorageError::new("request_conflict","清空请求编号对应其他范围，未改变资料。"));}return Ok(total);
        }
        if self.scoped_pending_ids(scope)?!=ids{return Err(StorageError::new("news_scope_changed","待处理范围已有变化，请重新读取条数后确认清空；没有清空新加入的资料。"));}
        let tx=self.db.transaction().map_err(db_error)?;let at=now();
        for id in ids{tx.execute("INSERT INTO news_pending_dismissals(material_id,request_id,dismissed_at) VALUES(?1,?2,?3)",params![id,request_id,at]).map_err(db_error)?;}
        tx.execute("INSERT INTO news_queue_requests(id,input,total) VALUES(?1,?2,?3)",params![request_id,input,ids.len() as i64]).map_err(db_error)?;tx.commit().map_err(db_error)?;Ok(ids.len())
    }
}
