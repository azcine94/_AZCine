"""Real owned-parent crash at three startup barriers. Barrier instrumentation is
added ONLY to a retained candidate copy, never production. No model calls, no
process-name kill, no file cleanup. Test children are exact owned handles.
"""
from pathlib import Path
import ctypes
from ctypes import wintypes
import datetime
import hashlib
import json
import os
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/validation'/('s03-parent-exit-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ'));OUT.mkdir()
report={'out':str(OUT),'mode':'test-copy startup barriers + exact owned process handles, not Pi/model integration','checks':[],'processes':[]}
handles=[];owners=[];control=None
kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];kernel.WaitForSingleObject.restype=wintypes.DWORD
kernel.CloseHandle.argtypes=[wintypes.HANDLE]
def check(name,ok,detail=None):
 report['checks'].append({'name':name,'ok':bool(ok),'detail':detail})
 if not ok:raise AssertionError(name)
def exact_handle(pid):
 handle=kernel.OpenProcess(0x00100000|0x1000,False,pid)
 if not handle:raise RuntimeError('Cannot open exact owned child handle')
 handles.append(handle);return handle
def wait_file(path,owner,seconds=15):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  if path.exists():
   try:return json.loads(path.read_text(encoding='utf8'))
   except json.JSONDecodeError:pass
  if owner.poll() is not None:raise RuntimeError('Owned test parent exited before barrier')
  time.sleep(.01)
 raise TimeoutError('Owned barrier not reached')
try:
 source=Path(sys.argv[1]).resolve();check('Candidate path in retained validation',source.is_relative_to(ROOT/'artifacts/validation'))
 text=source.read_text(encoding='utf8');report['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
 for old,new in [
  ('            unsafe {\n                CreateProcessW(','            crate::test_barrier("before", 0);\n            unsafe {\n                CreateProcessW('),
  ('            // SAFETY: CreateProcessW 成功时返回两个有效的新句柄。','            crate::test_barrier("created", information.dwProcessId);\n            // SAFETY: CreateProcessW 成功时返回两个有效的新句柄。'),
  ('            // 初始线程句柄不再需要；进程和 Job 继续由 owned 持有。','            crate::test_barrier("resumed", information.dwProcessId);\n            // 初始线程句柄不再需要；进程和 Job 继续由 owned 持有。')]:
  check('Single exact instrumentation marker',text.count(old)==1);text=text.replace(old,new)
 crate=OUT/'harness';crate.mkdir();(crate/'owned.rs').write_text(text,encoding='utf8')
 (crate/'Cargo.toml').write_text('[package]\nname="azcine-parent-exit-fixture"\nversion="0.0.0"\nedition="2024"\n[[bin]]\nname="azcine-parent-exit-fixture"\npath="main.rs"\n[dependencies]\nserde_json="=1.0.151"\nwindows={version="=0.62.2",features=["Win32_Foundation","Win32_Globalization","Win32_Security","Win32_Storage_FileSystem","Win32_System_IO","Win32_System_JobObjects","Win32_System_Pipes","Win32_System_Threading"]}\n',encoding='utf8')
 (crate/'main.rs').write_text(r'''#[path="owned.rs"] mod owned;
use std::{io::Read,ffi::OsString,path::Path};
fn test_barrier(stage:&str,child:u32){let args:Vec<_>=std::env::args().collect();if args[1]!=stage{return;}let value=serde_json::json!({"stage":stage,"owner":std::process::id(),"child":child});std::fs::write(&args[2],serde_json::to_vec(&value).unwrap()).unwrap();let mut data=[0u8];let _=std::io::stdin().read(&mut data);}
fn main(){let args:Vec<_>=std::env::args().collect();let system=std::env::var_os("SystemRoot").unwrap();let env:Vec<(OsString,OsString)>=vec![("SystemRoot".into(),system.clone()),("WINDIR".into(),system)];let child=owned::OwnedProcess::spawn(Path::new(&args[3]),&["-e".into(),"setInterval(()=>{},1000)".into()],Path::new(&args[4]),&env).unwrap();let _child=child;let mut data=[0u8];let _=std::io::stdin().read(&mut data);}
''',encoding='utf8')
 env=dict(os.environ);env.update(CARGO_HOME=str(ROOT/'.tooling/cargo'),RUSTUP_HOME=str(ROOT/'.tooling/rustup'),RUSTUP_TOOLCHAIN='1.99.0-x86_64-pc-windows-msvc',CARGO_TARGET_DIR=str(OUT/'target'));env['PATH']=str(ROOT/'.tooling/cargo/bin')+os.pathsep+env.get('PATH','')
 with (OUT/'build.log').open('xb') as log:build=subprocess.run([str(ROOT/'.tooling/cargo/bin/cargo.exe'),'build','--offline','--manifest-path',str(crate/'Cargo.toml')],env=env,stdout=log,stderr=log,timeout=300)
 check('Instrumented isolated fixture compiles',build.returncode==0)
 node=ROOT/'app/resources/runtime/pi-0.99.1-node-24.21.0/node-v24.21.0-win-x64/node.exe';exe=OUT/'target/debug/azcine-parent-exit-fixture.exe'
 system=os.environ.get('SystemRoot',r'C:\Windows');private_env={'SystemRoot':system,'WINDIR':system,'PATH':str(Path(system)/'System32')}
 control=subprocess.Popen([str(node),'-e','process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=private_env,cwd=OUT)
 for stage in ['before','created','resumed']:
  marker=OUT/f'{stage}-barrier.json';log=(OUT/f'{stage}-parent.log').open('xb');owner=subprocess.Popen([str(exe),stage,str(marker),str(node),str(OUT)],env=private_env,cwd=OUT,stdin=subprocess.PIPE,stdout=log,stderr=log);owners.append((owner,log));record=wait_file(marker,owner);report['processes'].append(record)
  handle=exact_handle(record['child']) if record['child'] else None
  if handle:check(f'{stage} child alive at test barrier',kernel.WaitForSingleObject(handle,0)==258)
  owner.kill();code=owner.wait(timeout=10);record['parentExitCode']=code
  if handle:check(f'{stage} parent crash closes Job and child process',kernel.WaitForSingleObject(handle,10000)==0)
  check(f'{stage} unrelated control not killed',control.poll() is None)
  owner.stdin.close();log.close()
 control.stdin.close();check('Unrelated control closes normally after all parent-crash tests',control.wait(timeout=10)==0)
 report['passed']=True
except Exception as e:report.update(passed=False,error=f'{type(e).__name__}: {e}')
finally:
 for owner,log in owners:
  if owner.poll() is None:owner.kill();owner.wait(timeout=10)
  if owner.stdin and not owner.stdin.closed:owner.stdin.close()
  if not log.closed:log.close()
 if control and control.poll() is None:control.stdin.close();control.wait(timeout=10)
 for handle in handles:kernel.CloseHandle(handle)
 (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({k:report.get(k) for k in ['out','passed','error']},ensure_ascii=False))
if not report.get('passed'):sys.exit(1)
