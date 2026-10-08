use crate::{news_editorial_types::Edition,storage::StorageError};
use std::{path::{Path,PathBuf},io::{Read,Write}};
fn failure()->StorageError{StorageError::new("news_pdf_failed","整期PDF未能完成，没有覆盖目标文件；刊期和已渲染输入保留，请重试。")}
fn domain_name(domain:crate::news_types::Domain)->&'static str{match domain{crate::news_types::Domain::Frontiers=>"大模型前沿",crate::news_types::Domain::Industry=>"AI行业动态",crate::news_types::Domain::Visual=>"AI视频、图片 / CG应用"}}
pub fn edition_text(e:&Edition)->String{
    let mut lines=vec![format!("AZCine 资讯日报 · {} · v{}",e.date,e.version),format!("生成时间：{}",e.generated_at),format!("完整窗口：{} — {}（过去24小时）",e.window_start,e.window_end),format!("配置版本：v{}",e.config_revision),String::new()];
    if e.incomplete{lines.push("覆盖不完整".into());lines.extend(e.gaps.iter().map(|g|format!("• {g}")));lines.push(String::new());}
    lines.push("总览 / 看点".into());for id in &e.overview_ids{if let Some(event)=e.events.iter().find(|v|&v.id==id){lines.push(format!("• {}",event.draft.title));lines.push(event.draft.summary.clone());}}
    if e.overview_ids.is_empty(){lines.push("本期没有符合规则的看点，不凑数。".into());}
    for domain in [crate::news_types::Domain::Frontiers,crate::news_types::Domain::Industry,crate::news_types::Domain::Visual]{lines.push(String::new());lines.push(domain_name(domain).into());let events=e.events.iter().filter(|v|v.draft.domain==Some(domain)).collect::<Vec<_>>();if events.is_empty(){lines.push("本期无符合规则的事件。".into());}
        for event in events {lines.push(String::new());lines.push(format!("{} · 事件 v{}",event.draft.title,event.revision));lines.push(format!("AI导读：{}",event.draft.summary));lines.push("来源事实：".into());
            for fact in &event.draft.facts{lines.push(format!("• {}",fact.text));for id in &fact.material_ids{if let Some(m)=event.materials.iter().find(|v|&v.id==id){lines.push(format!("  出处：{} {}",m.source_name,m.url));}}}
            lines.push(format!("AI判断 · 相关性 {}/100：{}",event.draft.score,event.draft.reason));lines.push("证据限制 / 未验证项：".into());lines.extend(event.draft.limitations.iter().map(|t|format!("• {t}")));
            if event.materials.iter().map(|m|&m.source_id).collect::<std::collections::HashSet<_>>().len()==1{lines.push("只有一个订阅来源，不构成多方核验。".into());}
            lines.push(format!("主题标签：{}",event.draft.tags.join("、")));lines.push(format!("整理模型：{} / {} · 规则 v{} · 提示版本 {}",event.model.provider,event.model.id,event.config_revision,event.prompt_version));
            lines.push("全部出处与关联进展：".into());for m in &event.materials{lines.push(format!("• {} · {}",m.source_name,m.title));lines.push(format!("  原发布时间：{} · 发现时间：{}",m.published_at.as_deref().unwrap_or("信源未提供"),m.discovered_at));lines.push(format!("  {}",m.url));}
        }
    }lines.push(String::new());lines.push("本刊只依据订阅摘要整理，未取得正文许可，没有补写全文；推荐与导读为AI判断，未亲测。".into());lines.join("\n")
}
fn escape(text:&str)->String{text.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;")}
pub fn edition_html(e:&Edition)->String{format!("<!doctype html><html lang=\"zh-CN\" data-azcine-edition=\"{}\"><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>资讯日报</title><style>@page{{size:A4;margin:16mm}}body{{margin:0;color:#111;background:white;font-family:'Microsoft YaHei','SimSun',sans-serif}}pre{{font:11pt/1.8 'Microsoft YaHei','SimSun',sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:0;orphans:3;widows:3}}</style><body><pre>{}</pre></body></html>",escape(&e.id),escape(&edition_text(e)))}
impl crate::storage::Store{pub fn news_edition(&self,id:&str)->Result<Edition,StorageError>{let value:String=self.db.query_row("SELECT payload FROM news_editions WHERE id=?1",[id],|r|r.get(0)).map_err(|_|StorageError::new("news_edition_unavailable","未找到这个固定刊期，请重新读取；未导出其他版本。"))?;serde_json::from_str(&value).map_err(|_|failure())}}
#[tauri::command]pub async fn news_edition_text(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String)->Result<String,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|{let store=m.store()?;if let Some(text)=crate::news_reader_export::saved_edition_text(store,&id)?{Ok(text)}else{Ok(edition_text(&store.news_edition(&id)?))}}).await}
#[tauri::command]pub async fn export_news_edition(app:tauri::AppHandle,window:tauri::WebviewWindow,id:String)->Result<Option<String>,StorageError>{
    let owner=crate::owner_handle(&window)?;let (root,edition)=crate::with_storage(app.clone(),move|m|{let s=m.store()?;Ok((s.root.clone(),s.news_edition(&id)?))}).await?;
    let name=format!("AZCine-news-{}-v{}.pdf",edition.date,edition.version);
    #[cfg(debug_assertions)]let test_path=std::env::var_os("AZCINE_TEST_PDF_DESTINATION").map(PathBuf::from);
    #[cfg(not(debug_assertions))]let test_path:Option<PathBuf>=None;
    let chosen=if let Some(path)=test_path{Some(path)}else{tauri::async_runtime::spawn_blocking(move||crate::native_paths::choose_news_pdf(owner,name)).await.map_err(|_|failure())??};
    let Some(destination)=chosen else{return Ok(None);};
    if !destination.is_absolute()||destination.try_exists().map_err(|_|failure())?{return Err(StorageError::new("news_pdf_exists","目标文件已经存在或路径无效，未覆盖；请用新的文件名导出。"));}
    let exports=root.join("exports");crate::pi_launch_plan::no_link(&exports).map_err(|_|failure())?;std::fs::create_dir_all(&exports).map_err(|_|failure())?;
    let render=tempfile::Builder::new().prefix("news-pdf-").tempdir_in(exports).map_err(|_|failure())?.keep().join("edition.pdf");
    render_pdf(app,&edition,&render).await?;
    let display=destination.to_string_lossy().into_owned();
    tauri::async_runtime::spawn_blocking(move||publish(&render,&destination)).await.map_err(|_|failure())??;Ok(Some(display))
}
fn publish(render:&Path,destination:&Path)->Result<(),StorageError>{
    let mut source=std::fs::File::open(render).map_err(|_|failure())?;let mut header=[0;5];source.read_exact(&mut header).map_err(|_|failure())?;if &header!=b"%PDF-"{return Err(failure());}
    let mut source=std::fs::File::open(render).map_err(|_|failure())?;let mut file=tempfile::Builder::new().prefix("AZCine-news-pending-").suffix(".pdf").tempfile_in(destination.parent().ok_or_else(failure)?).map_err(|_|failure())?;file.disable_cleanup(true);std::io::copy(&mut source,&mut file).map_err(|_|failure())?;file.flush().and_then(|_|file.as_file().sync_all()).map_err(|_|failure())?;file.persist_noclobber(destination).map_err(|_|StorageError::new("news_pdf_exists","PDF目标文件未能保存，未覆盖已有文件；刊期与已渲染PDF保留。"))?;Ok(())
}
#[cfg(windows)]async fn render_pdf(app:tauri::AppHandle,edition:&Edition,path:&Path)->Result<(),StorageError>{
    use windows::core::{Interface,PCWSTR};use webview2_com::{NavigationCompletedEventHandler,ExecuteScriptCompletedHandler,PrintToPdfCompletedHandler,Microsoft::Web::WebView2::Win32::{ICoreWebView2_7,ICoreWebView2Environment6}};
    let label=format!("news-export-{}",crate::news_editorial_commands::uuid_value());let window=tauri::WebviewWindowBuilder::new(&app,&label,tauri::WebviewUrl::External("about:blank".parse().map_err(|_|failure())?)).visible(false).title("AZCine news export").inner_size(794.,1123.).build().map_err(|_|failure())?;
    let html=edition_html(edition);let id=edition.id.clone();let path=path.to_path_buf();let (tx,rx)=std::sync::mpsc::channel();
    let result=window.with_webview(move|webview|{let setup=(||->windows::core::Result<()>{unsafe{
        let core=webview.controller().CoreWebView2()?;let print:ICoreWebView2_7=core.cast()?;let env:ICoreWebView2Environment6=webview.environment().cast()?;let settings=env.CreatePrintSettings()?;
        settings.SetPageWidth(210./25.4)?;settings.SetPageHeight(297./25.4)?;settings.SetMarginTop(16./25.4)?;settings.SetMarginBottom(16./25.4)?;settings.SetMarginLeft(16./25.4)?;settings.SetMarginRight(16./25.4)?;settings.SetShouldPrintHeaderAndFooter(false)?;
        let mut token=0;let send=tx.clone();let callback=NavigationCompletedEventHandler::create(Box::new(move|sender,_|{
            if let Some(core)=sender{let print=print.clone();let settings=settings.clone();let path=path.clone();let send=send.clone();let check=format!("document.documentElement.dataset.azcineEdition === '{}' && document.fonts.status === 'loaded'",id);let check:Vec<u16>=check.encode_utf16().chain(Some(0)).collect();
                core.ExecuteScript(PCWSTR(check.as_ptr()),&ExecuteScriptCompletedHandler::create(Box::new(move|status,result|{
                    if status.is_err(){let _=send.send(Err(failure()));return Ok(());}if result!="true"{return Ok(());}let path:Vec<u16>=path.to_string_lossy().encode_utf16().chain(Some(0)).collect();let done=send.clone();
                    if print.PrintToPdf(PCWSTR(path.as_ptr()),&settings,&PrintToPdfCompletedHandler::create(Box::new(move|status,success|{let _=done.send(if status.is_ok()&&success{Ok(())}else{Err(failure())});Ok(())}))).is_err(){let _=send.send(Err(failure()));}Ok(())
                })))?;
            }Ok(())
        }));core.add_NavigationCompleted(&callback,&mut token)?;let html:Vec<u16>=html.encode_utf16().chain(Some(0)).collect();core.NavigateToString(PCWSTR(html.as_ptr()))?;
    }Ok(())})();if setup.is_err(){let _=tx.send(Err(failure()));}});
    if result.is_err(){let _=window.close();return Err(failure());}
    let result=tauri::async_runtime::spawn_blocking(move||rx.recv_timeout(std::time::Duration::from_secs(60)).map_err(|_|failure())?).await.map_err(|_|failure());
    let _=window.close();result?
}
#[cfg(not(windows))]async fn render_pdf(_app:tauri::AppHandle,_edition:&Edition,_path:&Path)->Result<(),StorageError>{Err(StorageError::new("news_pdf_unsupported","PDF导出目前仅支持Windows桌面。"))}
