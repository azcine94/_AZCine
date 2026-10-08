//! Read-only indexes and display views of application-owned Pi v3 JSONL files.
//!
//! This module never writes JSONL, migrates sessions, rebuilds Pi's model
//! context or starts Pi. Summaries contain no message bodies; display views
//! contain projected messages on the last native branch.
//!
//! Bounds:
//! - at most four directories below the sessions root;
//! - at most 5,000 regular JSONL file candidates are opened per listing;
//! - per-file and per-line bounds account for four 50 MiB images plus overhead;
//! - physical line bounds exclude LF and include CR/BOM.
//!
//! `unreadable` counts rejected files and skipped/unreadable filesystem entries
//! or subtrees. A skipped subtree counts once; its contents are not enumerated.
//! Root traversal failure is an error rather than a successful partial listing.
//!
//! Path checks reject observed symlinks/reparse points. As with PiPaths, these
//! checks are not an OS sandbox or an atomic filesystem snapshot.

use crate::pi_launch_plan::PiPaths;
use crate::pi_model_config::ConfigError;
use serde_json::{Map, Value};
use std::fs::{self, File, Metadata, OpenOptions, ReadDir};
use std::io::{BufRead, BufReader};
use std::path::{Component, Path};

const MAX_DIRECTORY_DEPTH: usize = 4;
const MAX_FILE_CANDIDATES: usize = 5_000;
const MAX_FILE_BYTES: u64 = crate::pi_image_limits::MAX_IMAGE_HISTORY_BYTES as u64;
const MAX_LINE_BYTES: usize = crate::pi_image_limits::MAX_IMAGE_RPC_BYTES;

const MAX_ID_BYTES: usize = 1_024;
const MAX_NAME_BYTES: usize = 4_096;
const MAX_CWD_BYTES: usize = 32_768;
const MAX_TYPE_BYTES: usize = 128;
const MAX_MODEL_FIELD_BYTES: usize = 4_096;
const MAX_JS_DATE_MS: f64 = 8_640_000_000_000_000.0;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub path: String,
    pub name: Option<String>,
    pub cwd: String,
    pub updated_at: String,
    pub message_count: usize,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionList {
    pub sessions: Vec<SessionSummary>,
    pub unreadable: usize,
}

fn error(code: &'static str, message: &'static str) -> ConfigError {
    ConfigError { code, message }
}

fn root_error() -> ConfigError {
    error(
        "pi_sessions_root",
        "本应用会话目录不可读取或路径已变化，未改用其他会话目录。",
    )
}

fn read_error() -> ConfigError {
    error(
        "pi_session_read",
        "会话文件不可读取，未打开或修改该会话。",
    )
}

fn format_error() -> ConfigError {
    error(
        "pi_session_format",
        "会话内容损坏、字段无效或尾行尚未写完，未打开或修改该会话。",
    )
}

fn limit_error() -> ConfigError {
    error(
        "pi_session_limit",
        "会话文件、单行或目录层数超出读取上限，未返回截断会话。",
    )
}

fn version_error() -> ConfigError {
    error(
        "pi_session_version",
        "仅支持原生第 3 版会话；旧版或未知版本未打开，也未执行迁移。",
    )
}

fn changed_error() -> ConfigError {
    error(
        "pi_session_changed",
        "读取期间会话文件发生变化，请稍后重试；未返回不完整索引。",
    )
}

fn linked(path: &Path, metadata: &Metadata) -> bool {
    crate::pi_launch_plan::linked_path(path, metadata).unwrap_or(true)
}

/// PiPaths::prepare produces canonical owned paths. Recheck the root and every
/// component between the data root and sessions before enumerating or opening.
fn check_sessions_root(paths: &PiPaths) -> Result<(), ConfigError> {
    if !paths.root.is_absolute() || !paths.sessions.is_absolute() {
        return Err(root_error());
    }

    let relative = paths
        .sessions
        .strip_prefix(&paths.root)
        .map_err(|_| root_error())?;

    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(root_error());
    }

    let mut current = paths.root.clone();
    let metadata = fs::symlink_metadata(&current).map_err(|_| root_error())?;
    if linked(&current, &metadata) || !metadata.is_dir() {
        return Err(root_error());
    }

    for part in relative.components() {
        current.push(part);
        let metadata = fs::symlink_metadata(&current).map_err(|_| root_error())?;
        if linked(&current, &metadata) || !metadata.is_dir() {
            return Err(root_error());
        }
    }

    let actual_root = fs::canonicalize(&paths.root).map_err(|_| root_error())?;
    let actual_sessions = fs::canonicalize(&paths.sessions).map_err(|_| root_error())?;

    if actual_root != paths.root
        || actual_sessions != paths.sessions
        || !actual_sessions.starts_with(&actual_root)
    {
        return Err(root_error());
    }

    Ok(())
}

