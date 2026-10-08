// Installed release-profile application, explicit fictional data only. No model requests.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {browserRuntime}=require('./support/browser.cjs');
const out=path.resolve(process.argv[2]||''),exe=path.resolve(process.argv[3]||'');
const evidence=path.resolve(__dirname,'../artifacts/validation')+path.sep;
if(!out.startsWith(evidence)||!exe.startsWith(evidence)||!fs.existsSync(exe))throw Error('Owned installed validation executable required');
if(fs.existsSync(out))throw Error('Use a new evidence directory');fs.mkdirSync(out,{recursive:true});
const report={mode:'installed release profile; fictional roots; directory copy simulates OneDrive transfer, no cloud or inference',checks:[],pids:[],errors:[]};
const source=path.join(out,'original-data'),migrated=path.join(out,'migrated-data'),downloaded=path.join(out,'new-computer-data');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const owned=value=>{const resolved=path.resolve(value.replace(/^\\\\\?\\/,''));assert.ok(resolved.startsWith(evidence));return resolved;};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
let child,browser,page;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(executable){
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const launch=report.pids.length+1;
  const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,WEBVIEW2_USER_DATA_FOLDER:path.join(out,`webview-${launch}`)};
  for(const key of Object.keys(env))if(key.startsWith('AZCINE_DEV_')||key.startsWith('AZCINE_TEST_'))delete env[key];
  child=spawn(executable,[],{env,cwd:path.dirname(executable),windowsHide:true,stdio:['ignore','pipe','pipe']});report.pids.push({pid:child.pid,executable});
  const log=fs.createWriteStream(path.join(out,`desktop-${launch}.log`),{flags:'wx'});child.stdout.pipe(log);child.stderr.pipe(log);
  let ready=false;for(let attempt=0;attempt<90;attempt++){if(child.exitCode!==null)throw Error('Desktop exited before WebView');try{const response=await fetch(`http://127.0.0.1:${port}/json/version`);if(response.ok){ready=true;break;}}catch{}await delay(500);}assert.ok(ready,'Owned WebView ready');
  browser=await browserRuntime().chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  for(let attempt=0;attempt<60;attempt++){page=browser.contexts().flatMap(context=>context.pages()).find(candidate=>/tauri.localhost|tauri:\/\/localhost/.test(candidate.url()));if(page)break;await delay(500);}assert.ok(page,'Packaged frontend page');
  page.on('pageerror',error=>report.errors.push(error.message));await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
}
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
async function close(){
  if(!child)return;
  try{if(page&&!page.isClosed())await page.getByRole('button',{name:'关闭窗口',exact:true}).click({timeout:5000});}catch{}
  for(let attempt=0;attempt<40&&child.exitCode===null;attempt++)await delay(250);
  if(child.exitCode===null){execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});report.errors.push('Owned desktop required forced cleanup');}
  await browser?.close().catch(()=>{});child=null;browser=null;page=null;
}
async function expectSession(root){
  const index=await invoke('pi_sessions');const list=index.sessions||index;
  const session=list.find(item=>item.id==='00112233-4455-6677-8899-aabbccddeeff');assert.ok(session,'Restored session listed');
  check('Restored native session points inside selected root',owned(session.path).startsWith(owned(root)+path.sep)&&owned(session.cwd).startsWith(owned(root)+path.sep));
  const snapshot=await invoke('pi_connect',{cwd:session.cwd,sessionPath:session.path,reconnect:true});
  check('Bundled upstream Pi resumes history without a model request',snapshot.connection==='ready'&&JSON.stringify(snapshot.projection).includes('explicit transfer fixture'));
  await invoke('pi_disconnect');return session;
}
(async()=>{
  const lock=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../app/resources/runtime-lock.json'),'utf8'));
  const runtime=path.join(path.dirname(exe),'runtime',lock.directory);
  for(const key of ['node','pi','packageLock'])check(`Installed ${key} matches lock`,hash(path.join(runtime,lock[key]))===lock.entrySha256[key]);
  await start(exe);check('Fresh installed profile has no development root',(await invoke('storage_workspace')).root===null);
  await page.locator('#data-root').fill(source);await page.getByRole('button',{name:'使用此目录',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-storage-setup]'));
  const workspace=await invoke('storage_workspace');check('First directory selection uses fictional root',owned(workspace.root)===source);
  await invoke('create_todo',{input:{id:'12345678-1234-1234-1234-123456789abc',title:'换机后保留的虚构待办',dueDate:null,projectId:null}});
  const attachment=await invoke('agent_attach_file',{input:{name:'transfer-fixture.txt',mimeType:'text/plain',bytes:[65,90,67,105,110,101]}});
  const initial=await invoke('pi_connect',{cwd:null,sessionPath:null,reconnect:true});check('Installed Pi starts from bundled runtime',initial.connection==='ready'&&initial.runtime.piVersion===lock.piVersion);
  const cwd=owned(initial.cwd);await invoke('pi_disconnect');await close();
  const fixtureFile=path.join(source,'pi/sessions/transfer-fixture.jsonl');
  const header={type:'session',version:3,id:'00112233-4455-6677-8899-aabbccddeeff',timestamp:'2026-10-08T00:00:00Z',cwd};
  const body=JSON.stringify({type:'message',id:'a1',parentId:null,timestamp:'2026-10-08T00:00:01Z',message:{role:'user',content:'explicit transfer fixture',timestamp:1791417601000}})+'\n';
  fs.writeFileSync(fixtureFile,JSON.stringify(header)+'\n'+body,{flag:'wx'});
  const auth=path.join(source,'pi/agent/auth.json');fs.writeFileSync(auth,JSON.stringify({'explicit-fixture':{type:'api_key',key:'not-a-real-key'}}));const authHash=hash(auth);
  await start(exe);await expectSession(source);
  await page.evaluate(()=>location.hash='settings/data');await page.getByRole('button',{name:'更改数据目录'}).click();
  await page.getByLabel('目标目录').fill(migrated);await page.getByRole('button',{name:'保存，下次启动生效'}).click();await page.getByRole('button',{name:'取消更改'}).waitFor();
  check('Scheduling does not immediately change or copy data',owned((await invoke('storage_workspace')).root)===source&&!fs.existsSync(migrated));await close();
  const originalSessionHash=hash(fixtureFile),originalMessages=fs.readFileSync(fixtureFile,'utf8').split('\n').slice(1).join('\n');
  await start(exe);const moved=await invoke('storage_workspace');check('Restart migrates to selected root with records',owned(moved.root)===migrated&&moved.todos.length===1);
  check('Original directory and native content retained',fs.existsSync(path.join(source,'db/azcine.sqlite3'))&&hash(fixtureFile)===originalSessionHash&&fs.readFileSync(path.join(migrated,'pi/sessions/transfer-fixture.jsonl'),'utf8').split('\n').slice(1).join('\n')===originalMessages);
  check('Credentials copied unchanged',hash(path.join(migrated,'pi/agent/auth.json'))===authHash);
  check('Attachment retained',hash(path.join(source,attachment.relativePath))===hash(path.join(migrated,attachment.relativePath)));
  await expectSession(migrated);await page.evaluate(()=>location.hash='settings/data');await page.screenshot({path:path.join(out,'installed-migrated.png')});await close();
  fs.cpSync(migrated,downloaded,{recursive:true,errorOnExist:true,force:false});
  const secondInstall=path.join(out,'new-installation');
  fs.cpSync(path.dirname(exe),secondInstall,{recursive:true,errorOnExist:true,force:false,filter:input=>path.basename(input)!=='validation-profile'});
  await start(path.join(secondInstall,path.basename(exe)));check('New installation starts without old local locator',(await invoke('storage_workspace')).root===null);
  await page.locator('#data-root').fill(downloaded);await page.getByRole('button',{name:'使用此目录',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-storage-setup]'));
  const recovered=await invoke('storage_workspace');check('New computer opens copied data and records',owned(recovered.root)===downloaded&&recovered.todos.length===1);
  await expectSession(downloaded);check('New computer keeps credentials',hash(path.join(downloaded,'pi/agent/auth.json'))===authHash);
  await page.evaluate(()=>location.hash='settings/data');await page.screenshot({path:path.join(out,'new-computer-restored.png')});
  await page.getByRole('button',{name:'更改数据目录'}).click();await page.getByLabel('更改方式').selectOption('switch');await page.getByLabel('目标目录').fill(source);await page.getByRole('button',{name:'保存，下次启动生效'}).click();await page.getByRole('button',{name:'取消更改'}).waitFor();await close();
  await start(path.join(secondInstall,path.basename(exe)));check('Switch-existing takes effect after restart',owned((await invoke('storage_workspace')).root)===source);await close();
  assert.deepEqual(report.errors,[]);report.pass=true;
})().catch(error=>{report.pass=false;report.failure=String(error.stack||JSON.stringify(error));console.error(report.failure);process.exitCode=1;}).finally(async()=>{await close();fs.writeFileSync(path.join(out,'desktop-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length}));});
