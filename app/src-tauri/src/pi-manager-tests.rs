use super::*;
#[test]
fn given_no_connection_when_snapshot_then_no_model_reply_or_fake_ready(){
    let m=PiManager::default();let v=m.snapshot().unwrap();assert_eq!(v["connection"],"disconnected");assert_eq!(v["state"],Value::Null);assert_eq!(v["models"],json!([]));assert_eq!(v["projection"]["messages"],json!([]));assert_eq!(v["projection"]["outcome"],"none");
}
#[test]
fn given_send_with_stale_session_when_action_then_no_request_or_lost_input(){
    let m=PiManager::default();let input=SendInput{generation:99,session_id:"previous-session".into(),message:"未发送的文字".into(),images:vec![],behavior:None};
    let error=m.send(input,Arc::new(||{})).err().unwrap();assert_eq!(error.code,"pi_stale_session");assert_eq!(m.snapshot().unwrap()["projection"]["messages"],json!([]));
}
#[test]
fn given_old_generation_events_when_new_session_present_then_no_cross_session_mutation(){
    let m=PiManager::default();{let mut c=m.core.lock().unwrap();c.generation=2;c.state=json!({"sessionId":"new"});}
    on_event(&Arc::downgrade(&m.core),1,json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"old event"}],"stopReason":"stop"}}),&(Arc::new(||{}) as Notify));
    let v=m.snapshot().unwrap();assert_eq!(v["state"]["sessionId"],"new");assert_eq!(v["projection"]["messages"],json!([]));assert_eq!(v["seq"],0);
}
#[test]
fn given_stopping_and_unconfirmed_send_when_queue_clears_then_recovery_belongs_to_original_session(){
    let mut c=Core::default();c.state=json!({"sessionId":"first"});restore_queue(&mut c,&json!({"steering":["same","same"],"followUp":["later"]}));
    c.state=json!({"sessionId":"second"});restore_queue(&mut c,&json!({"steering":["second"],"followUp":[]}));
    assert_eq!(c.recovered["first"],vec!["same","same","later"]);assert_eq!(c.recovered["second"],vec!["second"]);
    assert_eq!(c.projection.steering.len(),0);assert_eq!(c.projection.follow_up.len(),0);
}
#[test]
fn given_redaction_candidates_when_snapshot_emitted_then_credential_never_echoed_in_completed_or_streaming_text(){
    let m=PiManager::default();{let mut c=m.core.lock().unwrap();c.redactor.add("fixture-credential-secret");c.projection.messages=vec![json!({"role":"user","content":"fixture-credential-secret"})];c.projection.partial=Some(json!({"role":"assistant","content":[{"type":"text","text":"here fixture-credential-sec"}]}));}
    let v=m.snapshot().unwrap();assert!(!v.to_string().contains("fixture-credential"));assert!(v.to_string().contains("凭据"));
}
#[test]
fn given_user_images_when_validating_then_invalid_padding_and_bytes_are_rejected(){
    for valid in ["aGVsbG8=","YWJj","YQ=="]{assert!(valid_base64(valid));}
    for invalid in ["a=bc","=abc","abcd===","abc-","中文"]{assert!(!valid_base64(invalid));}
}
#[test]
fn given_malformed_own_config_when_connecting_then_reject_before_native_start(){
    for docs in [[json!({"providers":[]}),json!({}),json!({})],[json!({"providers":{"x":{"models":[{"id":"a"},{"id":"a"}]}}}),json!({}),json!({})],[json!({}),json!({"x":{"type":"oauth","access":true}}),json!({})]]{assert_eq!(validate_documents(&docs).unwrap_err().code,"pi_config_invalid");}
    assert!(validate_documents(&[json!({}),json!({}),json!({})]).is_ok());
}
#[test]
fn given_explicit_disconnect_when_already_disconnected_then_idempotent_exit_without_new_process(){
    let m=PiManager::default();for _ in 0..2{let v=m.disconnect(Arc::new(||{})).unwrap();assert_eq!(v["connection"],"disconnected");assert_eq!(v["busy"],false);assert_eq!(v["stopping"],false);}assert!(m.core.lock().unwrap().process.is_none());
}
