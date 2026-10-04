//! App-side native configuration publication. The caller holds exclusive RPC/TUI
//! ownership while opening, recovering or saving. No credentials go into errors,
//! IPC views or logs. Private transaction files must be excluded from backups.
use crate::pi_model_config::{ConfigError, ModelSettingsInput, ModelSettingsView, plan_model_update};
use crate::pi_provider_config::{ProviderSettingsInput, plan_provider_update, provider_views};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}};

const LIMIT: u64 = 2 * 1024 * 1024;
const FILES: [&str; 3] = ["models.json", "auth.json", "settings.json"];
fn failure(code: &'static str, message: &'static str) -> ConfigError { ConfigError { code, message } }
fn io_error(_: std::io::Error) -> ConfigError { failure("pi_config_io", "模型配置不能完整保存或读取，请检查空间、目录权限与占用。输入保留；未报告成功，重新连接前会先核对未完成写入。") }
fn broken() -> ConfigError { failure("pi_config_invalid", "本应用原生配置或未完成写入记录损坏，已停止保存和启动，未用空配置覆盖。请保留原文件并修复后重试。") }
fn changed() -> ConfigError { failure("pi_config_changed", "未完成的配置写入期间，原生文件又被修改；已停止恢复，不覆盖这些新修改。请保留原文件后核对。") }

// Checking every owned segment before use also refuses Windows directory junctions.
// This is an ownership check, not an OS sandbox against simultaneous hostile changes.
fn reject_link(path: &Path) -> Result<(), ConfigError> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            { use std::os::windows::fs::MetadataExt; if meta.file_attributes() & 0x400 != 0 { return Err(failure("pi_path_link", "Pi 自有目录中发现链接或重解析路径，已停止以免读写其他环境。")); } }
            if meta.file_type().is_symlink() { return Err(failure("pi_path_link", "Pi 自有目录中发现链接，已停止以免读写其他环境。")); }
            Ok(())
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_error(e)),
    }
}
fn directory(path: &Path) -> Result<(), ConfigError> {
    reject_link(path)?;
    match fs::create_dir(path) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && path.is_dir() => Ok(()), Err(e) => Err(io_error(e)) }
}
fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, ConfigError> {
    reject_link(path)?;
    let file = match File::open(path) { Ok(f) => f, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(e) => return Err(io_error(e)) };
    let meta = file.metadata().map_err(io_error)?;
    if !meta.is_file() || meta.len() > LIMIT { return Err(failure("pi_config_limit", "原生配置不是普通文件或超过 2 MiB，未读取或覆盖。")); }
    let mut bytes = Vec::new(); file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(io_error)?;
    if bytes.len() as u64 > LIMIT { return Err(failure("pi_config_limit", "原生配置超过 2 MiB，未读取或覆盖。")); }
    Ok(Some(bytes))
}
fn read_required(path: &Path) -> Result<Vec<u8>, ConfigError> { read_optional(path)?.ok_or_else(broken) }
fn fresh_file(path: &Path, bytes: &[u8]) -> Result<(), ConfigError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path).map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?; file.sync_all().map_err(io_error)
}
fn publish(agent: &Path, name: &str, bytes: &[u8]) -> Result<(), ConfigError> {
    reject_link(&agent.join(name))?;
    let mut candidate = tempfile::Builder::new().prefix(".azcine-config-pending-").suffix(".json").tempfile_in(agent).map_err(io_error)?;
    candidate.disable_cleanup(true);
    candidate.write_all(bytes).map_err(io_error)?; candidate.as_file().sync_all().map_err(io_error)?;
    // Rename replaces one complete file, never truncates the active configuration.
    candidate.persist(agent.join(name)).map_err(|e| io_error(e.error))?;
    Ok(())
}

