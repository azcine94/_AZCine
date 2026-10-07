//! Only documented upstream RPC UI records; never generic command forwarding.
use crate::pi_manager::PiError;
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::{collections::BTreeMap,time::{Duration,Instant}};
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct UiRequest{pub id:String,pub method:String,pub title:String,pub message:String,pub options:Vec<String>,pub placeholder:String,pub prefill:String,pub status:String,pub expires_at:Option<String>,#[serde(skip)]deadline:Option<Instant>}
#[derive(Default,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ExtensionUi{pub requests:Vec<UiRequest>,pub notifications:Vec<Value>,pub statuses:BTreeMap<String,String>,pub widgets:BTreeMap<String,Value>,pub title:Option<String>,pub editor:Option<Value>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct UiResponse{pub generation:u64,pub session_id:String,pub id:String,pub cancelled:bool,pub value:Option<String>,pub confirmed:Option<bool>}
fn text(v:&Value,key:&str)->String{v[key].as_str().unwrap_or("").chars().take(100_000).collect()}
impl ExtensionUi{
    pub fn event(&mut self,event:&Value)->Option<Value>{
        let id=text(event,"id");let method=text(event,"method");if id.is_empty(){return None;}
        match method.as_str(){
            "select"|"confirm"|"input"|"editor"=>{
                if self.requests.iter().any(|r|r.id==id){return None;}
                self.requests.retain(|r|r.status=="pending");
                let oversized=["id","title","message","placeholder","prefill"].iter().any(|key|event[*key].as_str().is_some_and(|v|v.chars().count()>100_000));
                let invalid_options=method=="select"&&event["options"].as_array().is_none_or(|a|a.is_empty()||a.len()>1000||a.iter().any(|v|v.as_str().is_none_or(|s|s.chars().count()>100_000)));
                if self.requests.len()>=64||oversized||invalid_options{
                    self.notifications.push(json!({"id":id,"message":"扩展问题超出界面支持范围，已取消本次提问；原任务与输入保留。","tone":"warning"}));
                    if self.notifications.len()>32{self.notifications.remove(0);}
                    return Some(json!({"type":"extension_ui_response","id":event["id"],"cancelled":true}));
                }
                let timeout=event["timeout"].as_u64().filter(|n|*n>0).map(|n|Duration::from_millis(n.min(86_400_000)));
                let expires_at=timeout.map(|d|(chrono::Utc::now()+chrono::Duration::milliseconds(d.as_millis() as i64)).to_rfc3339());
                self.requests.push(UiRequest{id,method,title:text(event,"title"),message:text(event,"message"),options:event["options"].as_array().map(|a|a.iter().filter_map(Value::as_str).take(1000).map(str::to_owned).collect()).unwrap_or_default(),placeholder:text(event,"placeholder"),prefill:text(event,"prefill"),status:"pending".into(),expires_at,deadline:timeout.map(|d|Instant::now()+d)});
            },
            "notify"=>{self.notifications.push(json!({"id":id,"message":text(event,"message"),"tone":event["notifyType"].as_str().filter(|v|matches!(*v,"info"|"warning"|"error")).unwrap_or("info")}));if self.notifications.len()>32{self.notifications.remove(0);}},
            "setStatus"=>{let key=text(event,"statusKey");if event["statusText"].is_null(){self.statuses.remove(&key);}else if self.statuses.len()<64||self.statuses.contains_key(&key){self.statuses.insert(key,text(event,"statusText"));}},
            "setWidget"=>{let key=text(event,"widgetKey");if event["widgetLines"].is_null(){self.widgets.remove(&key);}else if self.widgets.len()<64||self.widgets.contains_key(&key){let lines=event["widgetLines"].as_array().map(|a|a.iter().filter_map(Value::as_str).take(100).map(|s|s.chars().take(2000).collect::<String>()).collect::<Vec<_>>()).unwrap_or_default();self.widgets.insert(key,json!({"lines":lines,"placement":if event["widgetPlacement"]=="belowEditor"{"belowEditor"}else{"aboveEditor"}}));}},
            "setTitle"=>self.title=Some(text(event,"title")),
            "set_editor_text"=>self.editor=Some(json!({"id":id,"text":text(event,"text")})),
            _=>{},
        }
        None
    }
    pub fn expire(&mut self)->bool{let mut changed=false;for r in &mut self.requests{if r.status=="pending"&&r.deadline.is_some_and(|d|Instant::now()>=d){r.status="expired".into();changed=true;}}changed}
    pub fn waiting(&self)->bool{self.requests.iter().any(|r|r.status=="pending")}
    pub fn cancel_all(&mut self)->Vec<Value>{self.requests.iter_mut().filter(|r|r.status=="pending").map(|r|{r.status="cancelled".into();json!({"type":"extension_ui_response","id":r.id,"cancelled":true})}).collect()}
    pub fn response(&mut self,input:&UiResponse)->Result<Value,PiError>{
        self.expire();
        let r=self.requests.iter().find(|r|r.id==input.id&&r.status=="pending").ok_or_else(||PiError::new("pi_ui_stale","扩展问题已经结束、超时或属于其他会话；输入保留。"))?;
        let mut value=json!({"type":"extension_ui_response","id":r.id});
        if input.cancelled{value["cancelled"]=json!(true);return Ok(value);}
        if r.method=="confirm"{if input.value.is_some(){return Err(PiError::new("pi_ui_invalid","此问题需要确认选项。"));}value["confirmed"]=json!(input.confirmed.ok_or_else(||PiError::new("pi_ui_invalid","请选择确认或拒绝。"))?);}
        else{if input.confirmed.is_some(){return Err(PiError::new("pi_ui_invalid","此问题需要文字回答。"));}let answer=input.value.as_ref().filter(|v|v.chars().count()<=100_000).ok_or_else(||PiError::new("pi_ui_invalid","扩展回答无效或超出长度，输入保留。"))?;if r.method=="select"&&!r.options.contains(answer){return Err(PiError::new("pi_ui_invalid","请选择扩展给出的选项。"));}value["value"]=json!(answer);}
        Ok(value)
    }
    pub fn answered(&mut self,id:&str){if let Some(r)=self.requests.iter_mut().find(|r|r.id==id){r.status="answered".into();}}
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn oversized_dialog_is_cancelled_with_original_id_without_silent_truncation(){let mut ui=ExtensionUi::default();let event=json!({"id":"original-id","method":"editor","prefill":"长".repeat(100001)});assert_eq!(ui.event(&event).unwrap(),json!({"type":"extension_ui_response","id":"original-id","cancelled":true}));assert!(!ui.waiting());assert_eq!(ui.notifications.len(),1);}
 #[test]fn excess_pending_questions_are_explicitly_cancelled_instead_of_hanging(){let mut ui=ExtensionUi::default();for id in 0..64{assert!(ui.event(&json!({"id":id.to_string(),"method":"input"})).is_none());}assert_eq!(ui.event(&json!({"id":"excess","method":"select","options":["继续"]})).unwrap()["cancelled"],true);assert_eq!(ui.requests.len(),64);}

 fn response(id:&str)->UiResponse{UiResponse{generation:1,session_id:"fixture".into(),id:id.into(),cancelled:false,value:Some("继续".into()),confirmed:None}}
 #[test]fn response_matches_pending_id_and_exact_select_option(){let mut ui=ExtensionUi::default();ui.event(&json!({"id":"one","method":"select","title":"测试","options":["继续","停止"]}));assert_eq!(ui.response(&response("other")).unwrap_err().code,"pi_ui_stale");let mut bad=response("one");bad.value=Some("自行增加".into());assert_eq!(ui.response(&bad).unwrap_err().code,"pi_ui_invalid");assert_eq!(ui.response(&response("one")).unwrap()["value"],"继续");ui.answered("one");assert_eq!(ui.response(&response("one")).unwrap_err().code,"pi_ui_stale");}
 #[test]fn timeout_and_cancel_release_pending_state_without_success(){let mut ui=ExtensionUi::default();ui.event(&json!({"id":"one","method":"input","timeout":10}));ui.requests[0].deadline=Some(Instant::now()-Duration::from_secs(1));assert!(ui.expire());assert!(!ui.waiting());assert_eq!(ui.response(&response("one")).unwrap_err().code,"pi_ui_stale");ui.event(&json!({"id":"two","method":"editor","prefill":"保留原文"}));assert_eq!(ui.cancel_all()[0],json!({"type":"extension_ui_response","id":"two","cancelled":true}));assert!(!ui.waiting());assert_eq!(ui.requests[0].prefill,"保留原文");}
 #[test]fn notifications_status_widgets_and_editor_do_not_create_dialog_waiters(){let mut ui=ExtensionUi::default();for event in [json!({"id":"1","method":"setStatus","statusKey":"fixture","statusText":"进行中"}),json!({"id":"2","method":"setWidget","widgetKey":"fixture","widgetLines":["完整文字"],"widgetPlacement":"belowEditor"}),json!({"id":"3","method":"set_editor_text","text":"扩展输入"}),json!({"id":"4","method":"notify","message":"提示","notifyType":"warning"})]{ui.event(&event);}assert!(!ui.waiting());assert_eq!(ui.widgets["fixture"]["placement"],"belowEditor");assert_eq!(ui.editor.as_ref().unwrap()["text"],"扩展输入");ui.event(&json!({"id":"5","method":"setStatus","statusKey":"fixture","statusText":null}));assert!(ui.statuses.is_empty());}
}
