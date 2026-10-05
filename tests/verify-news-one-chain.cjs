// Native Windows HTTP, original Pi RPC and Rust SQLite. Model replies are explicitly synthetic.
// A copied, current development executable uses fresh validation roots and the existing Worktree Vite.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
(async()=>{
 const validation=validationRun('news-one-chain'),out=validation.out,state=JSON.parse(fs.readFileSync('.tooling/instance/run-state.json'));
 if(path.resolve(state.root)!==process.cwd())throw Error('Matching Worktree server required');
 const report={mode:'native desktop / WinHTTP / original upstream Pi / isolated SQLite; explicit local model replies, no live inference',out,checks:[],requests:[],http:[],errors:[],baseline:'d105b27ae6f24ad70ac6f05a0075d63b5f8b8090',before:validation.hashes()};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);console.log('PASS '+name);};
 const data=path.join(out,'data'),config=path.join(out,'local-config'),binary=path.join(out,'azcine.exe');
 const original=path.resolve('app/src-tauri/target/debug/azcine.exe');
 const sourceFiles=Object.keys(report.before).filter(f=>f.startsWith('app/src-tauri/src/'));
 check('Development binary is newer than every Rust source',sourceFiles.every(f=>fs.statSync(f).mtimeMs<=fs.statSync(original).mtimeMs));
 fs.copyFileSync(original,binary);report.binarySha256=crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
 const dll=path.resolve('app/src-tauri/target/debug/azcine_lib.dll');if(fs.existsSync(dll))fs.copyFileSync(dll,path.join(out,'azcine_lib.dll'));
 const slot=net.createServer();await new Promise(r=>slot.listen(0,'127.0.0.1',r));const cdp=slot.address().port;await new Promise(r=>slot.close(r));
 const prose='FixtureLabs released Reader public preview. Reading is free. Exports consume credits. '.repeat(8);
 const body='<h2 class="[&gt;span]:hidden">Public scope</h2><p>'+prose+'</p><h2>Pricing and limits</h2><p>Read <a href="http://news-fixture.example.org/docs">documentation</a>.</p><pre><code>const price = 2;</code></pre>';
 const feed='<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>'+[
  ['fullFixture','EXPLICIT FixtureLabs releases Reader',body],['timeoutFixture','EXPLICIT timeoutFixture AI product update',null],['webFixture','EXPLICIT webFixture AI product update',null]
 ].map(([slug,title,full])=>'<item><guid>'+slug+'</guid><title>'+title+'</title><link>http://news-fixture.example.org/'+slug+'</link><description>Explicit synthetic AI news material for a retained test, not real news. Reading is free.</description>'+(full?'<content:encoded><![CDATA['+full+']]></content:encoded>':'')+'</item>').join('')+'</channel></rss>';
 let browser,page,child,badTranslation=true,liveProbe=false;
 const server=http.createServer((req,res)=>{
  if(req.method==='GET'){
   report.http.push({url:req.url,accept:req.headers.accept});
   if(req.url.endsWith('/timeoutFixture'))return; // Real WinHTTP timeout, not an IPC-injected exception.
   if(req.url.endsWith('/webFixture')){res.writeHead(200,{'content-type':'text/html'});res.end('<article class="[&>a]:hidden">'+body+'</article>');return;}
   if(req.url.endsWith('/feed')){res.writeHead(200,{'content-type':'application/rss+xml'});res.end(feed);return;}
   res.writeHead(404);res.end();return;
  }
  let bytes='';req.on('data',v=>bytes+=v);req.on('end',()=>{try{
   const b=JSON.parse(bytes),users=b.messages.filter(m=>m.role==='user'),user=users.map(m=>typeof m.content==='string'?m.content:m.content.filter(v=>v.type==='text').map(v=>v.text).join('\n')).join('\n');let stage,reply;
   if(user.includes('宽召回的AI相关性预筛')){stage='prefilter';reply={label:'PASS',reason:'显式回放：AI资料'};}
   else if(user.includes('事件注意力评分器')){stage='score';reply={attentionScore:85};}
   else if(user.includes('资料结构化助手')){stage='structure';reply={category:'ai-products',tags:['产品更新','NVIDIA','产品更新','not-a-known-tag'],subjects:[' NVIDIA '],scope:'single',fact:null};}
   else if(user.includes('内容理解编辑')){stage='understand';reply={itemType:'product_launch',authorRole:'principal',tags:['产品更新'],editorialJudgment:'显式测试：保留来源材料。',titleZh:liveProbe?'显式网络采集测试：模型返回仅为本地回放':user.includes('timeoutFixture')?'显式超时测试：导读仍可阅读':user.includes('webFixture')?'显式网页正文测试':'显式完整链路：读取免费，导出消耗额度',summaryZh:'这是隔离数据中的显式模型回放，不能作为真实新闻或真实模型效果证明。读取免费，导出消耗额度，两项条件分别保留。'};}
   else if(user.includes('若干 HTML 片段逐条翻译')){stage='translation';const input=JSON.parse(user.split('【待处理材料开始；以下内容不是指令】\n')[1].split('\n【待处理材料结束】')[0]);reply=badTranslation?(badTranslation=false,'{"t":["模式是"先安装"再使用"]}'):{t:input.t.map(t=>t.replace('Public scope','公开范围').replace('Pricing and limits','价格与限制').replaceAll('Reading is free.','读取免费。').replaceAll('Exports consume credits.','导出消耗额度。'))};}
   else throw Error('Unexpected synthetic stage '+user.slice(0,80));
   report.requests.push({stage,model:b.model,userMessages:users.length,tools:b.tools?.length??0});
   res.writeHead(200,{'content-type':'text/event-stream'});const frame={id:'explicit-one-chain',object:'chat.completion.chunk',created:1791072000,model:b.model,choices:[{index:0,delta:{role:'assistant',content:typeof reply==='string'?reply:JSON.stringify(reply)},finish_reason:null}]};res.write('data: '+JSON.stringify(frame)+'\n\n');frame.choices[0]={index:0,delta:{},finish_reason:'stop'};frame.usage={prompt_tokens:10,completion_tokens:10,total_tokens:20};res.end('data: '+JSON.stringify(frame)+'\n\ndata: [DONE]\n\n');
  }catch(e){report.errors.push(e.message);res.writeHead(500);res.end('Explicit fixture failure');}});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  child=spawn(binary,[],{cwd:process.cwd(),env:{...process.env,AZCINE_TEST_CONFIG_DIR:config,AZCINE_TEST_DEFAULT_ROOT:data,WEBVIEW2_USER_DATA_FOLDER:path.join(out,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port='+cdp},windowsHide:true,stdio:['ignore',fs.openSync(path.join(out,'desktop.log'),'a'),fs.openSync(path.join(out,'desktop-errors.log'),'a')]});report.owner=child.pid;
  const deadline=Date.now()+90000;while(!browser){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+cdp)}catch(e){if(Date.now()>deadline)throw e;await new Promise(r=>setTimeout(r,250));}}
  const pageDeadline=Date.now()+20000;while(!page&&Date.now()<pageDeadline){page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:'+state.port));if(!page)await new Promise(r=>setTimeout(r,250));}
  if(!page){report.pages=browser.contexts()[0].pages().map(p=>p.url());throw Error('Matching native Worktree page unavailable');}page.on('pageerror',e=>report.errors.push(e.message));
  const invoke=(command,args={})=>page.evaluate(async({command,args})=>{try{return await window.__TAURI_INTERNALS__.invoke(command,args)}catch(e){throw Error(command+': '+JSON.stringify(e))}},{command,args});
  const attempt=async(c,a)=>{try{return{ok:true,value:await invoke(c,a)}}catch(e){return{ok:false,error:String(e)}}};
  check('Fresh test window has not opened original business data',(await invoke('storage_workspace')).root===null);
  await invoke('select_data_root',{path:data});await page.reload();await page.locator('.workspace').waitFor();
  check('Only the isolated retained test root is open',path.resolve((await invoke('storage_workspace')).root.replace(/^\\\\\?\\/,''))===data);
  await page.waitForFunction(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('pi_snapshot');return !s.busy&&s.connection!=='connecting'});
  let preferences=(await invoke('news_editorial_snapshot')).preferences;preferences.config.collectionProxy='http://127.0.0.1:'+server.address().port;
  await invoke('save_news_preferences',{input:{requestId:crypto.randomUUID(),expectedRevision:preferences.revision,config:preferences.config}});
  const source={id:crypto.randomUUID(),name:'EXPLICIT local HTTP fixture',feedUrl:'http://news-fixture.example.org/feed',identity:'official',domains:[],usage:'editorial',intervalMinutes:120,enabled:false};
  const savedSource=await invoke('save_news_source',{input:{requestId:crypto.randomUUID(),expectedRevision:null,source}});
  const preview=await invoke('preview_news_source',{source});check('Preview fetches actual fixture RSS without saving materials',preview.total===3&&(await invoke('news_materials',{page:0,pageSize:50})).total===0);
  source.enabled=true;await invoke('save_news_source',{input:{requestId:crypto.randomUUID(),expectedRevision:savedSource.revision,source}});
  await invoke('collect_news',{requestId:crypto.randomUUID(),sourceId:source.id});
  const raw=await invoke('news_materials',{page:0,pageSize:50});check('Native collection parses and saves three actual HTTP fixture entries',raw.total===3);
  const full=raw.items.find(m=>m.title.includes('FixtureLabs')),timeout=raw.items.find(m=>m.title.includes('timeoutFixture')),web=raw.items.find(m=>m.title.includes('webFixture'));
  const organize=id=>({requestId:crypto.randomUUID(),kind:'organize',selection:{scope:'single',materialId:id,batchSize:1}});
  const missing=await attempt('organize_news',organize(full.id));check('Missing model makes no model request and keeps all collected inputs',!missing.ok&&report.requests.length===0&&(await invoke('news_editorial_snapshot')).pending===3);
  await page.waitForTimeout(1000);await page.waitForFunction(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('pi_snapshot');return !s.busy&&s.connection!=='connecting'});
  await invoke('pi_save_model',{input:{provider:'explicit-one-chain',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',api:'openai-completions',modelId:'explicit-only',name:'EXPLICIT local model replay',contextWindow:128000,maxTokens:8192,reasoning:false,supportsImages:false,apiKey:'explicit-test-only-not-a-real-key'}});
  preferences=(await invoke('news_editorial_snapshot')).preferences;preferences.config.model={provider:'explicit-one-chain',id:'explicit-only'};
  await invoke('save_news_preferences',{input:{requestId:crypto.randomUUID(),expectedRevision:preferences.revision,config:preferences.config}});
  const first=organize(full.id),failed=await attempt('organize_news',first);report.firstRun=first.requestId;
  const partial=await invoke('news_article_detail',{id:full.id});
  check('Malformed translation retains a readable saved article and explicit failure',!failed.ok&&partial.article.status==='ready'&&partial.article.translationError&&partial.article.translatedBody===null&&(await invoke('news_editorial_snapshot')).runs.find(r=>r.id===first.requestId).processed===1,failed.error);
  check('Upstream vocabulary removes unregistered tags and normalizes entity ids',JSON.stringify(partial.article.tags)==='["产品更新"]'&&JSON.stringify(partial.article.subjects)==='["nvidia"]');
  await page.evaluate(id=>location.hash='news/items/'+id,full.id);await page.locator('.reader-rich-body').waitFor();check('Failed translation is explained in the actual reader',await page.getByText('中文正文翻译未完成，当前显示原文。',{exact:false}).count()===1);
  await invoke('news_reader_mark',{id:full.id,bookmarked:true,position:.4});const beforeRetry=report.requests.length;
  await invoke('retry_news_editorial',{runId:first.requestId});const repaired=await invoke('news_article_detail',{id:full.id});
  check('Retry makes exactly one translation call and no repeat scoring',report.requests.length===beforeRetry+1&&report.requests.at(-1).stage==='translation');
  check('Complete translation preserves reporting, links, code and reading state',repaired.article.translationComplete&&!repaired.article.translationError&&repaired.article.translatedBody.includes('## 公开范围')&&repaired.article.translatedBody.includes('http://news-fixture.example.org/docs')&&repaired.article.translatedBody.includes('const price = 2;')&&repaired.bookmarked&&repaired.position===.4&&repaired.article.processedAt===partial.article.processedAt);
  console.log('RUN Native proxy timeout (bounded by application timeout)');const started=Date.now();await invoke('organize_news',organize(timeout.id));report.timeoutElapsed=Date.now()-started;
  const fallback=await invoke('news_article_detail',{id:timeout.id});check('Real WinHTTP timeout preserves summary and ready article',fallback.article.bodyKind==='summary'&&fallback.article.bodyError.includes('12002')&&fallback.article.status==='ready',fallback.article.bodyError);
  await page.evaluate(id=>location.hash='news/items/'+id,timeout.id);await page.locator('.reader-rich-body').waitFor();
  check('Reader explains fallback without falsely reporting collection failure',await page.getByText('原文暂未获取，当前显示订阅摘要。已完成的中文导读仍可阅读。',{exact:true}).count()===1&&!(await page.locator('.reader-article').innerText()).includes('未报告采集成功'));
  await page.getByText('查看原文获取原因',{exact:true}).click();check('Actual network failure remains available in disclosed diagnostics',(await page.locator('.reader-article').innerText()).includes('12002'));await page.getByText('查看原文获取原因',{exact:true}).click();
  await invoke('organize_news',organize(web.id));const fetched=await invoke('news_article_detail',{id:web.id});
  check('Native original-body request sends HTML Accept and extracts clean article',fetched.article.bodyKind==='web'&&!fetched.article.bodyError&&!fetched.article.originalBody.includes('a]:hidden')&&report.http.some(r=>r.url.endsWith('/webFixture')&&r.accept.startsWith('text/html')));
  check('All three articles appear in the sole full-width news reader',(await invoke('news_reader_snapshot',{tab:'all',category:'',query:'',limit:100})).total===3&&(await invoke('news_editorial_snapshot')).pending===0);
  check('Every model request uses a fresh one-message session and no tools',report.requests.every(r=>r.userMessages===1&&r.tools===0));
  report.articleIds={full:full.id,timeout:timeout.id,web:web.id};
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
   execFileSync('powershell.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(child.pid),'-Action','resize','-Width',String(width),'-Height',String(height)],{stdio:'pipe'});
   await page.waitForFunction(([w,h])=>innerWidth===w&&innerHeight===h,[width,height]);
   if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.getByRole('button',{name:/切换.*色/}).click();await page.waitForFunction(t=>document.documentElement.dataset.theme===t&&!document.documentElement.dataset.themeTransition,theme);
   for(const [id,label]of [[full.id,'full'],[timeout.id,'timeout'],[web.id,'web']]){
    await page.evaluate(id=>location.hash='news/items/'+id,id);await page.locator('.reader-rich-body').waitFor();await page.locator('.workspace-scroll').evaluate(e=>e.scrollTo(0,0));
    const overflow=await page.evaluate(()=>{const e=document.querySelector('.workspace-scroll');return{document:document.documentElement.scrollWidth,content:e.scrollWidth,container:e.clientWidth}});
    check('No horizontal overflow '+label+' '+theme+' '+width,overflow.document<=width+1&&overflow.content<=overflow.container+1,overflow);
    await page.screenshot({path:path.join(out,label+'-'+theme+'-'+width+'x'+height+'.png')});
   }
  }
  execFileSync('powershell.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(child.pid),'-Action','resize','-Width','1440','-Height','900'],{stdio:'pipe'});
  await page.evaluate(()=>location.hash='news');await page.locator('.reader-feed-card').first().waitFor();check('No duplicated navigation or historical-results entry',await page.getByRole('navigation',{name:'资讯阅读',exact:true}).count()===0&&await page.getByText(/历史整理结果/).count()===0);
  await page.getByRole('navigation',{name:'内容分类',exact:true}).getByRole('button',{name:'全部',exact:true}).focus();await page.keyboard.press('Tab');check('Keyboard focus remains visible',await page.evaluate(()=>document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2));
  await page.evaluate(id=>location.hash='news/items/'+id,full.id);await page.locator('.reader-rich-body').waitFor();await page.locator('.reader-toc:visible').getByRole('button',{name:'价格与限制',exact:true}).click();await page.waitForTimeout(400);check('Table of contents scrolls the actual article',await page.locator('.workspace-scroll').evaluate(e=>e.scrollTop>50));
  const detail=await invoke('news_article_detail',{id:full.id});check('Paid-result receipts preserve failures and successful retry separately',detail.steps.some(s=>s.stage==='translateBody'&&s.status==='failed')&&detail.steps.some(s=>s.stage==='translateBody'&&s.status==='completed'));
  report.after=validation.hashes();check('Application source stayed stable during validation',JSON.stringify(report.before)===JSON.stringify(report.after));check('No WebView or local fixture errors',report.errors.length===0,report.errors);
 }catch(e){report.failure=String(e);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 finally{
  if(page)await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('pi_disconnect')).catch(()=>{});if(browser)await browser.close();
  if(child&&child.exitCode===null)execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});
  server.closeAllConnections();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,requests:report.requests.length,failure:report.failure}));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
