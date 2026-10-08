use serde::{Serialize,Deserialize};
use crate::{news_editorial_types::ModelChoice,news_types::Material,storage::StorageError};
use std::collections::BTreeMap;
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SourceRule {pub source_id:String,pub tier:String,pub fetch_body:bool,pub display_body:bool}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PipelineConfig {
    #[serde(default)] pub models:BTreeMap<String,ModelChoice>,
    #[serde(default)] pub sources:Vec<SourceRule>,
    pub requests_per_minute:u32,pub requests_per_hour:u32,pub requests_per_day:u32,
}
impl Default for PipelineConfig {fn default()->Self{Self{models:BTreeMap::new(),sources:vec![],requests_per_minute:60,requests_per_hour:1000,requests_per_day:5000}}}
pub const STAGES:&[&str]=&["prefilter","score","structure","writing","translation","grouping","digest","period"];
impl PipelineConfig {pub fn validate(&self)->Result<(),StorageError>{
    if self.models.iter().any(|(s,m)|!STAGES.contains(&s.as_str())||m.provider.trim().is_empty()||m.id.trim().is_empty()||m.provider.len()>200||m.id.len()>300)
        || self.sources.iter().enumerate().any(|(i,r)|r.source_id.is_empty()||r.source_id.len()>200||!["T1","T1_5","T2","EXCLUDE_MP"].contains(&r.tier.as_str())||self.sources[..i].iter().any(|p|p.source_id==r.source_id))
        || [self.requests_per_minute,self.requests_per_hour,self.requests_per_day].iter().any(|n|*n>100000){return Err(StorageError::new("news_pipeline_config_invalid","步骤模型、信源等级或请求额度无效，草稿保留。"));}Ok(())
}}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Article {
    #[serde(default,skip_serializing_if="Option::is_none")]pub legacy_event_id:Option<String>,
    pub id:String,pub material:Material,pub title_zh:String,pub summary_zh:String,pub reason:String,
    pub category:Option<String>,pub tags:Vec<String>,pub subjects:Vec<String>,pub scope:String,pub fact:serde_json::Value,
    pub score_first:Option<u32>,pub score_second:Option<u32>,pub score:Option<f64>,pub tier:String,pub selected:bool,
    pub adds_value:bool,pub selection_reason:String,pub occurrence_id:String,pub story_id:String,
    pub original_body:String,pub translated_body:Option<String>,pub body_kind:String,pub body_error:Option<String>,pub display_body:bool,
    #[serde(default)]pub translation_complete:bool,
    #[serde(default,skip_serializing_if="Option::is_none")]pub translation_error:Option<String>,
    pub status:String,pub processed_at:String,pub config_revision:i64,pub upstream:String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Prefilter {pub label:String,pub reason:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Score {pub attention_score:u32}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Structure {pub category:Option<String>,pub tags:Vec<String>,pub subjects:Vec<String>,pub scope:String,pub fact:serde_json::Value}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Writing {pub item_type:String,pub author_role:String,pub tags:Vec<String>,pub editorial_judgment:String,pub title_zh:String,pub summary_zh:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Grouping {pub query:String,pub decisions:Vec<Decision>,pub selection:Selection}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {pub id:String,pub relation:String,pub confidence:f64,#[serde(default)]pub note:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Selection {pub adds_value:bool,pub reason:String}
