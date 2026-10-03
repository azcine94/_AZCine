"""Standalone harness imports current production PiManager/modules by absolute
Rust path. Uses application resource runtime and retained test roots. No prompt
or provider calls. Does not mutate production source or invoke Tauri UI.
"""
from pathlib import Path
import datetime,json,os,subprocess,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/validation'/('s03-manager-real-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ'));OUT.mkdir()
modules=['pi-model-config','pi-config-store','pi-launch-plan','pi-jsonl','pi-owned-process','pi-rpc','pi-projection','pi-redactor','pi-sessions','pi-runtime','pi-manager']
# pi-runtime include_str uses its own source file path and CARGO_MANIFEST_DIR in
# this harness. A local stub resolver reads the already-verified exact app-owned
# resource; the actual production resolver is tested in real Tauri separately.
modules.remove('pi-runtime')
paths={n:ROOT/'app/src-tauri/src'/f'{n}.rs' for n in modules}
before={n:hashlib.sha256(p.read_bytes()).hexdigest() for n,p in paths.items()}
source='\n'.join(f'#[path={json.dumps(str(p).replace(chr(92),"/"))}] mod {n.replace("-","_")};' for n,p in paths.items())
source+='\nmod pi_runtime { pub fn resolve(p:&std::path::Path)->Result<crate::pi_launch_plan::RuntimePaths,crate::pi_model_config::ConfigError>{crate::pi_launch_plan::RuntimePaths::at(p)} }\n'
source+=r'''
fn main(){
 use std::{path::PathBuf,sync::Arc};use serde_json::json;use pi_manager::{PiManager,SendInput};
 let args:Vec<_>=std::env::args().collect();let root=PathBuf::from(&args[1]);std::fs::create_dir(&root).unwrap();let runtime=PathBuf::from(&args[2]);let m=PiManager::default();let notify:pi_manager::Notify=Arc::new(||{});
 let first=m.connect(&root,&runtime,None,None,notify.clone()).unwrap();assert_eq!(first["connection"],"ready");assert!(first["state"]["model"].is_null());assert_eq!(first["models"],json!([]));
 let generation=first["generation"].as_u64().unwrap();let session=first["state"]["sessionId"].as_str().unwrap();
 let rejected=m.send(SendInput{generation,session_id:session.into(),message:"unsent no-model check".into(),images:vec![],behavior:None},notify.clone()).err().unwrap();assert_eq!(rejected.code,"pi_model_required");
 let named=m.session_action(generation,session,"set_session_name",json!({"name":"原生真实Manager·未推理"}),notify.clone()).unwrap();assert_eq!(named["state"]["sessionName"],"原生真实Manager·未推理");
 let new=m.session_action(generation,session,"new_session",json!({}),notify.clone()).unwrap();assert_ne!(new["state"]["sessionId"],first["state"]["sessionId"]);assert_eq!(new["projection"]["messages"],json!([]));
 let list=m.sessions(&root).unwrap();assert!(list["sessions"].is_array());m.disconnect(notify.clone()).unwrap();
 let settings=pi_model_config::ModelSettingsInput{provider:"explicit-fixture".into(),base_url:"https://example.invalid/v1".into(),api:"openai-responses".into(),model_id:"no-inference".into(),name:"Fixture never called".into(),context_window:128000,max_tokens:8192,reasoning:false,supports_images:false,api_key:Some("synthetic-manager-not-real-key".into())};
 let saved=m.save_model(&root,&runtime,settings,notify.clone()).unwrap();assert_eq!(saved["saved"],true);assert_eq!(saved["connected"],true);let snapshot=m.snapshot().unwrap();assert!(!snapshot.to_string().contains("synthetic-manager-not-real-key"));assert_eq!(snapshot["state"]["model"]["id"],"no-inference");
 let gen=snapshot["generation"].as_u64().unwrap();let id=snapshot["state"]["sessionId"].as_str().unwrap();let stopped=m.stop(gen,id,notify.clone()).unwrap();assert_eq!(stopped["projection"]["outcome"],"interrupted");
 let end=m.disconnect(notify).unwrap();assert_eq!(end["connection"],"disconnected");assert_eq!(end["projection"]["messages"],json!([]));println!("{}",json!({"passed":true,"noPrompt":true,"originalEmptyReady":true,"syntheticModelLoaded":true,"normalDisconnect":true}));
}
'''
(OUT/'main.rs').write_text(source,encoding='utf8');(OUT/'Cargo.toml').write_text('[package]\nname="azcine-manager-real-check"\nversion="0.0.0"\nedition="2024"\n[[bin]]\nname="azcine-manager-real-check"\npath="main.rs"\n[dependencies]\nserde={version="=1.0.229",features=["derive"]}\nserde_json="=1.0.151"\nurl="=2.5.8"\ntempfile="=3.27.0"\nwindows={version="=0.62.2",features=["Win32_Foundation","Win32_Globalization","Win32_Security","Win32_Storage_FileSystem","Win32_System_IO","Win32_System_JobObjects","Win32_System_Pipes","Win32_System_Threading"]}\n',encoding='utf8')
e=dict(os.environ);e.update(CARGO_HOME=str(ROOT/'.tooling/cargo'),RUSTUP_HOME=str(ROOT/'.tooling/rustup'),RUSTUP_TOOLCHAIN='1.99.0-x86_64-pc-windows-msvc',CARGO_TARGET_DIR=str(OUT/'target'));e['PATH']=str(ROOT/'.tooling/cargo/bin')+os.pathsep+e.get('PATH','')
command=[str(ROOT/'.tooling/cargo/bin/cargo.exe'),'run','--offline','--manifest-path',str(OUT/'Cargo.toml'),'--',str(OUT/'data'),str(ROOT/'app/resources/runtime/pi-0.99.1-node-24.21.0')]
with (OUT/'run.log').open('xb') as log:r=subprocess.run(command,env=e,stdout=log,stderr=log,timeout=300)
after={n:hashlib.sha256(p.read_bytes()).hexdigest() for n,p in paths.items()};report={'mode':'actual current Manager with real original RPC, resource lookup explicit harness only; no prompt or inference','command':command,'before':before,'after':after,'sourceStable':before==after,'exitCode':r.returncode,'passed':r.returncode==0 and before==after};(OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps({'out':str(OUT),'passed':report['passed'],'exitCode':r.returncode}));raise SystemExit(0 if report['passed'] else 1)
