//! Explicit model-list GET only. No generation, retries, redirects or host credentials.
use crate::{pi_model_config::{ConfigError,validate_connection},pi_redactor::Redactor};
use serde::Deserialize;
use serde_json::{Value,json};
use url::Url;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ModelListInput { pub provider:String, pub base_url:String, pub api:String, pub api_key:Option<String> }
fn failure(code:&'static str,message:&'static str)->ConfigError { ConfigError{code,message} }
fn invalid()->ConfigError { failure("pi_model_list_invalid","服务商没有返回可识别的模型列表；请核对地址与接口类型，或手动填写模型ID。输入保留。") }
fn network()->ConfigError { failure("pi_model_list_network","模型列表请求失败，请检查网络、地址和TLS证书；输入保留，不自动重试。") }

pub fn fetch(input:ModelListInput)->Result<Value,ConfigError> {
    validate_connection(&input.base_url,&input.api,input.api_key.as_deref())?;
    let mut url=Url::parse(&input.base_url).map_err(|_|invalid())?;
    let base_path=url.path().trim_end_matches('/');
    let suffix=match input.api.as_str() {
        "anthropic-messages" if !base_path.ends_with("/v1") => "/v1/models",
        "google-generative-ai" if !base_path.ends_with("/v1") && !base_path.ends_with("/v1beta") => "/v1beta/models",
        _ => "/models",
    };
    let request_path=format!("{base_path}{suffix}"); url.set_path(&request_path);
    let mut headers="Accept: application/json\r\n".to_owned();
    if input.api=="anthropic-messages" { headers.push_str("anthropic-version: 2023-06-01\r\n"); }
    if let Some(key)=input.api_key.as_deref().filter(|s|!s.is_empty()) {
        let header=match input.api.as_str(){"anthropic-messages"=>format!("x-api-key: {key}\r\n"),"google-generative-ai"=>format!("x-goog-api-key: {key}\r\n"),_=>format!("Authorization: Bearer {key}\r\n")};
        headers.push_str(&header);
    }
    let mut models=Vec::new(); let mut seen=std::collections::HashSet::new(); let mut truncated=false;
    let mut cursors=std::collections::HashSet::new();
    #[cfg(windows)]
    let deadline=std::time::Instant::now()+std::time::Duration::from_secs(45);
    for page in 0..5 {
        if input.api=="anthropic-messages" { url.query_pairs_mut().append_pair("limit","1000"); }
        if input.api=="google-generative-ai" { url.query_pairs_mut().append_pair("pageSize","1000"); }
        #[cfg(windows)]
        let body=windows_http::get(&url,&headers,deadline)?;
        #[cfg(not(windows))]
        let body:Vec<u8>={return Err(failure("pi_model_list_platform","模型列表获取目前仅接入Windows桌面版。"));};
        let response:Value=serde_json::from_slice(&body).map_err(|_|invalid())?;
        let rows=response.get(if input.api=="google-generative-ai"{"models"}else{"data"}).and_then(Value::as_array).ok_or_else(invalid)?;
        for row in rows {
            if input.api=="google-generative-ai" && !row.get("supportedGenerationMethods").and_then(Value::as_array).is_some_and(|v|v.iter().any(|v|v=="generateContent")) {continue;}
            let id=row.get(if input.api=="google-generative-ai"{"name"}else{"id"}).and_then(Value::as_str).ok_or_else(invalid)?;
            let id=if input.api=="google-generative-ai"{id.strip_prefix("models/").unwrap_or(id)}else{id};
            if id.is_empty()||id.len()>1000||id.chars().any(char::is_control) {return Err(invalid());}
            if !seen.insert(id.to_owned()) {continue;}
            let name=row.get("display_name").or_else(||row.get("displayName")).or_else(||row.get("name")).and_then(Value::as_str).filter(|s|s.len()<=2000).unwrap_or(id);
            let number=|field:&str|row.get(field).and_then(Value::as_u64).filter(|v|*v>0&&*v<=9_007_199_254_740_991);
            models.push(json!({"id":id,"name":name,"contextWindow":number("inputTokenLimit").or_else(||number("max_input_tokens")).or_else(||number("context_length")),
                "maxTokens":number("outputTokenLimit").or_else(||number("max_tokens")).or_else(||row.get("top_provider").and_then(|v|v.get("max_completion_tokens")).and_then(Value::as_u64).filter(|v|*v>0&&*v<=9_007_199_254_740_991)),
                "supportsImages":row.get("capabilities").and_then(|c|c.get("image_input")).and_then(|c|c.get("supported")).and_then(Value::as_bool).or_else(||row.get("architecture").and_then(|v|v.get("input_modalities")).and_then(Value::as_array).map(|v|v.iter().any(|v|v=="image")))}));
            if models.len()>=2000 {truncated=true;break;}
        }
        if truncated {break;}
        let cursor=if input.api=="google-generative-ai"{response.get("nextPageToken").and_then(Value::as_str)}
            else if response.get("has_more").and_then(Value::as_bool)==Some(true){Some(response.get("last_id").and_then(Value::as_str).filter(|s|!s.is_empty()).ok_or_else(invalid)?)}else{None};
        if let Some(cursor)=cursor.filter(|s|!s.is_empty()) {
            if cursor.len()>4096||!cursors.insert(cursor.to_owned()){return Err(invalid());}
            if page==4 {truncated=true;break;}
            url.set_query(None); url.query_pairs_mut().append_pair(if input.api=="google-generative-ai"{"pageToken"}else{"after_id"},cursor);
        }else{break;}
    }
    let mut redactor=Redactor::default(); if let Some(key)=input.api_key.as_deref(){redactor.add(key);}
    Ok(redactor.value(json!({"models":models,"truncated":truncated}),false))
}

