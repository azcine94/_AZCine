//! External development-environment export. No business database or Pi runtime writes.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fs, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, time::Duration};
use tauri::{Manager, State};
use crate::storage::StorageError;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentPaths { pub herdr: String, pub openpi: String, pub skills: String }

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportInput { paths: EnvironmentPaths, output: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStatus {
    id: u64, status: String, message: String, done: u64, total: u64,
    output: Option<String>, files: Vec<String>,
}
impl Default for ExportStatus {
    fn default() -> Self { Self { id:0, status:"idle".into(), message:String::new(), done:0, total:0, output:None, files:vec![] } }
}
#[derive(Default)]
struct ExportJob { status: ExportStatus, child: Option<Child>, cancelled: bool }
#[derive(Default)]
pub struct EnvironmentState(Arc<Mutex<ExportJob>>);
fn error(message: impl Into<String>) -> StorageError { StorageError::new("dev_environment", &message.into()) }

fn scripts() -> Result<tempfile::TempDir, StorageError> {
    if !cfg!(windows) { return Err(error("开发环境打包仅支持 Windows。")); }
    let dir = tempfile::Builder::new().prefix("azcine-environment-").tempdir().map_err(|_|error("无法建立打包器临时目录。"))?;
    for (name, content) in [
        ("common.ps1", include_str!("../resources/dev-environment/common.ps1")),
        ("inspect.ps1", include_str!("../resources/dev-environment/inspect.ps1")),
        ("export.ps1", include_str!("../resources/dev-environment/export.ps1")),
        ("deploy.ps1", include_str!("../resources/dev-environment/deploy.ps1")),
        ("start-environment.ps1", include_str!("../resources/dev-environment/start-environment.ps1")),
    ] {
        // Windows PowerShell 5.1 requires BOM to read Chinese script literals reliably.
        fs::write(dir.path().join(name), format!("\u{feff}{content}")).map_err(|_|error("无法准备打包器脚本。"))?;
    }
    Ok(dir)
}
fn powershell(dir: &Path, script: &str) -> Result<Command, StorageError> {
    let system = std::env::var_os("SystemRoot").ok_or_else(||error("找不到 Windows 系统目录。"))?;
    let executable = PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    if !executable.is_file() { return Err(error("找不到 Windows PowerShell。")); }
    let mut command=Command::new(executable);
    command.args(["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File"])
        .arg(dir.join(script)).arg("-RequestFile").arg(dir.join("request.json"))
        .current_dir(dir).stdin(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    Ok(command)
}
fn request(path:&Path, value:&Value) -> Result<(),StorageError> {
    let bytes=serde_json::to_vec(value).map_err(|_|error("无法准备打包参数。"))?;
    fs::write(path.join("request.json"),bytes).map_err(|_|error("无法保存临时打包参数。"))
}
fn validate_paths(paths:&EnvironmentPaths) -> Result<(),StorageError> {
    for path in [&paths.herdr,&paths.openpi,&paths.skills] {
        if path.len()>4096 || path.contains(['\r','\n','\0']) {return Err(error("目录路径不合法。"));}
    }
    Ok(())
}
#[tauri::command]
pub async fn dev_environment_inspect(paths: EnvironmentPaths) -> Result<Value,StorageError> {
    validate_paths(&paths)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir=scripts()?;
        request(dir.path(),&json!(paths))?;
        let output=powershell(dir.path(),"inspect.ps1")?.output().map_err(|_|error("环境识别进程无法启动。"))?;
        if !output.status.success(){return Err(error(String::from_utf8_lossy(&output.stderr).trim().to_string()));}
        serde_json::from_slice(&output.stdout).map_err(|_|error("环境识别未返回完整结果。"))
    }).await.map_err(|_|error("环境识别任务异常结束。"))?
}
#[tauri::command]
pub fn dev_environment_status(state:State<'_,EnvironmentState>) -> Result<ExportStatus,StorageError> {
    Ok(state.0.lock().map_err(|_|error("无法读取打包状态。"))?.status.clone())
}
fn run_export(shared:Arc<Mutex<ExportJob>>, input:ExportInput) -> Result<(),StorageError> {
    let dir=scripts()?;
    request(dir.path(),&json!({"paths":input.paths,"output":input.output}))?;
    let mut command=powershell(dir.path(),"export.ps1")?;
    command.arg("-ProgressFile").arg(dir.path().join("progress.json")).stdout(Stdio::null()).stderr(Stdio::null());
    {
        let mut job=shared.lock().map_err(|_|error("无法读取打包任务。"))?;
        if job.cancelled { job.status.status="cancelled".into();job.status.message="已取消打包。".into();return Ok(()); }
        job.child=Some(command.spawn().map_err(|_|error("打包进程无法启动。"))?);
    }
    let success=loop {
        let mut job=shared.lock().map_err(|_|error("无法读取打包任务。"))?;
        if job.cancelled {
            if let Some(mut child)=job.child.take(){let _=child.kill();let _=child.wait();}
            break false;
        }
        let result=job.child.as_mut().ok_or_else(||error("打包进程句柄丢失。"))?.try_wait().map_err(|_|error("无法取得打包进程状态。"))?;
        if let Some(exit)=result { job.child.take(); break exit.success(); }
        if let Ok(bytes)=fs::read(dir.path().join("progress.json")) {
            if let Ok(value)=serde_json::from_slice::<Value>(bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(&bytes)) {
                job.status.message=value["message"].as_str().unwrap_or("正在打包").to_string();
                job.status.done=value["done"].as_u64().unwrap_or(0);
                job.status.total=value["total"].as_u64().unwrap_or(0);
            }
        }
        drop(job);
        std::thread::sleep(Duration::from_millis(200));
    };
    let mut job=shared.lock().map_err(|_|error("无法读取打包结果。"))?;
    if job.cancelled {
        job.status.status="cancelled".into();
        job.status.message="已取消。源环境未改动；未完成的输出保留在所选保存目录。".into();
        return Ok(());
    }
    if !success {
        return Err(error(fs::read_to_string(dir.path().join("error.txt")).unwrap_or_else(|_|"打包未完成，可能无法读取部分文件或保存空间不足；原环境保持不变。".into()).trim_start_matches('\u{feff}').to_string()));
    }
    let bytes=fs::read(dir.path().join("result.json")).map_err(|_|error("打包进程结束，但没有取得完整产物回执。"))?;
    let result:Value=serde_json::from_slice(bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(&bytes)).map_err(|_|error("打包回执无法解析，请核对输出目录。"))?;
    let output=result["output"].as_str().ok_or_else(||error("打包结果缺少保存目录。"))?;
    let root=Path::new(output);
    if root.join("INCOMPLETE.txt").exists() || !root.join("dev-environment.zip").is_file() || !root.join("skills-manager.zip").is_file() {
        return Err(error("打包文件尚未全部完成，请保留目录供核对。"));
    }
    job.status.status="completed".into();job.status.message="两份文件已生成".into();
    job.status.output=Some(output.into());job.status.files=vec!["dev-environment.zip".into(),"skills-manager.zip".into()];
    Ok(())
}
#[tauri::command]
pub fn dev_environment_export(input:ExportInput,state:State<'_,EnvironmentState>) -> Result<ExportStatus,StorageError> {
    validate_paths(&input.paths)?;
    if input.output.len()>4096 || input.output.contains(['\0','\r','\n']) || !Path::new(&input.output).is_absolute() || !Path::new(&input.output).is_dir() {
        return Err(error("请先选择有效的保存目录。"));
    }
    let mut job=state.0.lock().map_err(|_|error("无法开始打包。"))?;
    if matches!(job.status.status.as_str(),"running"|"cancelling"){return Err(error("已有打包任务正在处理。"));}
    job.cancelled=false;
    job.status=ExportStatus{id:job.status.id+1,status:"running".into(),message:"正在准备打包".into(),..ExportStatus::default()};
    let result=job.status.clone();let shared=state.0.clone();drop(job);
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(failure)=run_export(shared.clone(),input) {
            if let Ok(mut job)=shared.lock() {
                if let Some(mut child)=job.child.take(){let _=child.kill();let _=child.wait();}
                job.status.status=if job.cancelled{"cancelled"}else{"failed"}.into();
                job.status.message=if job.cancelled{"已取消打包，未完成的输出已保留。".into()}else{failure.message};
            }
        }
    });
    Ok(result)
}
#[tauri::command]
pub fn dev_environment_cancel(state:State<'_,EnvironmentState>) -> Result<ExportStatus,StorageError> {
    let mut job=state.0.lock().map_err(|_|error("无法取消打包。"))?;
    if job.status.status=="running" {job.cancelled=true;job.status.status="cancelling".into();job.status.message="正在取消打包…".into();}
    Ok(job.status.clone())
}
#[tauri::command]
pub async fn dev_environment_open(state:State<'_,EnvironmentState>,window:tauri::WebviewWindow) -> Result<(),StorageError> {
    let path=state.0.lock().map_err(|_|error("无法读取产物目录。"))?.status.output.clone().ok_or_else(||error("还没有已完成的打包结果。"))?;
    let owner=crate::owner_handle(&window)?;
    tauri::async_runtime::spawn_blocking(move || crate::native_paths::open_folder(owner,Path::new(&path))).await.map_err(|_|error("无法打开产物目录。"))?
}
pub fn shutdown(app:&tauri::AppHandle) {
    if let Some(state)=app.try_state::<EnvironmentState>() {
        if let Ok(mut job)=state.0.lock() {
            if job.child.is_some() || job.status.status=="running" {
                job.cancelled=true;
                if let Some(child)=job.child.as_mut(){let _=child.kill();}
            }
        }
    }
}
