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
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderSettingsInput {
    pub provider: String, pub base_url: String, pub api: String,
    // Never derives Debug or Serialize. Keys are write-only.
    pub api_key: Option<String>, pub models: Vec<ProviderModelInput>,
}
fn invalid() -> ConfigError { ConfigError { code: "pi_provider_invalid", message: "服务商配置无效：请添加1至200个模型，模型ID不能重复；输入与原配置保留。" } }

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
            let model_url = row.get("baseUrl").and_then(Value::as_str).unwrap_or(endpoint);
            let model_api = row.get("api").and_then(Value::as_str).unwrap_or(api);
            models.push(json!({"id":model_id,"name":row.get("name").and_then(Value::as_str).unwrap_or(model_id),
                "contextWindow":row.get("contextWindow").and_then(Value::as_u64).unwrap_or(128000),
                "maxTokens":row.get("maxTokens").and_then(Value::as_u64).unwrap_or(8192),
                "reasoning":row.get("reasoning").and_then(Value::as_bool).unwrap_or(false),
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
