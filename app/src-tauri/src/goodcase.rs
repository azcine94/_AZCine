//! GoodCase public GET transport and local favorites. Source parsing stays in
//! goodcase-source.ts, following the approved standalone collector.
use crate::storage::StorageError;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn invalid() -> StorageError { StorageError::new("goodcase_request", "作品请求无效，已有内容保留。") }
fn storage_error() -> StorageError { StorageError::new("goodcase_storage", "作品收藏读取或保存失败，原记录保留。") }
fn valid_slug(slug:&str)->bool { !slug.is_empty() && slug.len()<=300 && slug.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_') }

fn source_url(route:&str)->Result<String,StorageError>{
    if !route.starts_with('/')||route.starts_with("//")||route.len()>512{return Err(invalid());}
    let url=url::Url::parse(&format!("https://goodcase.ai{route}")).map_err(|_|invalid())?;
    if url.host_str()!=Some("goodcase.ai")||url.fragment().is_some()||!url.username().is_empty(){return Err(invalid());}
    let pairs:Vec<_>=url.query_pairs().collect();
    let valid=match url.path(){
        "/"|"/models"|"/skills"|"/daily"=>pairs.is_empty(),
        "/creators"=>pairs.is_empty()||(pairs.len()==1&&pairs[0].0=="page"&&matches!(pairs[0].1.as_ref(),"2"|"3")),
        "/cases"=>{
            let category=pairs.iter().filter(|(k,_)|k=="filter").collect::<Vec<_>>();
            let page=pairs.iter().filter(|(k,_)|k=="page").collect::<Vec<_>>();
            let sort=pairs.iter().filter(|(k,_)|k=="sort").collect::<Vec<_>>();
            category.len()==1&&matches!(category[0].1.as_ref(),"video"|"image"|"web"|"hardware")
                &&page.len()==1&&page[0].1.parse::<u32>().is_ok_and(|n|n>0&&n<=999999)
                &&sort.len()<=1&&sort.iter().all(|(_,v)|matches!(v.as_ref(),"stability"|"latest"))
                &&pairs.len()==2+sort.len()
        },
        path if path.starts_with("/api/public/cases/")=>{
            let tail=path.trim_start_matches("/api/public/cases/");
            let slug=tail.strip_suffix("/retests").unwrap_or(tail);
            valid_slug(slug)&&pairs.len()==1&&pairs[0].0=="locale"&&pairs[0].1=="zh-CN"
        },
        _=>false,
    };
    if !valid{return Err(invalid());}Ok(url.to_string())
}

#[tauri::command]
pub async fn goodcase_fetch(window:tauri::WebviewWindow,route:String)->Result<String,StorageError>{
    crate::main_window(&window)?;
    let url=source_url(&route)?;
    tauri::async_runtime::spawn_blocking(move||{
        let response=crate::news_http::fetch_goodcase(&url)?;
        String::from_utf8(response.body).map_err(|_|StorageError::new("goodcase_encoding","GoodCase 返回了无法读取的内容，旧作品保留。"))
    }).await.map_err(|_|StorageError::new("goodcase_worker","作品读取任务中断，请重试。"))?
}

#[derive(Clone,Serialize,Deserialize,Default)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Favorites {revision:u64,items:Vec<Value>}
fn read(db:&rusqlite::Connection)->Result<Favorites,StorageError>{
    let value:Option<String>=db.query_row("SELECT value FROM app_meta WHERE key='goodcase_favorites_v1'",[],|r|r.get(0)).optional().map_err(|_|storage_error())?;
    value.map(|v|serde_json::from_str(&v).map_err(|_|storage_error())).unwrap_or(Ok(Favorites::default()))
}
#[tauri::command]
pub async fn goodcase_favorites(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String)->Result<Favorites,StorageError>{
    crate::main_window(&window)?;crate::with_storage(app,move|m|{let store=m.store()?;if store.root.to_string_lossy()!=root{return Err(storage_error());}read(&store.db)}).await
}
#[tauri::command]
pub async fn goodcase_favorite_save(app:tauri::AppHandle,window:tauri::WebviewWindow,root:String,item:Value,saved:bool,revision:u64)->Result<Favorites,StorageError>{
    crate::main_window(&window)?;
    let slug=item.get("slug").and_then(Value::as_str).filter(|s|valid_slug(s)).ok_or_else(invalid)?.to_owned();
    if !matches!(item.get("category").and_then(Value::as_str),Some("video"|"image"|"web"|"hardware"))||item.get("title").and_then(Value::as_str).is_none()||item.to_string().len()>1024*1024{return Err(invalid());}
    crate::with_storage(app,move|m|{
        let store=m.store()?;if store.root.to_string_lossy()!=root{return Err(storage_error());}
        let mut current=read(&store.db)?;
        if current.revision!=revision{return Err(StorageError::new("goodcase_conflict","收藏已发生变化，请重新读取收藏后再操作。"));}
        let index=current.items.iter().position(|x|x.get("slug").and_then(Value::as_str)==Some(slug.as_str()));
        if saved {if let Some(i)=index{current.items[i]=item;}else{current.items.push(item);}}
        else if let Some(i)=index{current.items.remove(i);}
        current.revision=current.revision.checked_add(1).ok_or_else(storage_error)?;
        let value=serde_json::to_string(&current).map_err(|_|storage_error())?;
        store.db.execute("INSERT INTO app_meta(key,value) VALUES('goodcase_favorites_v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[value]).map_err(|_|storage_error())?;
        Ok(current)
    }).await
}
