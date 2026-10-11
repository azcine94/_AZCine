//! Authenticated loopback-only media transport shared by the desktop and MV3 collector.
use crate::inspiration_library as library;
use crate::storage::StorageError;
use serde::Serialize;
use std::{collections::HashMap,io::{BufRead,BufReader,Read,Seek,SeekFrom,Write},net::{TcpListener,TcpStream},sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU64,AtomicUsize,Ordering}},time::{Duration,SystemTime,UNIX_EPOCH}};
use tauri::{Emitter,Manager};
use sha2::{Digest,Sha256};
const MAX_UPLOAD:u64=256*1024*1024;
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct BridgeInfo { pub endpoint:String,pub token:String,pub root:String,pub connected:bool }
struct Running { info:BridgeInfo,stop:Arc<AtomicBool>,seen:Arc<AtomicU64> }
#[derive(Default)]
pub struct BridgeState(Mutex<Option<Running>>);
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
fn extension_directory(config:&std::path::Path,root:&str)->Result<std::path::PathBuf,StorageError>{
    // Connection credentials stay with the local app config, outside business-data backups.
    let base=config.join("inspiration-bridge");let folder=base.join(format!("{:x}",Sha256::digest(root.as_bytes()))).join("chrome-v1");
    for path in [&base,folder.parent().unwrap(),&folder]{crate::pi_launch_plan::no_link(path).map_err(|_|library::error("扩展配置目录不能是链接。"))?;}
    std::fs::create_dir_all(&folder).map_err(io_error)?;Ok(folder)
}
#[tauri::command]
pub async fn inspiration_bridge(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String)->Result<BridgeInfo,StorageError>{
    crate::main_window(&window)?;
    let expected=root.clone();
    let token=crate::with_storage(app.clone(),move|m|{
        let config=m.local_config_directory()?;let s=m.store()?;library::root_matches(s,&expected)?;library::ensure(s)?;
        let path=extension_directory(&config,&expected)?.join("bridge-token.txt");
        crate::pi_launch_plan::no_link(&path).map_err(|_|library::error("桥接连接配置不能是链接。"))?;
        if path.exists(){let value=std::fs::read_to_string(&path).map_err(io_error)?;if value.len()!=64||!value.bytes().all(|b|b.is_ascii_hexdigit()){return Err(library::error("本机桥接配置无效，请保留文件并重新配置。"));}return Ok(value);}
        let value:String=s.db.query_row("SELECT lower(hex(randomblob(32)))",[],|r|r.get(0)).map_err(library::db_error)?;
        let mut file=tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(io_error)?;file.write_all(value.as_bytes()).map_err(io_error)?;file.as_file().sync_all().map_err(io_error)?;
        file.persist_noclobber(path).map_err(|_|library::error("桥接配置写入失败，未覆盖已有配置。"))?;Ok(value)
    }).await?;
    let state=app.state::<BridgeState>();let mut guard=state.0.lock().map_err(|_|library::error("采集桥接状态中断，请重启应用。"))?;
    if let Some(running)=guard.as_ref(){if running.info.root==root&&!running.stop.load(Ordering::Relaxed){let mut info=running.info.clone();info.connected=now().saturating_sub(running.seen.load(Ordering::Relaxed))<90;return Ok(info);}running.stop.store(true,Ordering::Relaxed);}
    let listener=(41570..41590).find_map(|port|TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,port)).ok()).ok_or_else(||library::error("本地采集端口被占用，请关闭其他 AZCine 实例后重试。"))?;
    let port=listener.local_addr().map_err(|_|library::error("无法读取采集端口。"))?.port();listener.set_nonblocking(true).map_err(|_|library::error("无法启动采集服务。"))?;
    let info=BridgeInfo{endpoint:format!("http://127.0.0.1:{port}"),token,root,connected:false};
    let stop=Arc::new(AtomicBool::new(false));let seen=Arc::new(AtomicU64::new(0));
    let running=Running{info:info.clone(),stop:stop.clone(),seen:seen.clone()};
    let app2=app.clone();let worker_info=info.clone();
    std::thread::Builder::new().name("azcine-inspiration-bridge".into()).spawn(move||{
        let active=Arc::new(AtomicUsize::new(0));
        while !stop.load(Ordering::Relaxed){match listener.accept(){
            Ok((stream,peer))=>{if !peer.ip().is_loopback()||active.load(Ordering::Relaxed)>=6{continue;}active.fetch_add(1,Ordering::Relaxed);let counter=active.clone();let app=app2.clone();let info=worker_info.clone();let seen=seen.clone();
                let result=std::thread::Builder::new().name("azcine-inspiration-request".into()).spawn(move||{let _=handle(stream,app,info,seen);counter.fetch_sub(1,Ordering::Relaxed);});if result.is_err(){active.fetch_sub(1,Ordering::Relaxed);}
            },Err(e)if e.kind()==std::io::ErrorKind::WouldBlock=>std::thread::sleep(Duration::from_millis(100)),Err(_)=>{stop.store(true,Ordering::Relaxed);break;}
        }}
    }).map_err(|_|library::error("无法启动采集线程。"))?;
    *guard=Some(running);Ok(info)
}
pub fn shutdown(app:&tauri::AppHandle){if let Ok(guard)=app.state::<BridgeState>().0.lock(){if let Some(running)=guard.as_ref(){running.stop.store(true,Ordering::Relaxed);}}}
fn io_error(_:std::io::Error)->StorageError{library::error("采集传输中断，请保留原文件并重试。")}
fn valid_origin(origin:&str)->bool{
    if origin.is_empty()||origin=="http://tauri.localhost"||origin=="https://tauri.localhost"||origin=="tauri://localhost"{return true;}
    if let Some(id)=origin.strip_prefix("chrome-extension://"){return id.len()==32&&id.bytes().all(|b|(b'a'..=b'p').contains(&b));}
    #[cfg(debug_assertions)]
    if let Ok(url)=url::Url::parse(origin){if url.scheme()=="http"&&url.host_str()==Some("127.0.0.1"){return true;}}
    false
}
fn reply(stream:&mut TcpStream,status:&str,mime:&str,origin:&str,body:&[u8],extra:&str)->Result<(),StorageError>{
    write_head(stream,status,mime,origin,body.len() as u64,extra)?;stream.write_all(body).map_err(io_error)
}
fn write_head(stream:&mut TcpStream,status:&str,mime:&str,origin:&str,len:u64,extra:&str)->Result<(),StorageError>{
    let cors=if origin.is_empty(){String::new()}else{format!("Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n")};
    write!(stream,"HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {len}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n{cors}{extra}\r\n").map_err(io_error)
}
fn handle(stream:TcpStream,app:tauri::AppHandle,info:BridgeInfo,seen:Arc<AtomicU64>)->Result<(),StorageError>{
    stream.set_nonblocking(false).map_err(io_error)?;
    stream.set_read_timeout(Some(Duration::from_secs(30))).map_err(io_error)?;stream.set_write_timeout(Some(Duration::from_secs(30))).map_err(io_error)?;
    let mut reader=BufReader::new(stream);let mut total=0;let mut lines=vec![];
    loop{let mut line=Vec::new();(&mut reader).take(16385-total).read_until(b'\n',&mut line).map_err(io_error)?;total+=line.len() as u64;if total>16384||line.is_empty(){return Err(library::error("请求头过长或不完整。"));}if line==b"\r\n"{break;}lines.push(String::from_utf8(line).map_err(|_|library::error("请求头编码无效。"))?);}
    let first=lines.first().ok_or_else(||library::error("缺少请求。"))?;let parts:Vec<_>=first.split_whitespace().collect();if parts.len()!=3||!parts[1].starts_with('/'){return Err(library::error("请求无效。"));}
    let method=parts[0].to_owned();let url=url::Url::parse(&(info.endpoint.clone()+parts[1])).map_err(|_|library::error("路径无效。"))?;
    let mut headers=HashMap::new();for line in &lines[1..]{let (key,value)=line.split_once(':').ok_or_else(||library::error("请求头无效。"))?;if headers.insert(key.trim().to_ascii_lowercase(),value.trim().to_owned()).is_some(){return Err(library::error("请求头重复。"));}}
    let origin=headers.get("origin").cloned().unwrap_or_default();let host=info.endpoint.trim_start_matches("http://");
    if headers.get("host").map(String::as_str)!=Some(host)||!valid_origin(&origin){return reply(reader.get_mut(),"403 Forbidden","text/plain","",b"Forbidden","");}
    if method=="OPTIONS"{return reply(reader.get_mut(),"204 No Content","text/plain",&origin,b"","Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Azcine-Token, X-Azcine-Meta, Range\r\nAccess-Control-Allow-Private-Network: true\r\n");}
    let query:HashMap<String,String>=url.query_pairs().into_owned().collect();
    let token=if url.path().starts_with("/media/"){query.get("token")}else{headers.get("x-azcine-token")};
    if token!=Some(&info.token){return reply(reader.get_mut(),"401 Unauthorized","application/json",&origin,b"{\"message\":\"Bridge authorization failed\"}","");}
    let result=process(&mut reader,&app,&info,&seen,&method,&url,&headers,&origin);
    if let Err(e)=result{let bytes=serde_json::to_vec(&e).unwrap_or_default();reply(reader.get_mut(),"400 Bad Request","application/json",&origin,&bytes,"")?;}Ok(())
}
fn process(reader:&mut BufReader<TcpStream>,app:&tauri::AppHandle,info:&BridgeInfo,seen:&AtomicU64,method:&str,url:&url::Url,headers:&HashMap<String,String>,origin:&str)->Result<(),StorageError>{
    if matches!(method,"GET"|"POST")&&url.path()=="/status"{
        let root=info.root.clone();let data=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let s=m.store()?;library::root_matches(s,&root)?;library::ensure(s)?;let groups=library::groups(s)?;Ok(serde_json::json!({"app":"AZCine","version":1,"groups":groups}))}))?;
        if origin.starts_with("chrome-extension://"){seen.store(now(),Ordering::Relaxed);}
        return reply(reader.get_mut(),"200 OK","application/json",origin,&serde_json::to_vec(&data).unwrap_or_default(),"");
    }
    if method=="POST"&&url.path()=="/import"{
        if headers.contains_key("transfer-encoding"){return Err(library::error("请使用有长度的图片或视频文件上传。"));}
        let len=headers.get("content-length").and_then(|s|s.parse::<u64>().ok()).filter(|n|*n>0&&*n<=MAX_UPLOAD).ok_or_else(||library::error("文件为空或超过256MiB，未导入。"))?;
        let encoded=headers.get("x-azcine-meta").ok_or_else(||library::error("缺少素材信息。"))?;
        let decoded=url::form_urlencoded::parse(format!("meta={encoded}").as_bytes()).find(|(k,_)|k=="meta").map(|(_,v)|v.into_owned()).ok_or_else(||library::error("素材信息无效。"))?;
        let meta:library::ImportMeta=serde_json::from_str(&decoded).map_err(|_|library::error("素材信息无效。"))?;library::check_meta(&meta)?;
        let root=info.root.clone();let group=meta.group_id.clone();
        let folder=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let s=m.store()?;library::root_matches(s,&root)?;library::check_group(s,&group)?;library::directory(s)}))?;
        let mut candidate=tempfile::NamedTempFile::new_in(folder).map_err(io_error)?;let mut remaining=len;let mut hash=Sha256::new();let mut prefix=vec![];let mut buffer=[0u8;65536];
        let started=std::time::Instant::now();
        while remaining>0{if started.elapsed()>Duration::from_secs(180){return Err(library::error("文件传输超时，请重试。"));}let capacity=remaining.min(buffer.len() as u64) as usize;let n=reader.read(&mut buffer[..capacity]).map_err(io_error)?;if n==0{return Err(library::error("文件未传完，未报告导入成功。"));}if prefix.len()<32{prefix.extend_from_slice(&buffer[..n.min(32-prefix.len())]);}candidate.write_all(&buffer[..n]).map_err(io_error)?;hash.update(&buffer[..n]);remaining-=n as u64;}
        let (mime,kind)=library::detect(&prefix).ok_or_else(||library::error("仅支持 PNG、JPEG、GIF、WebP、AVIF、MP4/MOV 和 WebM 素材。"))?;
        if kind=="image"&&len>50*1024*1024{return Err(library::error("单张图片不能超过50MiB。"));}
        candidate.as_file().sync_all().map_err(io_error)?;let hash=format!("{:x}",hash.finalize());let root=info.root.clone();
        let asset=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let s=m.store()?;library::root_matches(s,&root)?;library::finish_import(s,meta,candidate,mime,kind,len,hash)}))?;
        let _=app.emit("inspiration-changed",());if origin.starts_with("chrome-extension://"){seen.store(now(),Ordering::Relaxed);}
        return reply(reader.get_mut(),"200 OK","application/json",origin,&serde_json::to_vec(&asset).unwrap_or_default(),"");
    }
    if method=="GET"&&url.path().starts_with("/media/"){
        let id=url.path().trim_start_matches("/media/").to_owned();let root=info.root.clone();
        let (path,asset)=tauri::async_runtime::block_on(crate::with_storage(app.clone(),move|m|{let s=m.store()?;library::root_matches(s,&root)?;let a=library::get_asset(s,&id)?.ok_or_else(||library::error("素材不存在。"))?;Ok((library::media_path(s,&id)?,a))}))?;
        let mut file=std::fs::File::open(path).map_err(io_error)?;if file.metadata().map_err(io_error)?.len()!=asset.bytes{return Err(library::error("素材副本大小已变化，请检查文件。"));}
        let (start,end,partial)=if let Some(range)=headers.get("range"){
            let pair=range.strip_prefix("bytes=").and_then(|s|s.split_once('-')).ok_or_else(||library::error("视频范围无效。"))?;
            let start=if pair.0.is_empty(){asset.bytes.saturating_sub(pair.1.parse::<u64>().map_err(|_|library::error("范围无效。"))?)}else{pair.0.parse::<u64>().map_err(|_|library::error("范围无效。"))?};
            let end=if pair.1.is_empty()||pair.0.is_empty(){asset.bytes-1}else{pair.1.parse::<u64>().map_err(|_|library::error("范围无效。"))?.min(asset.bytes-1)};
            if start>end||start>=asset.bytes{return reply(reader.get_mut(),"416 Range Not Satisfiable","text/plain",origin,b"",&format!("Content-Range: bytes */{}\r\n",asset.bytes));}(start,end,true)
        }else{(0,asset.bytes-1,false)};
        let extra=if partial{format!("Accept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{}\r\n",asset.bytes)}else{"Accept-Ranges: bytes\r\n".into()};
        file.seek(SeekFrom::Start(start)).map_err(io_error)?;write_head(reader.get_mut(),if partial{"206 Partial Content"}else{"200 OK"},&asset.mime,origin,end-start+1,&extra)?;
        // Once a response header is sent, close on transport errors; never append a JSON response to media.
        let _=std::io::copy(&mut file.take(end-start+1),reader.get_mut());return Ok(());
    }
    reply(reader.get_mut(),"404 Not Found","text/plain",origin,b"Not found","")
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ExtensionInstall { pub directory:String,pub chrome_opened:bool,pub folder_opened:bool }
#[tauri::command]
pub async fn inspiration_install_extension(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String)->Result<ExtensionInstall,StorageError>{
    crate::main_window(&window)?;let bridge=inspiration_bridge(app.clone(),window.clone(),root.clone()).await?;
    let folder=crate::with_storage(app.clone(),move|m|{
        let config=m.local_config_directory()?;let s=m.store()?;library::root_matches(s,&root)?;
        let folder=extension_directory(&config,&root)?;
        for (name,body) in [
            ("manifest.json",include_str!("../../resources/inspiration-extension/manifest.json")),
            ("background.js",include_str!("../../resources/inspiration-extension/background.js")),
            ("content.js",include_str!("../../resources/inspiration-extension/content.js")),
            ("popup.html",include_str!("../../resources/inspiration-extension/popup.html")),
            ("popup.js",include_str!("../../resources/inspiration-extension/popup.js")),
            ("popup.css",include_str!("../../resources/inspiration-extension/popup.css")),
        ] {let path=folder.join(name);crate::pi_launch_plan::no_link(&path).map_err(|_|library::error("扩展文件不能是链接。"))?;std::fs::write(path,body).map_err(io_error)?;}
        let icon=folder.join("icon.png");crate::pi_launch_plan::no_link(&icon).map_err(|_|library::error("扩展图标不能是链接。"))?;
        std::fs::write(icon,include_bytes!("../../resources/inspiration-extension/icon.png")).map_err(io_error)?;
        let config=folder.join("connection.json");crate::pi_launch_plan::no_link(&config).map_err(|_|library::error("连接配置不能是链接。"))?;
        std::fs::write(config,serde_json::to_vec(&serde_json::json!({"endpoint":bridge.endpoint,"token":bridge.token})).map_err(|_|library::error("连接配置写入失败。"))?).map_err(io_error)?;
        Ok(folder)
    }).await?;
    tauri::async_runtime::spawn_blocking(move||{
        let folder_opened=crate::native_paths::open_folder(0,&folder).is_ok();
        let mut chrome_opened=false;
        #[cfg(windows)]{
            // Use only known Chrome locations. No policy/registry/profile modification.
            for base in [std::env::var_os("ProgramFiles"),std::env::var_os("ProgramFiles(x86)"),std::env::var_os("LOCALAPPDATA")].into_iter().flatten(){
                let exe=std::path::PathBuf::from(base).join("Google/Chrome/Application/chrome.exe");
                if exe.is_file(){chrome_opened=std::process::Command::new(exe).arg("chrome://extensions/").spawn().is_ok();if chrome_opened{break;}}
            }
        }
        Ok(ExtensionInstall{directory:folder.to_string_lossy().into_owned(),chrome_opened,folder_opened})
    }).await.map_err(|_|library::error("扩展安装向导中断。"))?
}
