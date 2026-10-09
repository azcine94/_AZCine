//! Opt-in real Node / upstream Pi checks. All data is newly generated and retained.
use super::*;
use std::{fs,path::Path,thread,time::{Instant,SystemTime}};

fn fixture()->(PathBuf,PiPaths,RuntimePaths){
    let base=PathBuf::from(std::env::var_os("AZCINE_PI_LOCK_TEST_BASE").expect("explicit isolated test base required"));
    assert!(base.is_absolute());fs::create_dir_all(&base).unwrap();
    let root=tempfile::Builder::new().prefix("config-lock-").tempdir_in(fs::canonicalize(base).unwrap()).unwrap().keep();
    let paths=PiPaths::prepare(&root).unwrap();
    for name in NAMES{fs::write(paths.agent.join(name),b"{}").unwrap();}
    let runtime=crate::pi_runtime::resolve(Path::new("unused-test-resources")).unwrap();
    (root,paths,runtime)
}
fn native_probe(paths:&PiPaths,runtime:&RuntimePaths)->RpcProcess{
    // No app adapter: exercises the actual upstream library and native async
    // auth heartbeat (30s stale / 15s update) against the application's lease.
    let script=r#"
      import {createRequire} from 'node:module';import {join} from 'node:path';
      import {createInterface} from 'node:readline';let unlock;
      for await(const line of createInterface({input:process.stdin,terminal:false})){
        const r=JSON.parse(line);let code;try{
          const lock=createRequire(join(r.package,'package.json'))('proper-lockfile');
          unlock=r.async?await lock.lock(join(r.agent,r.name),{realpath:false,stale:30000}):lock.lockSync(join(r.agent,r.name),{realpath:false});
        }catch(e){code=e.code;}
        process.stdout.write(JSON.stringify({type:'response',id:r.id,command:r.type,success:true,data:{acquired:!code,code}})+'\n');
      }
      if(unlock)await unlock();
    "#;
    let env=paths.environment(runtime,&PathBuf::from(std::env::var_os("SystemRoot").unwrap()),&[]).unwrap();
    RpcProcess::spawn(&runtime.node,&["--input-type=module".into(),"--eval".into(),script.into()],&paths.default_cwd,&env,|_|{}).unwrap()
}
fn probe(process:&RpcProcess,paths:&PiPaths,runtime:&RuntimePaths,name:&str,asynchronous:bool)->Value{
    process.request("acquire",json!({"package":runtime.package,"agent":paths.agent,"name":name,"async":asynchronous}),Duration::from_secs(5)).unwrap()["data"].clone()
}
#[test]
#[ignore="real bundled runtime; set AZCINE_PI_LOCK_TEST_BASE to an isolated directory"]
fn sustained_lease_survives_timestamp_changes_but_excludes_native_and_app_writers(){
    let (_,paths,runtime)=fixture();let lease=ConfigLease::acquire_catalog(&paths,&runtime).unwrap();
    let before:Vec<_>=NAMES.iter().map(|n|fs::read(paths.agent.join(n)).unwrap()).collect();
    let start=Instant::now();
    // >4 update intervals, plus forced timestamp disturbances between updates.
    for _ in 0..12{
        thread::sleep(Duration::from_secs(2));
        for name in NAMES{
            let lock=paths.agent.join(format!("{name}.lock"));
            let file=fixture_directory(&lock);
            file.set_times(fs::FileTimes::new().set_modified(SystemTime::now()-Duration::from_secs(60))).unwrap();
            assert!(fs::remove_dir(&lock).is_err(),"live lock must be pinned");
        }
        lease.check().unwrap();
        let contender=native_probe(&paths,&runtime);
        let result=probe(&contender,&paths,&runtime,"models.json",false);
        assert_eq!(result["acquired"],false);contender.shutdown(Duration::from_secs(2)).unwrap();
    }
    assert!(start.elapsed()>=Duration::from_secs(24));lease.check().unwrap();
    assert_eq!(ConfigLease::acquire(&paths,&runtime).err().unwrap().code,"pi_config_busy");
    for (i,name) in NAMES.iter().enumerate(){assert_eq!(fs::read(paths.agent.join(name)).unwrap(),before[i]);}
    drop(lease);
    for name in NAMES{assert!(!paths.agent.join(format!("{name}.lock")).exists());}
    let next=ConfigLease::acquire(&paths,&runtime).unwrap();next.check().unwrap();drop(next);
    let native=native_probe(&paths,&runtime);assert_eq!(probe(&native,&paths,&runtime,"auth.json",false)["acquired"],true);native.shutdown(Duration::from_secs(2)).unwrap();
}
// Open a directory only to mutate a fixture's timestamp. Does not delete data.
fn fixture_directory(path:&Path)->File{
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{FILE_WRITE_ATTRIBUTES,FILE_SHARE_READ,FILE_SHARE_WRITE,FILE_SHARE_DELETE,FILE_FLAG_BACKUP_SEMANTICS};
    fs::OpenOptions::new().access_mode(FILE_WRITE_ATTRIBUTES.0)
        .share_mode(FILE_SHARE_READ.0|FILE_SHARE_WRITE.0|FILE_SHARE_DELETE.0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0).open(path).unwrap()
}
#[test]
#[ignore="real bundled runtime; set AZCINE_PI_LOCK_TEST_BASE to an isolated directory"]
fn native_async_auth_lock_is_not_reclaimed_before_its_first_heartbeat(){
    let (_,paths,runtime)=fixture();let native=native_probe(&paths,&runtime);
    assert_eq!(probe(&native,&paths,&runtime,"auth.json",true)["acquired"],true);
    thread::sleep(Duration::from_secs(12));
    assert_eq!(ConfigLease::acquire(&paths,&runtime).err().unwrap().code,"pi_config_busy");
    assert!(!paths.agent.join("models.json.lock").exists(),"partial acquisition must unwind");
    assert!(paths.agent.join("auth.json.lock").exists());
    native.shutdown(Duration::from_secs(2)).unwrap();
    ConfigLease::acquire(&paths,&runtime).unwrap().check().unwrap();
}
#[test]
#[ignore="real bundled runtime; set AZCINE_PI_LOCK_TEST_BASE to an isolated directory"]
fn model_catalog_uses_read_only_native_credentials_and_keeps_config_bytes(){
    let (root,paths,runtime)=fixture();
    fs::write(paths.agent.join("models.json"),serde_json::to_vec(&json!({"providers":{"fixture":{"baseUrl":"http://127.0.0.1:1/v1","api":"openai-completions","apiKey":"explicit-fixture-key","models":[{"id":"fixture-chat","name":"Fixture chat","contextWindow":4096,"maxTokens":512}]}}})).unwrap()).unwrap();
    fs::write(paths.agent.join("auth.json"),br#"{"fixture":{"type":"api_key","key":"explicit-fixture-key"}}"#).unwrap();
    let before:Vec<_>=NAMES.iter().map(|n|fs::read(paths.agent.join(n)).unwrap()).collect();
    let lease=ConfigLease::acquire_catalog(&paths,&runtime).unwrap();
    let models=crate::pi_resources::models(&runtime,&paths).unwrap();lease.check().unwrap();
    assert!(models.as_array().unwrap().iter().any(|m|m["provider"]=="fixture"&&m["id"]=="fixture-chat"));
    assert!(!models.to_string().contains("explicit-fixture-key"));drop(lease);
    for (i,name) in NAMES.iter().enumerate(){assert_eq!(fs::read(paths.agent.join(name)).unwrap(),before[i]);}
    let manager=crate::pi_manager::PiManager::default();
    assert_eq!(manager.model_catalog(&root,Path::new("unused")).unwrap(),models);
    let snapshot=manager.connect(&root,Path::new("unused"),None,None,std::sync::Arc::new(||{})).unwrap();
    assert_eq!(snapshot["connection"],"ready");
    assert!(snapshot["models"].as_array().unwrap().iter().any(|m|m["id"]=="fixture-chat"));
    manager.disconnect(std::sync::Arc::new(||{})).unwrap();
    // Native Pi may update settings on connect, so compare the inspector before
    // connecting separately; auth and models must still be byte-identical.
    for (i,name) in NAMES.iter().take(2).enumerate(){assert_eq!(fs::read(paths.agent.join(name)).unwrap(),before[i]);}
}
#[test]
#[ignore="real bundled runtime; set AZCINE_PI_LOCK_TEST_BASE to an isolated directory"]
fn helper_exit_is_reported_as_lost_and_stale_locks_can_be_reacquired(){
    let (_,paths,runtime)=fixture();let lease=ConfigLease::acquire(&paths,&runtime).unwrap();
    lease.process.shutdown(Duration::ZERO).unwrap();
    assert_eq!(lease.check().unwrap_err().code,"pi_config_lock_lost");
    drop(lease);
    // A killed helper may leave dirs; simulate elapsed stale time, not deletion.
    for name in NAMES{let path=paths.agent.join(format!("{name}.lock"));if path.exists(){
        fixture_directory(&path).set_times(fs::FileTimes::new().set_modified(SystemTime::now()-Duration::from_secs(60))).unwrap();
    }}
    ConfigLease::acquire(&paths,&runtime).unwrap().check().unwrap();
    for name in NAMES{assert_eq!(fs::read(paths.agent.join(name)).unwrap(),b"{}");}
}
#[test]
#[ignore="real bundled runtime; set AZCINE_PI_LOCK_TEST_BASE to an isolated directory"]
fn migrated_config_can_immediately_lock_read_models_and_connect_native_pi(){
    use crate::storage::{Manager,CreateTodo};
    let (base,_,runtime)=fixture();let original=base.join("original");let destination=base.join("destination");
    let mut manager=Manager::new(base.join("locator"),original.clone()).unwrap();manager.select_root(&original).unwrap();
    manager.store().unwrap().create_todo(CreateTodo{id:"00112233-4455-6677-8899-aabbccddeeff".into(),title:"explicit migration fixture".into(),due_date:None,project_id:None}).unwrap();
    let paths=PiPaths::prepare(&original).unwrap();
    for name in NAMES{fs::write(paths.agent.join(name),b"{}").unwrap();fs::create_dir(paths.agent.join(format!("{name}.lock"))).unwrap();}
    // An existing upstream models.json requires providers; {} is invalid.
    fs::write(paths.agent.join("models.json"),br#"{"providers":{}}"#).unwrap();
    manager.schedule_root_change(&destination,"migrate").unwrap();drop(manager);
    let mut restored=Manager::new(base.join("locator"),original.clone()).unwrap();
    let workspace=restored.workspace().unwrap();assert_eq!(workspace.todos.len(),1);assert!(workspace.root_change_notice.unwrap().contains("已更改"));
    let moved=PiPaths::prepare(&destination).unwrap();
    ConfigLease::acquire(&moved,&runtime).unwrap().check().unwrap();
    for name in NAMES{assert!(paths.agent.join(format!("{name}.lock")).exists());assert_eq!(fs::read(moved.agent.join(name)).unwrap(),fs::read(paths.agent.join(name)).unwrap());}
    let pi=crate::pi_manager::PiManager::default();
    assert_eq!(pi.model_catalog(&destination,Path::new("unused")).unwrap(),json!([]));
    assert_eq!(pi.connect(&destination,Path::new("unused"),None,None,std::sync::Arc::new(||{})).unwrap()["connection"],"ready");
    pi.disconnect(std::sync::Arc::new(||{})).unwrap();
}
#[test]
fn lock_errors_distinguish_busy_lost_permissions_and_filesystem_failures(){
    for (wire,code) in [("busy","pi_config_busy"),("lost","pi_config_lock_lost"),("permission","pi_config_permission"),("io","pi_config_lock_io")]{
        assert_eq!(response(&json!({"success":false,"errorCode":wire})).unwrap_err().code,code);
    }
}
#[test]
#[ignore="real bundled runtime; set AZCINE_PI_LOCK_TEST_BASE to an isolated directory"]
fn model_cache_lock_only_blocks_catalog_not_unrelated_config_access(){
    let (_,paths,runtime)=fixture();let native=native_probe(&paths,&runtime);
    assert_eq!(probe(&native,&paths,&runtime,"models-store.json",true)["acquired"],true);
    ConfigLease::acquire(&paths,&runtime).unwrap().check().unwrap();
    assert_eq!(ConfigLease::acquire_catalog(&paths,&runtime).err().unwrap().code,"pi_config_busy");
    for name in &NAMES[..3]{assert!(!paths.agent.join(format!("{name}.lock")).exists());}
    native.shutdown(Duration::from_secs(2)).unwrap();
    ConfigLease::acquire_catalog(&paths,&runtime).unwrap().check().unwrap();
}

#[test]
#[ignore="concurrent catalog regression; real bundled runtime; explicit isolated AZCINE_PI_LOCK_TEST_BASE"]
fn concurrent_catalog_readers_share_a_successful_snapshot(){
    let (root,paths,_)=fixture();
    fs::write(paths.agent.join("models.json"),br#"{"providers":{}}"#).unwrap();
    let gate=std::sync::Arc::new(std::sync::Barrier::new(8));
    let workers:Vec<_>=(0..8).map(|_|{
        let root=root.clone();let gate=gate.clone();
        thread::spawn(move||{
            let manager=crate::pi_manager::PiManager::default();gate.wait();
            manager.model_catalog(&root,Path::new("unused"))
        })
    }).collect();
    let results:Vec<_>=workers.into_iter().map(|worker|worker.join().unwrap()).collect();
    let succeeded=results.iter().filter(|value|value.is_ok()).count();
    let failures:Vec<_>=results.iter().filter_map(|value|value.as_ref().err().map(|e|e.code)).collect();
    println!("catalog concurrent callers=8 succeeded={succeeded} failures={failures:?}");
    assert_eq!(succeeded,8,"every catalog caller must receive the shared list");
    assert!(failures.is_empty(),"normal concurrent reads must not report busy");
    assert!(failures.iter().all(|code|*code=="pi_config_busy"),"unexpected failure beyond lock contention");
    assert_eq!(crate::pi_manager::PiManager::default().model_catalog(&root,Path::new("unused")).unwrap(),json!([]),"retry after all readers finish must recover");
}

#[test]
#[ignore="real bundled runtime; explicit isolated AZCINE_PI_LOCK_TEST_BASE"]
fn catalog_cache_tracks_changed_config_and_keeps_roots_separate(){
    let (root,paths,_)=fixture();let (other,other_paths,_)=fixture();
    let manager=crate::pi_manager::PiManager::default();
    for p in [&paths,&other_paths]{fs::write(p.agent.join("models.json"),br#"{"providers":{}}"#).unwrap();}
    assert_eq!(manager.model_catalog(&root,Path::new("unused")).unwrap(),json!([]));
    let document=json!({"providers":{"fixture":{"baseUrl":"http://127.0.0.1:1/v1","api":"openai-completions","apiKey":"fictional-key","models":[{"id":"new-model","name":"New model","contextWindow":4096,"maxTokens":512}]}}});
    fs::write(paths.agent.join("models.json"),serde_json::to_vec(&document).unwrap()).unwrap();
    assert!(manager.model_catalog(&root,Path::new("unused")).unwrap().as_array().unwrap().iter().any(|m|m["id"]=="new-model"));
    assert_eq!(manager.model_catalog(&other,Path::new("unused")).unwrap(),json!([]));
    fs::write(paths.agent.join("models.json"),b"invalid fixture").unwrap();
    assert!(manager.model_catalog(&root,Path::new("unused")).is_err(),"must not return an obsolete successful result as current");
    fs::write(paths.agent.join("models.json"),br#"{"providers":{}}"#).unwrap();
    assert_eq!(manager.model_catalog(&root,Path::new("unused")).unwrap(),json!([]));
}

#[test]
#[ignore="real bundled runtime; explicit isolated AZCINE_PI_LOCK_TEST_BASE"]
fn foreground_connections_and_catalog_readers_can_start_together(){
    let (root,paths,_)=fixture();fs::write(paths.agent.join("models.json"),br#"{"providers":{}}"#).unwrap();
    let runtime=std::sync::Arc::new(crate::agent_runtime::AgentRuntime::default());
    let gate=std::sync::Arc::new(std::sync::Barrier::new(8));
    let workers:Vec<_>=(0..8).map(|i|{let root=root.clone();let runtime=runtime.clone();let gate=gate.clone();thread::spawn(move||{
        gate.wait();if i<6{runtime.connect(&format!("chat-{i}"),&root,Path::new("unused"),None,None,false,std::sync::Arc::new(||{})).map(|snapshot|{assert_eq!(snapshot["connection"],"ready");})}
        else{crate::pi_manager::PiManager::default().model_catalog(&root,Path::new("unused")).map(|_|())}
    })}).collect();
    let results:Vec<_>=workers.into_iter().map(|worker|worker.join().unwrap()).collect();
    let failures:Vec<_>=results.iter().filter_map(|v|v.as_ref().err().cloned()).collect();
    runtime.manager("chat-0").unwrap().disconnect(std::sync::Arc::new(||{})).unwrap();
    for i in 1..6{assert_eq!(runtime.manager(&format!("chat-{i}")).unwrap().snapshot().unwrap()["connection"],"ready");}
    runtime.shutdown(std::sync::Arc::new(||{})).unwrap();
    assert!(failures.is_empty(),"concurrent connect/catalog failures: {failures:?}");
}
