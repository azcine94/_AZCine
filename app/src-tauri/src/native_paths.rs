use crate::storage::StorageError;
use std::path::{Path, PathBuf};

#[cfg(windows)]
pub use windows_impl::{choose_folder, open_folder, open_ranking_source, choose_news_pdf,choose_news_markdown,choose_bookkeeping_csv,open_bookkeeping_receipt};

#[cfg(not(windows))]
pub fn choose_bookkeeping_csv(_owner:isize,_name:String)->Result<Option<PathBuf>,StorageError>{Err(StorageError::new("bookkeeping_export_unsupported","记账文件导出目前仅支持 Windows 桌面。"))}
#[cfg(not(windows))]
pub fn open_bookkeeping_receipt(_owner:isize,_path:&Path)->Result<(),StorageError>{Err(StorageError::new("bookkeeping_receipt_unsupported","系统票据打开目前仅支持 Windows 桌面。"))}

#[cfg(not(windows))]
pub fn open_ranking_source(_owner: isize, _board: crate::model_ranking::Board) -> Result<(), StorageError> {
    Err(StorageError::new("ranking_browser_unsupported", "当前平台尚未接入系统浏览器，请手动打开榜单的官方地址。"))
}

#[cfg(not(windows))]
pub fn choose_news_pdf(_owner:isize,_name:String)->Result<Option<PathBuf>,StorageError>{Err(StorageError::new("news_pdf_unsupported","PDF导出目前仅支持Windows桌面。"))}
#[cfg(not(windows))]
pub fn choose_news_markdown(_owner:isize,_name:String)->Result<Option<PathBuf>,StorageError>{Err(StorageError::new("news_export_unsupported","Markdown导出目前仅支持Windows桌面。"))}

#[cfg(not(windows))]
pub fn choose_folder(_owner: isize) -> Result<Option<PathBuf>, StorageError> {
    Err(StorageError::new(
        "native_paths_unsupported",
        "当前平台尚未实现系统目录选择，数据目录未更改。",
    ))
}

#[cfg(not(windows))]
pub fn open_folder(_owner: isize, _path: &Path) -> Result<(), StorageError> {
    Err(StorageError::new(
        "native_paths_unsupported",
        "当前平台尚未实现系统目录打开，数据目录未更改。",
    ))
}

