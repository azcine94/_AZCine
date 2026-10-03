//! 本应用自有的 Windows 进程树。
//!
//! 创建时通过 PROC_THREAD_ATTRIBUTE_JOB_LIST 纳入 Job，
//! 不存在 CreateProcess 成功后再 AssignProcessToJobObject 的窗口。
//!
//! 不读取宿主环境，不记录路径、参数或环境内容。
//! 正常 EOF、RPC、输出读取和业务等待期限均由上层负责。
//! Drop 是强制清理，不是正常退出协议。

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessError {
    pub code: &'static str,
    pub message: &'static str,
}

impl std::fmt::Display for ProcessError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for ProcessError {}

#[cfg(windows)]
mod platform {
    use super::ProcessError;

    use std::cmp::Ordering;
    use std::ffi::{OsStr, OsString};
    use std::marker::PhantomData;
    use std::mem::{size_of, size_of_val};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::os::windows::process::ExitStatusExt;
    use std::path::Path;
    use std::process::{ChildStderr, ChildStdin, ChildStdout, ExitStatus};
    use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

    use windows::core::{HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        ERROR_INSUFFICIENT_BUFFER, ERROR_IO_PENDING, ERROR_PIPE_CONNECTED,
        GENERIC_READ, GENERIC_WRITE, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows::Win32::Globalization::{
        CompareStringOrdinal, CSTR_EQUAL, CSTR_GREATER_THAN, CSTR_LESS_THAN,
    };
    use windows::Win32::Security::SECURITY_ATTRIBUTES;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_FLAG_FIRST_PIPE_INSTANCE,
        FILE_FLAG_OVERLAPPED, FILE_SHARE_MODE, OPEN_EXISTING,
        PIPE_ACCESS_INBOUND, PIPE_ACCESS_OUTBOUND,
    };
    use windows::Win32::System::IO::{
        CancelIoEx, GetOverlappedResult, OVERLAPPED,
    };
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectBasicAccountingInformation,
        JobObjectExtendedLimitInformation, QueryInformationJobObject,
        SetInformationJobObject, TerminateJobObject,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE,
        PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_WAIT,
    };
    use windows::Win32::System::Threading::{
        CreateEventW, CreateProcessW, DeleteProcThreadAttributeList,
        GetExitCodeProcess, InitializeProcThreadAttributeList,
        ResumeThread, UpdateProcThreadAttribute, WaitForSingleObject,
        CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
        EXTENDED_STARTUPINFO_PRESENT, INFINITE,
        LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST,
        STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    const FORCED_EXIT_CODE: u32 = 1;
    const PIPE_BUFFER_SIZE: u32 = 64 * 1024;

    // CreateProcessW 的限制包含结尾 NUL。
    const MAX_COMMAND_LINE_UNITS: usize = 32_767;
    const MAX_COMMAND_CONTENT_UNITS: usize = MAX_COMMAND_LINE_UNITS - 1;

    const QUOTE: u16 = b'"' as u16;
    const BACKSLASH: u16 = b'\\' as u16;
    const SPACE: u16 = b' ' as u16;
    const EQUALS: u16 = b'=' as u16;

    // 当前 PID + 不回绕的计数器。FIRST_PIPE_INSTANCE 防止已有同名对象
    // 被复用；发生冲突即失败，不连接到其他实例。
    static NEXT_PIPE_ID: AtomicU64 = AtomicU64::new(1);

    fn error(code: &'static str, message: &'static str) -> ProcessError {
        ProcessError { code, message }
    }

    fn raw_handle(handle: &OwnedHandle) -> HANDLE {
        HANDLE(handle.as_raw_handle())
    }

    fn wide_without_nul(value: &OsStr) -> Result<Vec<u16>, ProcessError> {
        let result: Vec<u16> = value.encode_wide().collect();
        if result.contains(&0) {
            return Err(error(
                "input_contains_nul",
                "启动输入不能包含空字符。",
            ));
        }
        Ok(result)
    }

    fn command_too_long() -> ProcessError {
        error("command_line_too_long", "启动参数超过系统长度限制。")
    }

    fn append_units(
        destination: &mut Vec<u16>,
        unit: u16,
        count: usize,
    ) -> Result<(), ProcessError> {
        if count > MAX_COMMAND_CONTENT_UNITS.saturating_sub(destination.len()) {
            return Err(command_too_long());
        }
        destination.extend(std::iter::repeat(unit).take(count));
        Ok(())
    }

    fn append_slice(
        destination: &mut Vec<u16>,
        units: &[u16],
    ) -> Result<(), ProcessError> {
        if units.len()
            > MAX_COMMAND_CONTENT_UNITS.saturating_sub(destination.len())
        {
            return Err(command_too_long());
        }
        destination.extend_from_slice(units);
        Ok(())
    }

    fn append_quoted_argument(
        destination: &mut Vec<u16>,
        argument: &OsStr,
    ) -> Result<(), ProcessError> {
        let argument = wide_without_nul(argument)?;
        if argument.len() > MAX_COMMAND_CONTENT_UNITS {
            return Err(command_too_long());
        }

        // 使用 Windows CRT 参数规则，所有参数都显式加引号：
        // - 空参数保留为 ""；
        // - 引号前的 n 个反斜线编码为 2n+1 个；
        // - 结束引号前的 n 个反斜线编码为 2n 个。
        append_units(destination, QUOTE, 1)?;
        let mut backslashes = 0usize;

        for unit in argument {
            if unit == BACKSLASH {
                backslashes += 1;
                continue;
            }

            if unit == QUOTE {
                append_units(destination, BACKSLASH, backslashes * 2 + 1)?;
            } else {
                append_units(destination, BACKSLASH, backslashes)?;
            }
            backslashes = 0;
            append_units(destination, unit, 1)?;
        }

        append_units(destination, BACKSLASH, backslashes * 2)?;
        append_units(destination, QUOTE, 1)?;
        Ok(())
    }

    fn build_command_line(
        program: &[u16],
        args: &[OsString],
    ) -> Result<Vec<u16>, ProcessError> {
        // argv[0] 使用单独的程序名规则，不套用普通参数的反斜线转义。
        // Windows 文件名不能包含双引号；明确拒绝，避免构造歧义。
        if program.contains(&QUOTE) {
            return Err(error(
                "invalid_program_path",
                "程序路径包含无效字符。",
            ));
        }

        let mut command = Vec::new();
        append_units(&mut command, QUOTE, 1)?;
        append_slice(&mut command, program)?;
        append_units(&mut command, QUOTE, 1)?;

        for argument in args {
            append_units(&mut command, SPACE, 1)?;
            append_quoted_argument(&mut command, argument.as_os_str())?;
        }

        command.push(0);
        Ok(command)
    }

    fn compare_environment_keys(
        left: &[u16],
        right: &[u16],
    ) -> Result<Ordering, ProcessError> {
        // 调用者保证键非空且长度可表示为 i32。
        // 使用 Windows 不区分大小写的序数比较，而不是当前区域设置。
        let result = unsafe { CompareStringOrdinal(left, right, true) };

        if result == CSTR_LESS_THAN {
            Ok(Ordering::Less)
        } else if result == CSTR_EQUAL {
            Ok(Ordering::Equal)
        } else if result == CSTR_GREATER_THAN {
            Ok(Ordering::Greater)
        } else {
            Err(error(
                "environment_compare_failed",
                "无法整理独立环境变量。",
            ))
        }
    }

    fn build_environment(
        env: &[(OsString, OsString)],
    ) -> Result<Vec<u16>, ProcessError> {
        let mut entries: Vec<(Vec<u16>, Vec<u16>)> = Vec::new();

        for (key, value) in env {
            let key = wide_without_nul(key.as_os_str())?;
            let value = wide_without_nul(value.as_os_str())?;

            if key.is_empty()
                || key.contains(&EQUALS)
                || key.len() > i32::MAX as usize
            {
                return Err(error(
                    "invalid_environment_name",
                    "环境变量名称无效。",
                ));
            }

            // 有序插入，同时处理 Windows 大小写不敏感的重复键。
            // 与逐次设置环境变量一致：调用方最后提供的值生效。
            let mut index = 0;
            let mut replace = false;

            while index < entries.len() {
                match compare_environment_keys(&entries[index].0, &key)? {
                    Ordering::Less => index += 1,
                    Ordering::Equal => {
                        replace = true;
                        break;
                    }
                    Ordering::Greater => break,
                }
            }

            if replace {
                entries[index] = (key, value);
            } else {
                entries.insert(index, (key, value));
            }
        }

        if entries.is_empty() {
            // 必须是显式双 NUL 块；传 NULL 会继承父进程环境。
            return Ok(vec![0, 0]);
        }

        let mut block = Vec::new();
        for (key, value) in entries {
            block.extend_from_slice(&key);
            block.push(EQUALS);
            block.extend_from_slice(&value);
            block.push(0);
        }
        block.push(0);
        Ok(block)
    }

    fn create_job() -> Result<OwnedHandle, ProcessError> {
        // 匿名、不可继承的 Job。
        let raw = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
            .map_err(|_| {
                error("job_create_failed", "无法创建进程作业对象。")
            })?;

        // SAFETY: API 成功返回的新句柄在此唯一转交。
        let job = unsafe { OwnedHandle::from_raw_handle(raw.0) };

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        // 不设置任何 BREAKAWAY 标志。
        unsafe {
            SetInformationJobObject(
                raw_handle(&job),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|_| {
            error("job_configure_failed", "无法配置进程树退出清理。")
        })?;

        Ok(job)
    }

    struct PipePair {
        parent: OwnedHandle,
        child: OwnedHandle,
    }

    // 防止异常的 pending ConnectNamedPipe 请求引用已经释放的 OVERLAPPED。
    // Box 保持地址稳定；Drop 先取消并等待 I/O 收口，再释放事件与内存。
    struct ConnectGuard<'a> {
        pipe: &'a OwnedHandle,
        overlapped: Box<OVERLAPPED>,
        _event: OwnedHandle,
        pending: bool,
    }

    impl Drop for ConnectGuard<'_> {
        fn drop(&mut self) {
            if self.pending {
                let mut transferred = 0;
                unsafe {
                    let _ = CancelIoEx(
                        raw_handle(self.pipe),
                        Some(self.overlapped.as_ref() as *const OVERLAPPED),
                    );
                    // 取消是异步的，必须等待结束后才能释放 OVERLAPPED。
                    let _ = GetOverlappedResult(
                        raw_handle(self.pipe),
                        self.overlapped.as_ref() as *const OVERLAPPED,
                        &mut transferred,
                        true,
                    );
                }
            }
        }
    }

    fn confirm_pipe_connection(parent: &OwnedHandle) -> Result<(), ProcessError> {
        let event_raw = unsafe {
            CreateEventW(None, true, false, PCWSTR::null())
        }
        .map_err(|_| {
            error("pipe_event_failed", "无法创建管道连接事件。")
        })?;

        let event = unsafe { OwnedHandle::from_raw_handle(event_raw.0) };
        let overlapped = Box::new(OVERLAPPED {
            hEvent: raw_handle(&event),
            ..Default::default()
        });

        let mut guard = ConnectGuard {
            pipe: parent,
            overlapped,
            _event: event,
            pending: false,
        };

        // 调用前已经成功打开并持有本实例的 client 端。
        // 文档明确：client 在 ConnectNamedPipe 前连接时，
        // ERROR_PIPE_CONNECTED 表示有效连接，不是失败。
        let result = unsafe {
            ConnectNamedPipe(
                raw_handle(parent),
                Some(guard.overlapped.as_mut() as *mut OVERLAPPED),
            )
        };

        match result {
            Ok(()) => Ok(()),
            Err(failure)
                if failure.code()
                    == HRESULT::from_win32(ERROR_PIPE_CONNECTED.0) =>
            {
                Ok(())
            }
            Err(failure)
                if failure.code() == HRESULT::from_win32(ERROR_IO_PENDING.0) =>
            {
                // 自有 client 已成功打开，这里不应该仍等待其他连接。
                // 不增加延时或外部等待；取消、收口并拒绝此次创建。
                guard.pending = true;
                Err(error(
                    "pipe_connection_pending",
                    "管道连接状态异常，已取消本次启动。",
                ))
            }
            Err(_) => Err(error(
                "pipe_connect_failed",
                "无法确认子进程管道连接。",
            )),
        }
    }

    fn create_pipe_pair(parent_writes: bool) -> Result<PipePair, ProcessError> {
        let sequence = NEXT_PIPE_ID
            .try_update(
                AtomicOrdering::Relaxed,
                AtomicOrdering::Relaxed,
                |current| current.checked_add(1),
            )
            .map_err(|_| {
                error("pipe_id_exhausted", "管道标识已经耗尽。")
            })?;

        // 此名称只用于本机内核管道对象，不产生磁盘文件、不写入日志。
        let name = format!(
            r"\\.\pipe\azcine-owned-{}-{}",
            std::process::id(),
            sequence,
        );
        let mut name_wide: Vec<u16> = name.encode_utf16().collect();
        name_wide.push(0);

        let direction = if parent_writes {
            PIPE_ACCESS_OUTBOUND
        } else {
            PIPE_ACCESS_INBOUND
        };

        // 父端：不可继承、overlapped、单实例、只允许本机连接。
        // 注意 windows 0.62.2 的 CreateNamedPipeW 返回 HANDLE，
        // 不是 Result，必须显式检查 INVALID_HANDLE_VALUE。
        let parent_raw = unsafe {
            CreateNamedPipeW(
                PCWSTR(name_wide.as_ptr()),
                direction | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT
                    | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                PIPE_BUFFER_SIZE,
                PIPE_BUFFER_SIZE,
                0,
                None,
            )
        };

        if parent_raw.is_invalid() {
            return Err(error(
                "pipe_create_failed",
                "无法创建独立进程管道。",
            ));
        }

        let parent = unsafe { OwnedHandle::from_raw_handle(parent_raw.0) };

        let security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: true.into(),
        };

        let child_access = if parent_writes {
            GENERIC_READ.0
        } else {
            GENERIC_WRITE.0
        };

        // 子端：同步、可继承。只在 HANDLE_LIST 中传递这三个子端。
        // client 可以在 ConnectNamedPipe 之前连接到已创建的 server。
        let child_raw = unsafe {
            CreateFileW(
                PCWSTR(name_wide.as_ptr()),
                child_access,
                FILE_SHARE_MODE(0),
                Some(&security as *const SECURITY_ATTRIBUTES),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            )
        }
        .map_err(|_| {
            error("pipe_client_failed", "无法打开子进程管道端点。")
        })?;

        let child = unsafe { OwnedHandle::from_raw_handle(child_raw.0) };
        confirm_pipe_connection(&parent)?;

        Ok(PipePair { parent, child })
    }

    // 属性列表的存储不移动，且按 u128 对齐，满足本项目 Windows
    // 原生属性结构的指针对齐。列表先销毁，随后 Box 才释放。
    //
    // 生命周期确保 JOB_LIST / HANDLE_LIST 的数组在 Delete 前仍存在。
    // 对应 OwnedHandle 也由 spawn 的局部变量或 OwnedProcess 持有。
    struct AttributeList<'a> {
        storage: Box<[u128]>,
        initialized: bool,
        _values: PhantomData<&'a [HANDLE]>,
    }

    impl<'a> AttributeList<'a> {
        fn raw(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
            LPPROC_THREAD_ATTRIBUTE_LIST(self.storage.as_mut_ptr().cast())
        }

        fn new(
            jobs: &'a [HANDLE; 1],
            inherited: &'a [HANDLE; 3],
        ) -> Result<Self, ProcessError> {
            let mut required = 0usize;

            // 第一次调用应以 INSUFFICIENT_BUFFER 返回所需字节数。
            let probe = unsafe {
                InitializeProcThreadAttributeList(None, 2, None, &mut required)
            };

            match probe {
                Err(failure)
                    if failure.code()
                        == HRESULT::from_win32(ERROR_INSUFFICIENT_BUFFER.0) => {}
                _ => {
                    return Err(error(
                        "attribute_size_failed",
                        "无法确定进程启动属性大小。",
                    ));
                }
            }

            if required == 0
                || required > (isize::MAX as usize).saturating_sub(15)
            {
                return Err(error(
                    "attribute_size_invalid",
                    "进程启动属性大小无效。",
                ));
            }

            let words = required.div_ceil(size_of::<u128>());
            let mut attributes = Self {
                storage: vec![0u128; words].into_boxed_slice(),
                initialized: false,
                _values: PhantomData,
            };

            unsafe {
                InitializeProcThreadAttributeList(
                    Some(attributes.raw()),
                    2,
                    None,
                    &mut required,
                )
            }
            .map_err(|_| {
                error("attribute_init_failed", "无法初始化进程启动属性。")
            })?;

            attributes.initialized = true;
            attributes.set_handles(PROC_THREAD_ATTRIBUTE_JOB_LIST, jobs)?;
            attributes.set_handles(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited)?;
            Ok(attributes)
        }

        fn set_handles(
            &mut self,
            attribute: u32,
            handles: &'a [HANDLE],
        ) -> Result<(), ProcessError> {
            unsafe {
                UpdateProcThreadAttribute(
                    self.raw(),
                    0,
                    attribute as usize,
                    Some(handles.as_ptr().cast()),
                    size_of_val(handles),
                    None,
                    None,
                )
            }
            .map_err(|_| {
                error(
                    "attribute_update_failed",
                    "无法配置创建时进程归属或管道继承。",
                )
            })
        }
    }

    impl Drop for AttributeList<'_> {
        fn drop(&mut self) {
            if self.initialized {
                unsafe { DeleteProcThreadAttributeList(self.raw()) };
            }
        }
    }

    pub struct OwnedProcess {
        process: OwnedHandle,
        job: Option<OwnedHandle>,
        process_id: u32,
        exit_status: Option<ExitStatus>,
        stdin: Option<ChildStdin>,
        stdout: Option<ChildStdout>,
        stderr: Option<ChildStderr>,
    }

    impl OwnedProcess {
        pub fn spawn(
            program: &Path,
            args: &[OsString],
            cwd: &Path,
            env: &[(OsString, OsString)],
        ) -> Result<Self, ProcessError> {
            if !program.is_absolute() {
                return Err(error(
                    "program_not_absolute",
                    "程序路径必须是绝对路径。",
                ));
            }

            if !cwd.is_absolute() {
                return Err(error(
                    "cwd_not_absolute",
                    "工作目录必须是绝对路径。",
                ));
            }

            // 所有调用方字符串先验证和编码，再创建内核对象。
            // encode_wide 保留原始 UTF-16，包括非配对代理项，
            // 不通过有损 UTF-8 转换修改调用方输入。
            let mut program_wide = wide_without_nul(program.as_os_str())?;
            let mut cwd_wide = wide_without_nul(cwd.as_os_str())?;
            let mut command_line = build_command_line(&program_wide, args)?;
            let environment = build_environment(env)?;

            program_wide.push(0);
            cwd_wide.push(0);

            let job = create_job()?;

            let PipePair {
                parent: stdin_parent,
                child: stdin_child,
            } = create_pipe_pair(true)?;

            let PipePair {
                parent: stdout_parent,
                child: stdout_child,
            } = create_pipe_pair(false)?;

            let PipePair {
                parent: stderr_parent,
                child: stderr_child,
            } = create_pipe_pair(false)?;

            // From<OwnedHandle> 自 Rust 1.74 稳定；这三个父端均确实
            // 使用 FILE_FLAG_OVERLAPPED 创建，满足标准库转换契约。
            let stdin = ChildStdin::from(stdin_parent);
            let stdout = ChildStdout::from(stdout_parent);
            let stderr = ChildStderr::from(stderr_parent);

            let jobs = [raw_handle(&job)];
            let inherited = [
                raw_handle(&stdin_child),
                raw_handle(&stdout_child),
                raw_handle(&stderr_child),
            ];
            let mut attributes = AttributeList::new(&jobs, &inherited)?;

            let mut startup = STARTUPINFOEXW::default();
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = inherited[0];
            startup.StartupInfo.hStdOutput = inherited[1];
            startup.StartupInfo.hStdError = inherited[2];
            startup.lpAttributeList = attributes.raw();

            let mut information = PROCESS_INFORMATION::default();

            // 一次系统创建操作同时完成：
            // 1. 以绝对路径选择程序；
            // 2. 使用调用方显式提供的环境块；
            // 3. 仅继承三个同步子管道端；
            // 4. 加入已配置 KILL_ON_JOB_CLOSE 的自有 Job；
            // 5. 初始线程保持挂起，等待本模块完成本地所有权交接。
            //
            // Job 句柄不可继承，也不在 HANDLE_LIST 中。
            // 任意属性或创建错误直接失败，绝不回退到创建后 Assign。
            unsafe {
                CreateProcessW(
                    PCWSTR(program_wide.as_ptr()),
                    Some(PWSTR(command_line.as_mut_ptr())),
                    None,
                    None,
                    true,
                    CREATE_SUSPENDED
                        | CREATE_NO_WINDOW
                        | CREATE_UNICODE_ENVIRONMENT
                        | EXTENDED_STARTUPINFO_PRESENT,
                    Some(environment.as_ptr().cast()),
                    PCWSTR(cwd_wide.as_ptr()),
                    &startup.StartupInfo,
                    &mut information,
                )
            }
            .map_err(|_| {
                error(
                    "process_spawn_failed",
                    "无法创建已纳入自有作业的子进程。",
                )
            })?;

            // SAFETY: CreateProcessW 成功时返回两个有效的新句柄。
            // 分别唯一接管；Job 从进程创建时已生效。
            let process = unsafe {
                OwnedHandle::from_raw_handle(information.hProcess.0)
            };
            let thread = unsafe {
                OwnedHandle::from_raw_handle(information.hThread.0)
            };

            let owned = Self {
                process,
                job: Some(job),
                process_id: information.dwProcessId,
                exit_status: None,
                stdin: Some(stdin),
                stdout: Some(stdout),
                stderr: Some(stderr),
            };

            // 删除属性列表时其所引用的两个数组仍在当前栈帧中。
            drop(attributes);

            // 父进程必须关闭自己的子端副本，否则正常 EOF 会被阻断。
            // 子进程已在创建时继承自己的三个句柄。
            drop(stdin_child);
            drop(stdout_child);
            drop(stderr_child);

            // 直接使用 CreateProcessW 返回的主线程句柄，
            // 不枚举线程、不按 PID 重新打开进程。
            let previous_suspend_count = unsafe {
                ResumeThread(raw_handle(&thread))
            };

            if previous_suspend_count == u32::MAX {
                return Err(error(
                    "thread_resume_failed",
                    "无法恢复初始线程，已终止本次启动。",
                ));
            }

            if previous_suspend_count != 1 {
                return Err(error(
                    "thread_suspend_count_unexpected",
                    "初始线程挂起状态异常，已终止本次启动。",
                ));
            }

            // 初始线程句柄不再需要；进程和 Job 继续由 owned 持有。
            drop(thread);
            Ok(owned)
        }

        pub fn id(&self) -> u32 {
            self.process_id
        }

        pub fn take_stdin(&mut self) -> Option<ChildStdin> {
            self.stdin.take()
        }

        pub fn take_stdout(&mut self) -> Option<ChildStdout> {
            self.stdout.take()
        }

        pub fn take_stderr(&mut self) -> Option<ChildStderr> {
            self.stderr.take()
        }

        pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, ProcessError> {
            if let Some(status) = self.exit_status {
                return Ok(Some(status));
            }

            let wait = unsafe {
                WaitForSingleObject(raw_handle(&self.process), 0)
            };

            if wait == WAIT_TIMEOUT {
                return Ok(None);
            }

            if wait != WAIT_OBJECT_0 {
                return Err(error(
                    "process_wait_failed",
                    "无法查询子进程退出状态。",
                ));
            }

            // 先确认进程对象已被置为有信号，再读取退出码。
            // 不能将数值 259 一律当成 STILL_ACTIVE：
            // 已结束进程也可能真实返回 259。
            let mut exit_code = 0u32;
            unsafe {
                GetExitCodeProcess(raw_handle(&self.process), &mut exit_code)
            }
            .map_err(|_| {
                error("process_exit_code_failed", "无法读取子进程退出码。")
            })?;

            let status = ExitStatus::from_raw(exit_code);
            self.exit_status = Some(status);
            Ok(Some(status))
        }

        pub fn terminate_tree(&mut self) -> Result<(), ProcessError> {
            let job = self.job_handle()?;

            // 只操作本实例的 Job。成功表示终止请求成功，
            // 不表示所有子孙的异步退出清理已经结束。
            unsafe { TerminateJobObject(job, FORCED_EXIT_CODE) }
                .map_err(|_| {
                    error("tree_terminate_failed", "无法终止自有进程树。")
                })
        }

        pub fn active_processes(&self) -> Result<u32, ProcessError> {
            let job = self.job_handle()?;
            let mut accounting =
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();

            unsafe {
                QueryInformationJobObject(
                    Some(job),
                    JobObjectBasicAccountingInformation,
                    (&mut accounting
                        as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)
                        .cast(),
                    size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    None,
                )
            }
            .map_err(|_| {
                error(
                    "job_query_failed",
                    "无法查询自有进程树的存活数量。",
                )
            })?;

            Ok(accounting.ActiveProcesses)
        }

        fn job_handle(&self) -> Result<HANDLE, ProcessError> {
            self.job
                .as_ref()
                .map(raw_handle)
                .ok_or_else(|| {
                    error("job_unavailable", "进程作业对象已经关闭。")
                })
        }
    }

    impl Drop for OwnedProcess {
        fn drop(&mut self) {
            // 已交给调用方的 stdin 不在这里；调用方负责正常 EOF。
            drop(self.stdin.take());

            if let Some(job) = self.job.take() {
                // 显式终止失败时，关闭最后一个不可继承的 Job 句柄
                // 仍由 KILL_ON_JOB_CLOSE 执行自有树清理。
                unsafe {
                    let _ = TerminateJobObject(
                        raw_handle(&job),
                        FORCED_EXIT_CODE,
                    );
                }
                drop(job);
            }

            // 这里等待的是已强制清理的直接进程，不是协议级正常 EOF。
            // Windows Job 负责其余子孙；不按名字或 PID 另行杀进程。
            unsafe {
                let _ = WaitForSingleObject(
                    raw_handle(&self.process),
                    INFINITE,
                );
            }

            // 其余仍在 self 中的管道及进程句柄随后自动关闭。
            // 被 take 的管道继续归调用方所有。
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::ProcessError;
    use std::ffi::OsString;
    use std::path::Path;
    use std::process::{ChildStderr, ChildStdin, ChildStdout, ExitStatus};

    fn unsupported() -> ProcessError {
        ProcessError {
            code: "unsupported_platform",
            message: "当前平台不支持此 Windows 自有进程树接口。",
        }
    }

    // 无有效实例：非 Windows 不降级创建未受管控的进程。
    pub enum OwnedProcess {}

    impl OwnedProcess {
        pub fn spawn(
            _program: &Path,
            _args: &[OsString],
            _cwd: &Path,
            _env: &[(OsString, OsString)],
        ) -> Result<Self, ProcessError> {
            Err(unsupported())
        }

        pub fn id(&self) -> u32 {
            match *self {}
        }

        pub fn take_stdin(&mut self) -> Option<ChildStdin> {
            match *self {}
        }

        pub fn take_stdout(&mut self) -> Option<ChildStdout> {
            match *self {}
        }

        pub fn take_stderr(&mut self) -> Option<ChildStderr> {
            match *self {}
        }

        pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, ProcessError> {
            Err(unsupported())
        }

        pub fn terminate_tree(&mut self) -> Result<(), ProcessError> {
            Err(unsupported())
        }

        pub fn active_processes(&self) -> Result<u32, ProcessError> {
            Err(unsupported())
        }
    }
}

pub use platform::OwnedProcess;
