// Real signed NSIS upgrade, private loopback fixture feed, fictional data only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');const assert=require('node:assert/strict');
const {browserRuntime}=require('./support/browser.cjs');
const [outArg,exeArg,setupArg,portArg]=process.argv.slice(2);
const out=path.resolve(outArg),exe=path.resolve(exeArg),setup=path.resolve(setupArg),port=Number(portArg);
const evidence=path.resolve(__dirname,'../artifacts/validation')+path.sep;
if(!out.startsWith(evidence)||!exe.startsWith(evidence)||fs.existsSync(out))throw Error('New isolated output and owned installed exe required');
fs.mkdirSync(out,{recursive:true});
const report={checks:[],pids:[],errors:[]};let server,browser,page,child,debugPort,mode='unavailable';
const delay=ms=>new Promise(r=>setTimeout(r,ms));const check=(name,condition)=>{assert.ok(condition,name);report.checks.push(name);console.log('PASS '+name);};
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const signature=fs.readFileSync(setup+'.sig','utf8').trim();
async function connect(){
 for(let i=0;i<160;i++){try{if((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok)break;}catch{}await delay(500);}
 browser=await browserRuntime().chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
 for(let i=0;i<80;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri.localhost|tauri:\/\/localhost/.test(p.url()));if(page)break;await delay(250);}
 assert.ok(page);page.on('pageerror',error=>report.errors.push(error.message));await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
}
function ownedPids(){
 const quoted=exe.replaceAll("'","''");
 return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`$items=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${quoted}' } | Select-Object -ExpandProperty ProcessId); ConvertTo-Json -InputObject $items -Compress`],{encoding:'utf8',windowsHide:true}));
}
(async()=>{
 server=http.createServer((req,res)=>{
  if(req.url==='/latest.json'){
   if(mode==='unavailable'){res.writeHead(503);res.end();return;}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:mode==='current'?'0.0.0':'0.0.1',notes:'Explicit signed update fixture',platforms:{'windows-x86_64':{signature,url:`http://127.0.0.1:${port}/setup.exe`}}}));return;
  }
  if(req.url==='/setup.exe'){
   if(mode==='corrupt'){res.end('explicit invalid signed fixture');return;}
   res.setHeader('Content-Length',fs.statSync(setup).size);fs.createReadStream(setup).pipe(res);return;
  }
  res.writeHead(404);res.end();
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));debugPort=listener.address().port;await new Promise(r=>listener.close(r));
 child=spawn(exe,[],{cwd:path.dirname(exe),windowsHide:true,env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`,WEBVIEW2_USER_DATA_FOLDER:path.join(out,'webview')},stdio:'ignore'});report.pids.push(child.pid);
 await connect();check('Installed initial version 0.0.0',(await invoke('app_update_status')).version==='0.0.0');
 check('Fresh install has no selected data root',(await invoke('storage_workspace')).root===null);
 const root=path.join(out,'fictional-data');await invoke('select_data_root',{path:root});
 await invoke('create_todo',{input:{id:'00112233-4455-6677-8899-aabbccddeeff',title:'Preserve through signed update',dueDate:null,projectId:null}});
 const connected=await invoke('pi_connect',{cwd:null,sessionPath:null,reconnect:true});check('Bundled Pi ready before update',connected.connection==='ready');
 await invoke('app_update_check');check('Network failure reports retryable error',(await invoke('app_update_status')).stage==='error');
 mode='current';await invoke('app_update_check');check('Same version is not installed',(await invoke('app_update_status')).stage==='current');
 mode='corrupt';await invoke('app_update_check');check('New version is discovered',(await invoke('app_update_status')).nextVersion==='0.0.1');
 await invoke('app_update_download');let status=await invoke('app_update_status');check('Invalid signature is rejected',status.stage==='available'&&!!status.error);
 mode='available';await invoke('app_update_download');status=await invoke('app_update_status');check('Signed package ready with full progress',status.stage==='ready'&&status.downloaded===fs.statSync(setup).size);
 await page.evaluate(()=>location.hash='settings/about');await page.getByRole('button',{name:'安装并重启',exact:true}).click();await page.getByRole('button',{name:'暂不安装',exact:true}).click();check('Cancelling leaves the version untouched',(await invoke('app_update_status')).version==='0.0.0');
 await page.getByRole('button',{name:'安装并重启',exact:true}).click();await page.getByRole('button',{name:'已保存，安装并重启',exact:true}).click();
 for(let i=0;i<160&&child.exitCode===null;i++)await delay(500);check('Installer exits old application',child.exitCode===0);
 await browser.close().catch(()=>{});browser=null;page=null;
 await delay(2000);await connect();
 for(let i=0;i<120;i++){try{if((await invoke('app_update_status')).version==='0.0.1')break;}catch{}await delay(500);}
 report.pids.push(...ownedPids());check('Application automatically restarted as 0.0.1',(await invoke('app_update_status')).version==='0.0.1');
 const restored=await invoke('storage_workspace');check('Data directory and todo retained',restored.root.replace(/^\\\\\?\\/,'')===root&&restored.todos.some(todo=>todo.title==='Preserve through signed update'));
 check('Bundled Pi works after upgrade',(await invoke('pi_connect',{cwd:null,sessionPath:null,reconnect:true})).connection==='ready');
 await page.evaluate(()=>location.hash='settings/about');await page.screenshot({path:path.join(out,'upgraded.png')});
 report.pass=true;
})().catch(error=>{report.pass=false;report.failure=error.stack||JSON.stringify(error);console.error(report.failure);process.exitCode=1;}).finally(async()=>{
 try{if(page&&!page.isClosed())await page.getByRole('button',{name:'关闭窗口',exact:true}).click();}catch{}
 await delay(3000);await browser?.close().catch(()=>{});server?.close();
 const remaining=ownedPids();report.remaining=remaining;
 for(const pid of remaining){execFileSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});report.errors.push('Forced cleanup of owned validation process '+pid);report.pass=false;process.exitCode=1;}
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length}));
});
