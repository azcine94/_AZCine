// Authorized real dialogue, native IPC, and UI approval against an isolated root.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const out=path.resolve(process.argv[2]||''),port=Number(process.argv[3]);
if(!out.startsWith(path.resolve(__dirname,'../artifacts/validation')+path.sep))throw Error('Isolated root required');
const data=path.join(out,process.argv[5]||'data');
const report={checks:[],errors:[]};let browser,page,ipc;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 const state=JSON.parse(fs.readFileSync(path.join(out,'config/launcher/run-state.json'),'utf8'));
 page=browser.contexts()[0].pages().find(p=>p.url().startsWith(`http://127.0.0.1:${state.port}`));assert.ok(page,'Owned desktop');
 page.on('pageerror',e=>report.errors.push(e.message));
 ipc=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args).catch(e=>{throw Error(e?.message||String(e))}),{command,args});
 const existing=(await ipc('storage_workspace')).root;if(!existing)await ipc('select_data_root',{path:data});else assert.equal(fs.statSync(existing).ino,fs.statSync(data).ino,'Must use owned isolated root');
 const source=process.env.AZCINE_EVOLUTION_REAL_SOURCE;if(!source)throw Error('Explicit app-owned configuration required');fs.mkdirSync(path.join(data,'pi/agent'),{recursive:true});
 for(const name of ['models.json','auth.json','settings.json'])fs.copyFileSync(path.join(source,'pi/agent',name),path.join(data,'pi/agent',name));
 fs.writeFileSync(path.join(data,'pi/agent/APPEND_SYSTEM.md'),'测试期间保持简短回答。');await page.reload();await page.locator('nav a[href="#self-evolution"]').waitFor();
 await page.locator('nav a[href="#self-evolution"]').click();let snapshot=await ipc('evolution_snapshot');
 assert.ok(typeof snapshot.state.settings.automatic==='boolean');
 await ipc('evolution_mutate',{input:{action:'settings',revision:snapshot.state.revision,settings:{...snapshot.state.settings,automatic:false}}});
 report.checks.push('Desktop module route, ACL, defaults and persisted settings');
 let agent;for(let attempt=0;attempt<8;attempt++){try{agent=await ipc('pi_connect',{cwd:null,sessionPath:null});break;}catch(error){if(!String(error).includes('正在更新配置')||attempt===7)throw error;await sleep(2000);}}assert.ok(agent);
 const sourceId=agent.state.sessionId;
 const send=async(text)=>{
  const before=await ipc('pi_snapshot');
  await ipc('pi_send',{input:{generation:before.generation,sessionId:before.state.sessionId,message:text,images:[],behavior:null}});
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){const next=await ipc('pi_snapshot');if(next.projection.activity==='idle'&&!next.busy&&!next.sending){assert.equal(next.projection.outcome,'success');return next;}await sleep(200);}
  throw Error('Real model timeout');
 };
 await send('以后跟我聊天叫我主人');
 await page.getByRole('button',{name:'立即提取',exact:true}).click();
 for(let end=Date.now()+240000;Date.now()<end;){snapshot=await ipc('evolution_snapshot');if(!snapshot.busy)break;await sleep(300);}
 assert.equal(snapshot.busy,false);assert.equal(snapshot.state.runs.at(-1).status,'completed',snapshot.state.runs.at(-1).error);
 const candidate=snapshot.state.candidates.find(c=>c.after.includes('主人')&&c.target==='AGENTS.md');assert.ok(candidate,'Real extraction candidate');
 assert.equal(fs.readFileSync(path.join(data,'pi/agent/AGENTS.md'),'utf8'),fs.readFileSync(path.resolve(__dirname,'../app/src-tauri/resources/AGENTS.md'),'utf8'));
 report.checks.push('Real native dialogue produces sourced candidate without writing before approval');
 const sourceView=await ipc('evolution_source',{id:candidate.id});assert.ok(JSON.stringify(sourceView.messages).includes('以后跟我聊天叫我主人'));
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 const row=page.locator('.evolution-list tbody tr').filter({hasText:candidate.title}).first();await row.waitFor();await row.click();await row.getByRole('checkbox').click();
 await page.getByRole('button',{name:/^批准已选/}).click();
 for(let end=Date.now()+30000;Date.now()<end;){snapshot=await ipc('evolution_snapshot');if(snapshot.state.candidates.find(c=>c.id===candidate.id).status==='written')break;await sleep(100);}
 assert.equal(snapshot.state.candidates.find(c=>c.id===candidate.id).status,'written');assert.ok(fs.readFileSync(path.join(data,'pi/agent/AGENTS.md'),'utf8').includes('主人'));
 report.checks.push('Frontend checkbox and approve button write actual AGENTS.md through Rust');
 agent=await ipc('pi_snapshot');const fresh=await ipc('pi_new_session',{generation:agent.generation,sessionId:agent.state.sessionId});
 assert.notEqual(fresh.state.sessionId,sourceId);assert.equal(fresh.projection.messages.length,0);
 assert.ok(fresh.rules.files.some(file=>file.path.endsWith('AGENTS.md')&&file.status==='loaded'));
 const answer=await send('你好，请简短打个招呼。');
 report.answer=answer.projection.messages.filter(m=>m.role==='assistant').at(-1).content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
 assert.ok(report.answer.includes('主人'));
 report.checks.push('Native new-session command rereads AGENTS.md; new real reply calls user 主人');
 assert.equal(fs.readFileSync(path.join(data,'pi/agent/APPEND_SYSTEM.md'),'utf8'),'测试期间保持简短回答。');
 report.checks.push('APPEND_SYSTEM.md unchanged');
 await page.getByRole('button',{name:/^已写入/}).click();await page.locator('.evolution-list tbody tr').first().click();
 await page.screenshot({path:path.join(out,'approved-desktop.png')});report.candidate=candidate;report.rules=fresh.rules;
 assert.deepEqual(report.errors,[]);report.pass=true;
})().catch(e=>{report.pass=false;report.failure=e instanceof Error?e.stack:JSON.stringify(e);process.exitCode=1;}).finally(async()=>{
 try{if(ipc)await ipc('pi_disconnect');}catch{}
 await browser?.close();
 // Only ephemeral credential copies created for this run; never touch source configuration.
 for(const name of ['models.json','auth.json','settings.json']){const file=path.join(data,'pi/agent',name);if(fs.existsSync(file))fs.unlinkSync(file);}
 fs.writeFileSync(path.join(out,process.argv[4]||'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
