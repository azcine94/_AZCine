// Parent candidate: pure native models/auth/settings merge. No file or network I/O.
// The owning process manager must stop RPC/TUI and publish these files transactionally.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use url::Url;

const MAX_SAFE: u64 = 9_007_199_254_740_991;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelSettingsInput {
    pub provider: String,
    pub base_url: String,
    pub api: String,
    pub model_id: String,
    pub name: String,
    pub context_window: u64,
    pub max_tokens: u64,
    pub reasoning: bool,
    pub supports_images: bool,
    // Write-only credential. Deliberately no Debug/Serialize implementation.
    pub api_key: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSettingsView {
    pub provider: String,
    pub base_url: String,
    pub api: String,
    pub model_id: String,
    pub name: String,
    pub context_window: u64,
    pub max_tokens: u64,
    pub reasoning: bool,
    pub supports_images: bool,
    pub has_credential: bool,
    pub connection_verified: bool,
}
// Never serialize this container to IPC or logs: it includes the private auth document.
pub struct NativeConfigUpdate {
    pub models: Value,
    pub auth: Value,
    pub settings: Value,
    pub view: ModelSettingsView,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError { pub code: &'static str, pub message: &'static str }
fn invalid() -> ConfigError { ConfigError { code: "invalid_model_settings", message: "模型设置无效，请检查服务标识、HTTP(S)地址、API类型、模型名称及长度；未修改原配置。" } }
fn malformed() -> ConfigError { ConfigError { code: "native_config_invalid", message: "本应用原生配置结构不完整，未覆盖原文件；请先修复配置再保存。" } }
fn text(value: &str, limit: usize) -> bool { !value.trim().is_empty() && value.chars().count() <= limit && !value.chars().any(char::is_control) }
pub fn validate_connection(base_url: &str, api: &str, api_key: Option<&str>) -> Result<(), ConfigError> {
    if !matches!(api, "openai-completions"|"openai-responses"|"anthropic-messages"|"google-generative-ai") { return Err(invalid()); }
    let url = Url::parse(base_url).map_err(|_| invalid())?;
    if base_url.len() > 8192 || base_url.chars().any(char::is_control) || !matches!(url.scheme(), "http"|"https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() || url.query().is_some() { return Err(invalid()); }
    if let Some(key) = api_key.filter(|key| !key.is_empty()) {
        if key.len() > 16384 || key.trim() != key || key.chars().any(char::is_control) || key.starts_with('!') || key.starts_with('$') {
            return Err(ConfigError { code: "invalid_literal_key", message: "只接受直接填写的密钥，不执行命令或解析环境变量；输入与原认证保留。" });
        }
    }
    Ok(())
}
fn valid_input(input: &ModelSettingsInput) -> Result<(), ConfigError> {
    if input.provider.is_empty() || input.provider.len() > 80 || !input.provider.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-'|b'_'|b'.'))
        || !text(&input.model_id, 1000) || !text(&input.name, 2000)
        || !matches!(input.api.as_str(), "openai-completions"|"openai-responses"|"anthropic-messages"|"google-generative-ai")
        || input.context_window == 0 || input.max_tokens == 0 || input.context_window > MAX_SAFE || input.max_tokens > MAX_SAFE {
        return Err(invalid());
    }
    let url = Url::parse(&input.base_url).map_err(|_| invalid())?;
    if input.base_url.len() > 8192 || !matches!(url.scheme(), "http"|"https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() || url.query().is_some() {
        return Err(invalid());
    }
    if let Some(key) = &input.api_key {
        // GUI entry is a literal, not native command/env interpolation. Existing
        // user-written native auth is preserved, not resolved or executed here.
        if !key.is_empty() && (key.len() > 16384 || key.trim() != key || key.chars().any(char::is_control) || key.starts_with('!') || key.starts_with('$')) {
            return Err(ConfigError { code: "invalid_literal_key", message: "此输入框只接受直接填写的密钥，不执行命令或解析环境变量；原认证仍保留。" });
        }
    }
    Ok(())
}
fn object(value: &Value) -> Result<(), ConfigError> { if value.is_object() { Ok(()) } else { Err(malformed()) } }

pub fn plan_model_update(models: &Value, auth: &Value, settings: &Value, input: &ModelSettingsInput) -> Result<NativeConfigUpdate, ConfigError> {
    valid_input(input)?; object(models)?; object(auth)?; object(settings)?;
    let mut models = models.clone(); let mut auth = auth.clone(); let mut settings = settings.clone();
    let providers = models.as_object_mut().unwrap().entry("providers").or_insert_with(|| json!({})).as_object_mut().ok_or_else(malformed)?;
    let provider = providers.entry(input.provider.clone()).or_insert_with(|| json!({})).as_object_mut().ok_or_else(malformed)?;
    let rows = provider.entry("models").or_insert_with(|| json!([])).as_array_mut().ok_or_else(malformed)?;
    let mut match_index = None;
    for (index, row) in rows.iter().enumerate() {
        let id = row.get("id").and_then(Value::as_str).ok_or_else(malformed)?;
        if id == input.model_id {
            if match_index.is_some() { return Err(malformed()); }
            match_index = Some(index);
        }
    }
    let index = match_index.unwrap_or_else(|| { rows.push(json!({"id": input.model_id})); rows.len() - 1 });
    let model = rows[index].as_object_mut().ok_or_else(malformed)?;
    // Per-model endpoint/API avoids silently rewriting sibling model endpoints.
    model.insert("name".into(), json!(input.name)); model.insert("baseUrl".into(), json!(input.base_url)); model.insert("api".into(), json!(input.api));
    model.insert("contextWindow".into(), json!(input.context_window)); model.insert("maxTokens".into(), json!(input.max_tokens));
    model.insert("reasoning".into(), json!(input.reasoning));
    model.insert("input".into(), if input.supports_images { json!(["text","image"]) } else { json!(["text"]) });
    if let Some(key) = input.api_key.as_deref().filter(|key| !key.is_empty()) {
        let credentials = auth.as_object_mut().unwrap();
        let old = credentials.get(&input.provider);
        if old.is_some_and(|value| !value.is_object() || !matches!(value.get("type").and_then(Value::as_str), Some("api_key"|"oauth"))) { return Err(malformed()); }
        // Explicit new key replaces OAuth for this provider only. Keep native
        // env options for API keys; do not carry obsolete OAuth tokens forward.
        let mut credential = old.filter(|value| value.get("type").and_then(Value::as_str) == Some("api_key")).cloned().unwrap_or_else(|| json!({}));
        // Native auth resolves $NAME anywhere in the string, not just at its
        // beginning. Escape all dollars so the GUI field remains a literal.
        credential["type"] = json!("api_key"); credential["key"] = json!(key.replace('$', "$$"));
        credentials.insert(input.provider.clone(), credential);
    }
    let credential = auth.get(&input.provider);
    let has_credential = credential.is_some_and(|value| match value.get("type").and_then(Value::as_str) {
        Some("api_key") => value.get("key").and_then(Value::as_str).is_some_and(|key| !key.is_empty()),
        Some("oauth") => true,
        _ => false,
    }) || provider.get("apiKey").and_then(Value::as_str).is_some_and(|key| !key.is_empty());
    let preferences = settings.as_object_mut().unwrap();
    preferences.insert("defaultProvider".into(), json!(input.provider)); preferences.insert("defaultModel".into(), json!(input.model_id));
    preferences.insert("cacheWarming".into(), json!("off"));
    let retry = preferences.entry("retry").or_insert_with(|| json!({})).as_object_mut().ok_or_else(malformed)?;
    retry.insert("enabled".into(), json!(false));
    let provider_retry = retry.entry("provider").or_insert_with(|| json!({})).as_object_mut().ok_or_else(malformed)?;
    provider_retry.insert("maxRetries".into(), json!(0));
    let view = ModelSettingsView { provider: input.provider.clone(), base_url: input.base_url.clone(), api: input.api.clone(), model_id: input.model_id.clone(), name: input.name.clone(), context_window: input.context_window, max_tokens: input.max_tokens, reasoning: input.reasoning, supports_images: input.supports_images, has_credential, connection_verified: false };
    Ok(NativeConfigUpdate { models, auth, settings, view })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> ModelSettingsInput { ModelSettingsInput { provider:"test-provider".into(),base_url:"https://example.invalid/v1".into(),api:"openai-responses".into(),model_id:"test-model".into(),name:"测试模型".into(),context_window:128000,max_tokens:8192,reasoning:true,supports_images:false,api_key:Some("fixture-only-never-real".into()) } }
    #[test]
    fn given_native_configs_when_model_saved_then_only_target_changes_and_secret_never_returns() {
        let models=json!({"providers":{"other":{"apiKey":"fixture-other","models":[{"id":"keep"}]},"test-provider":{"baseUrl":"https://old.invalid/v1","headers":{"X-Example":"fixture"},"models":[{"id":"sibling","baseUrl":"https://sibling.invalid"},{"id":"test-model","compat":{"supportsStrictMode":false},"cost":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0}}]}}});
        let auth=json!({"other":{"type":"oauth","access":"fixture-access","refresh":"fixture-refresh","expires":1}});let settings=json!({"extensions":["user-extension.ts"],"retry":{"maxRetries":5,"provider":{"timeoutMs":25000}},"theme":"light"});
        let original=(models.clone(),auth.clone(),settings.clone());let result=plan_model_update(&models,&auth,&settings,&input()).unwrap();
        assert_eq!(result.models["providers"]["other"],models["providers"]["other"]);assert_eq!(result.models["providers"]["test-provider"]["models"][0],models["providers"]["test-provider"]["models"][0]);
        assert_eq!(result.models["providers"]["test-provider"]["baseUrl"],models["providers"]["test-provider"]["baseUrl"]);
        assert_eq!(result.models["providers"]["test-provider"]["models"][1]["compat"],models["providers"]["test-provider"]["models"][1]["compat"]);
        assert_eq!(result.auth["other"],auth["other"]);assert_eq!(result.auth["test-provider"]["key"],"fixture-only-never-real");
        assert_eq!(result.settings["extensions"],settings["extensions"]);assert_eq!(result.settings["retry"]["provider"]["timeoutMs"],25000);assert_eq!(result.settings["retry"]["enabled"],false);assert_eq!(result.settings["cacheWarming"],"off");
        assert!(!serde_json::to_string(&result.view).unwrap().contains("fixture-only"));assert!(!result.view.connection_verified);assert!(result.view.has_credential);assert_eq!((models,auth,settings),original);
    }
    #[test]
    fn given_empty_key_when_updating_model_then_original_native_auth_is_kept_without_execution() {
        let auth=json!({"test-provider":{"type":"api_key","key":"!fixture-command-never-run","env":{"REGION":"fixture"}}});
        for key in [None,Some(String::new())] {let mut i=input();i.api_key=key;let r=plan_model_update(&json!({}),&auth,&json!({}),&i).unwrap();assert_eq!(r.auth,auth);assert!(r.view.has_credential);}
        let mut i=input();i.api_key=None;let r=plan_model_update(&json!({}),&json!({}),&json!({}),&i).unwrap();assert!(!r.view.has_credential);
    }
    #[test]
    fn given_explicit_replacement_when_provider_used_oauth_then_replace_only_that_provider() {
        let auth=json!({"test-provider":{"type":"oauth","access":"old-fixture","refresh":"old-refresh","expires":1},"other":{"type":"api_key","key":"keep-fixture"}});
        let r=plan_model_update(&json!({}),&auth,&json!({}),&input()).unwrap();assert_eq!(r.auth["test-provider"],json!({"type":"api_key","key":"fixture-only-never-real"}));assert_eq!(r.auth["other"],auth["other"]);
    }
    #[test]
    fn given_invalid_fields_or_credential_expressions_when_planning_then_reject_without_echo() {
        for value in ["file:///C:/private","https://user:secret@example.invalid","https://example.invalid/?key=private","https://example.invalid/#secret", "not-a-url"] {let mut i=input();i.base_url=value.into();assert!(plan_model_update(&json!({}),&json!({}),&json!({}),&i).is_err());}
        for value in ["!fixture-secret","$FIXTURE_KEY"," fixture-secret","fixture\nsecret"] {let mut i=input();i.api_key=Some(value.into());let e=plan_model_update(&json!({}),&json!({}),&json!({}),&i).err().unwrap();assert!(!format!("{e:?}").contains(value));}
        let mut i=input();i.context_window=0;assert!(plan_model_update(&json!({}),&json!({}),&json!({}),&i).is_err());
    }
    #[test]
    fn given_literal_key_contains_dollars_when_planning_then_escape_native_interpolation() {
        let mut i=input();i.api_key=Some("fixture-$NAME-${OTHER}-$$-end".into());
        let r=plan_model_update(&json!({}),&json!({}),&json!({}),&i).unwrap();
        assert_eq!(r.auth["test-provider"]["key"], "fixture-$$NAME-$${OTHER}-$$$$-end");
        assert!(!serde_json::to_string(&r.view).unwrap().contains("fixture-$"));
    }
    #[test]
    fn given_malformed_native_structures_when_planning_then_never_replace_them_with_defaults() {
        let cases=[(json!([]),json!({}),json!({})),(json!({"providers":[]}),json!({}),json!({})),(json!({"providers":{"test-provider":{"models":false}}}),json!({}),json!({})),(json!({}),json!([]),json!({})),(json!({}),json!({}),json!({"retry":false})),(json!({"providers":{"test-provider":{"models":[{"id":"test-model"},{"id":"test-model"}]}}}),json!({}),json!({}))];
        for (models,auth,settings) in cases {let before=(models.clone(),auth.clone(),settings.clone());assert!(plan_model_update(&models,&auth,&settings,&input()).is_err());assert_eq!((models,auth,settings),before);}
    }
}
