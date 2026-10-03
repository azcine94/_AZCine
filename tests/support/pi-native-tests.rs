// Included only in retained native-process validation harness, not production.
use crate::pi_owned_process::OwnedProcess;
use std::{ffi::OsString,fs,io::{Read,Write},path::{Path,PathBuf},thread,time::{Duration,Instant}};
fn root()->PathBuf{let base=PathBuf::from(std::env::var_os("AZCINE_PI_PROCESS_TEST_ROOT").unwrap());fs::create_dir_all(&base).unwrap();tempfile::Builder::new().prefix("native-").tempdir_in(base).unwrap().keep()}
fn node()->PathBuf{PathBuf::from(std::env::var_os("AZCINE_PI_RUNTIME_TEST_ROOT").unwrap()).join("node-v24.21.0-win-x64/node.exe")}
fn minimal_env()->Vec<(OsString,OsString)>{vec![("SystemRoot".into(),std::env::var_os("SystemRoot").unwrap())]} 
fn wait(p:&mut OwnedProcess)->std::process::ExitStatus{let deadline=Instant::now()+Duration::from_secs(10);loop{if let Some(s)=p.try_wait().unwrap(){return s;}assert!(Instant::now()<deadline,"owned child exit deadline");thread::sleep(Duration::from_millis(5));}}
fn run(args:&[OsString],env:&[(OsString,OsString)])->(Vec<u8>,Vec<u8>,std::process::ExitStatus){
 let root=root();let mut explicit=minimal_env();explicit.extend_from_slice(env);let mut p=OwnedProcess::spawn(&node(),args,&root,&explicit).unwrap();let input=p.take_stdin().unwrap();let mut output=p.take_stdout().unwrap();let mut diagnostic=p.take_stderr().unwrap();
 let out=thread::spawn(move||{let mut bytes=vec![];output.read_to_end(&mut bytes).unwrap();bytes});let err=thread::spawn(move||{let mut bytes=vec![];diagnostic.read_to_end(&mut bytes).unwrap();bytes});drop(input);let status=wait(&mut p);(out.join().unwrap(),err.join().unwrap(),status)
}
#[test]
fn given_empty_spaces_quotes_backslashes_unicode_args_when_native_create_then_node_receives_exact_values(){
 let expected=["","space value","tab\tvalue","中文\u{2028}🙂","embedded\"quote","one\\\"quote","two\\\\\"quote","trailing\\","double\\\\"," \\"];let mut args:Vec<OsString>=vec!["-e".into(),"console.log(JSON.stringify(process.argv.slice(1)))".into(),"--".into()];args.extend(expected.iter().map(OsString::from));let(out,_,status)=run(&args,&[]);assert!(status.success());let actual:Vec<String>=serde_json::from_slice(&out).unwrap();assert_eq!(actual,expected);
}
#[test]
fn given_explicit_minimal_environment_when_native_create_then_parent_sentinel_not_inherited(){
 // Sentinel is set by the outer single-process test harness only; no mutation
 // of environment from concurrent Rust threads and no secret environment read.
 let(out,_,status)=run(&["-e".into(),"console.log(JSON.stringify({sentinel:process.env.AZCINE_PARENT_FIXTURE_SENTINEL??null,own:process.env.AZCINE_CHILD_FIXTURE??null}))".into()],&[]);assert!(status.success());let v:serde_json::Value=serde_json::from_slice(&out).unwrap();assert_eq!(v,serde_json::json!({"sentinel":null,"own":null}));
}
#[test]
fn given_truly_empty_environment_when_native_create_then_system_child_does_not_inherit_parent_sentinel(){
 let root=root();let system=PathBuf::from(std::env::var_os("SystemRoot").unwrap());
 let mut p=OwnedProcess::spawn(&system.join("System32/cmd.exe"),&["/d".into(),"/s".into(),"/c".into(),"set".into()],&root,&[]).unwrap();drop(p.take_stdin());let mut out=p.take_stdout().unwrap();let mut bytes=vec![];out.read_to_end(&mut bytes).unwrap();let _=wait(&mut p);assert!(!String::from_utf8_lossy(&bytes).contains("synthetic-parent-only"));
}
#[test]
fn given_case_duplicate_env_keys_empty_value_and_equals_when_native_create_then_last_explicit_values_only(){
 let env=vec![("AZCINE_CHILD_FIXTURE".into(),"first".into()),("azcine_child_fixture".into(),"中文=last".into()),("EMPTY_FIXTURE".into(),"".into())];let(out,_,status)=run(&["-e".into(),"console.log(JSON.stringify([process.env.AZCINE_CHILD_FIXTURE,process.env.EMPTY_FIXTURE,process.env.AZCINE_PARENT_FIXTURE_SENTINEL??null]))".into()],&env);assert!(status.success());assert_eq!(serde_json::from_slice::<serde_json::Value>(&out).unwrap(),serde_json::json!(["中文=last","",null]));
}
#[test]
fn given_exit_codes_zero_nonzero_and_259_when_waiting_twice_then_actual_exit_is_stable(){for code in [0,7,259]{let root=root();let mut p=OwnedProcess::spawn(&node(),&["-e".into(),format!("process.exit({code})").into()],&root,&minimal_env()).unwrap();drop(p.take_stdin());let result=wait(&mut p);assert_eq!(result.code(),Some(code));assert_eq!(p.try_wait().unwrap().unwrap().code(),Some(code));}}
#[test]
fn given_large_stdout_and_stderr_when_drained_concurrently_then_overlapped_pipes_keep_all_bytes(){
 let script="const out=Buffer.alloc(1048576,65),err=Buffer.alloc(1048576,66);process.stdout.write(out);process.stderr.write(err);";let(out,err,status)=run(&["-e".into(),script.into()],&[]);assert!(status.success());assert_eq!(out,vec![65;1048576]);assert_eq!(err,vec![66;1048576]);
}
#[test]
fn given_nul_or_invalid_environment_names_when_native_create_then_reject_without_spawn(){
 let root=root();let program=node();
 let failure=|p:&Path,args:&[OsString],cwd:&Path,env:&[(OsString,OsString)]|OwnedProcess::spawn(p,args,cwd,env).err().expect("must reject");
 assert_eq!(failure(&program,&["nul\0value".into()],&root,&[]).code,"input_contains_nul");
 assert_eq!(failure(Path::new("C:/invalid\0/node.exe"),&[],&root,&[]).code,"input_contains_nul");
 assert_eq!(failure(&program,&[],Path::new("C:/invalid\0/work"),&[]).code,"input_contains_nul");
 for env in [vec![("".into(),"x".into())],vec![("x=y".into(),"x".into())]]{assert_eq!(failure(&program,&[],&root,&env).code,"invalid_environment_name");}
 for env in [vec![("x\0y".into(),"x".into())],vec![("x".into(),"y\0z".into())]]{assert_eq!(failure(&program,&[],&root,&env).code,"input_contains_nul");}
 assert_eq!(failure(Path::new("node.exe"),&[],&root,&[]).code,"program_not_absolute");assert_eq!(failure(&program,&[],Path::new("relative"),&[]).code,"cwd_not_absolute");
}
#[test]
fn given_space_program_and_cwd_when_native_create_then_explicit_application_path_and_eof_work(){
 let root=root();let spaced=root.join("space program");fs::create_dir(&spaced).unwrap();let own_node=spaced.join("own node.exe");fs::copy(node(),&own_node).unwrap();let cwd=root.join("space workspace");fs::create_dir(&cwd).unwrap();let mut p=OwnedProcess::spawn(&own_node,&["-e".into(),"process.stdin.once('data',b=>process.stdout.write(b));process.stdin.on('end',()=>process.exit(0));process.stdin.resume();".into()],&cwd,&minimal_env()).unwrap();let mut input=p.take_stdin().unwrap();let mut output=p.take_stdout().unwrap();input.write_all("管道🙂\n".as_bytes()).unwrap();drop(input);let mut s=String::new();output.read_to_string(&mut s).unwrap();assert_eq!(s,"管道🙂\n");assert!(wait(&mut p).success());
}
