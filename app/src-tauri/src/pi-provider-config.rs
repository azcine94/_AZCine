//! Provider batches use the existing native model merge and publication transaction.
use crate::pi_model_config::{ConfigError, ModelSettingsInput, plan_model_update};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashSet;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderModelInput {
    pub id: String, pub name: String, pub context_window: u64, pub max_tokens: u64,
    pub reasoning: bool, pub supports_images: bool,
    pub base_url: Option<String>, pub api: Option<String>,
    pub thinking_level_map: Option<Value>, pub default_thinking_level: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderSettingsInput {
    pub provider: String, pub base_url: String, pub api: String,
    // Never derives Debug or Serialize. Keys are write-only.
    pub api_key: Option<String>, pub models: Vec<ProviderModelInput>,
}
fn invalid() -> ConfigError { ConfigError { code: "pi_provider_invalid", message: "服务商配置无效：请添加1至200个模型，模型ID不能重复；输入与原配置保留。" } }
const LEVELS: [&str; 7] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ProviderDeleteInput { pub provider:String, pub model_id:Option<String>, pub expected_models:Vec<String> }
pub fn plan_provider_delete(documents:&[Value;3],input:&ProviderDeleteInput)->Result<[Value;3],ConfigError>{
    let conflict=||ConfigError{code:"pi_provider_conflict",message:"服务商或模型已变化，请重新读取后删除；原配置保留。"};
    let mut next=documents.clone();
    let provider=next[0].get_mut("providers").and_then(Value::as_object_mut).and_then(|p|p.get_mut(&input.provider)).ok_or_else(conflict)?;
    let rows=match provider.get("models"){Some(v)=>v.as_array().ok_or_else(conflict)?.as_slice(),None=>&[]};
    let actual=rows.iter().map(|m|m["id"].as_str().map(str::to_owned).ok_or_else(conflict)).collect::<Result<Vec<_>,_>>()?;
    if actual!=input.expected_models{return Err(conflict());}
    if let Some(id)=&input.model_id {if !actual.contains(id){return Err(conflict());}provider.get_mut("models").and_then(Value::as_array_mut).ok_or_else(conflict)?.retain(|m|m["id"].as_str()!=Some(id.as_str()));}
    else {next[0]["providers"].as_object_mut().ok_or_else(conflict)?.remove(&input.provider);next[1].as_object_mut().ok_or_else(conflict)?.remove(&input.provider);}
    let matches=|id:&str|input.model_id.as_deref().is_none_or(|m|m==id);
    if documents[2]["defaultProvider"]==input.provider && matches(documents[2]["defaultModel"].as_str().unwrap_or("")) {
        let settings=next[2].as_object_mut().ok_or_else(conflict)?;settings.remove("defaultProvider");settings.remove("defaultModel");
    }
    if let Some(levels)=next[2].get_mut("modelThinkingLevels").and_then(Value::as_object_mut){let prefix=format!("{}/",input.provider);levels.retain(|key,_|!key.strip_prefix(&prefix).is_some_and(matches));}
    Ok(next)
}
pub fn valid_thinking_map(value: &Value) -> bool {
    value.as_object().is_some_and(|map| map.iter().all(|(key, value)| LEVELS.contains(&key.as_str()) && (value.is_null() || value.as_str().is_some_and(|s| s.len() <= 100 && !s.chars().any(char::is_control)))))
}

pub fn plan_provider_update(documents: &[Value; 3], input: &ProviderSettingsInput) -> Result<[Value; 3], ConfigError> {
    crate::pi_model_config::validate_connection(&input.base_url, &input.api, input.api_key.as_deref())?;
    if input.models.is_empty() || input.models.len() > 200 { return Err(invalid()); }
    let mut ids = HashSet::new();
    let mut next = documents.clone();
    for model in &input.models {
        if !ids.insert(model.id.as_str()) { return Err(invalid()); }
        let model_input = ModelSettingsInput {
            provider: input.provider.clone(), base_url: model.base_url.as_ref().filter(|s| !s.is_empty()).unwrap_or(&input.base_url).clone(),
            api: model.api.as_ref().filter(|s| !s.is_empty()).unwrap_or(&input.api).clone(), api_key: input.api_key.clone(),
            model_id: model.id.clone(), name: model.name.clone(), context_window: model.context_window,
            max_tokens: model.max_tokens, reasoning: model.reasoning, supports_images: model.supports_images,
        };
        let update = plan_model_update(&next[0], &next[1], &next[2], &model_input)?;
        next = [update.models, update.auth, update.settings];
        if let Some(mapping) = &model.thinking_level_map {
            if !valid_thinking_map(mapping) { return Err(invalid()); }
            let row = next[0]["providers"][&input.provider]["models"].as_array_mut().ok_or_else(invalid)?.iter_mut().find(|row| row["id"] == model.id).ok_or_else(invalid)?;
            row["thinkingLevelMap"] = mapping.clone();
        }
        if let Some(level) = &model.default_thinking_level {
            let mapping = next[0]["providers"][&input.provider]["models"].as_array().ok_or_else(invalid)?.iter().find(|row| row["id"] == model.id).and_then(|row|row.get("thinkingLevelMap"));
            let mapped = mapping.and_then(|map|map.get(level));
            if !LEVELS.contains(&level.as_str()) || (!model.reasoning && level != "off") || (model.reasoning && (mapped.is_some_and(Value::is_null) || matches!(level.as_str(), "xhigh"|"max") && mapped.is_none())) { return Err(invalid()); }
            let levels = next[2].as_object_mut().ok_or_else(invalid)?.entry("modelThinkingLevels").or_insert_with(||json!({})).as_object_mut().ok_or_else(invalid)?;
            levels.insert(format!("{}/{}", input.provider, model.id), json!(level));
        }
    }
    next[0]["providers"][&input.provider]["baseUrl"] = json!(input.base_url);
    next[0]["providers"][&input.provider]["api"] = json!(input.api);
    // Editing another provider must not change the user's existing default model.
    for field in ["defaultProvider", "defaultModel"] {
        if let Some(value) = documents[2].get(field) { next[2][field] = value.clone(); }
        else { next[2].as_object_mut().ok_or_else(invalid)?.remove(field); }
    }
    if documents[2].get("defaultProvider").is_none() && documents[2].get("defaultModel").is_none() {
        next[2]["defaultProvider"] = json!(input.provider);
        next[2]["defaultModel"] = json!(input.models[0].id);
    }
    Ok(next)
}

/// Explicit field selection: no auth values, headers, arbitrary native JSON or pricing.
pub fn provider_views(documents: &[Value; 3]) -> Result<Value, ConfigError> {
    let mut result: Vec<Value> = Vec::new();
    let Some(providers) = documents[0].get("providers") else { return Ok(json!(result)); };
    let providers = providers.as_object().ok_or_else(invalid)?;
    for (id, provider) in providers {
        if !provider.is_object() { return Err(invalid()); }
        let rows = match provider.get("models") { None => &[][..], Some(rows) => rows.as_array().ok_or_else(invalid)?.as_slice() };
        let endpoint = provider.get("baseUrl").and_then(Value::as_str).or_else(|| rows.first().and_then(|m| m.get("baseUrl")).and_then(Value::as_str)).unwrap_or("");
        let api = provider.get("api").and_then(Value::as_str).or_else(|| rows.first().and_then(|m| m.get("api")).and_then(Value::as_str)).unwrap_or("openai-completions");
        // Native files can contain credentials inside URLs; those must never reach the view.
        for value in std::iter::once(endpoint).chain(rows.iter().filter_map(|m|m.get("baseUrl").and_then(Value::as_str))) {
            if !value.is_empty() {
                let url = url::Url::parse(value).map_err(|_|invalid())?;
                if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() { return Err(invalid()); }
            }
        }
        let mut models = Vec::new();
        for row in rows {
            let model_id = row.get("id").and_then(Value::as_str).ok_or_else(invalid)?;
            if row.get("thinkingLevelMap").is_some_and(|value| !valid_thinking_map(value)) { return Err(invalid()); }
            let model_url = row.get("baseUrl").and_then(Value::as_str).unwrap_or(endpoint);
            let model_api = row.get("api").and_then(Value::as_str).unwrap_or(api);
            models.push(json!({"id":model_id,"name":row.get("name").and_then(Value::as_str).unwrap_or(model_id),
                "contextWindow":row.get("contextWindow").and_then(Value::as_u64).unwrap_or(128000),
                "maxTokens":row.get("maxTokens").and_then(Value::as_u64).unwrap_or(8192),
                "reasoning":row.get("reasoning").and_then(Value::as_bool).unwrap_or(false),
                "thinkingLevelMap":row.get("thinkingLevelMap"),
                "defaultThinkingLevel":documents[2].get("modelThinkingLevels").and_then(|levels|levels.get(format!("{id}/{model_id}"))).and_then(Value::as_str).or_else(||documents[2].get("defaultThinkingLevel").and_then(Value::as_str)).unwrap_or("medium"),
                "supportsImages":row.get("input").and_then(Value::as_array).is_some_and(|v|v.iter().any(|v|v=="image")),
                "baseUrl":if model_url==endpoint {""}else{model_url}, "api":if model_api==api {""}else{model_api}}));
        }
        let credential = documents[1].get(id);
        let has_credential = credential.is_some_and(|v|v.get("type")==Some(&json!("oauth")) || v.get("key").and_then(Value::as_str).is_some_and(|v|!v.is_empty()))
            || provider.get("apiKey").and_then(Value::as_str).is_some_and(|v|!v.is_empty());
        result.push(json!({"provider":id,"baseUrl":endpoint,"api":api,"hasCredential":has_credential,"models":models}));
    }
    Ok(json!(result))
}
