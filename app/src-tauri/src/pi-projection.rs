//! In-memory projection of official RPC events. Persisted native sessions remain
//! the source of history; no second conversation database or provider API client.
use serde_json::{Value, json};
use serde::Serialize;
const MAX_MESSAGES: usize = 20000;
const MAX_BLOCKS: usize = 4096;
const MAX_TOOLS: usize = 10000;
const MAX_VALUE_BYTES: usize = crate::pi_image_limits::MAX_IMAGE_RPC_BYTES;
const MAX_HISTORY_BYTES: usize = crate::pi_image_limits::MAX_IMAGE_HISTORY_BYTES;
fn value_bytes(v:&Value)->usize{match v{Value::String(s)=>s.len(),Value::Array(a)=>a.iter().fold(0usize,|n,v|n.saturating_add(value_bytes(v))),Value::Object(o)=>o.iter().fold(0usize,|n,(k,v)|n.saturating_add(k.len()).saturating_add(value_bytes(v))),_=>8}}
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Projection {
    pub messages: Vec<Value>, pub partial: Option<Value>, pub tools: Vec<Value>,
    pub steering: Vec<String>, pub follow_up: Vec<String>, pub activity: String,
    pub outcome: String, pub notice: Option<String>,
    #[serde(skip)] run_start: usize,
    #[serde(skip)] last_assistant: Option<Value>,
    #[serde(skip)] pub overflowed: bool,
    #[serde(skip)] history_bytes: usize,
}
impl Default for Projection {
    fn default()->Self { Self{messages:vec![],partial:None,tools:vec![],steering:vec![],follow_up:vec![],activity:"idle".into(),outcome:"none".into(),notice:None,run_start:0,last_assistant:None,overflowed:false,history_bytes:0} }
}
fn text(value:&Value)->Option<&str>{value.as_str()}
fn key<'a>(v:&'a Value,k:&str)->Option<&'a str>{v.get(k).and_then(text)}
fn copy_fields(out:&mut Value,v:&Value,fields:&[&str]) { for name in fields {if let Some(value)=v.get(name){out[*name]=value.clone();}} }
fn strings(v:Option<&Value>)->Option<Vec<String>> {v?.as_array()?.iter().map(|v|v.as_str().map(str::to_owned)).collect()}
/// Remove credential-bearing structured fields; never include provider headers,
/// resolved credentials, signatures, raw model objects or arbitrary metadata.
fn scrub(value:&Value,depth:usize)->Value {
    if depth>24 {return json!("[结构过深，未展开]");}
    match value {
        Value::Object(map)=>Value::Object(map.iter().filter(|(k,_)| !matches!(k.to_ascii_lowercase().replace(['_','-'],"").as_str(),"apikey"|"authorization"|"accesstoken"|"refreshtoken"|"password"|"secret"|"headers"|"thinkingsignature"|"thoughtsignature"|"textsignature")).map(|(k,v)|(k.clone(),scrub(v,depth+1))).collect()),
        Value::Array(items) if items.len()>MAX_BLOCKS=>json!("[数组超过界面展开上限，完整原文仍在原生会话中]"),
        Value::Array(items)=>Value::Array(items.iter().map(|v|scrub(v,depth+1)).collect()),
        _=>value.clone(),
    }
}
fn content(value:Option<&Value>)->Value {
    let Some(value)=value else{return Value::Null;};
    if value.is_string(){return value.clone();}
    let Some(blocks)=value.as_array() else{return Value::Null;};
    if blocks.len()>MAX_BLOCKS{return json!([{"type":"text","text":"[消息块超过界面展开上限，完整原文仍在原生会话中]"}]);}
    Value::Array(blocks.iter().map(|block|match key(block,"type") {
        Some("text")=>json!({"type":"text","text":block.get("text").and_then(text)}),
        Some("thinking")=>json!({"type":"thinking","thinking":block.get("thinking").and_then(text),"redacted":block.get("redacted").and_then(Value::as_bool)}),
        Some("image")=>image_preview(block).unwrap_or_else(||json!({"type":"image","mimeType":block.get("mimeType").and_then(text)})),
        Some("toolCall")=>json!({"type":"toolCall","id":block.get("id").and_then(text),"name":block.get("name").and_then(text),"arguments":scrub(block.get("arguments").unwrap_or(&Value::Null),0)}),
        _=>json!({"type":"unknown"}),
    }).collect())
}
// Application display metadata only. Preserve the native sub-call outcome
// without exposing arbitrary details, arguments, results or credentials.
fn nested_calls(value:&Value)->Option<Value> {
    let calls=value.get("details")?.get("calls")?.as_array()?;
    if calls.len()>MAX_BLOCKS{return Some(json!([{"name":"子调用记录过多，未展开","status":"incomplete"}]));}
    Some(Value::Array(calls.iter().map(|call|{
        json!({"name":key(call,"name").unwrap_or("未记录子调用名称"),"status":key(call,"status").unwrap_or("incomplete")})
    }).collect()))
}
fn tool_output(value:&Value)->Value {
    let mut result=json!({"content":content(value.get("content"))});
    if let Some(calls)=nested_calls(value){result["calls"]=calls;}
    result
}
pub(crate) fn image_preview(block:&Value)->Option<Value>{
    let mime=key(block,"mimeType")?;let data=key(block,"data")?;
    if !crate::pi_image_limits::image_encoded_size_allowed(data){return None;}
    let mut header=Vec::new();let mut accumulator=0u32;let mut bits=0;
    for c in data.bytes().take(24){let n=match c{b'A'..=b'Z'=>c-b'A',b'a'..=b'z'=>c-b'a'+26,b'0'..=b'9'=>c-b'0'+52,b'+'=>62,b'/'=>63,b'='=>break,_=>return None};accumulator=(accumulator<<6)|u32::from(n);bits+=6;if bits>=8{bits-=8;header.push((accumulator>>bits) as u8);}}
    let valid=match mime{"image/png"=>header.starts_with(b"\x89PNG\r\n\x1a\n"),"image/jpeg"=>header.starts_with(b"\xff\xd8\xff"),"image/gif"=>header.starts_with(b"GIF87a")||header.starts_with(b"GIF89a"),"image/webp"=>header.starts_with(b"RIFF")&&header.get(8..12)==Some(b"WEBP"),_=>false};
    if !valid||!data.bytes().all(|c|c.is_ascii_alphanumeric()||matches!(c,b'+'|b'/'|b'=')){return None;}
    Some(json!({"type":"image","mimeType":mime,"data":data}))
}
#[cfg(test)]
#[test]
fn raster_preview_rejects_mime_spoofing_and_nonimage_secret_payloads(){
    let data="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZmcAAAAASUVORK5CYII=";
    assert!(image_preview(&json!({"mimeType":"image/png","data":data})).is_some());
    for mime in ["image/svg+xml","image/jpeg","text/html"]{assert!(image_preview(&json!({"mimeType":mime,"data":data})).is_none());}
    assert!(image_preview(&json!({"mimeType":"image/png","data":"fixture-secret-data"})).is_none());
}
pub fn message(value:&Value)->Value {
    let role=key(value,"role").unwrap_or("unknown");let mut result=json!({"role":role});
    match role {
        "user"|"assistant"|"toolResult"|"system"|"custom"=>{
            result["content"]=content(value.get("content"));
            copy_fields(&mut result,value,&["timestamp"]);
            match role {
                "assistant"=>{
                    copy_fields(&mut result,value,&["stopReason","provider","model"]);
                    if value.get("errorMessage").and_then(text).is_some_and(|s|!s.is_empty()) {result["errorMessage"]=json!("模型请求未完成。请检查本应用的模型配置、额度与网络；原始诊断未回传，以免暴露认证信息。");}
                },
                "toolResult"=>{copy_fields(&mut result,value,&["toolCallId","toolName","isError"]);if let Some(calls)=nested_calls(value){result["calls"]=calls;}},
                "custom"=>copy_fields(&mut result,value,&["customType","display"]),
                _=>{},
            }
        },
        "bashExecution"=>copy_fields(&mut result,value,&["command","output","exitCode","cancelled","truncated","excludeFromContext","timestamp"]),
        "branchSummary"|"compactionSummary"=>copy_fields(&mut result,value,&["summary","timestamp"]),
        _=>{result["content"]=json!("此原生消息类型尚未展开，原文仍保存在本应用会话中。");},
    }
    result
}
pub fn model(value:&Value)->Option<Value> {
    if key(value,"id")==Some("unknown") && key(value,"provider")==Some("unknown") && key(value,"api")==Some("unknown") && key(value,"baseUrl")==Some("") && value.get("reasoning").and_then(Value::as_bool)==Some(false) && value.get("input").and_then(Value::as_array).is_some_and(Vec::is_empty) && value.get("contextWindow").and_then(Value::as_u64)==Some(0) && value.get("maxTokens").and_then(Value::as_u64)==Some(0) {return Some(Value::Null);}
    let mut out=json!({});
    for name in ["id","name","provider","api"] {let v=key(value,name)?;if v.trim().is_empty(){return None;}out[name]=json!(v);}
    for name in ["contextWindow","maxTokens"] {let n=value.get(name)?.as_u64()?;if n==0 || n>9_007_199_254_740_991{return None;}out[name]=json!(n);}
    out["reasoning"]=json!(value.get("reasoning")?.as_bool()?);
    let input=value.get("input")?.as_array()?;if !input.iter().all(|v|matches!(v.as_str(),Some("text"|"image"))){return None;}out["input"]=json!(input);Some(out)
}
pub fn state(value:&Value)->Option<Value> {
    let id=key(value,"sessionId")?;if id.is_empty(){return None;}
    let mut out=json!({"sessionId":id});
    for name in ["sessionFile","sessionName"]{match value.get(name){None|Some(Value::Null)=>{out[name]=Value::Null;},Some(Value::String(s)) if !s.is_empty()=>{out[name]=json!(s);},_=>return None}}
    out["thinkingLevel"]=json!(key(value,"thinkingLevel")?);
    for name in ["isStreaming","isCompacting"]{out[name]=json!(value.get(name)?.as_bool()?);}
    for name in ["pendingMessageCount","messageCount"]{let n=value.get(name)?.as_u64()?;if n>9_007_199_254_740_991{return None;}out[name]=json!(n);}
    out["model"]=match value.get("model"){None|Some(Value::Null)=>Value::Null,Some(m)=>model(m)?};Some(out)
}
fn assistant_outcome(message:Option<&Value>)->&'static str {
    let Some(m)=message else{return "incomplete";};
    if key(m,"role")!=Some("assistant"){return "incomplete";}
    match key(m,"stopReason"){
        Some("aborted")=>"interrupted",
        Some("error")=>"error",
        _ if key(m,"errorMessage").is_some_and(|s|!s.is_empty())=>"error",
        Some("stop") if m.get("content").and_then(Value::as_array).is_some_and(|a|a.iter().any(|b|key(b,"type")==Some("text") && key(b,"text").is_some_and(|s|!s.trim().is_empty())))=>"success",
        _=>"incomplete",
    }
}
impl Projection {
    pub fn submitted(&mut self) {
        if self.activity=="idle" {self.last_assistant=None;self.outcome="none".into();self.run_start=self.messages.len();self.activity="starting".into();}
    }
    pub fn restore(&mut self,messages:&Value)->bool {
        let Some(messages)=messages.as_array() else{return false;};let size=messages.iter().fold(0usize,|n,v|n.saturating_add(value_bytes(v)));
        if messages.len()>MAX_MESSAGES||size>MAX_HISTORY_BYTES||messages.iter().any(|m|m.get("content").and_then(Value::as_array).is_some_and(|b|b.len()>MAX_BLOCKS)){return false;}
        self.history_bytes=size;self.overflowed=false;
        self.messages=messages.iter().map(message).collect();self.partial=None;self.tools.clear();self.run_start=self.messages.len();self.last_assistant=None;true
    }
    pub fn stopping(&mut self){self.activity="stopping".into();}
    pub fn interrupted(&mut self,notice:&str){
        self.activity="idle".into();self.outcome="interrupted".into();self.notice=Some(notice.into());
        for tool in &mut self.tools {if tool["status"]=="running"{tool["status"]=json!("interrupted");}}
        if let Some(partial)=self.partial.as_mut(){partial["stopReason"]=json!("aborted");}
    }
    fn limit(&mut self)->bool{self.overflowed=true;self.activity="idle".into();self.outcome="incomplete".into();self.notice=Some("会话内容超过界面读取上限，已停止接收，不会截断后假报完整；原生会话文件保留。".into());false}
    pub fn event(&mut self,event:&Value)->bool {
        if self.overflowed{return false;}
        if value_bytes(event)>MAX_VALUE_BYTES{return self.limit();}
        match key(event,"type") {
            Some("agent_start")=>{if self.activity=="idle"{self.run_start=self.messages.len();self.last_assistant=None;self.outcome="none".into();}self.activity="running".into();},
            Some("message_start")=>{if key(&event["message"],"role")==Some("assistant"){self.partial=Some(message(&event["message"]));}},
            Some("session_info_changed")=>{}, 
            Some("message_update")=>{if !self.delta(&event["assistantMessageEvent"]){self.notice=Some("收到未识别的消息片段，等待原版完整消息核对。".into());}},
            Some("message_end")=>{
                let bytes=value_bytes(&event["message"]);
                if !event["message"].is_object() || self.messages.len()>=MAX_MESSAGES||self.history_bytes.saturating_add(bytes)>MAX_HISTORY_BYTES||event["message"]["content"].as_array().is_some_and(|b|b.len()>MAX_BLOCKS){return self.limit();}
                self.history_bytes+=bytes;
                let m=message(&event["message"]);if key(&m,"role")==Some("assistant"){self.partial=None;self.last_assistant=Some(m.clone());}self.messages.push(m);
            },
            Some("tool_execution_start"|"tool_execution_update"|"tool_execution_end")=>{
                let Some(id)=key(event,"toolCallId") else{return false;};let pos=self.tools.iter().position(|t|key(t,"id")==Some(id));
                let pos=match pos{Some(p)=>p,None=>{if self.tools.len()>=MAX_TOOLS{return self.limit();}self.tools.push(json!({"id":id,"name":key(event,"toolName").unwrap_or("未知工具"),"status":"running"}));self.tools.len()-1}};
                let t=&mut self.tools[pos];
                match key(event,"type") {
                    Some("tool_execution_end")=>{t["status"]=json!(match event.get("isError").and_then(Value::as_bool){Some(true)=>"error",Some(false)=>"finished",None=>"incomplete"});t["result"]=tool_output(&event["result"]);},
                    _=>{t["args"]=scrub(&event["args"],0);if let Some(r)=event.get("partialResult"){t["result"]=tool_output(r);}},
                }
            },
            Some("queue_update")=>{let Some(steering)=strings(event.get("steering"))else{return false;};let Some(follow_up)=strings(event.get("followUp"))else{return false;};self.steering=steering;self.follow_up=follow_up;},
            Some("compaction_start")=>{self.activity="compacting".into();},
            Some("compaction_end")=>{self.activity="running".into();if event.get("errorMessage").is_some(){self.notice=Some("原生上下文压缩失败，未当作成功；请核对会话。".into());}},
            Some("agent_settled")=>{self.activity="idle".into();self.outcome=assistant_outcome(self.last_assistant.as_ref()).into();},
            Some("azcine_transport_error")=>{self.interrupted("Pi 连接中断，输入和已有消息保留；未确认请求不会自动重发。");},
            Some("extension_error")=>{self.notice=Some("原生扩展报错，未把异常当作成功；请核对本应用独立资源。".into());},
            Some("agent_end"|"turn_start"|"turn_end"|"entry_appended"|"thinking_level_changed")=>{},
            Some("auto_retry_start"|"summarization_retry_scheduled"|"summarization_retry_attempt_start")=>{self.activity="running".into();self.notice=Some("原生配置正在重试，尚未完成。".into());},
            Some("auto_retry_end"|"summarization_retry_finished")=>{},
            Some("extension_ui_request")=>{self.notice=Some("原生扩展请求界面交互，完整响应界面在资源阶段接入；可停止当前运行。".into());},
            _=>return false,
        }
        if self.partial.as_ref().is_some_and(|p|value_bytes(p)>MAX_VALUE_BYTES){return self.limit();}
        true
    }
    fn delta(&mut self,event:&Value)->bool {
        let Some(kind)=key(event,"type")else{return false;};
        let Some(index)=event.get("contentIndex").and_then(Value::as_u64).filter(|n|*n<MAX_BLOCKS as u64).map(|n|n as usize)else{return false;};
        let Some(partial)=self.partial.as_mut()else{return false;};let Some(blocks)=partial.get_mut("content").and_then(Value::as_array_mut)else{return false;};
        while blocks.len()<=index{blocks.push(json!({"type":"unknown"}));}
        let block=&mut blocks[index];
        match kind {
            "text_start"=>*block=json!({"type":"text","text":""}),
            "thinking_start"=>*block=json!({"type":"thinking","thinking":""}),
            "toolcall_start"=>*block=json!({"type":"toolCall","id":key(event,"id"),"name":key(event,"toolName"),"arguments":{},"argumentText":""}),
            "text_delta"|"thinking_delta"|"toolcall_delta"=>{let Some(delta)=key(event,"delta")else{return false;};let field=match kind{"text_delta"=>"text","thinking_delta"=>"thinking",_=>"argumentText"};let Some(old)=block.get(field).and_then(Value::as_str).map(str::to_owned)else{return false;};block[field]=json!(old+delta);},
            "text_end"|"thinking_end"=>{let Some(value)=key(event,"content")else{return false;};block[if kind=="text_end"{"text"}else{"thinking"}]=json!(value);},
            "toolcall_end"=>{let v=&event["toolCall"];*block=json!({"type":"toolCall","id":key(v,"id"),"name":key(v,"name"),"arguments":scrub(&v["arguments"],0)});},
            _=>return false,
        }true
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn given_streaming_delta_when_final_message_arrives_then_replace_partial_and_wait_for_settled(){
        let mut p=Projection::default();p.event(&json!({"type":"agent_start"}));p.event(&json!({"type":"message_start","message":{"role":"assistant","content":[],"stopReason":"pending"}}));
        p.event(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}));p.event(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"中文\u{2028}片段"}}));assert_eq!(p.partial.as_ref().unwrap()["content"][0]["text"],"中文\u{2028}片段");
        p.event(&json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"最终原文"}],"stopReason":"stop"}}));assert!(p.partial.is_none());assert_eq!(p.outcome,"none");p.event(&json!({"type":"agent_end","willRetry":false}));assert_eq!(p.outcome,"none");p.event(&json!({"type":"agent_settled"}));assert_eq!(p.outcome,"success");assert_eq!(p.messages[0]["content"][0]["text"],"最终原文");
        p.event(&json!({"type":"agent_start"}));p.event(&json!({"type":"agent_settled"}));assert_eq!(p.outcome,"incomplete");
    }
    #[test]
    fn given_error_abort_length_empty_when_settled_then_never_fake_success(){
        for (stop,text,expected) in [("aborted","partial","interrupted"),("error","partial","error"),("length","partial","incomplete"),("stop","","incomplete"),("deferred","partial","incomplete")] {let mut p=Projection::default();p.event(&json!({"type":"agent_start"}));p.event(&json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":text}],"stopReason":stop}}));p.event(&json!({"type":"agent_settled"}));assert_eq!(p.outcome,expected);}
    }
    #[test]
    fn given_credentials_or_unknown_metadata_when_projecting_then_not_returned(){
        let v=message(&json!({"role":"assistant","content":[{"type":"text","text":"<img onerror=evil>文字","textSignature":"secret-fixture"},{"type":"image","data":"secret-fixture","mimeType":"image/png"},{"type":"toolCall","id":"id","name":"read","arguments":{"path":"own","headers":{"Authorization":"secret-fixture"},"api_key":"secret-fixture"}}],"errorMessage":"secret-fixture","headers":{"Authorization":"secret-fixture"},"stopReason":"error"}));assert!(!v.to_string().contains("secret-fixture"));assert!(v.to_string().contains("<img onerror=evil>"));
    }
    #[test]
    fn given_tool_updates_and_queues_when_stopping_then_partial_replaced_and_running_not_finished(){let mut p=Projection::default();for (kind,text) in [("tool_execution_start",""),("tool_execution_update","a"),("tool_execution_update","ab")] {p.event(&json!({"type":kind,"toolCallId":"one","toolName":"bash","args":{},"partialResult":{"content":[{"type":"text","text":text}]}}));}assert_eq!(p.tools.len(),1);assert_eq!(p.tools[0]["result"]["content"][0]["text"],"ab");p.event(&json!({"type":"queue_update","steering":["中文"],"followUp":["later"]}));p.interrupted("停止");assert_eq!(p.tools[0]["status"],"interrupted");assert_eq!(p.steering,vec!["中文"]);assert_eq!(p.follow_up,vec!["later"]);}
}
