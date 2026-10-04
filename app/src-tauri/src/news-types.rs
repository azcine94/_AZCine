use serde::{Deserialize, Serialize};
use crate::storage::StorageError;

pub const MAX_REVISION: i64 = 9_007_199_254_740_991;
pub const PAGE_SIZE: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceIdentity { Official, Research, Media, Individual }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Domain { Frontiers, Industry, Visual }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceUsage { Editorial, Watch }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FeedKind { Rss, Atom }

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceConfig {
    pub id: String,
    pub name: String,
    pub feed_url: String,
    pub identity: SourceIdentity,
    pub domains: Vec<Domain>,
    pub usage: SourceUsage,
    pub interval_minutes: u32,
    pub enabled: bool,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveSource {
    pub request_id: String,
    pub expected_revision: Option<i64>,
    pub source: SourceConfig,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub config: SourceConfig,
    pub revision: i64,
    pub created_at: String,
    pub feed_kind: Option<FeedKind>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_status: Option<RunStatus>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus { Queued, Fetching, Parsing, Saving, Added, NoNew, FetchFailed, ParseFailed, SaveFailed, Interrupted }
impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued", Self::Fetching => "fetching", Self::Parsing => "parsing", Self::Saving => "saving",
            Self::Added => "added", Self::NoNew => "noNew", Self::FetchFailed => "fetchFailed",
            Self::ParseFailed => "parseFailed", Self::SaveFailed => "saveFailed", Self::Interrupted => "interrupted",
        }
    }
    pub fn from_str(value: &str) -> Result<Self, StorageError> {
        match value {
            "queued" => Ok(Self::Queued), "fetching" => Ok(Self::Fetching), "parsing" => Ok(Self::Parsing), "saving" => Ok(Self::Saving),
            "added" => Ok(Self::Added), "noNew" => Ok(Self::NoNew), "fetchFailed" => Ok(Self::FetchFailed),
            "parseFailed" => Ok(Self::ParseFailed), "saveFailed" => Ok(Self::SaveFailed), "interrupted" => Ok(Self::Interrupted),
            _ => Err(invalid_data()),
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RetryStage { Fetch, Parse, Save }
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRun {
    pub id: String,
    pub source_id: String,
    pub source_name: String,
    pub source_revision: i64,
    pub started_at: String,
    pub attempted_at: String,
    pub finished_at: Option<String>,
    pub status: RunStatus,
    pub fetched: usize,
    pub added: usize,
    pub skipped: usize,
    pub error: Option<String>,
    pub warning: Option<String>,
    pub retry_stage: Option<RetryStage>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedEntry {
    pub external_id: Option<String>,
    pub title: String,
    pub url: String,
    pub published_at: Option<String>,
    pub published_raw: Option<String>,
    pub summary: Option<String>,
    pub summary_truncated: bool,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParsedFeed {
    pub kind: FeedKind,
    pub entries: Vec<FeedEntry>,
    pub skipped: usize,
    pub warning: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub fetched_at: String,
    pub kind: FeedKind,
    pub total: usize,
    pub skipped: usize,
    pub warning: Option<String>,
    pub entries: Vec<FeedEntry>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub id: String,
    pub source_id: String,
    pub source_name: String,
    pub source_revision: i64,
    pub title: String,
    pub url: String,
    pub published_at: Option<String>,
    pub published_raw: Option<String>,
    pub discovered_at: String,
    pub summary: Option<String>,
    pub summary_truncated: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPage { pub items: Vec<Material>, pub total: usize, pub page: usize, pub page_size: usize }
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsSnapshot { pub sources: Vec<Source>, pub runs: Vec<CollectionRun> }

pub fn uuid(value: &str) -> bool {
    value.len() == 36 && value.bytes().enumerate().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() })
}
pub fn source_id(value: &str) -> bool {
    uuid(value) || value.starts_with("rss-") && value.len() <= 100 && value.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
pub fn invalid_data() -> StorageError { StorageError::new("news_data_invalid", "资讯记录不完整，未用空列表替换。请保留数据目录并重新核对。") }
pub fn validate_source(source: &SourceConfig) -> Result<(), StorageError> {
    if !source_id(&source.id) || source.name.trim().is_empty() || source.name.chars().count() > 200 || source.name.contains('\0') {
        return Err(StorageError::new("invalid_news_source", "请填写 1–200 字的信源名称，并使用有效来源编号。"));
    }
    crate::news_http::public_url(&source.feed_url)?;
    if !(15..=10080).contains(&source.interval_minutes) || source.domains.len() > 3
        || source.domains.iter().enumerate().any(|(i, domain)| source.domains[..i].contains(domain)) {
        return Err(StorageError::new("invalid_news_source", "覆盖领域不能重复；采集频率需为 15–10080 分钟的整数。"));
    }
    Ok(())
}