fn check_session_depth(paths: &PiPaths, path: &Path) -> Result<(), ConfigError> {
    let relative = path
        .strip_prefix(&paths.sessions)
        .map_err(|_| read_error())?;
    let mut component_count = 0usize;

    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(read_error());
        }
        component_count += 1;
    }

    // One component is the file itself; the rest are relative directories.
    if component_count == 0 {
        return Err(read_error());
    }
    if component_count - 1 > MAX_DIRECTORY_DEPTH {
        return Err(limit_error());
    }

    Ok(())
}

fn regular_file_metadata(path: &Path) -> Result<Metadata, ConfigError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| read_error())?;
    if linked(path, &metadata) || !metadata.is_file() {
        return Err(read_error());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(limit_error());
    }
    Ok(metadata)
}

fn open_read_only(path: &Path) -> Result<File, ConfigError> {
    let mut options = OpenOptions::new();
    options.read(true);

    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT: do not follow a final-component
        // reparse point if it replaces the checked file before open.
        options.custom_flags(0x0020_0000);
    }

    options.open(path).map_err(|_| read_error())
}

fn same_observed_file(before: &Metadata, after: &Metadata) -> Result<(), ConfigError> {
    if after.file_type().is_symlink()
        || !after.is_file()
        || before.len() != after.len()
        || before.modified().map_err(|_| read_error())?
            != after.modified().map_err(|_| read_error())?
    {
        return Err(changed_error());
    }
    Ok(())
}

pub fn validate_session(
    paths: &PiPaths,
    path: &Path,
) -> Result<SessionSummary, ConfigError> {
    validate_session_observed(paths,path,|_|Ok(()))
}

fn validate_session_observed(
    paths: &PiPaths,
    path: &Path,
    observe: impl FnMut(&Map<String,Value>)->Result<(),ConfigError>,
) -> Result<SessionSummary, ConfigError> {
    check_sessions_root(paths)?;
    // Pi can return a normal DOS path while our root is canonical \\?\ form.
    // Ownership is checked before opening; depth is checked on that exact result.
    let actual = paths.checked_session(path)?;
    check_session_depth(paths, &actual)?;

    // Do not use lossy conversion: the returned path is later used to reopen
    // the exact same file.
    let display_path = actual.to_str().ok_or_else(read_error)?.to_owned();
    let before = regular_file_metadata(&actual)?;
    let file = open_read_only(&actual)?;
    let opened = file.metadata().map_err(|_| read_error())?;
    same_observed_file(&before, &opened)?;

    let mut reader = BufReader::new(file);
    let (mut summary, bytes_read) = parse_session_observed(&mut reader,observe)?;

    let after = reader.get_ref().metadata().map_err(|_| read_error())?;
    same_observed_file(&opened, &after)?;
    if bytes_read != opened.len() {
        return Err(changed_error());
    }

    // Check ownership again after reading, and notice ordinary replacement or
    // append/truncate races. This is deliberately not described as a lock.
    check_sessions_root(paths)?;
    if paths.checked_session(path)? != actual {
        return Err(changed_error());
    }
    let current = regular_file_metadata(&actual)?;
    same_observed_file(&after, &current)?;

    // The stored cwd is only validated, never rewritten or inferred. In
    // particular this rejects the upstream external-cwd migration risk.
    paths.checked_cwd(Some(Path::new(&summary.cwd)))?;

    summary.path = display_path;
    Ok(summary)
}

/// Display the last native branch without starting Pi or rebuilding its model
/// context. Native JSONL stays unchanged; only whitelisted message fields leave
/// this reader. Live/resumed context continues to come from official RPC.
pub fn read_message_view(paths:&PiPaths,path:&Path)->Result<(SessionSummary,Value),ConfigError>{
    let mut entries=std::collections::HashMap::<String,(Option<String>,Option<Value>)>::new();
    let mut leaf=None;
    let summary=validate_session_observed(paths,path,|entry|{
        let is_message=entry.get("type").and_then(Value::as_str)==Some("message");
        let Some(id)=entry.get("id").and_then(Value::as_str)else{return if is_message{Err(format_error())}else{Ok(())};};
        if id.is_empty()||id.len()>MAX_ID_BYTES||entries.len()>=100_000{return Err(limit_error());}
        let parent=match entry.get("parentId"){None|Some(Value::Null)=>None,Some(Value::String(value))if value.len()<=MAX_ID_BYTES=>Some(value.clone()),_=>return Err(format_error())};
        let message=if is_message{Some(crate::pi_projection::message(entry.get("message").ok_or_else(format_error)?))}else{None};
        if entries.insert(id.to_owned(),(parent,message)).is_some(){return Err(format_error());}
        leaf=Some(id.to_owned());Ok(())
    })?;
    let mut messages=Vec::new();
    while let Some(id)=leaf{
        let (parent,message)=entries.remove(&id).ok_or_else(format_error)?;
        if let Some(message)=message{if messages.len()>=20_000{return Err(limit_error());}messages.push(message);}
        leaf=parent;
    }
    messages.reverse();Ok((summary,Value::Array(messages)))
}

