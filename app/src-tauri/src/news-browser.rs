//! Public, visible DOM fallback. No credentials, host profile or business IPC.
use std::{sync::{mpsc,atomic::Ordering},time::{Duration,Instant}};
use tauri::Manager;
use crate::storage::StorageError;

struct OwnedWindow(tauri::WebviewWindow);
impl Drop for OwnedWindow {fn drop(&mut self){let _=self.0.close();}}
fn unavailable(message:&str)->StorageError{StorageError::new("news_body_unavailable",message)}
pub fn read(app:&tauri::AppHandle,target:&str,proxy:Option<&str>)->Result<(String,String),StorageError>{
    let target=crate::news_http::public_url(target)?;
    let profile=app.path().app_cache_dir().map_err(|_|unavailable("无法准备公开网页读取目录。"))?.join("news-public-browser");
    let label=format!("news-public-{}",crate::news_editorial_commands::uuid_value());
    let mut builder=tauri::WebviewWindowBuilder::new(app,&label,tauri::WebviewUrl::External(target))
        .title("读取公开原文").visible(false).inner_size(1280.,900.).incognito(true).data_directory(profile)
        .on_navigation(|url|{let mut url=url.clone();url.set_fragment(None);crate::news_http::public_url(url.as_str()).is_ok()})
        .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
        .on_download(|_,_|false);
    if let Some(proxy)=proxy{crate::news_http::proxy_server(proxy)?;builder=builder.proxy_url(url::Url::parse(proxy).map_err(|_|unavailable("原文代理地址无效。"))?);}
    let window=OwnedWindow(builder.build().map_err(|error|unavailable(&format!("公开网页浏览器未能启动：{error}。订阅摘要已保留。")))?);
    let deadline=Instant::now()+Duration::from_secs(25);
    let mut previous=String::new();let mut stable=0;
    while Instant::now()<deadline {
        if app.state::<crate::news_ai::AiControl>().cancel.load(Ordering::Acquire){return Err(StorageError::new("news_cancelled","取文已取消，已有内容保留。"));}
        let(tx,rx)=mpsc::channel();
        window.0.eval_with_callback(include_str!("news-browser-extract.js"),move|value|{let _=tx.send(value);}).map_err(|_|unavailable("公开网页读取中断。"))?;
        if let Ok(raw)=rx.recv_timeout(Duration::from_secs(2)){
            if let Ok(value)=serde_json::from_str::<serde_json::Value>(&raw){
                if value["blocked"].as_bool()==Some(true){previous.clear();stable=0;}
                else if let (Some(html),Some(url))=(value["html"].as_str(),value["url"].as_str()){
                    if html.len()>crate::news_http::MAX_FEED_BYTES{return Err(unavailable("公开正文超过读取上限，未当作完整正文保存。"));}
                    if html==previous{stable+=1;}else{previous=html.to_owned();stable=0;}
                    if stable>=2&&crate::news_content::markdown(html,url,true).is_ok(){crate::news_http::public_url(url)?;return Ok((html.to_owned(),url.to_owned()));}
                }
            }
        }
        std::thread::sleep(Duration::from_millis(800));
    }
    Err(unavailable("已尝试普通网页加载，仍未取得可确认的公开正文；可能需要网站验证、登录或页面尚未加载完成。订阅摘要与原文链接保留，可稍后重试。"))
}
