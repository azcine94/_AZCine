// Two fixed official public-dataset boards. The WebView fetches public JSON;
// Rust validates complete snapshots and is the sole business SQLite writer.
// Namespaced app_meta records avoid competing numbered migrations in parallel
// worktrees. Immutable snapshots and their current pointer commit together.
use std::collections::HashSet;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::storage::{StorageError, Store, valid_date};

pub const MAX_SNAPSHOT_BYTES: usize = 512 * 1024;
const MAX_INTEGER: u64 = 9_007_199_254_740_991;
const DATASET_URL: &str = "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Board { Agent, TextToImage }
impl Board {
    fn key(self) -> &'static str { match self { Self::Agent => "agent", Self::TextToImage => "text-to-image" } }
    pub fn source_url(self) -> &'static str {
        match self {
            Self::Agent => "https://arena.ai/leaderboard/agent",
            Self::TextToImage => "https://arena.ai/leaderboard/text-to-image",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> std::path::PathBuf {
        let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
        std::fs::create_dir_all(&base).unwrap();
        tempfile::Builder::new().prefix("model-ranking-store-").tempdir_in(base).unwrap().keep().join("data")
    }
    fn snapshot(board: Board) -> Snapshot {
        let rows = (1..=50).map(|rank| match board {
            Board::Agent => RankingRow::Agent { rank, rank_low: None, rank_high: None, model: format!("Fixture {rank}"), organization: None, license: None,
                net_improvement: Metric { value: 14.310371476177606, lower: 12.415154304102166, upper: 16.205588648253044 },
                confirmed_success: Metric { value: -3.0, lower: -5.0, upper: -1.0 },
                praise_vs_complaint: Metric { value: 1.0, lower: 0.0, upper: 2.0 }, steerability: Metric { value: 1.0, lower: 0.0, upper: 2.0 } },
            Board::TextToImage => RankingRow::TextToImage { rank, rank_low: None, rank_high: None, model: format!("Fixture {rank}"), organization: None, license: None,
                score: 1423.6048361955234, score_lower: 1415.9321932783876, score_upper: 1431.277479112659, votes: 10884, preliminary: None },
        }).collect();
        Snapshot { version: 2, board, category: "overall".into(), source_url: board.source_url().into(), dataset_url: DATASET_URL.into(),
            dataset_revision: "1".repeat(40), dataset_license: "CC BY 4.0".into(), data_updated_at: "2026-10-02".into(),
            captured_at: "2026-10-04T01:00:00Z".into(), total_models: 50, total_samples: None, rows, pricing: None }
    }
    fn input(store: &Store, snapshot: &Snapshot) -> UpdateSnapshot {
        UpdateSnapshot { board: snapshot.board, json: serde_json::to_string(snapshot).unwrap(),
            expected_snapshot_id: store.ranking_board(snapshot.board).snapshot_id, expected_root: store.root.to_string_lossy().into_owned() }
    }
    #[test]
    fn given_official_decimal_precision_when_json_roundtrip_then_bits_are_preserved() {
        for value in [14.310371476177606_f64, 1423.6048361955234, 1415.9321932783876] {
            let parsed: f64 = serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap();
            assert_eq!(value.to_bits(), parsed.to_bits());
        }
    }
    #[test]
    fn given_two_full_boards_when_save_retry_reopen_then_content_times_and_pointers_persist() {
        let path = root(); let mut store = Store::open(&path, true).unwrap();
        for board in [Board::Agent, Board::TextToImage] {
            let data = snapshot(board); let request = input(&store, &data);
            let first = store.update_ranking(request).unwrap(); assert!(first.error.is_none());
            assert_eq!(serde_json::to_string(first.snapshot.as_ref().unwrap()).unwrap(), serde_json::to_string(&data).unwrap());
            let again = store.update_ranking(input(&store, &data)).unwrap();
            assert_eq!(first.snapshot_id, again.snapshot_id); assert_eq!(first.saved_at, again.saved_at);
        }
        let before = serde_json::to_string(&store.ranking_boards()).unwrap(); drop(store);
        let reopened = Store::open(&path, false).unwrap(); assert_eq!(before, serde_json::to_string(&reopened.ranking_boards()).unwrap());
    }
    #[test]
    fn given_saved_board_when_invalid_stale_older_or_wrong_root_update_then_old_snapshot_is_untouched() {
        let mut store = Store::open(&root(), true).unwrap(); let data = snapshot(Board::Agent);
        store.update_ranking(input(&store, &data)).unwrap();
        let before = serde_json::to_string(&store.ranking_board(Board::Agent)).unwrap();
        let mut broken = data.clone(); broken.rows.pop(); assert!(store.update_ranking(input(&store, &broken)).is_err());
        let mut newer = data.clone(); newer.captured_at = "2026-10-04T02:00:00Z".into();
        let mut stale = input(&store, &newer); stale.expected_snapshot_id = None; assert!(store.update_ranking(stale).is_err());
        let mut wrong_root = input(&store, &newer); wrong_root.expected_root = "C:/wrong-fixture-root".into(); assert!(store.update_ranking(wrong_root).is_err());
        let mut older = data.clone(); older.data_updated_at = "2026-10-01".into(); assert!(store.update_ranking(input(&store, &older)).is_err());
        assert_eq!(before, serde_json::to_string(&store.ranking_board(Board::Agent)).unwrap());
        let attempted = store.record_ranking_attempt(Board::Agent).unwrap();
        assert_eq!(attempted.snapshot_id, store.ranking_board(Board::Agent).snapshot_id);
        assert_eq!(attempted.snapshot.unwrap().captured_at, data.captured_at);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metric { pub value: f64, pub lower: f64, pub upper: f64 }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum RankingRow {
    #[serde(rename_all = "camelCase")]
    Agent {
        rank: u64, rank_low: Option<u64>, rank_high: Option<u64>,
        model: String, organization: Option<String>, license: Option<String>,
        net_improvement: Metric, confirmed_success: Metric,
        praise_vs_complaint: Metric, steerability: Metric,
    },
    #[serde(rename_all = "camelCase")]
    TextToImage {
        rank: u64, rank_low: Option<u64>, rank_high: Option<u64>,
        model: String, organization: Option<String>, license: Option<String>,
        score: f64, score_lower: f64, score_upper: f64, votes: u64, preliminary: Option<bool>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Price {
    pub input: f64, pub output: f64,
    pub provider_id: String, pub provider_name: String,
    pub model_id: String, pub canonical_model_id: String,
    pub kind: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PriceRow { pub model: String, pub price: Option<Price> }
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Prices {
    pub source_url: String, pub captured_at: Option<String>, pub rows: Vec<PriceRow>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub version: u32,
    pub board: Board,
    pub category: String,
    pub source_url: String,
    pub dataset_url: String,
    pub dataset_revision: String,
    pub dataset_license: String,
    // The source publishes a date. Do not invent a cutoff hour.
    pub data_updated_at: String,
    pub captured_at: String,
    pub total_models: u64,
    pub total_samples: Option<u64>,
    pub rows: Vec<RankingRow>,
    // Omit absent extensions so existing immutable snapshot hashes stay valid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing: Option<Prices>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedSnapshot { id: String, saved_at: String, snapshot: Snapshot }

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceCheck {
    pub day: Option<String>,
    pub attempted_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardState {
    pub board: Board,
    pub snapshot_id: Option<String>,
    pub saved_at: Option<String>,
    pub snapshot: Option<Snapshot>,
    pub source_check: SourceCheck,
    pub error: Option<StorageError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateSnapshot {
    pub board: Board,
    pub json: String,
    pub expected_snapshot_id: Option<String>,
    pub expected_root: String,
}

fn invalid() -> StorageError {
    StorageError::new("ranking_invalid_snapshot", "快照格式或字段不完整，需要对应 Overall 榜官方原序的完整 50 行；未替换已保存榜单。")
}
fn database_error(_: rusqlite::Error) -> StorageError {
    StorageError::new("ranking_storage_failed", "模型榜读写失败，未报告更新成功。请重新读取后核对。")
}
// Automatic data has its own namespace; old manually imported records remain
// on disk and are never silently presented as data fetched from the publisher.
fn key(board: Board, suffix: &str) -> String { format!("ranking-auto:{}:{suffix}", board.key()) }
fn read_value(db: &Connection, key: &str) -> Result<Option<String>, StorageError> {
    db.query_row("SELECT value FROM app_meta WHERE key=?1", [key], |row| row.get(0))
        .optional().map_err(database_error)
}
fn write_value(db: &Connection, key: &str, value: &str) -> Result<(), StorageError> {
    db.execute("INSERT INTO app_meta(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value])
        .map_err(database_error)?;
    Ok(())
}
fn now(db: &Connection) -> Result<String, StorageError> {
    db.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| row.get(0)).map_err(database_error)
}

// Strict RFC3339, normalized to epoch nanoseconds for comparing timezones.
// The original string remains untouched in storage and IPC.
fn timestamp(value: &str) -> Option<i128> {
    if !value.is_ascii() || value.len() < 20 || !valid_date(&value[..10]) { return None; }
    let b = value.as_bytes();
    if b[10] != b'T' || b[13] != b':' || b[16] != b':'
        || !b[11..13].iter().chain(b[14..16].iter()).chain(b[17..19].iter()).all(u8::is_ascii_digit) { return None; }
    let hour = value[11..13].parse::<i64>().ok()?;
    let minute = value[14..16].parse::<i64>().ok()?;
    let second = value[17..19].parse::<i64>().ok()?;
    if hour > 23 || minute > 59 || second > 59 || hour < 0 || minute < 0 || second < 0 { return None; }
    let mut end = 19;
    let mut nanos = 0;
    if b.get(end) == Some(&b'.') {
        end += 1;
        let start = end;
        while b.get(end).is_some_and(u8::is_ascii_digit) { end += 1; }
        if end == start || end - start > 9 { return None; }
        let fraction = &value[start..end];
        let padded = format!("{fraction:0<9}");
        nanos = padded.parse::<i128>().ok()?;
    }
    let zone = &value[end..];
    let offset = if zone == "Z" { 0 } else {
        let z = zone.as_bytes();
        if z.len() != 6 || !matches!(z[0], b'+' | b'-') || z[3] != b':'
            || !z[1..3].iter().chain(z[4..6].iter()).all(u8::is_ascii_digit) { return None; }
        let hours = zone[1..3].parse::<i64>().ok()?;
        let minutes = zone[4..6].parse::<i64>().ok()?;
        if hours > 23 || minutes > 59 { return None; }
        (hours * 60 + minutes) * 60 * if z[0] == b'-' { -1 } else { 1 }
    };
    let year = value[..4].parse::<i64>().ok()?;
    let month = value[5..7].parse::<i64>().ok()?;
    let day = value[8..10].parse::<i64>().ok()?;
    let adjusted_year = year - if month <= 2 { 1 } else { 0 };
    let era = adjusted_year / 400;
    let y = adjusted_year - era * 400;
    let m = month + if month > 2 { -3 } else { 9 };
    let days = era * 146097 + y * 365 + y / 4 - y / 100 + (153 * m + 2) / 5 + day - 1 - 719468;
    Some(i128::from(days * 86400 + hour * 3600 + minute * 60 + second - offset) * 1_000_000_000 + nanos)
}
fn text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= limit && !value.chars().any(char::is_control)
}
fn metric(value: &Metric) -> bool {
    value.value.is_finite() && value.lower.is_finite() && value.upper.is_finite()
        && value.lower <= value.value && value.value <= value.upper
}
fn validate_snapshot(snapshot: &Snapshot) -> Result<(), StorageError> {
    if snapshot.version != 2 || snapshot.category != "overall" || snapshot.source_url != snapshot.board.source_url()
        || snapshot.dataset_url != DATASET_URL || snapshot.dataset_license != "CC BY 4.0"
        || snapshot.dataset_revision.len() != 40 || !snapshot.dataset_revision.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || !valid_date(&snapshot.data_updated_at) || timestamp(&snapshot.captured_at).is_none()
        || snapshot.total_models < 50 || snapshot.total_models > MAX_INTEGER || snapshot.rows.len() != 50
        || snapshot.total_samples.is_some_and(|value| value > MAX_INTEGER) { return Err(invalid()); }
    let mut names = HashSet::new();
    if let Some(pricing) = &snapshot.pricing {
        if snapshot.board != Board::Agent || pricing.source_url != "https://models.dev/" || pricing.rows.len() != snapshot.rows.len()
            || pricing.captured_at.as_ref().is_some_and(|v| timestamp(v).is_none()) { return Err(invalid()); }
        for (item, row) in pricing.rows.iter().zip(&snapshot.rows) {
            let RankingRow::Agent { model, .. } = row else { return Err(invalid()); };
            if item.model != *model { return Err(invalid()); }
            if let Some(price) = &item.price {
                if pricing.captured_at.is_none() || !price.input.is_finite() || !price.output.is_finite()
                    || price.input <= 0.0 || price.output <= 0.0
                    || !matches!(price.kind.as_str(), "first-party" | "third-party")
                    || !text(&price.provider_id, 150) || !text(&price.provider_name, 150)
                    || !text(&price.model_id, 250) || !text(&price.canonical_model_id, 250) { return Err(invalid()); }
            }
        }
    }
    let mut previous_rank = 0;
    for row in &snapshot.rows {
        let (rank, low, high, model, organization, license, fields_valid) = match row {
            RankingRow::Agent { rank, rank_low, rank_high, model, organization, license, net_improvement, confirmed_success, praise_vs_complaint, steerability } =>
                (*rank, *rank_low, *rank_high, model, organization, license,
                    snapshot.board == Board::Agent && [net_improvement, confirmed_success, praise_vs_complaint, steerability].iter().all(|m| metric(m))),
            RankingRow::TextToImage { rank, rank_low, rank_high, model, organization, license, score, score_lower, score_upper, votes, .. } =>
                (*rank, *rank_low, *rank_high, model, organization, license,
                    snapshot.board == Board::TextToImage && score.is_finite() && score_lower.is_finite() && score_upper.is_finite()
                        && score_lower <= score && score <= score_upper && *votes <= MAX_INTEGER),
        };
        if !fields_valid || rank == 0 || rank > 50 || rank < previous_rank || (previous_rank == 0 && rank != 1)
            || match (low, high) { (None, None) => false, (Some(l), Some(h)) => l == 0 || l > h || h > snapshot.total_models, _ => true }
            || !text(model, 250) || organization.as_ref().is_some_and(|v| !text(v, 150))
            || license.as_ref().is_some_and(|v| !text(v, 150)) || !names.insert(model.clone()) { return Err(invalid()); }
        previous_rank = rank;
    }
    Ok(())
}

fn parse_snapshot(json: &str, board: Board) -> Result<Snapshot, StorageError> {
    if json.len() > MAX_SNAPSHOT_BYTES { return Err(StorageError::new("ranking_snapshot_too_large", "快照文件不能超过 512 KB，原榜单未改变。")); }
    // Require nullable fields explicitly so omission is not mistaken for a
    // source-confirmed absence. Deserialize never sorts, fills or renumbers rows.
    let raw: serde_json::Value = serde_json::from_str(json).map_err(|_| invalid())?;
    if raw.get("totalSamples").is_none() || raw.get("rows").and_then(|v| v.as_array()).is_none_or(|rows|
        rows.iter().any(|row| row.get("organization").is_none() || row.get("license").is_none())) { return Err(invalid()); }
    if let Some(pricing) = raw.get("pricing") {
        if !pricing.is_object() || pricing.get("capturedAt").is_none()
            || pricing.get("rows").and_then(|v| v.as_array()).is_none_or(|rows|
                rows.iter().any(|row| row.get("price").is_none())) { return Err(invalid()); }
    }
    let snapshot: Snapshot = serde_json::from_str(json).map_err(|_| invalid())?;
    if snapshot.board != board { return Err(StorageError::new("ranking_wrong_board", "更新数据与所请求榜单不同，原榜未改变。")); }
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn read_saved(db: &Connection, board: Board) -> Result<Option<SavedSnapshot>, StorageError> {
    let Some(id) = read_value(db, &key(board, "current"))? else { return Ok(None); };
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) { return Err(invalid()); }
    let raw = read_value(db, &key(board, &format!("snapshot:{id}")))?.ok_or_else(invalid)?;
    if raw.len() > MAX_SNAPSHOT_BYTES + 1024 { return Err(invalid()); }
    let saved: SavedSnapshot = serde_json::from_str(&raw).map_err(|_| invalid())?;
    validate_snapshot(&saved.snapshot)?;
    let bytes = serde_json::to_vec(&saved.snapshot).map_err(|_| invalid())?;
    let expected_id = format!("{:x}", Sha256::digest(bytes));
    if saved.id != id || id != expected_id || saved.snapshot.board != board || timestamp(&saved.saved_at).is_none() { return Err(invalid()); }
    Ok(Some(saved))
}
fn read_check(db: &Connection, board: Board) -> Result<SourceCheck, StorageError> {
    let Some(json) = read_value(db, &key(board, "source-check"))? else { return Ok(SourceCheck::default()); };
    let check: SourceCheck = serde_json::from_str(&json).map_err(|_| invalid())?;
    if check.day.as_ref().is_none_or(|d| !valid_date(d)) || check.attempted_at.as_ref().is_none_or(|d| timestamp(d).is_none()) { return Err(invalid()); }
    Ok(check)
}

impl Store {
    pub fn ensure_ranking_root(&self, expected: &str) -> Result<(), StorageError> {
        if self.root.to_string_lossy() != expected {
            return Err(StorageError::new("ranking_root_changed", "数据目录在获取期间发生变化，未将榜单写入另一目录，请重新刷新。"));
        }
        Ok(())
    }
    pub fn ranking_board(&self, board: Board) -> BoardState {
        // A corrupt board must not prevent reading the other board or projects.
        let mut state = BoardState { board, snapshot_id: None, saved_at: None, snapshot: None, source_check: SourceCheck::default(), error: None };
        match read_saved(&self.db, board) {
            Ok(Some(saved)) => { state.snapshot_id = Some(saved.id); state.saved_at = Some(saved.saved_at); state.snapshot = Some(saved.snapshot); },
            Ok(None) => {},
            Err(error) => state.error = Some(error),
        }
        match read_check(&self.db, board) {
            Ok(check) => state.source_check = check,
            Err(error) => { if state.error.is_none() { state.error = Some(error); } },
        }
        state
    }
    pub fn ranking_boards(&self) -> Vec<BoardState> {
        [Board::Agent, Board::TextToImage].into_iter().map(|board| self.ranking_board(board)).collect()
    }
    pub fn update_ranking(&mut self, input: UpdateSnapshot) -> Result<BoardState, StorageError> {
        self.ensure_ranking_root(&input.expected_root)?;
        let snapshot = parse_snapshot(&input.json, input.board)?;
        let bytes = serde_json::to_vec(&snapshot).map_err(|_| invalid())?;
        let id = format!("{:x}", Sha256::digest(&bytes));
        let tx = self.db.transaction().map_err(database_error)?;
        let current = read_saved(&tx, input.board)?;
        // Repeating an uncertain identical request is safe; no new save time.
        if current.as_ref().is_some_and(|saved| saved.id == id) {
            tx.commit().map_err(database_error)?;
            return Ok(self.ranking_board(input.board));
        }
        if current.as_ref().map(|saved| &saved.id) != input.expected_snapshot_id.as_ref() {
            return Err(StorageError::new("ranking_stale_snapshot", "已保存榜单在获取期间发生变化，未覆盖新快照。请重新读取后刷新。"));
        }
        if current.as_ref().is_some_and(|saved|
            timestamp(&snapshot.captured_at) < timestamp(&saved.snapshot.captured_at)
                || snapshot.data_updated_at < saved.snapshot.data_updated_at) {
            return Err(StorageError::new("ranking_older_snapshot", "来源数据比已保存榜单更旧，未替换当前榜单，请稍后刷新。"));
        }
        let history_key = key(input.board, &format!("snapshot:{id}"));
        if read_value(&tx, &history_key)?.is_none() {
            let saved = SavedSnapshot { id: id.clone(), saved_at: now(&tx)?, snapshot };
            let json = serde_json::to_string(&saved).map_err(|_| invalid())?;
            tx.execute("INSERT INTO app_meta(key,value) VALUES (?1,?2)", params![history_key, json]).map_err(database_error)?;
        } else {
            // Reuse a valid immutable historical record; never overwrite it.
            let raw = read_value(&tx, &history_key)?.ok_or_else(invalid)?;
            let saved: SavedSnapshot = serde_json::from_str(&raw).map_err(|_| invalid())?;
            let historical_bytes = serde_json::to_vec(&saved.snapshot).map_err(|_| invalid())?;
            if saved.id != id || historical_bytes != bytes || timestamp(&saved.saved_at).is_none() { return Err(invalid()); }
        }
        write_value(&tx, &key(input.board, "current"), &id)?;
        tx.commit().map_err(database_error)?;
        let state = self.ranking_board(input.board);
        if state.error.is_some() || state.snapshot_id.as_ref() != Some(&id) {
            return Err(StorageError::new("ranking_save_uncertain", "保存回执尚未确认，请重新读取核对，尚未报告更新成功。"));
        }
        Ok(state)
    }
    pub fn record_ranking_attempt(&mut self, board: Board) -> Result<BoardState, StorageError> {
        let tx = self.db.transaction().map_err(database_error)?;
        let today: String = tx.query_row("SELECT strftime('%Y-%m-%d','now','+8 hours')", [], |r| r.get(0)).map_err(database_error)?;
        {
            // An actual acquisition attempt, including failure or cancellation.
            // This never changes a snapshot's acquisition time or saved content.
            let check = SourceCheck { day: Some(today), attempted_at: Some(now(&tx)?) };
            let json = serde_json::to_string(&check).map_err(|_| invalid())?;
            write_value(&tx, &key(board, "source-check"), &json)?;
        }
        tx.commit().map_err(database_error)?;
        Ok(self.ranking_board(board))
    }
}
