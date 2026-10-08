//! Cooperative, OS-held session ownership across AZCine instances. No stale PID
//! cleanup: the OS releases the handle after exit, and the lock file is retained.
use crate::{pi_launch_plan::{PiPaths,no_link},pi_manager::PiError};
use sha2::{Digest,Sha256};
use std::{fs::{self,File,OpenOptions},path::Path};

pub struct SessionLease { _file:File }
impl SessionLease {
    pub fn acquire(paths:&PiPaths,session:&Path)->Result<Self,PiError>{
        let parent=session.parent().ok_or_else(||PiError::new("pi_session_invalid","会话路径无效。"))?;
        let parent=fs::canonicalize(parent).map_err(|_|PiError::new("pi_session_invalid","会话目录不可读取。"))?;
        if !parent.starts_with(&paths.sessions){return Err(PiError::new("pi_session_outside","会话不属于本应用。"));}
        let identity=parent.join(session.file_name().ok_or_else(||PiError::new("pi_session_invalid","会话名称无效。"))?);
        let identity=identity.to_string_lossy().into_owned();
        let identity=if cfg!(windows){identity.to_lowercase()}else{identity};
        let directory=paths.pi_root.join("session-locks");no_link(&directory)?;
        fs::create_dir_all(&directory).map_err(|_|PiError::new("pi_session_lock","无法准备会话占用锁。"))?;
        let path=directory.join(format!("{:x}.lock",Sha256::digest(identity.as_bytes())));no_link(&path)?;
        let mut options=OpenOptions::new();options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;options.share_mode(0x1|0x2);}
        let file=options.open(path).map_err(|_|PiError::new("pi_session_lock","会话占用锁不可读取。"))?;
        match file.try_lock(){
            Ok(())=>Ok(Self{_file:file}),
            Err(std::fs::TryLockError::WouldBlock)=>Err(PiError::new("pi_session_owned","这个会话已由另一个 AZCine 会话或窗口使用；没有启动第二个写入者。")),
            Err(_)=>Err(PiError::new("pi_session_lock","无法取得会话占用锁，未打开会话。")),
        }
    }
}