#[cfg(windows)]
mod windows_http {
    use super::*;
    use std::{ffi::c_void,time::Instant};
    use windows::{core::{PCWSTR,w},Win32::Networking::WinHttp::*};
    struct Handle(*mut c_void);
    impl Handle { fn new(ptr:*mut c_void)->Result<Self,ConfigError>{if ptr.is_null(){Err(network())}else{Ok(Self(ptr))}} }
    impl Drop for Handle {fn drop(&mut self){unsafe{let _=WinHttpCloseHandle(self.0);}}}
    fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
    fn option(handle:&Handle,key:u32,value:u32)->Result<(),ConfigError>{unsafe{WinHttpSetOption(Some(handle.0.cast_const()),key,Some(&value.to_ne_bytes()))}.map_err(|_|network())}
    fn timeout(handle:&Handle,deadline:Instant)->Result<(),ConfigError>{
        let ms=deadline.checked_duration_since(Instant::now()).filter(|d|!d.is_zero()).ok_or_else(||failure("pi_model_list_timeout","获取模型列表超时，输入保留，可手动重试。"))?.as_millis().clamp(1,10000) as i32;
        unsafe{WinHttpSetTimeouts(handle.0,ms,ms,ms,ms)}.map_err(|_|network())
    }
    pub fn get(url:&Url,headers:&str,deadline:Instant)->Result<Vec<u8>,ConfigError>{
        let session=Handle::new(unsafe{WinHttpOpen(w!("AZCine model list"),WINHTTP_ACCESS_TYPE_NO_PROXY,PCWSTR::null(),PCWSTR::null(),0)})?;
        option(&session,WINHTTP_OPTION_DISABLE_GLOBAL_POOLING,1)?; timeout(&session,deadline)?;
        let host=wide(url.host_str().ok_or_else(invalid)?.trim_matches(['[',']']));
        let connection=Handle::new(unsafe{WinHttpConnect(session.0,PCWSTR(host.as_ptr()),url.port_or_known_default().ok_or_else(invalid)?,0)})?;
        let path=wide(&format!("{}{}",url.path(),url.query().map(|q|format!("?{q}")).unwrap_or_default()));
        let flags=if url.scheme()=="https"{WINHTTP_FLAG_SECURE}else{WINHTTP_OPEN_REQUEST_FLAGS(0)};
        let request=Handle::new(unsafe{WinHttpOpenRequest(connection.0,w!("GET"),PCWSTR(path.as_ptr()),PCWSTR::null(),PCWSTR::null(),std::ptr::null(),flags)})?;
        option(&request,WINHTTP_OPTION_DISABLE_FEATURE,WINHTTP_DISABLE_REDIRECTS|WINHTTP_DISABLE_COOKIES|WINHTTP_DISABLE_AUTHENTICATION)?;
        option(&request,WINHTTP_OPTION_DECOMPRESSION,WINHTTP_DECOMPRESSION_FLAG_GZIP|WINHTTP_DECOMPRESSION_FLAG_DEFLATE)?;
        timeout(&request,deadline)?; let headers:Vec<u16>=headers.encode_utf16().collect();
        unsafe{WinHttpSendRequest(request.0,Some(&headers),None,0,0,0)}.map_err(|_|network())?;
        timeout(&request,deadline)?; unsafe{WinHttpReceiveResponse(request.0,std::ptr::null_mut())}.map_err(|_|network())?;
        let mut status=0u32; let mut length=4;
        unsafe{WinHttpQueryHeaders(request.0,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,PCWSTR::null(),Some((&mut status as *mut u32).cast()),&mut length,std::ptr::null_mut())}.map_err(|_|network())?;
        if !(200..300).contains(&status){return Err(match status {
            401|403=>failure("pi_model_list_auth","服务商拒绝认证，请检查Key与访问权限；输入保留。"),
            404|405=>failure("pi_model_list_unsupported","此地址没有提供该类型的模型列表接口；请核对API地址与类型，或手动填写模型ID。"),
            300..=399=>failure("pi_model_list_redirect","服务商要求重定向，请填写最终API地址；不会转发Key到新地址。"),
            _=>failure("pi_model_list_http","服务商暂未成功返回模型清单；输入保留，可手动重试。")});}
        let mut body=Vec::new(); let mut buffer=[0u8;16384];
        loop{timeout(&request,deadline)?;let mut count=0;unsafe{WinHttpReadData(request.0,buffer.as_mut_ptr().cast(),buffer.len() as u32,&mut count)}.map_err(|_|network())?;
            if count==0{break;} if body.len()+count as usize>2*1024*1024{return Err(failure("pi_model_list_large","模型列表超过2MiB，已停止读取；输入保留。"));}body.extend_from_slice(&buffer[..count as usize]);}
        Ok(body)
    }
}
