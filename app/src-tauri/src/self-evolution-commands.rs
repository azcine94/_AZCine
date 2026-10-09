use crate::{self_evolution::*,self_evolution_worker::{Control,Worker,root_paths},storage::Store};
use serde::Deserialize;
use serde_json::{Value,json};
use tauri::{Manager,Emitter};
use std::{sync::atomic::Ordering,time::{Duration,Instant},path::PathBuf};
fn allowed(app:&tauri::AppHandle,window:&tauri::WebviewWindow)->Result<()>{crate::main_window(window)?;if app.state::<crate::pi_commands::PiExit>().0.load(Ordering::Acquire)!=0{return Err(err("应用正在退出。"));}Ok(())}
fn changed(app:&tauri::AppHandle){let _=app.emit_to("main","azcine-evolution-changed",());}
fn snapshot(store:&Store,busy:bool)->Result<Value>{
    let paths=root_paths(&store.root)?;let mut state=load(store)?;recover(store,&paths,&mut state)?;
    if !busy&&state.runs.iter().any(|r|r.status=="running"){for r in &mut state.runs{if r.status=="running"{r.status="interrupted".into();r.error=Some("上次提取未确认完成；已保存批次保留，可继续提取。".into());r.finished_at=Some(now());}}save(store,&mut state)?;}
    Ok(json!({"state":state,"resources":resources(&paths)?,"busy":busy}))
}
#[tauri::command]
pub async fn evolution_snapshot(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Value>{
    allowed(&app,&window)?;let busy=app.state::<Control>().busy.load(Ordering::Acquire);
    crate::with_storage(app,move|m|snapshot(m.store()?,busy)).await
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Mutation{action:String,revision:u64,#[serde(default)]ids:Vec<String>,id:Option<String>,content:Option<String>,settings:Option<Settings>}
#[tauri::command]
pub async fn evolution_mutate(app:tauri::AppHandle,window:tauri::WebviewWindow,input:Mutation)->Result<Value>{
    allowed(&app,&window)?;
    if app.state::<Control>().busy.load(Ordering::Acquire){return Err(err("正在提取，请完成或取消后再修改候选。"));}
    let out=crate::with_storage(app.clone(),move|m|{
        let store=m.store()?;let paths=root_paths(&store.root)?;let mut state=load(store)?;recover(store,&paths,&mut state)?;
        if state.revision!=input.revision{return Err(err("记录已更新，请刷新后核对，手改内容保留。"));}
        match input.action.as_str(){
            "settings"=>{let settings=input.settings.ok_or_else(||err("缺少提取设置。"))?;
                if !(4000..=100000).contains(&settings.budget)||chrono::NaiveTime::parse_from_str(&settings.time,"%H:%M").is_err(){return Err(err("时间或字符上限无效；每轮支持 4,000 至 100,000 字符。"));}
                for key in &settings.allowed{target(&paths,key)?;}
                state.settings=settings;save(store,&mut state)?;
            },
            "approve"=>approve(store,&paths,&mut state,&input.ids)?,
            "undo"=>undo(store,&paths,&mut state,input.id.as_deref().ok_or_else(||err("缺少修改记录。"))?)?,
            action@("edit"|"dismiss"|"restore"|"rebase")=>{
                let c=state.candidates.iter_mut().find(|c|Some(&c.id)==input.id.as_ref()).ok_or_else(||err("候选不存在。"))?;
                if action=="restore"{if c.status!="dismissed"{return Err(err("只有不记住的候选可放回。"));}c.status="pending".into();}
                else{
                    if c.status!="pending"{return Err(err("候选已处理，未修改。"));}
                    match action{
                        "edit"=>{let text=input.content.ok_or_else(||err("缺少候选内容。"))?;if text.trim().is_empty()||text.len()>12000{return Err(err("候选不能为空或超过 12 KiB。"));}c.after=text;},
                        "dismiss"=>c.status="dismissed".into(),
                        "rebase"=>{let text=text_file(&target(&paths,&c.target)?)?;replace(text.as_deref().unwrap_or(""),c)?;c.base_hash=text.as_ref().map(|s|hash(s.as_bytes()));},
                        _=>{}
                    }
                }c.revision+=1;save(store,&mut state)?;
            },
            _=>return Err(err("不支持的自进化操作。"))
        }
        snapshot(store,false)
    }).await;changed(&app);out
}
#[tauri::command]
pub async fn evolution_source(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String)->Result<Value>{
    allowed(&app,&window)?;
    crate::with_storage(app,move|m|{
        let store=m.store()?;let state=load(store)?;let c=state.candidates.iter().find(|c|c.id==id).ok_or_else(||err("来源候选不存在。"))?;
        let paths=root_paths(&store.root)?;let path=source_path(&paths,&c.source.path)?;
        let messages=source_context(&paths,&c.source)?;
        Ok(json!({"source":c.source,"messages":messages,"path":path}))
    }).await
}
#[tauri::command]
pub async fn evolution_open_source(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String)->Result<()>{
    allowed(&app,&window)?;
    let path=crate::with_storage(app,move|m|{let store=m.store()?;let state=load(store)?;let c=state.candidates.iter().find(|c|c.id==id).ok_or_else(||err("来源不存在。"))?;let paths=root_paths(&store.root)?;let path=source_path(&paths,&c.source.path)?;let info=crate::pi_sessions::validate_session(&paths,&path).map_err(|e|err(e.message))?;if info.id!=c.source.session{return Err(err("来源文件已变化。"));}Ok(path)}).await?;
    // Open as text, independent of a user's JSONL shell association. No shell expansion.
    tauri::async_runtime::spawn_blocking(move||{
        let windows=std::env::var_os("SystemRoot").map(PathBuf::from).ok_or_else(||err("Windows 目录不可用。"))?;
        std::process::Command::new(windows.join("System32/notepad.exe")).arg(path).spawn().map_err(|_|err("原文件无法打开，请检查记事本是否可用。"))?;Ok(())
    }).await.map_err(|_|err("打开会话原文件中断。"))?
}
#[tauri::command]
pub async fn evolution_extract(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<()>{
    allowed(&app,&window)?;start(app,"手动",false).await
}
#[tauri::command]
pub async fn evolution_cancel(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<()>{
    allowed(&app,&window)?;tauri::async_runtime::spawn_blocking(move||crate::self_evolution_worker::cancel(&app.state::<Control>())).await.map_err(|_|err("取消提取中断。"))?;Ok(())
}
async fn start(app:tauri::AppHandle,trigger:&str,automatic:bool)->Result<()>{
    if app.state::<Control>().busy.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return if automatic{Ok(())}else{Err(err("已有提取正在运行。"))};}
    app.state::<Control>().cancel.store(false,Ordering::Release);
    let trigger=trigger.to_owned();let setup=crate::with_storage(app.clone(),move|m|{
        let store=m.store()?;let mut state=load(store)?;
        if automatic{
            if !state.settings.automatic{return Ok(None);}
            let day=crate::news_schedule::due_daily(&state.settings.time,chrono::Utc::now())?;
            if day.is_none()||day==state.last_day{return Ok(None);}state.last_day=day;
        }
        let run=Run{id:id(),trigger,status:"running".into(),started_at:now(),finished_at:None,messages:0,candidates:0,error:None};
        state.runs.push(run.clone());save(store,&mut state)?;Ok(Some((store.root.clone(),run.id,state.settings)))
    }).await;
    let job=match setup{Ok(Some(job))=>job,other=>{app.state::<Control>().busy.store(false,Ordering::Release);return other.map(|_|());}};
    changed(&app);
    tauri::async_runtime::spawn_blocking(move||{
        let result=extract(&app,&job.0,&job.1,&job.2);
        let cancelled=app.state::<Control>().cancel.load(Ordering::Acquire);let handle=app.clone();
        let saved=tauri::async_runtime::block_on(crate::with_storage(handle,move|m|{
            let store=m.store()?;let mut state=load(store)?;
            if let Some(run)=state.runs.iter_mut().find(|r|r.id==job.1){run.status=if cancelled{"cancelled"}else if result.is_ok(){"completed"}else{"failed"}.into();run.finished_at=Some(now());run.error=result.err().map(|e|e.message);}
            save(store,&mut state)
        }));
        app.state::<Control>().busy.store(false,Ordering::Release);changed(&app);
        if saved.is_err(){let _=app.emit_to("main","azcine-evolution-error","提取终态保存失败，请核对记录。");}
    });Ok(())
}
fn extract(app:&tauri::AppHandle,root:&std::path::Path,run_id:&str,settings:&Settings)->Result<()>{
    let paths=root_paths(root)?;let all=resources(&paths)?;let keys=session_files(&paths)?;
    let control=app.state::<Control>();let mut remaining=settings.budget;let mut worker=None;let mut lease=None;
    for key in keys{
        if control.cancel.load(Ordering::Acquire){return Err(err("提取已取消。"));}if remaining==0{break;}
        let lookup=key.clone();let (cursor,deleted)=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let store=m.store()?;Ok((load(store)?.cursors.get(&lookup).cloned().unwrap_or_default(),store.agent_deleted_paths()?))}))?;
        let path=source_path(&paths,&key)?;
        if deleted.iter().any(|d|*d==crate::agent_store::session_path_key(&path.to_string_lossy())){continue;}
        let batch=match batch(&paths,&key,&cursor,remaining){Ok(batch)=>batch,Err(error)if error.code=="evolution_message_budget"&&remaining<settings.budget=>break,Err(error)=>return Err(error)};
        if batch.cursor.offset==cursor.offset{continue;}
        let mut proposals=Vec::new();
        if batch.messages.iter().any(|m|m.role=="user"){
            if worker.is_none(){
                lease=Some(app.state::<crate::agent_jobs::BackgroundSlots>().acquire(&format!("evolution-{run_id}"),&control.cancel,Instant::now()+Duration::from_secs(300))?);
                let resources=app.path().resource_dir().map_err(|_|err("运行资源不可用。"))?;
                let runtime=crate::pi_runtime::resolve(&resources).map_err(|e|err(e.message))?;
                let docs=crate::agent_jobs::configuration(app,&paths.root,&resources,&control.cancel,Instant::now()+Duration::from_secs(30))?;
                worker=Some(Worker::connect(&paths,&runtime,&docs,settings.model.as_ref(),&control)?);
            }
            let related=worker.as_ref().unwrap().related(&batch,&all,&settings.allowed)?;
            let reply=worker.as_ref().unwrap().prompt(&prompt(&batch,&related))?;
            proposals=crate::self_evolution::proposals(&reply,&batch,&related)?;
        }
        if control.cancel.load(Ordering::Acquire){return Err(err("提取已取消，未提交当前批次。"));}
        remaining=remaining.saturating_sub(batch.messages.iter().map(|m|m.text.chars().count()).sum::<usize>());
        let run_id=run_id.to_owned();
        tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{
            let store=m.store()?;let mut state=load(store)?;let mut added=0;
            for c in proposals{if !state.candidates.iter().any(|old|old.source.path==c.source.path&&old.source.message==c.source.message&&old.target==c.target&&old.before==c.before&&old.after==c.after){state.candidates.push(c);added+=1;}}
            state.cursors.insert(key,batch.cursor);
            if let Some(run)=state.runs.iter_mut().find(|r|r.id==run_id){run.messages+=batch.messages.len();run.candidates+=added;}
            save(store,&mut state)
        }))?;changed(app);
    }
    drop(worker);drop(lease);Ok(())
}
pub fn start_scheduler(app:tauri::AppHandle){
    let _=std::thread::Builder::new().name("azcine-evolution-schedule".into()).spawn(move||{
        loop{std::thread::sleep(Duration::from_secs(30));
            if app.state::<crate::pi_commands::PiExit>().0.load(Ordering::Acquire)!=0{break;}
            let _=tauri::async_runtime::block_on(start(app.clone(),"自动",true));
        }
    });
}
