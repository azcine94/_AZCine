const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {browserRuntime}=require('./support/browser.cjs');
const {installTitleFixture}=require('./support/pi-session-title-fixture.cjs');
const out=path.resolve('artifacts/validation/release-011-20261009');
(async()=>{let server,browser;const checks=[];try{
 const {createServer}=await import(pathToFileURL(path.resolve('app/node_modules/vite/dist/node/index.js')).href);
 server=await createServer({root:path.resolve('app'),configFile:path.resolve('app/vite.config.ts'),configLoader:'runner',cacheDir:path.join(out,'vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:true},clearScreen:false});await server.listen();
 const runtime=browserRuntime();browser=await runtime.chromium.launch({executablePath:runtime.executablePath,headless:true});
 for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
  await page.addInitScript(installTitleFixture);
  await page.addInitScript(()=>{
   const f=window.titleFixture,original=window.__TAURI_INTERNALS__.invoke;
   const model={id:'model-a',name:'隔离测试模型',provider:'fixture',api:'openai-responses',input:['text','image'],reasoning:false,contextWindow:128000,maxTokens:8192};
   f.snapshot.models=[model,{...model,id:'model-b'}];f.snapshot.state.model=model;f.catalogFails=true;f.queue={entries:[],paused:{}};
   window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
    if(command==='pi_model_catalog'){if(f.catalogFails)throw Error('explicit temporary catalog lock');return structuredClone(f.snapshot.models);}
    if(command==='agent_bind')return{conversationKey:'default',sessionId:f.snapshot.state.sessionId,sessionPath:null,source:{module:'agent',page:'agent',objectId:null},title:'隔离测试',cwd:f.snapshot.cwd};
    if(command==='agent_view_conversation')return structuredClone(f.snapshot);
    if(command==='agent_remember')return{};
    if(command==='agent_queue_read')return structuredClone(f.queue);
    if(command==='agent_queue_tick'){if(f.queue.paused.default)return structuredClone(f.queue);return new Promise(resolve=>{f.pendingTick=resolve;});}
    if(command==='agent_queue_mutate'){f.calls.push({command,args});if(args.input.action==='pause')f.queue.paused.default=true;return structuredClone(f.queue);}
    if(command==='pi_stop'){f.calls.push({command,args});f.pendingTick?.(structuredClone(f.queue));f.pendingTick=null;return structuredClone(f.snapshot);}
    if(command==='pi_select_model'){f.snapshot.state.model={...model,id:args.id};f.snapshot.seq++;return structuredClone(f.snapshot);}
    if(command==='pi_connect'){f.snapshot.generation++;f.snapshot.seq++;f.snapshot.state.sessionId='reconnected-fixture';f.snapshot.state.sessionFile='X:/ExplicitTitleRefresh/pi/sessions/reconnected.jsonl';return structuredClone(f.snapshot);}
    return original(command,args);
   };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pi-session-title-refresh.html`);
  await page.waitForFunction(()=>window.titleModel?.snapshot?.state&&window.titleModel.modelCatalogError);
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.titleModel.setText('未发送的文字草稿');window.titleModel.setImages([{id:'fixture-image',name:'test.png',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS7sAAAAASUVORK5CYII='}]);},theme);
  await page.waitForFunction(()=>window.titleModel.draft.images.length===1);
  assert.equal(await page.evaluate(()=>window.titleModel.modelCatalog),null);
  await page.evaluate(()=>window.titleModel.sessionAction('pi_select_model',{provider:'fixture',id:'model-b'}));
  assert.equal(await page.evaluate(()=>window.titleModel.draft.text),'未发送的文字草稿');assert.equal(await page.evaluate(()=>window.titleModel.draft.images.length),1);
  await page.waitForFunction(()=>!!window.titleFixture.pendingTick);
  await Promise.race([page.evaluate(()=>window.titleModel.stop()),new Promise((_,reject)=>setTimeout(()=>reject(Error('stop deadlocked')),5000))]);
  const order=await page.evaluate(()=>window.titleFixture.calls.filter(c=>c.command==='agent_queue_mutate'||c.command==='pi_stop').map(c=>c.command));assert.deepEqual(order,['agent_queue_mutate','pi_stop']);
  await page.evaluate(()=>{window.titleFixture.catalogFails=false;return window.titleModel.connect(undefined,true);});
  await page.waitForFunction(()=>window.titleModel.modelCatalog?.length===2&&!window.titleModel.modelCatalogError);
  assert.equal(await page.evaluate(()=>window.titleModel.draft.text),'未发送的文字草稿');assert.equal(await page.evaluate(()=>window.titleModel.draft.images.length),1);
  assert.equal(await page.evaluate(()=>window.titleModel.snapshot.state.sessionId),'reconnected-fixture');
  await page.screenshot({path:path.join(out,`agent-${theme}-${width}.png`)});
  checks.push(`${theme} ${width}: catalog fallback/retry, text+image drafts, out-of-band queue stop`);await context.close();
 }
 console.log(JSON.stringify(checks));fs.writeFileSync(path.join(out,'agent-ui.json'),JSON.stringify({mode:'isolated explicit IPC replay, production React hook',checks},null,2));
}catch(e){console.error(e);process.exitCode=1;}finally{await browser?.close();await server?.close();}})();
