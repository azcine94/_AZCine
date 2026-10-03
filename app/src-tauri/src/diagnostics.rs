use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

// Only one owned temporary probe runs at a time, including rapid calls outside the UI.
static PROBE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopReport {
    pub request_id: u32,
    pub app_version: &'static str,
    pub sqlite_version: String,
    pub storage: &'static str,
    pub round_trip: bool,
    pub rollback: bool,
}

#[derive(Debug, Serialize)]
pub struct ProbeError {
    pub code: &'static str,
    pub message: &'static str,
}

impl ProbeError {
    pub fn invalid_request() -> Self {
        Self { code: "invalid_request", message: "检查编号无效，请重新发起。" }
    }

    pub fn worker_failed() -> Self {
        Self { code: "worker_failed", message: "桌面检查意外中断，请重试。" }
    }
}

fn storage_error(_: rusqlite::Error) -> ProbeError {
    ProbeError { code: "storage_failed", message: "临时数据库检查失败；没有修改正式业务数据。请检查临时目录可写后重试。" }
}

fn verify_database(path: &Path, request_id: u32) -> Result<String, ProbeError> {
    let mut db = Connection::open(path).map_err(storage_error)?;
    verify_connection(&mut db, request_id)?;
    let version: String = db.query_row("SELECT sqlite_version()", [], |row| row.get(0)).map_err(storage_error)?;
    db.close().map_err(|(_, error)| storage_error(error))?;
    Ok(version)
}

fn verify_connection(db: &mut Connection, request_id: u32) -> Result<(), ProbeError> {
    db.pragma_update(None, "journal_mode", "PERSIST").map_err(storage_error)?;
    db.execute_batch("CREATE TABLE probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL) STRICT;")
        .map_err(storage_error)?;
    db.execute("INSERT INTO probe (id, value) VALUES (1, ?1)", params![request_id]).map_err(storage_error)?;
    let stored: u32 = db.query_row("SELECT value FROM probe WHERE id = 1", [], |row| row.get(0)).map_err(storage_error)?;
    if stored != request_id {
        return Err(ProbeError { code: "round_trip_failed", message: "临时数据库读写结果不一致。" });
    }
    // A real failed batch must not leave its earlier insert behind.
    let tx = db.transaction().map_err(storage_error)?;
    tx.execute("INSERT INTO probe (id, value) VALUES (2, ?1)", params![request_id]).map_err(storage_error)?;
    let duplicate = tx.execute("INSERT INTO probe (id, value) VALUES (1, ?1)", params![request_id]);
    if !matches!(duplicate, Err(rusqlite::Error::SqliteFailure(ref error, _)) if error.code == rusqlite::ErrorCode::ConstraintViolation) {
        return Err(ProbeError { code: "failure_check_failed", message: "临时数据库约束检查未按预期拒绝重复记录。" });
    }
    tx.rollback().map_err(storage_error)?;
    let count: u32 = db.query_row("SELECT COUNT(*) FROM probe", [], |row| row.get(0)).map_err(storage_error)?;
    if count != 1 {
        return Err(ProbeError { code: "rollback_failed", message: "临时数据库事务回滚检查失败。" });
    }
    Ok(())
}

pub fn check(request_id: u32) -> Result<DesktopReport, ProbeError> {
    if request_id == 0 { return Err(ProbeError::invalid_request()); }
    let _guard = PROBE_LOCK.try_lock().map_err(|_| ProbeError { code: "busy", message: "已有桌面检查正在执行，请稍后重试。" })?;
    let base = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation")
    } else { std::env::temp_dir() };
    std::fs::create_dir_all(&base).map_err(|_| ProbeError { code: "temporary_directory_failed", message: "无法创建检查目录；请检查磁盘空间与写入权限。" })?;
    let dir = tempfile::Builder::new().prefix("desktop-probe-").tempdir_in(base)
        .map_err(|_| ProbeError { code: "temporary_directory_failed", message: "无法创建检查目录；请检查磁盘空间与写入权限。" })?.keep();
    let result = verify_database(&dir.join("probe.sqlite3"), request_id);
    // Validation evidence stays on disk until the user explicitly requests cleanup.
    Ok(DesktopReport {
        request_id,
        app_version: env!("CARGO_PKG_VERSION"),
        sqlite_version: result?,
        storage: "temporary",
        round_trip: true,
        rollback: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_temporary_database_when_checking_then_echo_and_rollback_are_verified() {
        let report = check(42).expect("actual temporary probe");
        assert_eq!(report.request_id, 42);
        assert_eq!(report.storage, "temporary");
        assert!(!report.sqlite_version.is_empty());
        assert!(report.round_trip && report.rollback);
    }

    #[test]
    fn given_read_only_connection_when_writing_then_error_is_returned() {
        let mut db = Connection::open_in_memory().unwrap();
        db.pragma_update(None, "query_only", true).unwrap();
        let error = verify_connection(&mut db, 17).unwrap_err();
        assert_eq!(error.code, "storage_failed");
    }

    #[test]
    fn given_directory_instead_of_file_when_opening_then_no_false_success() {
        let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
        std::fs::create_dir_all(&base).unwrap();
        let dir = tempfile::Builder::new().prefix("probe-failure-").tempdir_in(base).unwrap().keep();
        let error = verify_database(&dir, 9).unwrap_err();
        assert_eq!(error.code, "storage_failed");
        assert!(!error.message.contains(&dir.to_string_lossy().to_string()));
    }

    #[test]
    fn given_zero_request_when_checking_then_rejected_before_io() {
        assert_eq!(check(0).unwrap_err().code, "invalid_request");
    }
}