#[cfg(windows)]
mod windows_impl {
    use super::{Path, PathBuf, StorageError};
    use std::ffi::{OsString, c_void};
    use std::fs;
    use std::io::ErrorKind;
    use std::marker::PhantomData;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Component, Prefix};
    use std::rc::Rc;
    use std::thread;
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::{
        FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_PICKFOLDERS, FileOpenDialog,
        IFileOpenDialog, SIGDN_FILESYSPATH, ShellExecuteW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HRESULT, PCWSTR, PWSTR, w};

    /// Runs a native folder picker without selecting or saving a storage root.
    ///
    /// Call from the parent's spawn_blocking task, not the Tauri UI thread:
    /// this function joins its own dedicated STA thread.
    ///
    /// `owner` is the main window's HWND converted to isize; zero means no
    /// owner. The caller must keep a nonzero owner valid until this returns.
    /// Native cancellation returns Ok(None), not an error or a saved result.
    pub fn choose_folder(owner: isize) -> Result<Option<PathBuf>, StorageError> {
        run_in_sta("azcine-folder-picker", move || choose_folder_sta(owner))
    }
    pub fn choose_bookkeeping_csv(owner:isize,name:String)->Result<Option<PathBuf>,StorageError>{run_in_sta("azcine-expenses-save",move||{
        use windows::Win32::UI::Shell::{IFileSaveDialog,FileSaveDialog,FOS_OVERWRITEPROMPT};
        let dialog:IFileSaveDialog=unsafe{CoCreateInstance(&FileSaveDialog,None,CLSCTX_INPROC_SERVER)}.map_err(|e|native_error("无法创建记账保存窗口",e.code()))?;
        let name:Vec<u16>=name.encode_utf16().chain(Some(0)).collect();
        (||->windows::core::Result<()>{unsafe{dialog.SetTitle(w!("导出记账明细（请选择新文件名）"))?;dialog.SetDefaultExtension(w!("csv"))?;dialog.SetFileName(PCWSTR(name.as_ptr()))?;let options=dialog.GetOptions()?;dialog.SetOptions(options|FOS_FORCEFILESYSTEM|FOS_NOCHANGEDIR|FOS_OVERWRITEPROMPT)}})().map_err(|e:windows::core::Error|native_error("无法设置记账保存选项",e.code()))?;
        match unsafe{dialog.Show(owner_hwnd(owner))}{Ok(())=>{},Err(e)if e.code()==HRESULT::from_win32(ERROR_CANCELLED.0)=>return Ok(None),Err(e)=>return Err(native_error("无法显示记账保存窗口",e.code()))}
        let item=unsafe{dialog.GetResult()}.map_err(|e|native_error("无法取得导出路径",e.code()))?;
        let display=TaskMemString(unsafe{item.GetDisplayName(SIGDN_FILESYSPATH)}.map_err(|e|native_error("无法取得导出路径",e.code()))?);
        if display.0.is_null(){return Err(StorageError::new("bookkeeping_export_path","系统没有返回导出路径。"));}
        let path=PathBuf::from(OsString::from_wide(unsafe{display.0.as_wide()}));
        if !path.is_absolute()||path.extension().is_none_or(|e|!e.eq_ignore_ascii_case("csv")){return Err(StorageError::new("bookkeeping_export_path","请选择绝对路径的 .csv 文件。"));}
        Ok(Some(path))
    })}
    // Only called with a verified, app-owned PNG/JPEG/WebP/PDF receipt path from Rust.
    pub fn open_bookkeeping_receipt(owner:isize,path:&Path)->Result<(),StorageError>{
        let path=path.to_path_buf();run_in_sta("azcine-receipt-open",move||{
            let encoded:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
            let result=unsafe{ShellExecuteW(owner_hwnd(owner),w!("open"),PCWSTR(encoded.as_ptr()),PCWSTR::null(),PCWSTR::null(),SW_SHOWNORMAL)};
            if result.0 as isize>32{Ok(())}else{Err(StorageError::new("bookkeeping_receipt_open","Windows 未能打开票据，请检查是否有对应的图片或 PDF 查看程序。"))}
        })
    }
    pub fn choose_news_pdf(owner:isize,name:String)->Result<Option<PathBuf>,StorageError>{run_in_sta("azcine-news-save",move||{
        use windows::Win32::UI::Shell::{IFileSaveDialog,FileSaveDialog,FOS_OVERWRITEPROMPT};
        let dialog:IFileSaveDialog=unsafe{CoCreateInstance(&FileSaveDialog,None,CLSCTX_INPROC_SERVER)}.map_err(|e|native_error("无法创建PDF保存窗口",e.code()))?;
        let name:Vec<u16>=name.encode_utf16().chain(Some(0)).collect();
        (||->windows::core::Result<()>{unsafe{dialog.SetTitle(w!("导出完整资讯日报 PDF（请选择新文件名）"))?;dialog.SetDefaultExtension(w!("pdf"))?;dialog.SetFileName(PCWSTR(name.as_ptr()))?;let options=dialog.GetOptions()?;dialog.SetOptions(options|FOS_FORCEFILESYSTEM|FOS_NOCHANGEDIR|FOS_OVERWRITEPROMPT)}})().map_err(|e:windows::core::Error|native_error("无法设置PDF保存选项",e.code()))?;
        match unsafe{dialog.Show(owner_hwnd(owner))}{Ok(())=>{},Err(e)if e.code()==HRESULT::from_win32(ERROR_CANCELLED.0)=>return Ok(None),Err(e)=>return Err(native_error("无法显示PDF保存窗口",e.code()))}
        let item=unsafe{dialog.GetResult()}.map_err(|e|native_error("无法取得PDF路径",e.code()))?;let display=TaskMemString(unsafe{item.GetDisplayName(SIGDN_FILESYSPATH)}.map_err(|e|native_error("无法取得PDF路径",e.code()))?);
        if display.0.is_null(){return Err(StorageError::new("news_pdf_path","系统没有返回PDF路径。"));}
        let path=PathBuf::from(OsString::from_wide(unsafe{display.0.as_wide()}));if !path.is_absolute()||path.extension().is_none_or(|e|!e.eq_ignore_ascii_case("pdf")){return Err(StorageError::new("news_pdf_path","请选择绝对路径的.pdf文件。"));}Ok(Some(path))
    })}
    pub fn choose_news_markdown(owner:isize,name:String)->Result<Option<PathBuf>,StorageError>{run_in_sta("azcine-news-markdown-save",move||{
        use windows::Win32::UI::Shell::{IFileSaveDialog,FileSaveDialog,FOS_OVERWRITEPROMPT};
        let dialog:IFileSaveDialog=unsafe{CoCreateInstance(&FileSaveDialog,None,CLSCTX_INPROC_SERVER)}.map_err(|e|native_error("无法创建Markdown保存窗口",e.code()))?;
        let name:Vec<u16>=name.encode_utf16().chain(Some(0)).collect();
        (||->windows::core::Result<()>{unsafe{dialog.SetTitle(w!("导出资讯 Markdown（请选择新文件名）"))?;dialog.SetDefaultExtension(w!("md"))?;dialog.SetFileName(PCWSTR(name.as_ptr()))?;let options=dialog.GetOptions()?;dialog.SetOptions(options|FOS_FORCEFILESYSTEM|FOS_NOCHANGEDIR|FOS_OVERWRITEPROMPT)}})().map_err(|e:windows::core::Error|native_error("无法设置保存选项",e.code()))?;
        match unsafe{dialog.Show(owner_hwnd(owner))}{Ok(())=>{},Err(e)if e.code()==HRESULT::from_win32(ERROR_CANCELLED.0)=>return Ok(None),Err(e)=>return Err(native_error("无法显示保存窗口",e.code()))}
        let item=unsafe{dialog.GetResult()}.map_err(|e|native_error("无法取得文件路径",e.code()))?;let display=TaskMemString(unsafe{item.GetDisplayName(SIGDN_FILESYSPATH)}.map_err(|e|native_error("无法取得文件路径",e.code()))?);
        if display.0.is_null(){return Err(StorageError::new("news_export_path","系统没有返回导出路径。"));}
        let path=PathBuf::from(OsString::from_wide(unsafe{display.0.as_wide()}));if !path.is_absolute()||path.extension().is_none_or(|e|!e.eq_ignore_ascii_case("md")){return Err(StorageError::new("news_export_path","请选择绝对路径的.md文件。"));}Ok(Some(path))
    })}

    /// Asks Windows to open the current stored data root.
    ///
    /// The caller MUST obtain `path` from Manager::store()?.root, not from
    /// frontend arguments. This helper cannot independently prove root
    /// ownership because it intentionally does not receive the Manager.
    ///
    /// Call from spawn_blocking. Ok(()) means ShellExecuteW accepted the
    /// request; it is not proof that an Explorer window has finished opening.
    pub fn open_folder(owner: isize, path: &Path) -> Result<(), StorageError> {
        let path = path.to_path_buf();
        run_in_sta("azcine-open-folder", move || open_folder_sta(owner, &path))
    }

    // Board selects one of two fixed HTTPS pages. No frontend URL, command-line
    // arguments, shell command, process-name lookup or browser credential access.
    pub fn open_ranking_source(owner: isize, board: crate::model_ranking::Board) -> Result<(), StorageError> {
        run_in_sta("azcine-open-ranking", move || {
            let address: Vec<u16> = board.source_url().encode_utf16().chain(std::iter::once(0)).collect();
            let result = unsafe {
                ShellExecuteW(owner_hwnd(owner), w!("open"), PCWSTR(address.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
            };
            let status = result.0 as isize;
            if status > 32 { Ok(()) } else {
                Err(StorageError::new("ranking_browser_failed", &format!("Windows 未能打开官方榜单（返回 {status}），请重试或手动打开官方地址。")))
            }
        })
    }

    fn run_in_sta<T, F>(name: &'static str, task: F) -> Result<T, StorageError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, StorageError> + Send + 'static,
    {
        let worker = thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || {
                // Never initialize COM on Tauri's UI thread or on a reused
                // spawn_blocking thread whose apartment mode is unknown.
                let _apartment = StaApartment::initialize()?;
                // All COM interfaces and task-allocated strings are local to
                // task(), and are dropped before _apartment is uninitialized.
                task()
            })
            .map_err(|_| {
                StorageError::new(
                    "native_worker_start_failed",
                    "无法启动系统目录操作线程，请重试。",
                )
            })?;

        worker.join().map_err(|_| {
            StorageError::new(
                "native_worker_failed",
                "系统目录操作异常中止，未报告成功，请重试。",
            )
        })?
    }

    struct StaApartment {
        // Prevent accidental transfer of the apartment guard to another thread.
        _thread_bound: PhantomData<Rc<()>>,
    }

    impl StaApartment {
        fn initialize() -> Result<Self, StorageError> {
            let result = unsafe {
                CoInitializeEx(
                    None,
                    COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE,
                )
            };

            if result.is_err() {
                // Failed initialization, including RPC_E_CHANGED_MODE, must
                // not be paired with CoUninitialize.
                return Err(native_error(
                    "无法初始化 Windows 目录操作",
                    result,
                ));
            }

            // Both S_OK and S_FALSE require one matching CoUninitialize.
            Ok(Self {
                _thread_bound: PhantomData,
            })
        }
    }

    impl Drop for StaApartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }

    /// Owns a string allocated by IShellItem::GetDisplayName.
    struct TaskMemString(PWSTR);

    impl Drop for TaskMemString {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CoTaskMemFree(Some(self.0.as_ptr() as *const c_void));
                }
            }
        }
    }

    fn owner_hwnd(owner: isize) -> Option<HWND> {
        if owner == 0 {
            None
        } else {
            // Reconstruct only on the STA thread. No HWND or COM interface is
            // transported across threads, and no unsafe Send impl is needed.
            Some(HWND(owner as *mut c_void))
        }
    }

    fn native_error(message: &str, result: HRESULT) -> StorageError {
        StorageError::new(
            "native_paths_failed",
            &format!("{message}（HRESULT 0x{:08X}）。", result.0 as u32),
        )
    }

    fn choose_folder_sta(owner: isize) -> Result<Option<PathBuf>, StorageError> {
        let dialog: IFileOpenDialog =
            unsafe { CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER) }
                .map_err(|error| native_error("无法创建目录选择窗口", error.code()))?;

        let options = unsafe { dialog.GetOptions() }
            .map_err(|error| native_error("无法读取目录选择选项", error.code()))?;

        unsafe {
            dialog.SetOptions(
                options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR,
            )
        }
        .map_err(|error| native_error("无法设置目录选择方式", error.code()))?;

        unsafe { dialog.SetTitle(w!("选择 AZCine 数据目录")) }
            .map_err(|error| native_error("无法设置目录选择窗口标题", error.code()))?;

        match unsafe { dialog.Show(owner_hwnd(owner)) } {
            Ok(()) => {}
            Err(error) if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) => {
                return Ok(None);
            }
            Err(error) => {
                return Err(native_error("无法显示目录选择窗口", error.code()));
            }
        }

        let item = unsafe { dialog.GetResult() }
            .map_err(|error| native_error("无法取得所选目录", error.code()))?;

        let display_name = TaskMemString(
            unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
                .map_err(|error| native_error("无法取得所选目录路径", error.code()))?,
        );

        if display_name.0.is_null() {
            return Err(StorageError::new(
                "invalid_path",
                "系统未返回有效的文件夹路径，数据目录未更改。",
            ));
        }

        // Copy the UTF-16 path losslessly before freeing the COM allocation.
        // Do not use to_string_lossy: Windows paths can contain lone surrogates.
        let path = PathBuf::from(OsString::from_wide(unsafe {
            display_name.0.as_wide()
        }));

        if !path.is_absolute() {
            return Err(StorageError::new(
                "invalid_path",
                "系统未返回有效的绝对目录路径，数据目录未更改。",
            ));
        }

        Ok(Some(path))
    }

    fn open_folder_sta(owner: isize, path: &Path) -> Result<(), StorageError> {
        let file = folder_path_for_shell(path)?;

        // Fixed verb, an existing absolute directory, no command-line
        // parameters, and no executable lookup through PATH.
        let result = unsafe {
            ShellExecuteW(
                owner_hwnd(owner),
                w!("open"),
                PCWSTR(file.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };

        // ShellExecuteW returns a compatibility value, not an owned process
        // handle. Do not CloseHandle/FreeLibrary it or substitute GetLastError.
        let status = result.0 as isize;
        if status > 32 {
            Ok(())
        } else {
            Err(StorageError::new(
                "folder_open_failed",
                &format!(
                    "Windows 未能打开当前数据目录（ShellExecuteW 返回 {status}）。"
                ),
            ))
        }
    }

    fn folder_path_for_shell(path: &Path) -> Result<Vec<u16>, StorageError> {
        if !path.is_absolute() || path.as_os_str().encode_wide().any(|unit| unit == 0) {
            return Err(StorageError::new(
                "invalid_path",
                "当前数据目录路径无效，未执行打开操作。",
            ));
        }

        // Read-only checks: never create a replacement for a missing root.
        let canonical = fs::canonicalize(path).map_err(root_read_error)?;
        if !fs::metadata(&canonical).map_err(root_read_error)?.is_dir() {
            return Err(StorageError::new(
                "invalid_path",
                "当前数据目录位置不是文件夹，未执行打开操作。",
            ));
        }

        // Store::open uses std::fs::canonicalize, which normally returns a
        // verbatim Windows path. The shell does not consistently accept that
        // spelling. Convert drive and UNC paths only; reject device namespaces.
        let wide: Vec<u16> = canonical.as_os_str().encode_wide().collect();
        let mut shell_wide = match canonical.components().next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::VerbatimDisk(_) => wide[4..].to_vec(),
                Prefix::VerbatimUNC(_, _) => {
                    let mut value = vec![b'\\' as u16, b'\\' as u16];
                    value.extend_from_slice(&wide[8..]);
                    value
                }
                Prefix::Disk(_) | Prefix::UNC(_, _) => wide,
                _ => return Err(unsupported_shell_path()),
            },
            _ => return Err(unsupported_shell_path()),
        };

        // Removing a verbatim prefix must not make Win32 trim a literal
        // trailing dot/space and open a different directory.
        if shell_wide
            .split(|unit| *unit == b'\\' as u16 || *unit == b'/' as u16)
            .any(|part| matches!(part.last().copied(), Some(0x20 | 0x2e)))
        {
            return Err(unsupported_shell_path());
        }

        // Require the shell spelling to resolve back to the same canonical
        // directory. Do not silently normalize to another location.
        let shell_path = PathBuf::from(OsString::from_wide(&shell_wide));
        let round_trip =
            fs::canonicalize(&shell_path).map_err(|_| unsupported_shell_path())?;
        if round_trip != canonical {
            return Err(unsupported_shell_path());
        }

        shell_wide.push(0);
        Ok(shell_wide)
    }

    fn root_read_error(error: std::io::Error) -> StorageError {
        match error.kind() {
            ErrorKind::NotFound => StorageError::new(
                "root_missing",
                "当前数据目录不存在或尚未挂载，未创建替代目录。",
            ),
            ErrorKind::PermissionDenied => StorageError::new(
                "storage_io",
                "无法读取当前数据目录，请检查目录权限。",
            ),
            _ => StorageError::new(
                "storage_io",
                "无法读取当前数据目录，请检查路径、权限与磁盘状态。",
            ),
        }
    }

    fn unsupported_shell_path() -> StorageError {
        StorageError::new(
            "folder_path_unsupported",
            "当前路径无法按原样交给 Windows 资源管理器打开，数据目录未更改。",
        )
    }
}
