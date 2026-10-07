use crate::storage::{StorageError, Store};
use crate::task_panel_paths::{hash, read_limited, scoped_file};
fn within_scope(path:&str,scope:&[String])->bool { crate::task_panel_paths::source_path(path) && crate::task_panel_paths::within_scope(path,scope) }
use crate::task_panel_store::{db_error, encode, invalid, new_id, now, repository};
use crate::task_panel_types::Repository;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, process::{Command, Stdio}, time::{Duration, Instant}};

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct FileSnapshot { pub path:String,pub hash:String,pub bytes:u64,pub tracked:bool,pub changed:bool }
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct WorkspaceSnapshot {pub id:String,pub repository_id:String,pub head:Option<String>,pub files:Vec<FileSnapshot>,pub changes:String,pub fingerprint:String,pub consistent:bool,pub sampled_at:String,pub coverage:Vec<String>,pub unknowns:Vec<String>}

pub(crate) fn git(root:&Path,args:&[&str])->Result<String,StorageError>{
    let mut command=Command::new("git");command.arg("-C").arg(root).args(args).env_clear();
    for key in ["PATH","SystemRoot","WINDIR","TEMP","TMP","LOCALAPPDATA","USERPROFILE"] {if let Some(value)=std::env::var_os(key){command.env(key,value);}}
    // Read-only queries must use the same Git configuration as checkout/status.
    // Hiding core.autocrlf makes fresh Windows worktrees look entirely modified.
    // Keep injected GIT_DIR/INDEX_FILE/config environment overrides excluded.
    #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    command.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    let mut child=command.spawn().map_err(|_|invalid("Git 不可用；仓库版本尚未核实。"))?;
    let stdout=child.stdout.take().unwrap();let stderr=child.stderr.take().unwrap();
    let reader=std::thread::spawn(move||{use std::io::Read;let mut bytes=Vec::new();let _=stdout.take(2_000_001).read_to_end(&mut bytes);bytes});
    let errors=std::thread::spawn(move||{use std::io::Read;let mut bytes=Vec::new();let _=stderr.take(65536).read_to_end(&mut bytes);bytes});
    let deadline=Instant::now()+Duration::from_secs(15);
    let status=loop{match child.try_wait(){Ok(Some(s))=>break s,Ok(None) if Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(20)),_=>{let _=child.kill();let _=child.wait();return Err(invalid("Git 查询超时；未使用混合版本快照。"));}}};
    let bytes=reader.join().map_err(|_|invalid("Git 查询中断。"))?;let _=errors.join();
    if !status.success()||bytes.len()>2_000_000{return Err(invalid("Git 版本查询失败或超出范围；没有伪造提交。"));}
    String::from_utf8(bytes).map_err(|_|invalid("Git 文件名或结果无法表示。"))
}
fn walk(root:&Path,dir:&Path,scope:&[String],files:&mut BTreeMap<String,bool>,depth:usize)->Result<(),StorageError>{
    if depth>24||files.len()>5000{return Err(invalid("文件范围过大，请缩小允许目录。"));}
    let real=std::fs::canonicalize(dir).map_err(|_|invalid("目录不可读。"))?;
    let base=std::fs::canonicalize(root).map_err(|_|invalid("仓库不可读。"))?;
    if !real.starts_with(base){return Err(invalid("目录链接逃逸，未枚举外部文件。"));}
    for entry in std::fs::read_dir(dir).map_err(|_|invalid("允许目录不可读。"))? {
        let entry=entry.map_err(|_|invalid("目录枚举失败。"))?;let path=entry.path();let relative=path.strip_prefix(root).map_err(|_|invalid("目录越界。"))?.to_string_lossy().replace('\\',"/");
        let kind=entry.file_type().map_err(|_|invalid("目录项不可读。"))?;
        if kind.is_symlink()||!crate::task_panel_paths::source_path(&relative)||crate::task_panel_paths::sensitive(&relative){continue;}
        if kind.is_dir(){walk(root,&path,scope,files,depth+1)?;}else if kind.is_file()&&within_scope(&relative,scope){files.insert(relative,false);}
    }Ok(())
}