pub fn list_sessions(paths: &PiPaths) -> Result<SessionList, ConfigError> {
    check_sessions_root(paths)?;
    let entries = fs::read_dir(&paths.sessions).map_err(|_| root_error())?;

    let mut result = SessionList {
        sessions: Vec::new(),
        unreadable: 0,
    };
    let mut candidates = 0usize;

    walk(
        paths,
        entries,
        0,
        true,
        &mut candidates,
        &mut result,
    )?;

    check_sessions_root(paths)?;
    sort_sessions(&mut result.sessions);
    Ok(result)
}

fn count_unreadable(result: &mut SessionList) {
    result.unreadable = result.unreadable.saturating_add(1);
}

fn walk(
    paths: &PiPaths,
    entries: ReadDir,
    depth: usize,
    is_root: bool,
    candidates: &mut usize,
    result: &mut SessionList,
) -> Result<(), ConfigError> {
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) if is_root => return Err(root_error()),
            Err(_) => {
                count_unreadable(result);
                continue;
            }
        };

        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                count_unreadable(result);
                continue;
            }
        };

        if linked(&path, &metadata) {
            count_unreadable(result);
            continue;
        }

        if metadata.is_dir() {
            if depth >= MAX_DIRECTORY_DEPTH {
                count_unreadable(result);
                continue;
            }

            // Recheck immediately before entering, without following a known
            // junction or symbolic link.
            let checked = fs::symlink_metadata(&path);
            if !matches!(checked, Ok(ref meta) if meta.is_dir() && !linked(&path, meta)) {
                count_unreadable(result);
                continue;
            }

            match fs::read_dir(&path) {
                Ok(children) => {
                    walk(
                        paths,
                        children,
                        depth + 1,
                        false,
                        candidates,
                        result,
                    )?;
                }
                Err(_) => count_unreadable(result),
            }
            continue;
        }

        if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }

        if !metadata.is_file() {
            count_unreadable(result);
            continue;
        }

        // Continue enumerating names after the cap so every additional
        // candidate is counted, but never open those files.
        if *candidates >= MAX_FILE_CANDIDATES {
            count_unreadable(result);
            continue;
        }
        *candidates += 1;

        match validate_session(paths, &path) {
            Ok(summary) => result.sessions.push(summary),
            Err(_) => count_unreadable(result),
        }
    }

    Ok(())
}

fn sort_sessions(sessions: &mut [SessionSummary]) {
    sessions.sort_by(|left, right| {
        // Every returned timestamp was already validated by parse_session.
        iso_time_key(&right.updated_at)
            .cmp(&iso_time_key(&left.updated_at))
            .then_with(|| left.path.cmp(&right.path))
    });
}

/// Read one physical LF-delimited line with bounded allocation. Unicode
/// U+2028/U+2029 are ordinary UTF-8 bytes, not line delimiters.
///
/// A final complete JSON object without LF is allowed. A partial final object
/// is rejected by JSON parsing, never discarded as a successful prefix.
fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    line: &mut Vec<u8>,
    total: &mut u64,
) -> Result<bool, ConfigError> {
    line.clear();

    loop {
        let available = reader.fill_buf().map_err(|_| read_error())?;
        if available.is_empty() {
            return Ok(!line.is_empty());
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let body_length = newline.unwrap_or(available.len());
        let consumed = body_length + usize::from(newline.is_some());

        if consumed as u64 > MAX_FILE_BYTES.saturating_sub(*total)
            || body_length > MAX_LINE_BYTES.saturating_sub(line.len())
        {
            return Err(limit_error());
        }

        line.extend_from_slice(&available[..body_length]);
        reader.consume(consumed);
        *total += consumed as u64;

        if newline.is_some() {
            return Ok(true);
        }
    }
}

fn parse_object(line: &[u8], first: bool) -> Result<Map<String, Value>, ConfigError> {
    let line = if first {
        line.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(line)
    } else {
        line
    };
    let line = line.strip_suffix(b"\r").unwrap_or(line);

    // No trim/split-lines operation that could change U+2028/U+2029.
    let value: Value = serde_json::from_slice(line).map_err(|_| format_error())?;
    match value {
        Value::Object(object) => Ok(object),
        _ => Err(format_error()),
    }
}

fn parse_session<R: BufRead>(
    reader: &mut R,
) -> Result<(SessionSummary, u64), ConfigError> {
    parse_session_observed(reader,|_|Ok(()))
}

fn parse_session_observed<R:BufRead>(reader:&mut R,mut observe:impl FnMut(&Map<String,Value>)->Result<(),ConfigError>)->Result<(SessionSummary,u64),ConfigError>{
    let mut line = Vec::new();
    let mut total = 0u64;

    if !read_bounded_line(reader, &mut line, &mut total)? {
        return Err(format_error());
    }

    let header = parse_object(&line, true)?;
    if header.get("type").and_then(Value::as_str) != Some("session") {
        return Err(format_error());
    }
    if header.get("version").and_then(Value::as_u64) != Some(3) {
        return Err(version_error());
    }

    let id = bounded_string(&header, "id", MAX_ID_BYTES, true)?;
    if id.chars().any(char::is_control) {
        return Err(format_error());
    }

    let cwd = bounded_string(&header, "cwd", MAX_CWD_BYTES, true)?;
    if cwd.contains('\0') || !Path::new(cwd).is_absolute() {
        return Err(format_error());
    }

    let timestamp = required_timestamp(&header)?;
    let mut summary = SessionSummary {
        id: id.to_owned(),
        path: String::new(),
        name: None,
        cwd: cwd.to_owned(),
        updated_at: timestamp.to_owned(),
        message_count: 0,
    };

    while read_bounded_line(reader, &mut line, &mut total)? {
        let entry = parse_object(&line, false)?;
        let entry_type = bounded_string(&entry, "type", MAX_TYPE_BYTES, true)?;

        match entry_type {
            "session" => return Err(format_error()),
            "message" => {
                // Known native entries have ISO entry timestamps. Do not use
                // the nested Unix message timestamp as updated_at.
                required_timestamp(&entry)?;
                validate_message(entry.get("message").ok_or_else(format_error)?)?;
                summary.message_count = summary
                    .message_count
                    .checked_add(1)
                    .ok_or_else(limit_error)?;
            }
            "session_info" => {
                required_timestamp(&entry)?;
                summary.name = match entry.get("name") {
                    None => None,
                    Some(Value::String(name)) if name.len() <= MAX_NAME_BYTES => {
                        Some(name.clone())
                    }
                    _ => return Err(format_error()),
                };
            }
            // Unknown entries remain compatible with the metadata index. The
            // display observer follows their parent links without using their
            // contents to rebuild Pi's model context.
            _ => {}
        }

        if let Some(timestamp) = entry.get("timestamp") {
            let timestamp = timestamp.as_str().ok_or_else(format_error)?;
            if iso_time_key(timestamp).is_none() {
                return Err(format_error());
            }
            // Last valid timestamp in physical file order, not the maximum.
            summary.updated_at = timestamp.to_owned();
        }
        observe(&entry)?;
    }

    Ok((summary, total))
}

fn bounded_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    maximum: usize,
    nonempty: bool,
) -> Result<&'a str, ConfigError> {
    let value = object
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(format_error)?;
    if value.len() > maximum || (nonempty && value.trim().is_empty()) {
        return Err(format_error());
    }
    Ok(value)
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
) -> Result<&'a str, ConfigError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(format_error)
}

