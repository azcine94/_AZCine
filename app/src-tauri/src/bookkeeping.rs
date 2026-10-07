use crate::storage::{StorageError, Store};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use crate::bookkeeping_exchange::Exchange;

pub const MAX_AMOUNT: i64 = 9_999_999_999;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Status { Unclaimed, Pending, Submitted, Paid }
impl Status {
    pub fn key(self) -> &'static str { match self { Self::Unclaimed=>"unclaimed", Self::Pending=>"pending", Self::Submitted=>"submitted", Self::Paid=>"paid" } }
    pub fn label(self) -> &'static str { match self { Self::Unclaimed=>"不报销", Self::Pending=>"待提交", Self::Submitted=>"已提交", Self::Paid=>"已到账" } }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt { pub id: String, pub name: String, pub media_type: String, pub size: i64 }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Expense {
    pub id: String, pub date: String, pub purpose: String, pub amount_fen: i64,
    pub note: String, pub status: Status, pub receipts: Vec<Receipt>,
    pub revision: i64, pub deleted: bool, pub created_at: String, pub updated_at: String,
    #[serde(default)] pub exchange: Option<Exchange>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Content { pub id: String, pub date: String, pub purpose: String, pub amount_fen: i64, pub note: String, pub status: Status, pub receipt_ids: Vec<String>, #[serde(default)] pub exchange: Option<Exchange> }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target { pub id: String, pub revision: i64 }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Mutation {
    Save { request_id: String, expected_revision: Option<i64>, content: Content },
    Status { request_id: String, targets: Vec<Target>, status: Status },
    Delete { request_id: String, target: Target, deleted: bool },
}
impl Mutation {
    fn request_id(&self) -> &str { match self { Self::Save{request_id,..}|Self::Status{request_id,..}|Self::Delete{request_id,..} => request_id } }
}
pub fn error(message: &str) -> StorageError { StorageError::new("invalid_expense", message) }
pub fn db_error(_: rusqlite::Error) -> StorageError { StorageError::new("bookkeeping_database", "记账操作失败，原记录与输入保留；请核对后重试。") }
pub fn uuid(id: &str) -> bool { id.len()==36 && id.bytes().enumerate().all(|(i,c)| if [8,13,18,23].contains(&i) { c==b'-' } else { c.is_ascii_hexdigit() }) }
fn valid_revision(value: i64) -> bool { (1..9_007_199_254_740_991).contains(&value) }
pub fn create_schema(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("CREATE TABLE bookkeeping_expenses (
        id TEXT PRIMARY KEY, date TEXT NOT NULL, purpose TEXT NOT NULL CHECK(length(trim(purpose)) BETWEEN 1 AND 200),
        amount_fen INTEGER NOT NULL CHECK(amount_fen BETWEEN 1 AND 9999999999), note TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('unclaimed','pending','submitted','paid')), receipt_ids TEXT NOT NULL, exchange TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;
        CREATE INDEX bookkeeping_dates ON bookkeeping_expenses(deleted,date,id);
        CREATE TABLE bookkeeping_receipts (id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL,
            size INTEGER NOT NULL, sha256 TEXT NOT NULL) STRICT;
        CREATE TABLE bookkeeping_requests (id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL) STRICT;").map_err(db_error)
}
pub fn validate_schema(db: &Connection) -> Result<(), StorageError> {
    validate_legacy_schema(db)?;
    db.prepare("SELECT exchange FROM bookkeeping_expenses LIMIT 0").map_err(db_error)?;
    Ok(())
}
pub fn validate_legacy_schema(db: &Connection) -> Result<(), StorageError> {
    for sql in ["SELECT id,date,purpose,amount_fen,note,status,receipt_ids,revision,deleted,created_at,updated_at FROM bookkeeping_expenses LIMIT 0",
        "SELECT id,expense_id,name,media_type,size,sha256 FROM bookkeeping_receipts LIMIT 0", "SELECT id,input,result FROM bookkeeping_requests LIMIT 0"] { db.prepare(sql).map_err(db_error)?; }
    Ok(())
}
pub(crate) fn validate(content: &Content) -> Result<(), StorageError> {
    if !uuid(&content.id) { return Err(error("开销编号无效。")); }
    let parsed=chrono::NaiveDate::parse_from_str(&content.date,"%Y-%m-%d").ok();
    if content.date.len()!=10 || parsed.is_none_or(|date|date.format("%Y-%m-%d").to_string()!=content.date) || content.date.starts_with("0000") { return Err(error("请填写有效日期，格式为 YYYY-MM-DD。")); }
    if content.purpose.trim().is_empty() || content.purpose.chars().count()>200 { return Err(error("用途需要填写，最多 200 字。")); }
    if !(1..=MAX_AMOUNT).contains(&content.amount_fen) { return Err(error("金额必须大于零，最多 99,999,999.99 元。")); }
    if let Some(exchange)=&content.exchange {
        if exchange.quote.requested_date!=content.date||crate::bookkeeping_exchange::converted(exchange)?!=content.amount_fen{return Err(error("人民币金额与汇率折算不一致，原记录保留。"));}
    }
    if content.note.chars().count()>5000 { return Err(error("备注最多 5000 字。")); }
    let mut unique = std::collections::HashSet::new();
    if content.receipt_ids.len()>5 || content.receipt_ids.iter().any(|id| !uuid(id)||!unique.insert(id)) { return Err(error("每笔最多 5 份票据，编号不能重复。")); }
    Ok(())
}
fn status(value: &str) -> Result<Status, StorageError> { match value { "unclaimed"=>Ok(Status::Unclaimed), "pending"=>Ok(Status::Pending), "submitted"=>Ok(Status::Submitted), "paid"=>Ok(Status::Paid), _=>Err(error("开销状态损坏，请保留记录并核对。")) } }
pub(crate) fn read(db: &Connection, id: &str) -> Result<Option<Expense>, StorageError> {
    let raw = db.query_row("SELECT id,date,purpose,amount_fen,note,status,receipt_ids,revision,deleted,created_at,updated_at,exchange FROM bookkeeping_expenses WHERE id=?1", [id], |r| {
        Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,i64>(7)?,r.get::<_,bool>(8)?,r.get::<_,String>(9)?,r.get::<_,String>(10)?,r.get::<_,Option<String>>(11)?))
    }).optional().map_err(db_error)?;
    let Some((id,date,purpose,amount_fen,note,raw_status,ids,revision,deleted,created_at,updated_at,raw_exchange)) = raw else { return Ok(None); };
    let exchange:Option<Exchange>=raw_exchange.map(|v|serde_json::from_str(&v).map_err(|_|error("汇率记录损坏，请保留记录并核对。"))).transpose()?;
    let receipt_ids: Vec<String> = serde_json::from_str(&ids).map_err(|_| error("票据记录损坏，未返回空记录。"))?;
    let state = status(&raw_status)?;
    validate(&Content{id:id.clone(),date:date.clone(),purpose:purpose.clone(),amount_fen,note:note.clone(),status:state,receipt_ids:receipt_ids.clone(),exchange:exchange.clone()})?;
    if !valid_revision(revision) { return Err(error("开销版本无效，请保留记录并核对。")); }
    let receipts = receipt_ids.iter().map(|rid| receipt(db,&id,rid)).collect::<Result<Vec<_>,_>>()?;
    Ok(Some(Expense{id,date,purpose,amount_fen,note,status:state,receipts,revision,deleted,created_at,updated_at,exchange}))
}
pub fn receipt(db: &Connection, expense_id: &str, id: &str) -> Result<Receipt, StorageError> {
    db.query_row("SELECT id,name,media_type,size FROM bookkeeping_receipts WHERE id=?1 AND expense_id=?2",params![id,expense_id], |r|Ok(Receipt{id:r.get(0)?,name:r.get(1)?,media_type:r.get(2)?,size:r.get(3)?})).optional().map_err(db_error)?.ok_or_else(||error("票据不存在或不属于这笔开销，原文件保留。"))
}
fn current(db: &Connection, target: &Target, allow_deleted: bool) -> Result<Expense, StorageError> {
    if !uuid(&target.id)||!valid_revision(target.revision) { return Err(error("开销编号或版本无效。")); }
    let item = read(db,&target.id)?.ok_or_else(||error("这笔开销已不存在，请刷新核对。"))?;
    if item.revision!=target.revision || (!allow_deleted&&item.deleted) { return Err(StorageError::new("stale_record","记录在操作前已变化，整批未应用；输入和选择保留，请刷新核对。")); }
    Ok(item)
}
impl Store {
    pub fn bookkeeping_list(&self) -> Result<Vec<Expense>, StorageError> {
        let mut q = self.db.prepare("SELECT id FROM bookkeeping_expenses ORDER BY date DESC,created_at DESC,id").map_err(db_error)?;
        let ids = q.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
        ids.iter().map(|id|read(&self.db,id)?.ok_or_else(||error("开销读取不完整，请重新读取。"))).collect()
    }
    pub fn bookkeeping_request(&self, id: &str) -> Result<Option<Vec<Expense>>, StorageError> {
        if !uuid(id) { return Err(error("记账请求编号无效。")); }
        let raw: Option<String> = self.db.query_row("SELECT result FROM bookkeeping_requests WHERE id=?1",[id],|r|r.get(0)).optional().map_err(db_error)?;
        raw.map(|raw|serde_json::from_str(&raw).map_err(|_|error("原操作回执损坏，未报告成功。"))).transpose()
    }
    pub fn bookkeeping_export_rows(&self, targets: &[Target]) -> Result<Vec<Expense>, StorageError> {
        if targets.is_empty()||targets.len()>100_000 { return Err(error("请选择 1–100000 笔开销导出。")); }
        let mut unique=std::collections::HashSet::new();
        targets.iter().map(|target| { if !unique.insert(&target.id) { return Err(error("导出选择有重复记录。")); } current(&self.db,target,false) }).collect()
    }
    pub fn bookkeeping_mutate(&mut self, input: Mutation) -> Result<Vec<Expense>, StorageError> {
        let tx = self.db.transaction().map_err(db_error)?;
        let result = mutate_in(&tx, input)?;
        tx.commit().map_err(db_error)?;
        Ok(result)
    }
}