pub(crate) fn sample(repo:&Repository,scope:&[String])->Result<WorkspaceSnapshot,StorageError>{
    if scope.is_empty()||scope.iter().any(|s|!repo.scope.iter().any(|allowed|allowed=="."||s==allowed||s.starts_with(&(allowed.to_string()+"/")))) {return Err(invalid("任务范围超出仓库已确认的读取范围。"));}
    let root=Path::new(&repo.path);
    let is_repository=git(root,&["rev-parse","--show-toplevel"]).ok().and_then(|s|std::fs::canonicalize(s.trim()).ok()).is_some_and(|top|std::fs::canonicalize(root).is_ok_and(|r|top==r));
    let head=if is_repository{git(root,&["rev-parse","--verify","HEAD"]).ok().map(|s|s.trim().to_string())}else{None};
    let mut files=BTreeMap::<String,bool>::new();let mut changes=String::new();let mut unknowns=Vec::new();
    if is_repository {
        let mut args=vec!["ls-files","-z","--"];args.extend(scope.iter().map(String::as_str));
        for p in git(root,&args)?.split('\0').filter(|p|within_scope(p,scope)){files.insert(p.into(),true);}
        let mut args=vec!["ls-files","--others","--exclude-standard","-z","--"];args.extend(scope.iter().map(String::as_str));
        for p in git(root,&args)?.split('\0').filter(|p|within_scope(p,scope)){files.entry(p.into()).or_insert(false);}
        let mut args=vec!["status","--porcelain=v1","-z","--untracked-files=all","--"];args.extend(scope.iter().map(String::as_str));
        let raw=git(root,&args)?;
        // Status text contains only paths/status, never source content. Sensitive paths are omitted.
        changes=raw.split('\0').filter(|line|line.get(3..).is_some_and(|p|within_scope(p,scope))).collect::<Vec<_>>().join("\n");
    }else{
        unknowns.push("当前目录没有可核对的 Git 提交；快照只记录允许范围内的文件。".into());
        for s in scope {let path=root.join(s);if path.is_dir(){walk(root,&path,scope,&mut files,0)?;}else if path.is_file()&&within_scope(s,scope){files.insert(s.clone(),false);}}
    }
    if files.len()>5000{return Err(invalid("快照超过 5000 个文件，请缩小范围。"));}
    let mut snapshots=Vec::new();let mut total=0u64;
    for (p,tracked) in files {
        if tracked&&!root.join(&p).exists()&&changes.lines().any(|s|s.get(..2).is_some_and(|status|status.contains('D'))&&s.get(3..)==Some(p.as_str())){continue;}
        let path=scoped_file(root,&p,scope)?;let bytes=read_limited(&path,8_000_000)?;total+=bytes.len() as u64;
        if total>64_000_000{return Err(invalid("快照内容过大，请缩小范围。"));}
        snapshots.push(FileSnapshot{changed:!tracked||changes.lines().any(|line|line.get(3..)==Some(p.as_str())),path:p,hash:hash(&bytes),bytes:bytes.len() as u64,tracked});
    }
    let after_head=if is_repository{git(root,&["rev-parse","--verify","HEAD"]).ok().map(|s|s.trim().to_string())}else{None};
    let consistent=head==after_head;
    if !consistent{return Err(invalid("提交在采样期间改变，请重新读取。"));}
    // Re-read each file hash to catch edits that do not change HEAD.
    for file in &snapshots {if hash(&read_limited(&scoped_file(root,&file.path,scope)?,8_000_000)?)!=file.hash{return Err(invalid("源码在采样期间改变，请重新生成上下文。"));}}
    if is_repository {
        let mut args=vec!["status","--porcelain=v1","-z","--untracked-files=all","--"];args.extend(scope.iter().map(String::as_str));
        let after=git(root,&args)?.split('\0').filter(|line|line.get(3..).is_some_and(|p|within_scope(p,scope))).collect::<Vec<_>>().join("\n");
        if after!=changes{return Err(invalid("文件增删或暂存状态在采样期间改变，请重新取样。"));}
    }
    if !is_repository {
        let mut after_files=BTreeMap::new();
        for s in scope {let path=root.join(s);if path.is_dir(){walk(root,&path,scope,&mut after_files,0)?;}else if path.is_file()&&within_scope(s,scope){after_files.insert(s.clone(),false);}}
        if after_files.keys().map(String::as_str).collect::<Vec<_>>() != snapshots.iter().map(|s|s.path.as_str()).collect::<Vec<_>>() {return Err(invalid("目录文件在采样期间增删，请重新取样。"));}
    }
    unknowns.push("排除 .azcine 任务数据、认证文件、工具缓存、Git 元数据和忽略文件；快照保存哈希，不保存可直接还原的源码副本。".into());
    let fingerprint=hash(encode(&(head.as_ref(),&snapshots,&changes))?.as_bytes());
    Ok(WorkspaceSnapshot{id:String::new(),repository_id:repo.id.clone(),head,files:snapshots,changes,fingerprint,consistent,sampled_at:now(),coverage:scope.to_vec(),unknowns})
}
impl Store {
    pub fn task_panel_snapshot_task(&mut self,task:&crate::task_panel_types::Task)->Result<WorkspaceSnapshot,StorageError>{
        let repo=crate::task_panel_locations::execution_repository(&self.db,task)?;
        let mut result=sample(&repo,&task.scope)?;result.id=new_id(&self.db,"snap")?;
        self.db.execute("INSERT INTO tp_snapshots VALUES(?1,?2,?3,?4,?5,?6,?7)",params![result.id,repo.id,result.head,encode(&result)?,result.fingerprint,result.consistent,result.sampled_at]).map_err(db_error)?;
        Ok(result)
    }

    pub fn task_panel_snapshot_workspace(&mut self,repository_id:&str,scope:&[String])->Result<WorkspaceSnapshot,StorageError>{
        let repo=repository(&self.db,repository_id)?;let mut result=sample(&repo,scope)?;result.id=new_id(&self.db,"snap")?;
        self.db.execute("INSERT INTO tp_snapshots VALUES(?1,?2,?3,?4,?5,?6,?7)",params![result.id,repository_id,result.head,encode(&result)?,result.fingerprint,result.consistent,result.sampled_at]).map_err(db_error)?;
        Ok(result)
    }
}
