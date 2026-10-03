// Own this validation launch and cleanup; never target another application or user's records.
const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const {validationRun}=require('./support/validation-run.cjs');
(async()=>{
 const restoration=process.argv.includes('--restoration'),baseline=process.argv.includes('--baseline');
 if(baseline&&!restoration)throw Error('Baseline is only supported for the matched-reference restoration test');
 const {out}=validationRun(restoration?'s02-restoration-desktop':'s02-fidelity-desktop');process.env.AZCINE_VALIDATION_RUN=out;process.env.AZCINE_CDP_PORT='9224';
 if(baseline)process.env.AZCINE_RESTORATION_BASELINE='1';
 // The normal close proof may precede the development CLI releasing its server.
 // Refuse to launch over any owner; wait for actual free-port bind events instead.
 const net=require('node:net');const portDeadline=Date.now()+30000;
 for(const port of [1420,9224]){let free=false;while(Date.now()<portDeadline&&!free){free=await new Promise(resolve=>{const server=net.createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});if(!free)await new Promise(r=>setTimeout(r,250));}if(!free)throw Error(`Port ${port} still owned; did not launch duplicate desktop`);}
 const launcher=spawn(process.execPath,['tests/launch-validation-desktop.cjs'],{stdio:['ignore','pipe','pipe'],env:process.env});let text='';launcher.stdout.on('data',data=>{text+=data;process.stdout.write(data);});launcher.stderr.pipe(process.stderr);
 const launched=new Promise((resolve,reject)=>{launcher.once('error',reject);launcher.once('exit',(code)=>resolve(code));});
 let rootPid,ownerPid;const deadline=Date.now()+90000;
 try{
  while(Date.now()<deadline){const file=fs.readdirSync(out).find(f=>/^launch-.*\.json$/.test(f));if(file)rootPid=JSON.parse(fs.readFileSync(path.join(out,file),'utf8')).rootPid;
   try{const json=await (await fetch('http://127.0.0.1:9224/json')).json();if(json.some(p=>p.url.startsWith('http://127.0.0.1:1420')))break;}catch{}if(launcher.exitCode!==null)throw Error('Owned launcher exited before desktop ready');await new Promise(r=>setTimeout(r,250));
  }
  if(!rootPid)throw Error('No owned launch receipt');
  const raw=execFileSync('pwsh.exe',['-NoProfile','-Command',`$all=Get-CimInstance Win32_Process;$ids=[System.Collections.Generic.HashSet[uint32]]::new();[void]$ids.Add(${rootPid});do{$changed=$false;foreach($p in $all){if($ids.Contains($p.ParentProcessId)-and $ids.Add($p.ProcessId)){$changed=$true}}}while($changed);$found=@($all|Where-Object{$ids.Contains($_.ProcessId)-and $_.Name -eq 'azcine.exe'});if($found.Count -ne 1){throw 'Owned AZCine process not unique'};$found[0].ProcessId`],{encoding:'utf8'});ownerPid=Number(raw.trim());if(!Number.isInteger(ownerPid)||ownerPid<1)throw Error('Invalid owned PID');process.env.AZCINE_OWNER_PID=String(ownerPid);
  fs.writeFileSync(path.join(out,'owned-window.json'),JSON.stringify({rootPid,ownerPid},null,2),{flag:'wx'});
  const files=[restoration?'tests/verify-s02-restoration.cjs':'tests/verify-s02-fidelity.cjs',...(process.argv.includes('--regression')?[...(restoration?['tests/verify-s02-fidelity.cjs']:[]),'tests/verify-s02-editor.cjs','tests/verify-s02-keyboard-blur.cjs','tests/verify-s02-layout.cjs','tests/verify-s02-volume.cjs','tests/verify-s02-fixtures.cjs','tests/verify-s02-review-fixtures.cjs']:[])];
  for(const file of files){const test=spawn(process.execPath,[file],{stdio:'inherit',env:process.env});const code=await new Promise((resolve,reject)=>{test.once('error',reject);test.once('exit',resolve);});if(code!==0){process.exitCode=1;break;}}
 }catch(error){console.error(error);fs.writeFileSync(path.join(out,'run-failure.txt'),String(error),{flag:'wx'});process.exitCode=1;}
 finally{if(rootPid&&ownerPid){try{process.stdout.write(execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/verify-owned-exit.ps1','-RootPid',String(rootPid),'-OwnerPid',String(ownerPid),'-CdpPort','9224','-Output',path.join(out,'normal-close.json')],{encoding:'utf8',timeout:60000}));}catch(error){console.error(error);process.exitCode=1;}}const result=await launched;console.log(JSON.stringify({out,launcherExit:result,passed:!process.exitCode}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