/// Strip JSON comments only outside quoted strings; BOM is native-compatible.
/// We preserve unknown values, not comments/formatting. Trailing commas are not JSON.
fn parse_document(bytes: Option<&[u8]>) -> Result<Value, ConfigError> {
    let Some(bytes) = bytes else { return Ok(json!({})); };
    let text = std::str::from_utf8(bytes).map_err(|_| broken())?.trim_start_matches('\u{feff}');
    let mut result = text.as_bytes().to_vec(); let mut i = 0; let mut quoted = false;
    while i < result.len() {
        if quoted {
            if result[i] == b'\\' { i += 2; continue; }
            if result[i] == b'"' { quoted = false; }
            i += 1; continue;
        }
        if result[i] == b'"' { quoted = true; i += 1; continue; }
        if result[i] == b'/' && result.get(i+1) == Some(&b'/') {
            while i < result.len() && !matches!(result[i], b'\n'|b'\r') { result[i] = b' '; i += 1; }
        } else if result[i] == b'/' && result.get(i+1) == Some(&b'*') {
            result[i] = b' '; result[i+1] = b' '; i += 2; let mut closed = false;
            while i < result.len() {
                if result[i] == b'*' && result.get(i+1) == Some(&b'/') { result[i] = b' '; result[i+1] = b' '; i += 2; closed = true; break; }
                if !matches!(result[i], b'\n'|b'\r') { result[i] = b' '; } i += 1;
            }
            if !closed { return Err(broken()); }
        } else { i += 1; }
    }
    let value: Value = serde_json::from_slice(&result).map_err(|_| broken())?;
    if !value.is_object() { return Err(broken()); } Ok(value)
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Transaction { version: u32, existed: [bool; 3] }

pub struct ConfigStore { agent: PathBuf, transactions: PathBuf }
impl ConfigStore {
    pub fn open(root: &Path) -> Result<Self, ConfigError> {
        if !root.is_absolute() || !root.is_dir() { return Err(failure("pi_root_required", "请先选择有效的 AZCine 数据目录。")); }
        let root = fs::canonicalize(root).map_err(io_error)?;
        let pi = root.join("pi"); directory(&pi)?;
        let agent = pi.join("agent"); directory(&agent)?;
        let transactions = pi.join("private-config-transactions"); directory(&transactions)?;
        let store = Self { agent, transactions }; store.recover()?; Ok(store)
    }
    pub fn agent_dir(&self) -> &Path { &self.agent }
    /// Private application-owned documents only. Never serialize this result to
    /// the WebView, diagnostics or backups. No command/env credential resolution.
    pub fn private_documents(&self) -> Result<[Value; 3], ConfigError> {
        let bytes = self.originals()?;
        let auth = match bytes[1].as_deref() {
            Some(bytes) => serde_json::from_slice(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes)).map_err(|_| broken())?,
            None => json!({}),
        };
        if !auth.is_object() { return Err(broken()); }
        Ok([parse_document(bytes[0].as_deref())?, auth, parse_document(bytes[2].as_deref())?])
    }
    fn originals(&self) -> Result<[Option<Vec<u8>>; 3], ConfigError> {
        Ok([read_optional(&self.agent.join(FILES[0]))?, read_optional(&self.agent.join(FILES[1]))?, read_optional(&self.agent.join(FILES[2]))?])
    }
    pub fn recover(&self) -> Result<usize, ConfigError> {
        reject_link(&self.agent)?; reject_link(&self.transactions)?;
        let mut pending = Vec::new();
        for entry in fs::read_dir(&self.transactions).map_err(io_error)? {
            let entry = entry.map_err(io_error)?; let path = entry.path(); reject_link(&path)?;
            if !entry.file_type().map_err(io_error)?.is_dir() { return Err(broken()); }
            let ready = path.join("prepared"); let done = path.join("committed");
            reject_link(&ready)?; reject_link(&done)?;
            if done.try_exists().map_err(io_error)? { if !done.is_dir() { return Err(broken()); } continue; }
            if ready.try_exists().map_err(io_error)? { if !ready.is_dir() { return Err(broken()); } pending.push(path); }
            // An interruption before the prepared marker cannot have published anything.
        }
        if pending.len() > 1 { return Err(broken()); }
        for path in &pending { self.finish(path, |_| Ok(()))?; }
        Ok(pending.len())
    }
    fn finish(&self, txn: &Path, mut before_publish: impl FnMut(usize) -> Result<(), ConfigError>) -> Result<(), ConfigError> {
        let descriptor: Transaction = serde_json::from_slice(&read_required(&txn.join("manifest.json"))?).map_err(|_| broken())?;
        if descriptor.version != 1 { return Err(broken()); }
        let current = self.originals()?;
        let mut next = Vec::new();
        // Verify all three first. A manual edit blocks the entire recovery before further writes.
        for (index, name) in FILES.iter().enumerate() {
            let before = if descriptor.existed[index] { Some(read_required(&txn.join(format!("before-{name}")))?) } else { None };
            let after = read_required(&txn.join(format!("after-{name}")))?;
            parse_document(Some(&after))?;
            if current[index] != before && current[index].as_deref() != Some(after.as_slice()) { return Err(changed()); }
            next.push(after);
        }
        for (index, name) in FILES.iter().enumerate() {
            if current[index].as_deref() != Some(next[index].as_slice()) {
                before_publish(index)?; publish(&self.agent, name, &next[index])?;
            }
        }
        // Verify durable publication before success. An interrupted marker is recoverable.
        let actual = self.originals()?;
        if actual.iter().zip(&next).any(|(a,b)| a.as_deref() != Some(b.as_slice())) { return Err(changed()); }
        fs::create_dir(txn.join("committed")).map_err(io_error)?; Ok(())
    }
    pub fn save(&self, input: &ModelSettingsInput) -> Result<ModelSettingsView, ConfigError> { self.save_with_hook(input, |_| Ok(())) }
    fn save_with_hook(&self, input: &ModelSettingsInput, hook: impl FnMut(usize) -> Result<(), ConfigError>) -> Result<ModelSettingsView, ConfigError> {
        self.recover()?;
        let before = self.originals()?;
        let models = parse_document(before[0].as_deref())?;
        // Unlike models/settings, upstream auth.json accepts JSON but not comments.
        let auth: Value = match before[1].as_deref() {
            Some(bytes) => serde_json::from_slice(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes)).map_err(|_| broken())?,
            None => json!({}),
        };
        let settings = parse_document(before[2].as_deref())?;
        let update = plan_model_update(&models, &auth, &settings, input)?;
        self.publish_documents(&before, [update.models, update.auth, update.settings], hook)?;
        Ok(update.view)
    }
    pub fn providers(&self) -> Result<Value, ConfigError> {
        let documents = self.private_documents()?;
        let view = provider_views(&documents)?;
        Ok(crate::pi_redactor::Redactor::from_documents(&documents[0], &documents[1]).value(view, false))
    }
    pub fn model_list_key(&self, provider: &str, base_url: &str) -> Result<Option<String>, ConfigError> {
        let docs = self.private_documents()?;
        let service = docs[0].get("providers").and_then(|v|v.get(provider));
        if service.is_none() { return Ok(None); }
        let same_url = |value: &Value| value.as_str().is_some_and(|s|s.trim_end_matches('/') == base_url.trim_end_matches('/'));
        let known_address = service.is_some_and(|s|s.get("baseUrl").is_some_and(same_url)
            || s.get("models").and_then(Value::as_array).is_some_and(|rows|rows.iter().any(|m|m.get("baseUrl").is_some_and(same_url))));
        if !known_address { return Err(failure("pi_key_address", "此地址尚未保存，请填写它的Key；不会向新地址发送已有服务商的认证。")); }
        let auth = docs[1].get(provider);
        if auth.is_some_and(|a|a.get("type").and_then(Value::as_str)==Some("oauth")) {
            return Err(failure("pi_list_key_required", "获取模型暂不支持OAuth认证，请填写用于模型列表接口的Key；原认证保留。"));
        }
        let key = auth.and_then(|a|a.get("key")).and_then(Value::as_str).or_else(||service.and_then(|s|s.get("apiKey")).and_then(Value::as_str));
        let Some(key) = key.filter(|s|!s.is_empty()) else { return Ok(None); };
        if key.starts_with('!') { return Err(failure("pi_list_key_required", "现有认证不是直接填写的Key，请重新填写；不执行命令或读取外部环境。")); }
        let mut literal=String::new(); let mut chars=key.chars();
        while let Some(ch)=chars.next() {
            if ch=='$' { if chars.next()!=Some('$') { return Err(failure("pi_list_key_required", "现有认证包含环境引用，请直接填写Key；不读取外部环境。")); } literal.push('$'); }
            else { literal.push(ch); }
        }
        Ok(Some(literal))
    }
    pub fn save_provider(&self, input: &ProviderSettingsInput) -> Result<(), ConfigError> {
        self.recover()?;
        let before = self.originals()?;
        let documents = self.private_documents()?;
        // The plan and publication must refer to the same native file snapshot.
        if self.originals()? != before { return Err(changed()); }
        let next = plan_provider_update(&documents, input)?;
        self.publish_documents(&before, next, |_| Ok(()))
    }
    fn publish_documents(&self, before: &[Option<Vec<u8>>; 3], next: [Value; 3], hook: impl FnMut(usize) -> Result<(), ConfigError>) -> Result<(), ConfigError> {
        let encoded: Vec<Vec<u8>> = next.iter().map(|v| serde_json::to_vec_pretty(v).map_err(|_| broken())).collect::<Result<_,_>>()?;
        if encoded.iter().any(|bytes| bytes.len() as u64 > LIMIT) { return Err(failure("pi_config_limit", "保存后的原生配置超过 2 MiB，未修改原配置。")); }
        let txn = tempfile::Builder::new().prefix("native-").tempdir_in(&self.transactions).map_err(io_error)?.keep();
        for (index, name) in FILES.iter().enumerate() {
            if let Some(bytes) = &before[index] { fresh_file(&txn.join(format!("before-{name}")), bytes)?; }
            fresh_file(&txn.join(format!("after-{name}")), &encoded[index])?;
        }
        let descriptor = Transaction { version: 1, existed: std::array::from_fn(|i| before[i].is_some()) };
        fresh_file(&txn.join("manifest.json"), &serde_json::to_vec(&descriptor).map_err(|_| broken())?)?;
        // Check again just before enabling recovery, avoiding known external changes.
        if &self.originals()? != before { return Err(changed()); }
        fs::create_dir(txn.join("prepared")).map_err(io_error)?;
        self.finish(&txn, hook)
    }
    /// Initial no-model settings: no background cache calls or automatic paid retries.
    /// Existing native settings are not overwritten by initialization.
    pub fn initialize_defaults(&self) -> Result<(), ConfigError> {
        self.recover()?;
        let path = self.agent.join("settings.json");
        if let Some(bytes) = read_optional(&path)? { parse_document(Some(&bytes))?; return Ok(()); }
        let bytes = serde_json::to_vec_pretty(&json!({"cacheWarming":"off","retry":{"enabled":false,"provider":{"maxRetries":0}},"enableInstallTelemetry":false})).map_err(|_| broken())?;
        let mut file = tempfile::Builder::new().prefix(".azcine-initial-settings-").suffix(".json").tempfile_in(&self.agent).map_err(io_error)?;
        file.disable_cleanup(true); file.write_all(&bytes).map_err(io_error)?; file.as_file().sync_all().map_err(io_error)?;
        file.persist_noclobber(path).map_err(|e| io_error(e.error))?; Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let base = std::env::var_os("AZCINE_PI_CONFIG_TEST_ROOT").map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation/s03-config-tests"));
        fs::create_dir_all(&base).unwrap(); tempfile::Builder::new().prefix("case-").tempdir_in(base).unwrap().keep()
    }
    fn input() -> ModelSettingsInput { ModelSettingsInput { provider:"fixture-service".into(),base_url:"https://example.invalid/v1".into(),api:"openai-responses".into(),model_id:"fixture-model".into(),name:"测试模型".into(),context_window:128000,max_tokens:8192,reasoning:false,supports_images:true,api_key:Some("explicit-test-credential-not-real".into()) } }
    fn contents(s: &ConfigStore, index: usize) -> Value { parse_document(read_optional(&s.agent.join(FILES[index])).unwrap().as_deref()).unwrap() }
    #[test]
    fn given_three_native_files_when_save_then_preserves_unrelated_values_and_returns_no_key() {
        let s = ConfigStore::open(&root()).unwrap();
        fresh_file(&s.agent.join("models.json"), br#"{"providers":{"other":{"models":[{"id":"other-model"}]}}}"#).unwrap();
        fresh_file(&s.agent.join("settings.json"), b"\xef\xbb\xbf{ //native comment\n\"theme\":\"light\",\"extensions\":[\"own.ts\"] }").unwrap();
        let v = s.save(&input()).unwrap(); assert!(v.has_credential); assert!(!v.connection_verified);
        assert!(!serde_json::to_string(&v).unwrap().contains("explicit-test-credential"));
        assert_eq!(contents(&s, 0)["providers"]["other"]["models"][0]["id"], "other-model");
        assert_eq!(contents(&s, 1)["fixture-service"]["key"], "explicit-test-credential-not-real");
        assert_eq!(contents(&s, 2)["theme"], "light"); assert_eq!(contents(&s, 2)["extensions"], json!(["own.ts"]));
        assert_eq!(s.recover().unwrap(), 0);
    }
    #[test]
    fn given_interruption_after_first_publish_when_reopening_then_recover_all_without_false_success() {
        let root = root(); let s = ConfigStore::open(&root).unwrap();
        let err = s.save_with_hook(&input(), |index| if index == 1 { Err(failure("fixture_interruption", "测试写入中断")) } else { Ok(()) }).unwrap_err();
        assert_eq!(err.code, "fixture_interruption"); assert!(s.agent.join("models.json").exists()); assert!(!s.agent.join("auth.json").exists());
        let reopened = ConfigStore::open(&root).unwrap();
        assert_eq!(contents(&reopened, 1)["fixture-service"]["key"], "explicit-test-credential-not-real");
        assert_eq!(contents(&reopened, 2)["defaultModel"], "fixture-model"); assert_eq!(reopened.recover().unwrap(), 0);
    }
    #[test]
    fn given_external_change_during_failed_transaction_when_recovery_then_does_not_overwrite_any_new_values() {
        let root = root(); let s = ConfigStore::open(&root).unwrap();
        assert!(s.save_with_hook(&input(), |index| if index == 1 { Err(failure("fixture_interruption", "测试写入中断")) } else { Ok(()) }).is_err());
        fresh_file(&s.agent.join("settings.json"), br#"{"theme":"manual-change"}"#).unwrap();
        let before = s.originals().unwrap(); let error = match ConfigStore::open(&root) { Ok(_) => panic!("must reject changed baseline"), Err(e) => e };
        assert_eq!(error.code, "pi_config_changed"); assert_eq!(s.originals().unwrap(), before);
    }
    #[test]
    fn given_malformed_native_document_when_save_then_original_bytes_and_input_remain() {
        let s = ConfigStore::open(&root()).unwrap(); let bytes = b"{ broken /* unfinished";
        fresh_file(&s.agent.join("auth.json"), bytes).unwrap(); let i = input();
        assert!(s.save(&i).is_err()); assert_eq!(read_required(&s.agent.join("auth.json")).unwrap(), bytes);
        assert_eq!(i.api_key.as_deref(), Some("explicit-test-credential-not-real")); assert_eq!(fs::read_dir(&s.transactions).unwrap().count(), 0);
    }
    #[test]
    fn given_failed_unprepared_candidate_when_opening_then_does_not_apply_it_or_delete_evidence() {
        let root = root(); let s = ConfigStore::open(&root).unwrap(); let partial = s.transactions.join("native-incomplete"); fs::create_dir(&partial).unwrap();
        fresh_file(&partial.join("after-auth.json"), br#"{"fixture":"partial-not-published"}"#).unwrap();
        let reopened = ConfigStore::open(&root).unwrap(); assert!(!reopened.agent.join("auth.json").exists()); assert!(partial.join("after-auth.json").exists());
    }
    #[test]
    fn given_comments_and_escaped_strings_when_parsing_then_only_comments_are_removed() {
        let value = parse_document(Some(br#"{/* block */"url":"https://example.invalid/a//b", "text":"quote\"/*not-comment*/", // line
        "emoji":"\u4e2d"}"#)).unwrap();
        assert_eq!(value["url"], "https://example.invalid/a//b"); assert_eq!(value["text"], "quote\"/*not-comment*/"); assert_eq!(value["emoji"], "中");
        for text in ["{/*unterminated", "[]", "null", "{\"x\":1,}", ""] { assert!(parse_document(Some(text.as_bytes())).is_err()); }
    }
    #[test]
    fn given_existing_defaults_when_initializing_then_never_replaces_native_customizations() {
        let s = ConfigStore::open(&root()).unwrap(); s.initialize_defaults().unwrap();
        assert_eq!(contents(&s, 2)["retry"]["enabled"], false); assert_eq!(contents(&s, 2)["cacheWarming"], "off");
        let before = read_required(&s.agent.join("settings.json")).unwrap(); s.initialize_defaults().unwrap(); assert_eq!(read_required(&s.agent.join("settings.json")).unwrap(), before);
    }
    #[test]
    fn given_explicit_native_probe_export_when_saving_then_produce_only_synthetic_app_owned_configs() {
        let base = std::env::var_os("AZCINE_PI_CONFIG_TEST_ROOT").map(PathBuf::from).unwrap_or_else(root);
        fs::create_dir_all(&base).unwrap();
        let exported = base.join("native-probe-data"); fs::create_dir(&exported).unwrap();
        let s = ConfigStore::open(&exported).unwrap(); let mut i = input(); i.api_key = Some("fixture-literal-$NAME-${OTHER}-$$-end".into());
        s.initialize_defaults().unwrap(); s.save(&i).unwrap();
        assert_eq!(contents(&s, 1)["fixture-service"]["key"], "fixture-literal-$$NAME-$${OTHER}-$$$$-end");
    }
    #[test]
    fn given_oversized_config_when_saving_then_bounded_read_rejects_without_replacement() {
        let s = ConfigStore::open(&root()).unwrap(); fresh_file(&s.agent.join("models.json"), &vec![b' '; LIMIT as usize + 1]).unwrap();
        assert_eq!(s.save(&input()).unwrap_err().code, "pi_config_limit"); assert_eq!(fs::metadata(s.agent.join("models.json")).unwrap().len(), LIMIT + 1);
    }
}