fn required_bool(object: &Map<String, Value>, field: &str) -> Result<bool, ConfigError> {
    object
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(format_error)
}

fn optional_string(object: &Map<String, Value>, field: &str) -> Result<(), ConfigError> {
    if let Some(value) = object.get(field) {
        if !value.is_string() {
            return Err(format_error());
        }
    }
    Ok(())
}

fn optional_bool(object: &Map<String, Value>, field: &str) -> Result<(), ConfigError> {
    if let Some(value) = object.get(field) {
        if !value.is_boolean() {
            return Err(format_error());
        }
    }
    Ok(())
}

fn required_nonnegative_number(
    object: &Map<String, Value>,
    field: &str,
) -> Result<(), ConfigError> {
    let value = object
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(format_error)?;
    if !value.is_finite() || value < 0.0 {
        return Err(format_error());
    }
    Ok(())
}

fn required_timestamp(object: &Map<String, Value>) -> Result<&str, ConfigError> {
    let timestamp = required_string(object, "timestamp")?;
    if iso_time_key(timestamp).is_none() {
        return Err(format_error());
    }
    Ok(timestamp)
}

fn validate_usage(value: &Value) -> Result<(), ConfigError> {
    let usage = value.as_object().ok_or_else(format_error)?;
    for field in [
        "input",
        "output",
        "cacheRead",
        "cacheWrite",
        "totalTokens",
    ] {
        required_nonnegative_number(usage, field)?;
    }
    for field in ["cacheWrite1h", "reasoning"] {
        if usage.contains_key(field) {
            required_nonnegative_number(usage, field)?;
        }
    }

    let cost = usage
        .get("cost")
        .and_then(Value::as_object)
        .ok_or_else(format_error)?;
    for field in ["input", "output", "cacheRead", "cacheWrite", "total"] {
        required_nonnegative_number(cost, field)?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum ContentKind {
    System,
    User,
    Assistant,
    ToolResult,
}

fn validate_content(
    value: &Value,
    kind: ContentKind,
) -> Result<(), ConfigError> {
    if value.is_string() && matches!(kind, ContentKind::System | ContentKind::User) {
        return Ok(());
    }

    let blocks = value.as_array().ok_or_else(format_error)?;
    for block in blocks {
        let block = block.as_object().ok_or_else(format_error)?;
        let block_type = bounded_string(block, "type", MAX_TYPE_BYTES, true)?;

        match block_type {
            "text" => {
                required_string(block, "text")?;
                optional_string(block, "textSignature")?;
            }
            "image" => {
                if !matches!(kind, ContentKind::User | ContentKind::ToolResult) {
                    return Err(format_error());
                }
                required_string(block, "data")?;
                bounded_string(block, "mimeType", MAX_TYPE_BYTES, true)?;
            }
            "thinking" => {
                if !matches!(kind, ContentKind::Assistant) {
                    return Err(format_error());
                }
                optional_bool(block, "redacted")?;
                optional_string(block, "thinkingSignature")?;
                match block.get("thinking") {
                    Some(Value::String(_)) => {}
                    None if block.get("redacted").and_then(Value::as_bool) == Some(true) => {}
                    _ => return Err(format_error()),
                }
            }
            "toolCall" => {
                if !matches!(kind, ContentKind::Assistant) {
                    return Err(format_error());
                }
                bounded_string(block, "id", MAX_ID_BYTES, true)?;
                bounded_string(block, "name", MAX_MODEL_FIELD_BYTES, true)?;
                if !block.get("arguments").is_some_and(Value::is_object) {
                    return Err(format_error());
                }
                optional_string(block, "thoughtSignature")?;
                optional_string(block, "namespace")?;
            }
            // New block types remain opaque; require the object and nonempty
            // type above, but do not retain or expose their payload.
            _ => {}
        }
    }

    Ok(())
}

fn validate_message(value: &Value) -> Result<(), ConfigError> {
    let message = value.as_object().ok_or_else(format_error)?;
    let role = bounded_string(message, "role", MAX_TYPE_BYTES, true)?;

    let timestamp = message
        .get("timestamp")
        .and_then(Value::as_f64)
        .ok_or_else(format_error)?;
    if !timestamp.is_finite() || timestamp.abs() > MAX_JS_DATE_MS {
        return Err(format_error());
    }

    match role {
        "system" => {
            validate_content(
                message.get("content").ok_or_else(format_error)?,
                ContentKind::System,
            )?;
            optional_bool(message, "replace")?;
            if let Some(sections) = message.get("sections") {
                let sections = sections.as_object().ok_or_else(format_error)?;
                if sections
                    .values()
                    .any(|value| !value.is_string() && !value.is_null())
                {
                    return Err(format_error());
                }
            }
            for field in ["toolsAdded", "toolsRemoved"] {
                if let Some(value) = message.get(field) {
                    let tools = value.as_array().ok_or_else(format_error)?;
                    if tools.iter().any(|tool| !tool.is_object()) {
                        return Err(format_error());
                    }
                }
            }
        }
        "user" => {
            validate_content(
                message.get("content").ok_or_else(format_error)?,
                ContentKind::User,
            )?;
        }
        "assistant" => {
            validate_content(
                message.get("content").ok_or_else(format_error)?,
                ContentKind::Assistant,
            )?;
            for field in ["api", "provider", "model"] {
                bounded_string(message, field, MAX_MODEL_FIELD_BYTES, true)?;
            }
            validate_usage(message.get("usage").ok_or_else(format_error)?)?;

            let stop_reason = required_string(message, "stopReason")?;
            // Official message-types.md: "pending" is a streaming value and
            // is not persisted in native session JSONL.
            if !matches!(
                stop_reason,
                "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred"
            ) {
                return Err(format_error());
            }
            optional_string(message, "errorMessage")?;

            if stop_reason == "deferred" {
                let deferred = message
                    .get("deferred")
                    .and_then(Value::as_object)
                    .ok_or_else(format_error)?;
                for field in ["provider", "modelId", "api", "id"] {
                    bounded_string(deferred, field, MAX_MODEL_FIELD_BYTES, true)?;
                }
            }
        }
        "toolResult" => {
            bounded_string(message, "toolCallId", MAX_ID_BYTES, true)?;
            bounded_string(message, "toolName", MAX_MODEL_FIELD_BYTES, true)?;
            required_bool(message, "isError")?;
            validate_content(
                message.get("content").ok_or_else(format_error)?,
                ContentKind::ToolResult,
            )?;
            if let Some(usage) = message.get("usage") {
                validate_usage(usage)?;
            }
        }
        "bashExecution" => {
            required_string(message, "command")?;
            required_string(message, "output")?;
            required_bool(message, "cancelled")?;
            required_bool(message, "truncated")?;
            if let Some(exit_code) = message.get("exitCode") {
                let value = exit_code.as_f64().ok_or_else(format_error)?;
                if !value.is_finite() || value.fract() != 0.0 {
                    return Err(format_error());
                }
            }
            optional_string(message, "fullOutputPath")?;
            optional_bool(message, "excludeFromContext")?;
        }
        "custom" => {
            bounded_string(message, "customType", MAX_MODEL_FIELD_BYTES, true)?;
            required_bool(message, "display")?;
            validate_content(
                message.get("content").ok_or_else(format_error)?,
                ContentKind::User,
            )?;
        }
        "branchSummary" => {
            required_string(message, "summary")?;
            match message.get("fromId") {
                Some(Value::Null) => {}
                Some(Value::String(id))
                    if !id.trim().is_empty() && id.len() <= MAX_ID_BYTES => {}
                _ => return Err(format_error()),
            }
        }
        "compactionSummary" => {
            required_string(message, "summary")?;
            required_nonnegative_number(message, "tokensBefore")?;
        }
        // AgentMessage is extensible. Unknown custom roles are opaque and
        // still count as one message; they do not become guessed user text.
        _ => {}
    }

    Ok(())
}

/// Supported ISO display timestamps:
/// YYYY-MM-DDTHH:MM:SS[.1..9 digits](Z|+HH:MM|-HH:MM).
///
/// Validates Gregorian dates and explicit zones without chrono. Fractions are
/// normalized only in the private sort key; returned strings remain unchanged.
/// Seconds are measured from 0001-01-01, sufficient for comparison.
fn iso_time_key(value: &str) -> Option<(i64, u32)> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes.len() > 35 {
        return None;
    }
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }

    let year = digits(bytes, 0, 4)? as i64;
    let month = digits(bytes, 5, 2)? as usize;
    let day = digits(bytes, 8, 2)? as i64;
    let hour = digits(bytes, 11, 2)? as i64;
    let minute = digits(bytes, 14, 2)? as i64;
    let second = digits(bytes, 17, 2)? as i64;

    if year == 0
        || !(1..=12).contains(&month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }

    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_lengths = [
        31i64,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if day < 1 || day > month_lengths[month - 1] {
        return None;
    }

    let mut position = 19usize;
    let mut nanos = 0u32;
    if bytes.get(position) == Some(&b'.') {
        position += 1;
        let start = position;
        while let Some(byte) = bytes.get(position) {
            if !byte.is_ascii_digit() {
                break;
            }
            if position - start >= 9 {
                return None;
            }
            nanos = nanos * 10 + u32::from(*byte - b'0');
            position += 1;
        }
        let count = position - start;
        if count == 0 {
            return None;
        }
        for _ in count..9 {
            nanos *= 10;
        }
    }

    let offset_seconds = match bytes.get(position) {
        Some(b'Z') if position + 1 == bytes.len() => 0i64,
        Some(sign @ (b'+' | b'-')) if position + 6 == bytes.len() => {
            if bytes[position + 3] != b':' {
                return None;
            }
            let hours = digits(bytes, position + 1, 2)? as i64;
            let minutes = digits(bytes, position + 4, 2)? as i64;
            if hours > 23 || minutes > 59 {
                return None;
            }
            let offset = hours * 3_600 + minutes * 60;
            if *sign == b'+' {
                offset
            } else {
                -offset
            }
        }
        _ => return None,
    };

    let previous_year = year - 1;
    let days_before_year =
        previous_year * 365 + previous_year / 4 - previous_year / 100
            + previous_year / 400;
    let days_before_month: i64 = month_lengths[..month - 1].iter().sum();
    let days = days_before_year + days_before_month + day - 1;

    Some((
        days * 86_400 + hour * 3_600 + minute * 60 + second - offset_seconds,
        nanos,
    ))
}

fn digits(bytes: &[u8], start: usize, count: usize) -> Option<u32> {
    let end = start.checked_add(count)?;
    let slice = bytes.get(start..end)?;
    let mut result = 0u32;
    for byte in slice {
        if !byte.is_ascii_digit() {
            return None;
        }
        result = result * 10 + u32::from(*byte - b'0');
    }
    Some(result)
}

#[cfg(test)] #[path="pi-sessions-files-tests.rs"] mod files_tests;
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;

    // These tests use only in-memory strings. No environment, filesystem,
    // temporary directory, compilation, process, or network is accessed here.
    fn fixture_cwd() -> &'static str {
        if cfg!(windows) {
            r"C:\azcine-session-fixture"
        } else {
            "/azcine-session-fixture"
        }
    }

    fn header() -> Value {
        json!({
            "type": "session",
            "version": 3,
            "id": "custom-native-id",
            "cwd": fixture_cwd(),
            "timestamp": "2026-10-03T00:00:00.000Z"
        })
    }

    fn user_entry(text: &str) -> Value {
        json!({
            "type": "message",
            "id": "entry-one",
            "parentId": null,
            "timestamp": "2026-10-03T00:00:01.000Z",
            "message": {
                "role": "user",
                "content": text,
                "timestamp": 1790985601000u64
            }
        })
    }

    fn source(entries: &[Value]) -> String {
        let mut source = serde_json::to_string(&header()).unwrap();
        source.push('\n');
        for entry in entries {
            source.push_str(&serde_json::to_string(entry).unwrap());
            source.push('\n');
        }
        source
    }

    fn parse(source: &str) -> Result<SessionSummary, ConfigError> {
        parse_session(&mut Cursor::new(source.as_bytes())).map(|result| result.0)
    }

    fn must_parse(source: &str) -> SessionSummary {
        match parse(source) {
            Ok(summary) => summary,
            Err(error) => panic!("unexpected static error: {}", error.code),
        }
    }

    fn error_code(source: &str) -> &'static str {
        match parse(source) {
            Ok(_) => panic!("expected rejection"),
            Err(error) => error.code,
        }
    }

    #[test]
    fn given_header_only_when_indexing_then_name_is_none_and_no_title_is_guessed() {
        let summary = must_parse(&source(&[]));
        assert_eq!(summary.id, "custom-native-id");
        assert_eq!(summary.name, None);
        assert_eq!(summary.message_count, 0);
        assert_eq!(summary.updated_at, "2026-10-03T00:00:00.000Z");
        assert_eq!(summary.cwd, fixture_cwd());
    }

    #[test]
    fn given_unicode_separators_and_crlf_bom_when_parsing_then_only_lf_splits_lines() {
        let entry = user_entry("中文\u{2028}继续\u{2029}<script>只是正文</script>");
        let raw = source(&[entry]).replace('\n', "\r\n");
        let raw = format!("\u{feff}{raw}");
        let summary = must_parse(&raw);
        assert_eq!(summary.message_count, 1);
        assert_eq!(summary.name, None);
        assert_eq!(summary.updated_at, "2026-10-03T00:00:01.000Z");
        let serialized = serde_json::to_string(&summary).unwrap();
        assert!(!serialized.contains("script"));
        assert!(!serialized.contains("只是正文"));
    }

    #[test]
    fn given_multiple_branches_when_indexing_then_count_all_messages_without_projection() {
        let first = user_entry("root");
        let mut second = user_entry("branch one");
        second["id"] = json!("branch-one");
        second["parentId"] = json!("entry-one");
        let mut third = user_entry("branch two");
        third["id"] = json!("branch-two");
        third["parentId"] = json!("entry-one");

        let summary = must_parse(&source(&[first, second, third]));
        assert_eq!(summary.message_count, 3);
        assert_eq!(summary.name, None);
    }

    #[test]
    fn given_session_info_when_indexing_then_last_name_and_last_timestamp_are_used() {
        let first = json!({
            "type": "session_info",
            "timestamp": "2026-10-03T05:00:00Z",
            "name": "旧名字"
        });
        let last = json!({
            "type": "session_info",
            "timestamp": "2026-10-03T02:00:00Z",
            "name": "新名字"
        });
        let summary = must_parse(&source(&[first, last]));
        assert_eq!(summary.name.as_deref(), Some("新名字"));
        assert_eq!(summary.updated_at, "2026-10-03T02:00:00Z");
    }

    #[test]
    fn given_unknown_entry_and_custom_role_when_indexing_then_opaque_payload_is_not_returned() {
        let unknown_entry = json!({
            "type": "future_entry",
            "timestamp": "2026-10-03T00:00:02Z",
            "headers": {"secret": "synthetic-do-not-return"}
        });
        let custom_message = json!({
            "type": "message",
            "timestamp": "2026-10-03T00:00:03Z",
            "message": {
                "role": "futureCustomRole",
                "timestamp": 1,
                "privatePayload": "synthetic-do-not-return"
            }
        });
        let summary = must_parse(&source(&[unknown_entry, custom_message]));
        assert_eq!(summary.message_count, 1);
        assert_eq!(summary.updated_at, "2026-10-03T00:00:03Z");
        assert!(!serde_json::to_string(&summary)
            .unwrap()
            .contains("synthetic-do-not-return"));
    }

    #[test]
    fn given_legacy_or_unknown_header_version_when_parsing_then_reject_without_migration() {
        for version in [json!(1), json!(2), json!(4), json!("3"), Value::Null] {
            let mut value = header();
            value["version"] = version;
            assert_eq!(
                error_code(&value.to_string()),
                "pi_session_version"
            );
        }
        let mut value = header();
        value.as_object_mut().unwrap().remove("version");
        assert_eq!(error_code(&value.to_string()), "pi_session_version");
    }

    #[test]
    fn given_truncated_tail_when_parsing_then_no_successful_prefix_is_returned() {
        let mut raw = source(&[user_entry("完整消息")]);
        raw.push_str("{\"type\":\"message\",\"message\":");
        assert_eq!(error_code(&raw), "pi_session_format");

        let complete = source(&[user_entry("完整但无末尾LF")]);
        assert_eq!(
            must_parse(complete.strip_suffix('\n').unwrap()).message_count,
            1
        );
    }

    #[test]
    fn given_invalid_lines_when_parsing_then_reject_instead_of_silently_skipping() {
        for tail in [
            "\n",
            "null\n",
            "[]\n",
            "{\"type\":\"\"}\n",
            "{\"type\":5}\n",
            "\u{feff}{\"type\":\"future\"}\n",
            "{\"type\":\"future\",\"timestamp\":\"2026-02-30T00:00:00Z\"}\n",
        ] {
            assert_eq!(
                error_code(&(source(&[]) + tail)),
                "pi_session_format"
            );
        }

        assert_eq!(
            error_code(&source(&[header()])),
            "pi_session_format"
        );
    }

    #[test]
    fn given_malformed_known_fields_when_parsing_then_reject_the_whole_session() {
        let mut bad_message = user_entry("ok");
        bad_message["message"]["content"] = json!(42);

        let mut bad_role = user_entry("ok");
        bad_role["message"]["role"] = json!("");

        let mut bad_timestamp = user_entry("ok");
        bad_timestamp["message"]["timestamp"] = json!("not milliseconds");

        for entry in [
            bad_message,
            bad_role,
            bad_timestamp,
            json!({
                "type": "session_info",
                "timestamp": "2026-10-03T00:00:02Z",
                "name": 42
            }),
            json!({
                "type": "message",
                "timestamp": "2026-10-03T00:00:02Z",
                "message": {
                    "role": "toolResult",
                    "timestamp": 2,
                    "toolCallId": "call",
                    "toolName": "bash",
                    "content": [],
                    "isError": "false"
                }
            }),
        ] {
            assert_eq!(error_code(&source(&[entry])), "pi_session_format");
        }
    }

    #[test]
    fn given_valid_bash_without_exit_code_when_indexing_then_count_without_guessing_success() {
        let entry = json!({
            "type": "message",
            "timestamp": "2026-10-03T00:00:02Z",
            "message": {
                "role": "bashExecution",
                "command": "synthetic command",
                "output": "synthetic partial output",
                "cancelled": true,
                "truncated": false,
                "timestamp": 2
            }
        });
        assert_eq!(must_parse(&source(&[entry])).message_count, 1);
    }

    #[test]
    fn given_calendar_or_zone_errors_when_validating_time_then_reject_invalid_values() {
        for valid in [
            "2024-02-29T23:59:59.999Z",
            "2000-02-29T00:00:00Z",
            "2026-10-03T08:00:00+08:00",
            "2026-10-03T00:00:00.123456789Z",
        ] {
            assert!(iso_time_key(valid).is_some(), "{valid}");
        }
        for invalid in [
            "1900-02-29T00:00:00Z",
            "2026-02-29T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "0000-01-01T00:00:00Z",
            "2026-10-03T24:00:00Z",
            "2026-10-03T00:00:60Z",
            "2026-10-03T00:00:00",
            "2026-10-03T00:00:00.Z",
            "2026-10-03T00:00:00.1234567890Z",
            "2026-10-03T00:00:00+24:00",
            "2026-10-03T00:00:00+08:60",
            "2026-10-03T00:00:00Z trailing",
        ] {
            assert!(iso_time_key(invalid).is_none(), "{invalid}");
        }
    }

    #[test]
    fn given_duplicate_ids_and_offset_times_when_sorting_then_keep_paths_and_sort_actual_time() {
        let mut first = must_parse(&source(&[]));
        first.path = "b.jsonl".to_owned();
        first.updated_at = "2026-10-03T08:00:00+08:00".to_owned();

        let mut same_time = first.clone();
        same_time.path = "a.jsonl".to_owned();
        same_time.updated_at = "2026-10-03T00:00:00Z".to_owned();

        let mut newer = first.clone();
        newer.path = "c.jsonl".to_owned();
        newer.updated_at = "2026-10-03T00:00:00.001Z".to_owned();

        let mut sessions = vec![first, same_time, newer];
        sort_sessions(&mut sessions);

        assert_eq!(sessions.len(), 3);
        assert!(sessions.iter().all(|session| session.id == "custom-native-id"));
        assert_eq!(
            sessions
                .iter()
                .map(|session| session.path.as_str())
                .collect::<Vec<_>>(),
            vec!["c.jsonl", "a.jsonl", "b.jsonl"]
        );
    }

    #[test]
    fn given_overlong_line_or_file_budget_when_reading_then_reject_without_truncation() {
        let bytes = vec![b'x'; MAX_LINE_BYTES + 1];
        let mut reader = Cursor::new(bytes);
        let mut line = Vec::new();
        let mut total = 0;
        let result = read_bounded_line(&mut reader, &mut line, &mut total);
        assert!(matches!(result, Err(error) if error.code == "pi_session_limit"));
        assert!(line.len() <= MAX_LINE_BYTES);

        let mut reader = Cursor::new(b"x\n");
        let mut total = MAX_FILE_BYTES - 1;
        let result = read_bounded_line(&mut reader, &mut line, &mut total);
        assert!(matches!(result, Err(error) if error.code == "pi_session_limit"));
    }

    #[test]
    fn given_summary_when_serialized_then_only_frozen_camel_case_fields_are_returned() {
        let summary = must_parse(&source(&[user_entry("not returned")]));
        let value = serde_json::to_value(summary).unwrap();
        let object = value.as_object().unwrap();
        assert_eq!(object.len(), 6);
        for field in ["id", "path", "name", "cwd", "updatedAt", "messageCount"] {
            assert!(object.contains_key(field));
        }

        let list = SessionList {
            sessions: Vec::new(),
            unreadable: 2,
        };
        let value = serde_json::to_value(list).unwrap();
        assert_eq!(value["unreadable"], 2);
        assert_eq!(value.as_object().unwrap().len(), 2);
    }
}