pub(crate) fn mutate_in(tx: &rusqlite::Transaction<'_>, input: Mutation) -> Result<Vec<Expense>, StorageError> {
        if !uuid(input.request_id()) { return Err(error("记账请求编号无效。")); }
        let payload=serde_json::to_string(&input).map_err(|_|error("无法生成记账请求。"))?;

        let previous:Option<(String,String)>=tx.query_row("SELECT input,result FROM bookkeeping_requests WHERE id=?1",[input.request_id()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        if let Some((old,result))=previous {
            if old!=payload { return Err(error("请求编号已用于不同内容，未覆盖原操作。")); }
            return serde_json::from_str(&result).map_err(|_|error("原操作回执损坏，未重复执行。"));
        }
        let mut ids=Vec::new();
        match &input {
            Mutation::Save{expected_revision,content,..}=>{
                validate_save(tx,*expected_revision,content)?;
                let receipts=serde_json::to_string(&content.receipt_ids).map_err(|_|error("无法保存票据关联。"))?;
                let exchange=content.exchange.as_ref().map(serde_json::to_string).transpose().map_err(|_|error("无法保存汇率记录。"))?;
                if let Some(revision)=expected_revision {
                    tx.execute("UPDATE bookkeeping_expenses SET date=?2,purpose=?3,amount_fen=?4,note=?5,status=?6,receipt_ids=?7,exchange=?9,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND revision=?8 AND deleted=0",params![content.id,content.date,content.purpose,content.amount_fen,content.note,content.status.key(),receipts,revision,exchange]).map_err(db_error)?;
                } else {
                    if !matches!(content.status,Status::Unclaimed|Status::Pending){return Err(error("新开销只能设为不报销或待提交。"));}
                    if read(tx,&content.id)?.is_some() { return Err(StorageError::new("stale_record","这笔开销已存在，未重复创建；请核对原保存结果。")); }
                    tx.execute("INSERT INTO bookkeeping_expenses(id,date,purpose,amount_fen,note,status,receipt_ids,exchange) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![content.id,content.date,content.purpose,content.amount_fen,content.note,content.status.key(),receipts,exchange]).map_err(db_error)?;
                }
                ids.push(content.id.clone());
            }
            Mutation::Status{targets,status,..}=>{
                if targets.is_empty()||targets.len()>200 { return Err(error("每次请选择 1–200 笔报销记录。")); }
                let mut unique=std::collections::HashSet::new();
                for target in targets {
                    if !unique.insert(&target.id) { return Err(error("选择有重复记录。")); }
                    validate_status(tx,target,*status)?;
                }
                for target in targets {
                    tx.execute("UPDATE bookkeeping_expenses SET status=?2,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND revision=?3",params![target.id,status.key(),target.revision]).map_err(db_error)?;
                    ids.push(target.id.clone());
                }
            }
            Mutation::Delete{target,deleted,..}=>{
                let before=current(tx,target,true)?;
                if before.deleted==*deleted { return Err(error("记录移除状态已变化，请刷新核对。")); }
                tx.execute("UPDATE bookkeeping_expenses SET deleted=?2,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND revision=?3",params![target.id,deleted,target.revision]).map_err(db_error)?;
                ids.push(target.id.clone());
            }
        }
        let result=ids.iter().map(|id|read(tx,id)?.ok_or_else(||error("操作回执不完整，未提交。"))).collect::<Result<Vec<_>,_>>()?;
        let raw=serde_json::to_string(&result).map_err(|_|error("无法保存操作回执，未提交。"))?;
        tx.execute("INSERT INTO bookkeeping_requests(id,input,result) VALUES(?1,?2,?3)",params![input.request_id(),payload,raw]).map_err(db_error)?;

        Ok(result)

}

pub(crate) fn validate_save(db:&Connection,revision:Option<i64>,content:&Content)->Result<(),StorageError>{
    validate(content)?;
    if revision.is_some_and(|r|!valid_revision(r)){return Err(error("开销版本无效。"));}
    for id in &content.receipt_ids{receipt(db,&content.id,id)?;}
    if let Some(revision)=revision{
        let before=current(db,&Target{id:content.id.clone(),revision},false)?;
        if content.status!=before.status&&!matches!(content.status,Status::Unclaimed|Status::Pending){return Err(error("提交与到账请使用报销状态操作，未改变记录。"));}
        if matches!(before.status,Status::Submitted|Status::Paid)&&matches!(content.status,Status::Submitted|Status::Paid)&&(before.amount_fen!=content.amount_fen||before.date!=content.date||before.purpose!=content.purpose||before.exchange!=content.exchange){return Err(error("已提交或已到账的开销，请先退回待提交再修改金额、用途、日期或汇率。"));}
    }else if !matches!(content.status,Status::Unclaimed|Status::Pending){return Err(error("新开销只能设为不报销或待提交。"));}
    Ok(())
}
pub(crate) fn validate_status(db:&Connection,target:&Target,status:Status)->Result<(),StorageError>{
    let before=current(db,target,false)?;
    if !matches!((before.status,status),(Status::Pending,Status::Submitted)|(Status::Submitted,Status::Paid)|(Status::Submitted,Status::Pending)|(Status::Paid,Status::Pending)){return Err(error("所选记录的报销状态不一致，整批未应用；请选择同一状态的记录。"));}
    Ok(())
}
