use serde::{Deserialize, Serialize};
use crate::news_types::{Domain, Material};
use crate::storage::StorageError;

pub const PROMPT_VERSION: u32 = 1;
pub const BATCH_SIZE: usize = 20;
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ModelChoice { pub provider: String, pub id: String }
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct DomainRule { pub domain: Domain, pub enabled: bool, pub rule: String, pub min_score: u32, pub daily_limit: usize }
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct EditorialConfig {
    pub model: Option<ModelChoice>, pub domains: Vec<DomainRule>, pub featured_score: u32,
    pub overview_limit: usize, pub auto_collect: bool, pub auto_daily: bool, pub daily_time: String,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub collection_proxy: Option<String>,
}
impl Default for EditorialConfig {
    fn default() -> Self { Self { model: None, domains: vec![
        DomainRule { domain: Domain::Frontiers, enabled: true, rule: "大模型能力、研究、开放模型与开发工具；关注实际变化及证据限制。".into(), min_score: 50, daily_limit: 5 },
        DomainRule { domain: Domain::Industry, enabled: true, rule: "AI行业、产品、政策与商业动态；区分发布事实、营销说法和推测。".into(), min_score: 50, daily_limit: 5 },
        DomainRule { domain: Domain::Visual, enabled: true, rule: "AI视频、图片及影视CG应用；关注制作流程、工具能力和可验证的局限。".into(), min_score: 50, daily_limit: 5 },
    ], featured_score: 75, overview_limit: 3, auto_collect: false, auto_daily: false, daily_time: "09:00".into(), collection_proxy: None } }
}
pub fn validate_config(config: &EditorialConfig) -> Result<(), StorageError> {
    let time: Vec<_> = config.daily_time.split(':').collect();
    if config.domains.len()!=3 || config.featured_score>100 || config.overview_limit>3 || time.len()!=2
        || time[0].len()!=2 || time[1].len()!=2 || time[0].parse::<u32>().map_or(true, |n|n>23)
        || time[1].parse::<u32>().map_or(true, |n|n>59)
        || config.domains.iter().enumerate().any(|(i,r)|config.domains[..i].iter().any(|p|p.domain==r.domain)
            || r.rule.trim().is_empty() || r.rule.chars().count()>2000 || r.min_score>100 || r.daily_limit>5)
        || config.model.as_ref().is_some_and(|m|m.provider.trim().is_empty()||m.id.trim().is_empty()||m.provider.len()>200||m.id.len()>300) {
        return Err(StorageError::new("news_config_invalid", "请填写三个领域的规则、0–100评分、有效数量和北京时间HH:MM；输入保留。"));
    }
    if let Some(proxy) = &config.collection_proxy { crate::news_http::proxy_server(proxy)?; }
    Ok(())
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Preferences { pub config: EditorialConfig, pub revision: i64 }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct SavePreferences { pub request_id: String, pub expected_revision: i64, pub config: EditorialConfig }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct CitedText { pub text: String, pub material_ids: Vec<String> }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct EventDraft {
    pub event_key: String, pub material_ids: Vec<String>, pub domain: Option<Domain>,
    pub title: String, pub summary: String, pub facts: Vec<CitedText>, pub score: u32,
    pub reason: String, pub tags: Vec<String>, pub limitations: Vec<String>, pub needs_review: bool, pub has_new_facts: bool,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct EditorialReply { pub events: Vec<EventDraft> }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Event {
    pub id: String, pub revision: i64, pub draft: EventDraft, pub materials: Vec<Material>,
    pub generated_at: String, pub latest_at: String, pub config_revision: i64, pub model: ModelChoice,
    pub prompt_version: u32, pub featured: bool, pub analysis: Option<EventAnalysis>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct EventAnalysis { pub generated_at: String, pub model: ModelChoice, pub judgments: Vec<CitedText>, pub limitations: Vec<String> }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Edition {
    pub id: String, pub date: String, pub version: i64, pub generated_at: String,
    pub window_start: String, pub window_end: String, pub config_revision: i64,
    pub overview_ids: Vec<String>, pub events: Vec<Event>, pub incomplete: bool, pub gaps: Vec<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct EditorialRun {
    pub id: String, pub kind: String, pub status: String, pub started_at: String, pub finished_at: Option<String>,
    pub window_start: String, pub window_end: String, pub config_revision: i64,
    pub config: EditorialConfig,
    pub sources: Vec<crate::news_types::Source>,
    #[serde(default)] pub event_id: Option<String>,
    #[serde(default)] pub event_revision: Option<i64>,
    pub total: usize, pub processed: usize, pub error: Option<String>, pub schedule_date: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct EditorialSnapshot {
    pub preferences: Preferences, pub events: Vec<Event>, pub editions: Vec<Edition>, pub runs: Vec<EditorialRun>,
    pub pending: usize, pub next_daily_at: Option<String>,
}
pub fn invalid_reply() -> StorageError { StorageError::new("news_ai_invalid", "模型结果缺字段、引用不对应或超过范围，没有发布；材料与已有结果保留，可只重试失败部分。") }

#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ProcessingSelection { pub scope:String,pub material_id:Option<String>,pub batch_size:usize }
impl ProcessingSelection {
    pub fn validate(&self)->Result<(),StorageError>{
        if !(1..=20).contains(&self.batch_size)||!matches!(self.scope.as_str(),"single"|"all")
            ||self.scope=="single"&&self.material_id.as_ref().is_none_or(|v|v.len()!=32||!v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))
            ||self.scope=="all"&&self.material_id.is_some(){return Err(StorageError::new("news_scope_invalid","请选择单条资料或明确选择全部处理，每批1至20条；没有启动任务。"));}Ok(())
    }
}
pub fn legacy_batch_size()->usize{BATCH_SIZE}
