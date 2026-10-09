//! Public project feed; local cache is written only by Rust in app_meta.
use crate::storage::{StorageError,Store};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use rusqlite::OptionalExtension;
use std::collections::HashSet;
const KEY:&str="github.projects.v1";
fn error(message:&str)->StorageError{StorageError::new("github_projects",message)}
#[derive(Clone,Serialize,Deserialize)]#[serde(rename_all="camelCase")]
pub struct Project{pub id:String,pub name:String,pub full_name:String,pub title:String,pub summary:String,pub author:String,pub language:String,pub updated_at:String,pub views:Option<u64>,pub comments:Option<u64>}
#[derive(Clone,Default,Serialize,Deserialize)]#[serde(rename_all="camelCase")]
pub struct Snapshot{pub items:Vec<Project>,pub fetched_at:Option<String>,pub next_page:u32,pub has_more:bool,pub revision:u64}
fn owner(value:&str)->bool{!value.is_empty()&&value.len()<=39&&value.bytes().next().is_some_and(|b|b.is_ascii_alphanumeric())&&value.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-')}
fn repository(value:&str)->bool{let parts:Vec<_>=value.split('/').collect();parts.len()==2&&owner(parts[0])&&!parts[1].is_empty()&&parts[1].len()<=100&&!matches!(parts[1],"."|"..")&&parts[1].bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b))}
fn text(value:&Value,key:&str,max:usize)->Result<String,StorageError>{let s=value[key].as_str().unwrap_or("");if s.len()>max{return Err(error("来源字段过长，保留已有项目。"));}Ok(s.to_owned())}
fn parse(body:&[u8],page:u32)->Result<(Vec<Project>,bool),StorageError>{
    let raw:Value=serde_json::from_slice(body).map_err(|_|error("项目来源没有返回有效JSON，保留已有内容。"))?;
    if raw["success"]!=true||raw["page"].as_u64().is_some_and(|n|n!=u64::from(page)){return Err(error("项目来源分页或状态异常，保留已有内容。"));}
    let list=raw["data"].as_array().ok_or_else(||error("项目来源格式变化，保留已有内容。"))?;
    if list.len()>200{return Err(error("单页项目过多，未写入缓存。"));}
    let mut rows=Vec::new();
    for value in list{
        let full_name=text(value,"full_name",160)?;if !repository(&full_name){continue;}
        let id=if let Some(id)=value["item_id"].as_str(){id.to_owned()}else{full_name.clone()};
        let mut updated_at=text(value,"updated_at",100)?;
        if !updated_at.is_empty()&&chrono::DateTime::parse_from_rfc3339(&updated_at).is_err(){updated_at=format!("{}+08:00",updated_at.replace(' ',"T"));}
        if !updated_at.is_empty()&&chrono::DateTime::parse_from_rfc3339(&updated_at).is_err(){return Err(error("项目来源日期格式变化，保留已有内容。"));}
        rows.push(Project{id,name:full_name.split('/').nth(1).unwrap_or("").into(),full_name,title:text(value,"title",4000)?,summary:text(value,"summary",20000)?,author:text(value,"author",200)?,language:text(value,"primary_lang",100)?,updated_at,views:value["clicks_total"].as_u64(),comments:value["comment_total"].as_u64()});
    }
    if !list.is_empty()&&rows.is_empty(){return Err(error("来源没有有效的GitHub仓库，未覆盖缓存。"));}
    Ok((rows,raw["has_more"]==true))
}
fn read(store:&Store,key:&str)->Result<Option<String>,StorageError>{store.db.query_row("SELECT value FROM app_meta WHERE key=?",[key],|r|r.get(0)).optional().map_err(|_|error("项目缓存读取失败。"))}
fn save(store:&Store,key:&str,value:&impl Serialize)->Result<(),StorageError>{let value=serde_json::to_string(value).map_err(|_|error("项目缓存编码失败。"))?;store.db.execute("INSERT INTO app_meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",rusqlite::params![key,value]).map_err(|_|error("项目缓存保存失败，已有内容保留。"))?;Ok(())}
fn snapshot(store:&Store)->Result<Snapshot,StorageError>{read(store,KEY)?.map(|s|serde_json::from_str(&s).map_err(|_|error("项目缓存格式异常，未覆盖。"))).unwrap_or_else(||Ok(Snapshot{next_page:1,has_more:true,..Default::default()}))}
fn ensure(store:&Store,root:&str)->Result<(),StorageError>{if crate::agent_store::session_path_key(&store.root.to_string_lossy())!=crate::agent_store::session_path_key(root){return Err(error("数据目录已切换，本次结果未写入其他目录。"));}Ok(())}
fn commit(store:&Store,root:&str,revision:u64,next:Snapshot)->Result<Snapshot,StorageError>{ensure(store,root)?;if snapshot(store)?.revision!=revision{return Err(error("项目缓存已由另一次刷新更新，请重新读取。"));}save(store,KEY,&next)?;Ok(next)}
fn collect(mut previous:Snapshot,append:bool,mut fetch:impl FnMut(u32)->Result<(Vec<Project>,bool),StorageError>)->Result<Snapshot,StorageError>{
    if append&&!previous.has_more{return Ok(previous);}
    let mut page=if append{previous.next_page.max(1)}else{1};let mut fresh=Vec::new();let mut seen=HashSet::new();let mut more=false;
    for _ in 0..10{
        let (rows,has_more)=fetch(page)?;let before=fresh.len();
        for row in rows{if seen.insert(row.full_name.to_ascii_lowercase()){fresh.push(row);}}
        page+=1;more=has_more;
        if !more||fresh.len()==before{more=false;break;}
    }
    if append{
        let mut positions=previous.items.iter().enumerate().map(|(i,row)|(row.full_name.to_ascii_lowercase(),i)).collect::<std::collections::HashMap<_,_>>();
        for row in fresh{let key=row.full_name.to_ascii_lowercase();if let Some(index)=positions.get(&key){previous.items[*index]=row;}else{positions.insert(key,previous.items.len());previous.items.push(row);}}
    }else{
        fresh.extend(previous.items.into_iter().filter(|row|seen.insert(row.full_name.to_ascii_lowercase())));previous.items=fresh;
    }
    if previous.items.len()>5000{return Err(error("本机项目缓存已达5000条，本次未覆盖。"));}
    previous.next_page=page;previous.has_more=more;previous.fetched_at=Some(chrono::Utc::now().to_rfc3339());previous.revision+=1;Ok(previous)
}
#[tauri::command]
pub async fn github_projects_snapshot(app:tauri::AppHandle,window:tauri::WebviewWindow,expected_root:String)->Result<Snapshot,StorageError>{crate::main_window(&window)?;crate::with_storage(app,move|m|{let s=m.store()?;ensure(s,&expected_root)?;snapshot(s)}).await}
#[tauri::command]
pub async fn github_projects_refresh(app:tauri::AppHandle,window:tauri::WebviewWindow,expected_root:String,append:bool)->Result<Snapshot,StorageError>{
    crate::main_window(&window)?;let root=expected_root.clone();
    let previous=crate::with_storage(app.clone(),move|m|{let s=m.store()?;ensure(s,&root)?;snapshot(s)}).await?;let revision=previous.revision;
    let next=tauri::async_runtime::spawn_blocking(move||collect(previous,append,|page|{let response=crate::news_http::fetch_github(&format!("https://api.hellogithub.com/v1/?sort_by=featured&page={page}"))?;parse(&response.body,page)})).await.map_err(|_|error("项目读取任务中断，已有缓存保留。"))??;
    crate::with_storage(app,move|m|commit(m.store()?,&expected_root,revision,next)).await
}
fn mime(bytes:&[u8])->Result<&'static str,StorageError>{
    if bytes.len()>2*1024*1024{return Err(error("头像超过大小上限。"));}
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n"){Ok("image/png")}else if bytes.starts_with(b"\xff\xd8\xff"){Ok("image/jpeg")}else if bytes.starts_with(b"GIF87a")||bytes.starts_with(b"GIF89a"){Ok("image/gif")}else if bytes.len()>12&&&bytes[..4]==b"RIFF"&&&bytes[8..12]==b"WEBP"{Ok("image/webp")}else{Err(error("头像格式不支持。"))}
}
#[tauri::command]
pub async fn github_project_avatar(app:tauri::AppHandle,window:tauri::WebviewWindow,expected_root:String,owner_name:String)->Result<Value,StorageError>{
    crate::main_window(&window)?;if !owner(&owner_name){return Err(error("仓库作者标识无效。"));}let key=format!("github.avatar.v1:{}",owner_name.to_ascii_lowercase());let read_key=key.clone();let root=expected_root.clone();
    let cached=crate::with_storage(app.clone(),move|m|{let s=m.store()?;ensure(s,&root)?;read(s,&read_key)}).await?;
    if let Some(cached)=cached{let value:Value=serde_json::from_str(&cached).map_err(|_|error("头像缓存无效。"))?;return Ok(value);}
    let value=tauri::async_runtime::spawn_blocking(move||{let response=crate::news_http::fetch_github(&format!("https://avatars.githubusercontent.com/{owner_name}?s=96"))?;Ok::<_,StorageError>(json!({"mime":mime(&response.body)?,"bytes":response.body}))}).await.map_err(|_|error("头像读取中断。"))??;
    crate::with_storage(app,move|m|{let s=m.store()?;ensure(s,&expected_root)?;save(s,&key,&value)?;Ok(value)}).await
}
#[tauri::command]
pub async fn github_project_open(window:tauri::WebviewWindow,repository_name:Option<String>)->Result<(),StorageError>{
    let url=match repository_name{Some(name) if repository(&name)=>format!("https://github.com/{name}"),None=>"https://hellogithub.com".into(),_=>return Err(error("仓库地址无效。"))};
    crate::news_commands::open_news_url(window,url).await
}
#[cfg(test)]mod tests{
    use super::*;
    fn row(name:&str)->Project{Project{id:name.into(),name:name.into(),full_name:format!("fixture/{name}"),title:String::new(),summary:String::new(),author:String::new(),language:String::new(),updated_at:String::new(),views:None,comments:None}}
    #[test]fn repository_links_only_accept_an_owner_and_repository(){for name in ["owner/repo","hello-github/demo.js"]{assert!(repository(name));}for name in ["../repo","owner/..","owner/repo/issues","owner/repo?x=1","https://evil.invalid","owner\\repo"]{assert!(!repository(name));}}
    #[test]fn refresh_restarts_pagination_and_retains_previous_history_without_duplicates(){let old=Snapshot{items:vec![row("old"),row("new")],next_page:8,has_more:false,..Default::default()};let mut called=Vec::new();let result=collect(old,false,|page|{called.push(page);Ok((vec![row(if page==1{"new"}else{"second"})],page==1))}).unwrap();assert_eq!(called,vec![1,2]);assert_eq!(result.items.len(),3);assert_eq!(result.next_page,3);assert!(!result.has_more);}
    #[test]fn invalid_source_and_image_are_rejected(){assert!(parse(br#"{"success":true,"data":[{"full_name":"../repo"}]}"#,1).is_err());assert!(mime(b"<html>not an avatar</html>").is_err());}
    #[test]fn cache_survives_reopen_and_rejects_stale_or_other_root_results(){
        let base=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation");
        let dir=tempfile::Builder::new().prefix("github-cache-").tempdir_in(base).unwrap().keep();
        let root=dir.join("data");let s=Store::open(&root,true).unwrap();let root_text=s.root.to_string_lossy().into_owned();
        let next=collect(snapshot(&s).unwrap(),false,|_|Ok((vec![row("saved")],false))).unwrap();
        commit(&s,&root_text,0,next.clone()).unwrap();
        assert!(commit(&s,&root_text,0,next.clone()).is_err());
        assert!(commit(&s,&dir.join("other").to_string_lossy(),1,next).is_err());
        let before=read(&s,KEY).unwrap();
        assert!(collect(snapshot(&s).unwrap(),false,|_|Err(error("fixture network failure"))).is_err());
        assert_eq!(read(&s,KEY).unwrap(),before);drop(s);
        let reopened=Store::open(&root,false).unwrap();assert_eq!(snapshot(&reopened).unwrap().items[0].full_name,"fixture/saved");
    }
    #[test]fn append_uses_cursor_and_merges_existing_repositories(){let old=Snapshot{items:vec![row("existing")],next_page:5,has_more:true,..Default::default()};let next=collect(old,true,|page|{assert_eq!(page,5);Ok((vec![row("existing"),row("older")],false))}).unwrap();assert_eq!(next.items.len(),2);assert_eq!(next.next_page,6);}
    #[test]fn fetched_timestamp_is_separate_from_source_updated_at(){let (rows,more)=parse(br#"{"success":true,"page":1,"has_more":true,"data":[{"full_name":"owner/repo","title":"Demo","updated_at":"2026-10-09T12:00:00","clicks_total":20}]}"#,1).unwrap();assert_eq!(rows[0].updated_at,"2026-10-09T12:00:00+08:00");assert!(more);}
    #[test]#[ignore="public GET; no credentials; opt-in source integration"]fn live_public_source_and_avatar_are_readable(){let response=crate::news_http::fetch_github("https://api.hellogithub.com/v1/?sort_by=featured&page=1").unwrap();let(rows,more)=parse(&response.body,1).unwrap();assert!(!rows.is_empty());let image=crate::news_http::fetch_github(&format!("https://avatars.githubusercontent.com/{}?s=96",rows[0].full_name.split('/').next().unwrap())).unwrap();assert!(mime(&image.body).is_ok());println!("projects={} has_more={} avatar_bytes={}",rows.len(),more,image.body.len());}
}
