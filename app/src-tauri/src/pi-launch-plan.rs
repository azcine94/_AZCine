//! Owned paths and explicit child environment. Does not spawn processes or read
//! host credential/config files. Call only with a verified resource runtime.
use crate::pi_model_config::ConfigError;
use std::{ffi::OsString, fs, path::{Path, PathBuf}};

fn error(code: &'static str, message: &'static str) -> ConfigError { ConfigError { code, message } }
fn io_error(_: std::io::Error) -> ConfigError { error("pi_path_io", "Pi 自有目录不可读写，请检查路径、权限与空间；没有改用其他 Pi。") }
pub(crate) fn linked_path(path: &Path, meta: &fs::Metadata) -> Result<bool, ConfigError> {
    if meta.file_type().is_symlink() { return Ok(true); }
    #[cfg(windows)] {
        use std::os::windows::{fs::{MetadataExt, OpenOptionsExt}, io::AsRawHandle};
        use windows::Win32::{Foundation::HANDLE, Storage::FileSystem::{GetFileInformationByHandleEx, FileAttributeTagInfo, FILE_ATTRIBUTE_TAG_INFO}};
        if meta.file_attributes() & 0x400 != 0 {
            let file = fs::OpenOptions::new().access_mode(0x80).share_mode(7)
                .custom_flags(0x0220_0000).open(path).map_err(io_error)?;
            let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
            unsafe { GetFileInformationByHandleEx(HANDLE(file.as_raw_handle()), FileAttributeTagInfo,
                (&mut info as *mut FILE_ATTRIBUTE_TAG_INFO).cast(), std::mem::size_of_val(&info) as u32) }.map_err(|_| error("pi_path_io", "无法核对数据目录属性。"))?;
            // Cloud Files tags represent in-place OneDrive files, not another
            // pathname. Continue rejecting junctions, symlinks and unknown tags.
            return Ok((info.ReparseTag & !0x0000_f000) != 0x9000_001a);
        }
    }
    let _ = path;
    Ok(false)
}
pub fn no_link(path: &Path) -> Result<(), ConfigError> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if linked_path(path, &meta)? { return Err(error("pi_path_link", "Pi 目录含链接或不支持的重解析路径，已停止以免读写其他环境。")); }
            Ok(())
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_error(e)),
    }
}
fn owned_dir(parent: &Path, name: &str) -> Result<PathBuf, ConfigError> {
    let path = parent.join(name); no_link(&path)?;
    match fs::create_dir(&path) { Ok(()) => {}, Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && path.is_dir() => {}, Err(e) => return Err(io_error(e)) }
    let path = fs::canonicalize(path).map_err(io_error)?;
    if !path.starts_with(parent) { return Err(error("pi_path_outside", "Pi 路径不属于当前数据目录，已停止启动。")); } Ok(path)
}
fn owned_file(root: &Path, relative: &str) -> Result<PathBuf, ConfigError> {
    let mut path = root.to_path_buf();
    for component in Path::new(relative).components() { path.push(component); no_link(&path)?; }
    let path = fs::canonicalize(path).map_err(io_error)?;
    if !path.is_file() || !path.starts_with(root) { return Err(error("pi_runtime_invalid", "独立原版运行文件缺失或不属于本应用，未调用系统中的其他 Pi。")); } Ok(path)
}
#[derive(Clone)]
pub struct RuntimePaths { pub root: PathBuf, pub node: PathBuf, pub pi: PathBuf, pub package: PathBuf }
impl RuntimePaths {
    /// The parent verifies the resource receipt before calling. Never accepts
    /// independently chosen node/pi binaries or follows symlinked dependencies.
    pub fn at(root: &Path) -> Result<Self, ConfigError> {
        if !root.is_absolute() { return Err(error("pi_runtime_invalid", "Pi 运行目录必须是本应用的绝对路径。")); }
        no_link(root)?; let root = fs::canonicalize(root).map_err(io_error)?;
        let node = owned_file(&root, "node-v24.21.0-win-x64/node.exe")?;
        let pi = owned_file(&root, "pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js")?;
        let package = pi.parent().and_then(Path::parent).and_then(Path::parent).ok_or_else(|| error("pi_runtime_invalid", "Pi 原版运行文件路径不完整。"))?.to_path_buf();
        Ok(Self { root, node, pi, package })
    }
}
#[derive(Clone)]
pub struct PiPaths {
    pub root: PathBuf, pub pi_root: PathBuf, pub agent: PathBuf, pub sessions: PathBuf,
    pub home: PathBuf, pub appdata: PathBuf, pub localappdata: PathBuf, pub temp: PathBuf, pub default_cwd: PathBuf,
}
impl PiPaths {
    pub fn prepare(root: &Path) -> Result<Self, ConfigError> {
        // Normal development shares main's native Pi configuration/resources
        // and sessions. Release and isolated validation keep their own root.
        // Unit tests must never inherit the shared development root.
        #[cfg(all(debug_assertions,not(test)))]
        let shared_root = if std::env::var_os("AZCINE_DEV_USE_MAIN_DATA").as_deref() == Some(std::ffi::OsStr::new("1"))
            && std::env::var_os("AZCINE_TEST_CONFIG_DIR").is_none()
            && std::env::var_os("AZCINE_TEST_DEFAULT_ROOT").is_none() {
            let data = std::env::var_os("AZCINE_DEV_PI_DATA_DIR").map(PathBuf::from)
                .ok_or_else(|| error("pi_root_required", "共享 Pi 启动参数缺失，请结束当前开发进程，再在本目录运行 npm run dev；未回退分支目录。"))?;
            if !data.is_absolute() { return Err(error("pi_root_required", "main 的共享 Pi 数据目录必须为绝对路径。")); }
            no_link(&data)?;
            fs::create_dir_all(&data).map_err(io_error)?;
            Some(fs::canonicalize(data).map_err(io_error)?)
        } else { None };
        #[cfg(all(debug_assertions,not(test)))]
        let root = shared_root.as_deref().unwrap_or(root);
        if !root.is_absolute() || !root.is_dir() { return Err(error("pi_root_required", "请先选择有效的 AZCine 数据目录。")); }
        let root = fs::canonicalize(root).map_err(io_error)?;
        let pi_root = owned_dir(&root, "pi")?;
        let agent = owned_dir(&pi_root, "agent")?; let sessions = owned_dir(&pi_root, "sessions")?;
        owned_dir(&agent, "skills")?; owned_dir(&agent, "extensions")?;
        crate::pi_session_title::provision(&pi_root,&agent)?;
        crate::pi_resources::provision_task_refinement(&pi_root,&agent)?;
        let home = owned_dir(&pi_root, "home")?; let appdata = owned_dir(&pi_root, "appdata")?; let localappdata = owned_dir(&pi_root, "localappdata")?; let temp = owned_dir(&pi_root, "temp")?;
        let workspaces = owned_dir(&pi_root, "workspaces")?; let default_cwd = owned_dir(&workspaces, "default")?;
        Ok(Self { root, pi_root, agent, sessions, home, appdata, localappdata, temp, default_cwd })
    }
    pub fn checked_cwd(&self, selected: Option<&Path>) -> Result<PathBuf, ConfigError> {
        let cwd = selected.unwrap_or(&self.default_cwd);
        if !cwd.is_absolute() || !cwd.is_dir() { return Err(error("pi_cwd_invalid", "工作目录不可用，请选择现有绝对目录；输入仍保留。")); }
        let cwd = fs::canonicalize(cwd).map_err(io_error)?;
        if cwd.starts_with(&self.pi_root) && !cwd.starts_with(self.default_cwd.parent().unwrap()) {
            return Err(error("pi_cwd_private", "不能把 Pi 认证、会话或私有配置目录作为工作目录。"));
        }
        let project = cwd.join(".pi"); no_link(&project)?;
        // Upstream Pi runs migrations before trust. Metadata-only preflight; never
        // read foreign settings/auth and never rename the external directory.
        for name in ["commands", "hooks", "tools"] {
            if project.join(name).try_exists().map_err(io_error)? {
                return Err(error("pi_cwd_migration", "所选工作目录有原版 Pi 的旧资源目录，启动可能迁移或等待交互。已拒绝启动，原目录未修改；请换用本应用工作目录或自行迁移后重试。"));
            }
        }
        Ok(cwd)
    }
    pub fn checked_session(&self, path: &Path) -> Result<PathBuf, ConfigError> {
        if !path.is_absolute() || path.components().any(|c|matches!(c,std::path::Component::ParentDir)) || path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
            return Err(error("pi_session_outside", "只能打开本应用会话目录中的原生 JSONL，会话没有切换。"));
        }
        let actual = fs::canonicalize(path).map_err(io_error)?;
        if !actual.starts_with(&self.sessions) || !actual.is_file() { return Err(error("pi_session_outside", "会话不属于当前应用，未打开。")); }
        // Check input ancestors too: canonicalization alone must not accept an
        // alias/junction even if it eventually points back into our root.
        let mut raw = PathBuf::new();
        for component in path.components() { raw.push(component); if matches!(component,std::path::Component::Normal(_)) { no_link(&raw)?; } }
        let mut cursor = self.sessions.clone();
        for component in actual.strip_prefix(&self.sessions).map_err(|_| error("pi_session_outside", "会话路径不属于当前应用。"))?.components() {
            if !matches!(component, std::path::Component::Normal(_)) { return Err(error("pi_session_outside", "会话路径含越界部分，未打开。")); }
            cursor.push(component); no_link(&cursor)?;
        }
        Ok(actual)
    }
    /// Inputs are explicit non-secret OS locations. No process.env enumeration or
    /// denylist filtering; credential/config/module injection variables do not exist.
    pub fn environment(&self, runtime: &RuntimePaths, windows_dir: &Path, program_files: &[PathBuf]) -> Result<Vec<(OsString, OsString)>, ConfigError> {
        if !windows_dir.is_absolute() || !windows_dir.is_dir() { return Err(error("pi_system_path", "无法确认 Windows 系统目录，未启动 Pi。")); }
        let system32 = windows_dir.join("System32");
        let search = [runtime.node.parent().unwrap().to_path_buf(), system32.clone(), windows_dir.to_path_buf(), system32.join("WindowsPowerShell/v1.0")];
        let path = std::env::join_paths(search).map_err(|_| error("pi_system_path", "不能构造独立进程命令路径。"))?;
        let mut env: Vec<(OsString,OsString)> = vec![
            ("SystemRoot".into(),windows_dir.into()), ("WINDIR".into(),windows_dir.into()),
            ("ComSpec".into(),system32.join("cmd.exe").into_os_string()), ("PATH".into(),path),
            ("HOME".into(),self.home.as_os_str().into()), ("USERPROFILE".into(),self.home.as_os_str().into()),
            ("APPDATA".into(),self.appdata.as_os_str().into()), ("LOCALAPPDATA".into(),self.localappdata.as_os_str().into()),
            ("TEMP".into(),self.temp.as_os_str().into()), ("TMP".into(),self.temp.as_os_str().into()),
            ("PI_CODING_AGENT_DIR".into(),self.agent.as_os_str().into()), ("PI_CODING_AGENT_SESSION_DIR".into(),self.sessions.as_os_str().into()),
            ("PI_PACKAGE_DIR".into(),runtime.package.as_os_str().into()),
            ("PI_OFFLINE".into(),"1".into()), ("PI_SKIP_VERSION_CHECK".into(),"1".into()), ("PI_TELEMETRY".into(),"0".into()),
        ];
        // Original shell discovery may use standard Program Files. No inherited
        // PATH entry or shell profile is loaded; Bash is the existing OS tool.
        for (name, path) in ["ProgramFiles", "ProgramFiles(x86)"].iter().zip(program_files) {
            if !path.is_absolute() { return Err(error("pi_system_path", "系统程序目录必须是绝对路径。")); }
            env.push(((*name).into(),path.as_os_str().into()));
        }
        Ok(env)
    }
    pub fn arguments(&self, runtime: &RuntimePaths, session: Option<&Path>) -> Result<Vec<OsString>, ConfigError> {
        let mut args = vec!["--no-global-search-paths".into(),runtime.pi.as_os_str().into(),"--mode".into(),"rpc".into(),"--offline".into(),"--no-approve".into(),"--no-context-files".into(),"--session-dir".into(),self.sessions.as_os_str().into()];
        if let Some(session) = session { args.push("--session".into()); args.push(self.checked_session(session)?.into_os_string()); }
        Ok(args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf { let base = std::env::var_os("AZCINE_PI_CONFIG_TEST_ROOT").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation/s03-launch-tests")); fs::create_dir_all(&base).unwrap(); tempfile::Builder::new().prefix("paths-").tempdir_in(base).unwrap().keep() }
    fn runtime(base: &Path) -> RuntimePaths { let dir = base.join("runtime");fs::create_dir_all(dir.join("node-v24.21.0-win-x64")).unwrap();fs::create_dir_all(dir.join("pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle")).unwrap();fs::write(dir.join("node-v24.21.0-win-x64/node.exe"), b"synthetic not executable").unwrap();fs::write(dir.join("pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"), b"synthetic not executable").unwrap();RuntimePaths::at(&dir).unwrap() }
    #[test]
    fn given_owned_paths_when_plan_then_explicit_environment_and_no_host_discovery_or_probe_model() {
        let root = root(); let paths = PiPaths::prepare(&root).unwrap(); let rt = runtime(&root); let windows = root.join("windows-fixture");fs::create_dir(&windows).unwrap();
        let env = paths.environment(&rt, &windows, &[]).unwrap();let names:Vec<_>=env.iter().map(|(k,_)|k.to_str().unwrap()).collect();
        assert_eq!(names.len(),16); for absent in ["NODE_OPTIONS","NODE_PATH","OPENAI_API_KEY","BASH_ENV","PI_PROVIDER","PI_MODEL","HTTP_PROXY"] { assert!(!names.contains(&absent)); }
        assert_eq!(env.iter().find(|(k,_)|k=="HOME").unwrap().1, paths.home.as_os_str());
        let args = paths.arguments(&rt,None).unwrap(); assert!(!args.iter().any(|a|a=="--no-extensions"||a=="--model"||a=="gpt-4o")); assert_eq!(paths.checked_cwd(None).unwrap(),paths.default_cwd);
        assert_eq!(rt.package,rt.root.join("pi/node_modules/@earendil-works/pi-coding-agent"));
    }
    #[test]
    fn given_external_legacy_resource_when_check_cwd_then_reject_without_reading_or_renaming_original() {
        let root = root(); let paths = PiPaths::prepare(&root).unwrap();let foreign = root.join("foreign-workspace");fs::create_dir_all(foreign.join(".pi/commands")).unwrap();let marker=foreign.join(".pi/commands/keep.md");fs::write(&marker,b"foreign marker not to load").unwrap();
        assert_eq!(paths.checked_cwd(Some(&foreign)).unwrap_err().code,"pi_cwd_migration");assert_eq!(fs::read(marker).unwrap(),b"foreign marker not to load");assert!(!foreign.join(".pi/prompts").exists());
        let clean = root.join("selected-clean");fs::create_dir(&clean).unwrap();assert_eq!(paths.checked_cwd(Some(&clean)).unwrap(),fs::canonicalize(clean).unwrap());
        assert_eq!(paths.checked_cwd(Some(&paths.agent)).unwrap_err().code,"pi_cwd_private");
    }
    #[test]
    fn given_foreign_or_traversing_session_when_validating_then_reject_without_opening() {
        let root = root();let paths=PiPaths::prepare(&root).unwrap();let own=paths.sessions.join("native-fixture.jsonl");fs::write(&own,b"synthetic native-format validation happens separately").unwrap();assert_eq!(paths.checked_session(&own).unwrap(),own);
        for invalid in [root.join("foreign.jsonl"),paths.sessions.join("../agent/private.jsonl"),paths.sessions.join("auth.json"),PathBuf::from("relative.jsonl")] {assert!(paths.checked_session(&invalid).is_err());}
    }
}
