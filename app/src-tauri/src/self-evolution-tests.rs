use crate::{self_evolution::*,self_evolution_worker::{Control,Worker},pi_manager::{PiManager,SendInput}};
use serde_json::{json,Value};
use std::{path::PathBuf,fs,io::Write,sync::Arc,time::{Duration,Instant}};
fn fixture()->(tempfile::TempDir,crate::storage::Store,crate::pi_launch_plan::PiPaths){
    let parent=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../artifacts/validation/self-evolution-tests");
    fs::create_dir_all(&parent).unwrap();let temp=tempfile::Builder::new().prefix("case-").tempdir_in(parent).unwrap();
    let store=crate::storage::Store::open(&temp.path().join("data"),true).unwrap();
    let paths=crate::pi_launch_plan::PiPaths::prepare(&store.root).unwrap();(temp,store,paths)
}
fn fixture_source(paths:&crate::pi_launch_plan::PiPaths)->String{
    let key="sample.jsonl";let values=[json!({"type":"session","version":3,"id":"test-session","timestamp":"2026-10-09T10:00:00Z","cwd":paths.default_cwd}),
        json!({"type":"message","id":"m1","parentId":null,"timestamp":"2026-10-09T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"以后跟我聊天叫我主人"}]}})];
    fs::write(paths.sessions.join(key),values.iter().map(|v|v.to_string()+"\n").collect::<String>()).unwrap();key.into()
}
fn candidate(paths:&crate::pi_launch_plan::PiPaths,key:&str)->Candidate{
    let batch=batch(paths,key,&Cursor::default(),24000).unwrap();let resources=resources(paths).unwrap();
    proposals(&json!([{"title":"称呼偏好","target":"AGENTS.md","before":"","after":"与用户聊天时称呼用户为「主人」。","message":"m1","quote":"以后跟我聊天叫我主人"}]).to_string(),&batch,&resources).unwrap().remove(0)
}
#[test]fn default_agents_preserves_existing_and_empty_user_files(){
    let (_tmp,_store,paths)=fixture();let file=paths.agent.join("AGENTS.md");
    assert_eq!(fs::read_to_string(&file).unwrap(),crate::pi_rules::DEFAULT_AGENTS);
    for content in ["用户手写规则\r\n",""]{
        fs::write(&file,content).unwrap();crate::pi_rules::provision_agents(&paths.agent).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(),content);
    }
}
#[test]fn evolution_only_changes_marked_region_and_refuses_invalid_boundaries(){
    let (_tmp,_store,paths)=fixture();let key=fixture_source(&paths);let mut c=candidate(&paths,&key);
    let prefix="手写基础规则\r\n<!-- evolution:start -->";
    let suffix="<!-- evolution:end -->\r\n手写尾注\r\n";
    let before=format!("{prefix}\r\n原有规则\r\n{suffix}");
    let added=replace(&before,&c).unwrap();assert!(added.starts_with(prefix)&&added.ends_with(suffix));assert!(added.contains(&c.after));
    c.before="原有规则".into();c.after="修订规则".into();let revised=replace(&added,&c).unwrap();assert!(revised.contains("修订规则"));
    c.before="修订规则".into();c.after=String::new();let removed=replace(&revised,&c).unwrap();assert!(!removed.contains("修订规则"));assert!(removed.starts_with(prefix)&&removed.ends_with(suffix));
    c.before="手写基础规则".into();assert!(replace(&before,&c).is_err());
    c.before=String::new();c.after="新增规则".into();
    for invalid in ["".to_owned(),"已有但没有标记的用户文件".into(),before.replace("evolution:end","wrong:end"),format!("{before}\n<!-- evolution:start -->"),"<!-- evolution:end -->\n<!-- evolution:start -->\n".into()]{assert!(replace(&invalid,&c).is_err());}
    c.after="<!-- evolution:end -->".into();assert!(replace(&before,&c).is_err());
}
#[test]fn evolution_incremental_partial_tail_and_source_integrity(){
    let (_tmp,_store,paths)=fixture();let key=fixture_source(&paths);
    let first=batch(&paths,&key,&Cursor::default(),24000).unwrap();assert_eq!(first.messages.len(),1);
    assert!(batch(&paths,&key,&first.cursor,24000).unwrap().messages.is_empty());
    let mut file=fs::OpenOptions::new().append(true).open(paths.sessions.join(&key)).unwrap();file.write_all(b"{\"type\":").unwrap();
    assert_eq!(batch(&paths,&key,&first.cursor,24000).unwrap().cursor.offset,first.cursor.offset);
    fs::write(paths.sessions.join(&key),"short").unwrap();assert!(batch(&paths,&key,&first.cursor,24000).is_err());
}
#[test]fn evolution_approval_reopen_context_and_undo_preserve_append(){
    let (_tmp,store,paths)=fixture();let key=fixture_source(&paths);
    fs::write(paths.agent.join("APPEND_SYSTEM.md"),"这是原有追加规则。").unwrap();
    let mut state=load(&store).unwrap();let c=candidate(&paths,&key);let cid=c.id.clone();state.candidates.push(c);save(&store,&mut state).unwrap();
    assert_eq!(fs::read_to_string(paths.agent.join("AGENTS.md")).unwrap(),crate::pi_rules::DEFAULT_AGENTS);approve(&store,&paths,&mut state,&[cid]).unwrap();
    let saved=load(&store).unwrap();assert_eq!(saved.candidates[0].status,"written");
    let (context,_)=crate::pi_rules::context(&paths).unwrap();assert!(context.contains("主人"));assert!(context.contains("这是原有追加规则。"));
    let change=state.changes[0].id.clone();undo(&store,&paths,&mut state,&change).unwrap();
    assert!(!crate::pi_rules::context(&paths).unwrap().0.contains("主人"));assert_eq!(fs::read_to_string(paths.agent.join("APPEND_SYSTEM.md")).unwrap(),"这是原有追加规则。");
}
#[test]fn legacy_undo_restores_snapshot_but_preserves_later_edits(){
    let (_tmp,store,paths)=fixture();let path=paths.agent.join("AGENTS.md");
    let mut state=load(&store).unwrap();
    for before in [None,Some("用户原有规则\n".to_owned())]{
        let after=format!("{}- 每次回复前称呼用户为主人\n",before.as_deref().unwrap_or(""));
        let change=Change{id:id(),candidates:vec![],target:"AGENTS.md".into(),before:before.clone(),after:after.clone(),status:"written".into(),at:now()};
        let key=change.id.clone();state.changes.push(change);save(&store,&mut state).unwrap();
        let edited=format!("{after}手动补充的规则\n");fs::write(&path,&edited).unwrap();
        assert!(undo(&store,&paths,&mut state,&key).is_err());assert_eq!(fs::read_to_string(&path).unwrap(),edited);
        fs::write(&path,&after).unwrap();undo(&store,&paths,&mut state,&key).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),before.unwrap_or_default());
        assert_eq!(state.changes.last().unwrap().status,"reverted");
    }
    let before=crate::pi_rules::DEFAULT_AGENTS.to_owned();let after=format!("{before}\n区域外意外改动\n");
    let change=Change{id:id(),candidates:vec![],target:"AGENTS.md".into(),before:Some(before),after:after.clone(),status:"written".into(),at:now()};
    let key=change.id.clone();state.changes.push(change);save(&store,&mut state).unwrap();fs::write(&path,&after).unwrap();
    assert!(undo(&store,&paths,&mut state,&key).is_err());assert_eq!(fs::read_to_string(&path).unwrap(),after);
}
#[test]fn evolution_manual_file_change_and_fake_evidence_are_rejected(){
    let (_tmp,store,paths)=fixture();let key=fixture_source(&paths);let mut state=load(&store).unwrap();state.candidates.push(candidate(&paths,&key));
    fs::write(paths.agent.join("AGENTS.md"),"手动内容").unwrap();let cid=state.candidates[0].id.clone();assert!(approve(&store,&paths,&mut state,&[cid]).is_err());
    assert_eq!(fs::read_to_string(paths.agent.join("AGENTS.md")).unwrap(),"手动内容");
    let batch=batch(&paths,&key,&Cursor::default(),24000).unwrap();
    assert!(proposals(&json!([{"title":"伪造","target":"AGENTS.md","before":"","after":"伪造规则","message":"m1","quote":"用户未说过"}]).to_string(),&batch,&resources(&paths).unwrap()).is_err());
    assert!(target(&paths,"../APPEND_SYSTEM.md").is_err());assert!(target(&paths,"APPEND_SYSTEM.md").is_err());
}
#[test]fn evolution_recovers_published_write_before_database_confirmation(){
    let (_tmp,store,paths)=fixture();let key=fixture_source(&paths);let c=candidate(&paths,&key);let mut state=load(&store).unwrap();
    let before=fs::read_to_string(paths.agent.join("AGENTS.md")).unwrap();let after=replace(&before,&c).unwrap();let cid=c.id.clone();state.candidates.push(c);
    state.changes.push(Change{id:id(),candidates:vec![cid],target:"AGENTS.md".into(),before:Some(before),after:after.clone(),status:"prepared".into(),at:now()});
    save(&store,&mut state).unwrap();fs::write(paths.agent.join("AGENTS.md"),&after).unwrap();
    recover(&store,&paths,&mut state).unwrap();assert_eq!(state.candidates[0].status,"written");assert_eq!(load(&store).unwrap().changes[0].status,"written");
}
#[test]fn evolution_source_context_keeps_exact_evidence_and_rejects_changed_quote(){
    let (_tmp,_store,paths)=fixture();let key=fixture_source(&paths);let c=candidate(&paths,&key);
    let context=source_context(&paths,&c.source).unwrap();assert_eq!(context[0]["content"][0]["text"],"以后跟我聊天叫我主人");
    let mut changed=c.source;changed.quote="这不是原文".into();assert!(source_context(&paths,&changed).is_err());
}
fn wait_reply(manager:&PiManager)->Value{
    let until=Instant::now()+Duration::from_secs(180);
    loop{let summary=manager.summary().unwrap();if summary["active"]==false{assert_eq!(summary["outcome"],"success","真实模型未完成");return manager.snapshot().unwrap();}assert!(Instant::now()<until,"真实回复超时");std::thread::sleep(Duration::from_millis(50));}
}
fn send(manager:&PiManager,text:&str)->Value{
    let s=manager.summary().unwrap();manager.send(SendInput{generation:s["generation"].as_u64().unwrap(),session_id:s["sessionId"].as_str().unwrap().into(),message:text.into(),images:vec![],behavior:None},Arc::new(||{})).unwrap();wait_reply(manager)
}
struct PrivateFiles(Vec<PathBuf>);
impl Drop for PrivateFiles{fn drop(&mut self){for file in &self.0{let _=fs::remove_file(file);}}}
#[test]
#[ignore="Requires explicit real-model authorization and application-owned model configuration"]
fn evolution_real_conversation_learns_and_fresh_agent_reads_rule(){
    let source=PathBuf::from(std::env::var_os("AZCINE_EVOLUTION_REAL_SOURCE").expect("指定本应用自有 Pi 数据根"));
    let evidence=PathBuf::from(std::env::var_os("AZCINE_EVOLUTION_EVIDENCE").expect("指定隔离证据目录"));fs::create_dir_all(&evidence).unwrap();
    let store=crate::storage::Store::open(&evidence.join("data"),true).unwrap();let paths=crate::pi_launch_plan::PiPaths::prepare(&store.root).unwrap();
    // Read only the explicitly supplied app configuration, in process, never in output.
    let docs:[Value;3]=["models.json","auth.json","settings.json"].map(|name|{let bytes=fs::read(source.join("pi/agent").join(name)).unwrap();serde_json::from_slice(bytes.strip_prefix(&[239,187,191]).unwrap_or(&bytes)).unwrap()});
    let private=PrivateFiles(["models.json","auth.json","settings.json"].map(|name|paths.agent.join(name)).to_vec());
    for (path,doc) in private.0.iter().zip(&docs){fs::write(path,serde_json::to_vec(doc).unwrap()).unwrap();}
    fs::write(paths.agent.join("APPEND_SYSTEM.md"),"测试期间保持简短回答。").unwrap();
    let resources=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources");
    let runtime=crate::pi_runtime::resolve(&resources).unwrap();
    let manager=PiManager::default();let before=manager.connect(&store.root,&resources,None,None,Arc::new(||{})).unwrap();
    let chat=send(&manager,"以后跟我聊天叫我主人");
    let summary=manager.summary().unwrap();let path=PathBuf::from(summary["sessionFile"].as_str().unwrap());manager.disconnect(Arc::new(||{})).unwrap();
    let key=path.strip_prefix(&paths.sessions).unwrap().to_string_lossy().replace('\\',"/");
    let batch=batch(&paths,&key,&Cursor::default(),24000).unwrap();
    let offered=resources_for_test(&paths);let worker=Worker::connect(&paths,&runtime,&docs,None,&Control::default()).unwrap();
    let raw=worker.prompt(&prompt(&batch,&offered)).unwrap();drop(worker);
    let candidates=proposals(&raw,&batch,&offered).unwrap();
    let learned=candidates.iter().find(|c|c.after.contains("主人")&&c.target=="AGENTS.md").expect("真实模型应提出有来源的称呼规则");
    let mut state=load(&store).unwrap();state.candidates=candidates.clone();save(&store,&mut state).unwrap();
    assert_eq!(fs::read_to_string(paths.agent.join("AGENTS.md")).unwrap(),crate::pi_rules::DEFAULT_AGENTS,"候选阶段不得改变默认规则");
    approve(&store,&paths,&mut state,std::slice::from_ref(&learned.id)).unwrap();
    let fresh=manager.connect(&store.root,&resources,None,None,Arc::new(||{})).unwrap();
    assert_ne!(before["state"]["sessionId"],fresh["state"]["sessionId"]);
    let reply=send(&manager,"你好，请简短打个招呼。");manager.disconnect(Arc::new(||{})).unwrap();
    let answer=reply["projection"]["messages"].as_array().unwrap().iter().rev().find(|m|m["role"]=="assistant").unwrap();
    let text=answer["content"].as_array().unwrap().iter().filter_map(|p|p["text"].as_str()).collect::<Vec<_>>().join("\n");
    let passed=text.contains("主人");
    let result=json!({"passed":passed,"sourceSession":key,"userMessage":"以后跟我聊天叫我主人","sourceReply":chat["projection"]["messages"],"candidates":candidates,"agents":fs::read_to_string(paths.agent.join("AGENTS.md")).unwrap(),"freshSession":fresh["state"]["sessionId"],"freshPrompt":"你好，请简短打个招呼。","freshAnswer":text,"loadedRules":fresh["rules"],"appendUnchanged":fs::read_to_string(paths.agent.join("APPEND_SYSTEM.md")).unwrap()=="测试期间保持简短回答。"});
    fs::write(evidence.join("real-result.json"),serde_json::to_vec_pretty(&result).unwrap()).unwrap();
    assert!(passed,"新会话未按沉淀规则称呼用户，详见隔离证据");
}
fn resources_for_test(paths:&crate::pi_launch_plan::PiPaths)->Vec<Resource>{resources(paths).unwrap().into_iter().filter(|r|r.id=="AGENTS.md").collect()}
