/* 迁移后共用页面与固定日报回归；不调用外部服务，不覆盖旧测试证据。 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/A/AppData/Local/npm-cache/_npx/381cec31605a419a/node_modules/playwright');
const root=path.resolve(__dirname,'..'),run=path.join(root,'artifacts/validation/shared-pages-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(run,{recursive:true});
const report={scope:'Shared pages after path migration; not production',checks:[],errors:[],network:[],files:{}};
const files=[...fs.readdirSync(path.join(root,'design')).filter(f=>/\.(js|css|html)$/.test(f)).map(f=>'design/'+f),'assets/brand/logo-lockup.png','tests/verify-shared-pages.cjs'];
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');for(const f of files)report.files[f]=sha(f);
const check=(name,ok,detail='')=>{report.checks.push({name,ok,detail});if(!ok)console.error('FAIL',name,detail);};
const fixture={window:{AZ_V2:{events:[]}}};vm.runInNewContext(fs.readFileSync(path.join(root,'design/news-data.js'),'utf8'),fixture);
const expected=['AZCine / DAILY','2026-10-01','星期四 · 09:12 · v2','AI 日报','从工具恢复到多镜头测试：让工作过程可以回查。','虚构新闻样例 · 非真实报道','时间窗口：2026-09-30 09:00 — 2026-10-01 09:00（北京时间）','今日看点',...['e2','e1','e3'].map((id,n)=>`${n+1}. ${fixture.window.AZ_NEWS.find(i=>i.id===id).title}`),...[['大模型前沿','e2'],['AI 行业动态','e3'],['AI 视频、图片 / CG 应用','e1']].flatMap(([f,id])=>{const i=fixture.window.AZ_NEWS.find(x=>x.id===id);return[f,i.title,i.summary,'推荐理由（Agent 判断）：'+i.reason,'来源：'+i.sources.map(s=>s.name+' '+s.url).join('；')];}),'AZCine · 2026-10-01 · v2 · 虚构样例，不自动发送'];
const normalize=s=>s.replace(/\s+/gu,'');
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/A/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});try{
for(const theme of ['light','dark'])for(const[width,height]of [[1440,900],[1024,768]]){
 const context=await b.newContext({viewport:{width,height}}),p=await context.newPage(),tag=`${theme}-${width}`;p.on('pageerror',e=>report.errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
 await p.goto(pathToFileURL(path.join(root,'design/workspace-a.html')).href+'?theme='+theme+'#today');
 for(const [page,title]of [['today','今天'],['projects','项目'],['news','资讯'],['models','模型榜'],['ideas','灵感'],['agent','Agent'],['jobs','后台任务'],['settings','设置']]){
  await p.locator(`.side [data-nav="${page}"]`).click();check(tag+' nav '+page,await p.locator('.page-heading h1').innerText()===title&&!await p.locator('#modal').isVisible());check(tag+' no horizontal '+page,await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
 }
 await p.locator('[data-nav="news"]').first().click();check(tag+' only 3 domains',JSON.stringify(await p.locator('[data-news-field]').allTextContents())===JSON.stringify(['全部','大模型前沿','AI 行业动态','AI 视频、图片 / CG 应用']));
 for(const f of ['大模型前沿','AI 行业动态','AI 视频、图片 / CG 应用']){await p.locator(`[data-news-field="${f}"]`).click();check(tag+' domain '+f,await p.locator('.news-card').count()===2&&await p.locator('.news-hot li').count()===1);}
 await p.locator('[data-news-field="大模型前沿"]').click();await p.locator('.news-title[data-route="news/e2"]').click();check(tag+' article',await p.locator('.article-prose section').count()===4);await p.locator('#reader-source-select').selectOption('1');check(tag+' no invented body',await p.locator('.article-missing').isVisible()&&await p.locator('.article-prose').count()===0);await p.goBack();await p.waitForFunction(()=>document.querySelector('.workspace').dataset.route==='news');
 await p.locator('[data-route="news/daily"]').first().click();check(tag+' edition exact',normalize(await p.locator('.daily-paper').innerText())===normalize(expected.join('\n')));
 await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>window.__copy=t},configurable:true}));await p.locator('[data-copy-daily]').click();check(tag+' copy exact',await p.evaluate(()=>window.__copy)===expected.join('\n\n'));
 await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('blocked')}},configurable:true}));await p.locator('[data-copy-daily]').click();check(tag+' copy fallback exact',await p.locator('#daily-copy-fallback textarea').inputValue()===expected.join('\n\n'));
 await p.emulateMedia({media:'print'});check(tag+' print DOM exact',normalize(await p.locator('.daily-paper').innerText())===normalize(expected.join('\n')));
 if(width===1440){const pdf=path.join(run,'daily-'+theme+'.pdf'),txt=path.join(run,'daily-'+theme+'.txt');await p.pdf({path:pdf,format:'A4',printBackground:true});execFileSync(process.env.PDFTOTEXT_PATH||'pdftotext',['-raw','-enc','UTF-8',pdf,txt]);check(tag+' real PDF exact',normalize(fs.readFileSync(txt,'utf8'))===normalize(expected.join('\n')));}
 await p.emulateMedia({media:'screen'});await p.locator('[data-nav="agent"]').click();await p.locator('#chat-input').fill('保留输入草稿');await p.locator('[data-nav="ideas"]').click();await p.goBack();await p.waitForFunction(()=>document.querySelector('.workspace').dataset.route==='agent');check(tag+' chat draft',await p.locator('#chat-input').inputValue()==='保留输入草稿');
 await p.locator('#chat-input').dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});check(tag+' IME no send',await p.locator('.user-message').count()===0);
 await p.locator('#chat-send').click();await p.locator('[data-stop-chat]').click();check(tag+' stop visible',await p.locator('.message-interrupted').count()===1);
 await p.locator('[data-nav="ideas"]').click();await p.locator('#idea-title').fill('草稿标题');await p.locator('#idea-body').fill('草稿内容');await p.locator('[data-edit-idea="i1"]').click();await p.locator('[data-cancel-edit]').click();check(tag+' ideas draft',await p.locator('#idea-title').inputValue()==='草稿标题');await p.locator('#idea-form [type="submit"]').click();check(tag+' idea saved',await p.locator('.idea-card').first().innerText().then(t=>t.includes('草稿标题')));
 await p.locator('[data-nav="today"]').click();await p.locator('.page-heading [data-action="note"]').click();await p.goBack();await p.waitForFunction(()=>document.querySelector('.workspace').dataset.route==='ideas');check(tag+' history closes old dialog',!await p.locator('#modal').isVisible());
 await p.locator('[data-action="theme"]').click();check(tag+' theme',await p.locator('html').getAttribute('data-theme')!==theme);
 await context.close();
}
for(const f of files)check('unchanged '+f,sha(f)===report.files[f]);check('No errors',!report.errors.length,report.errors);check('No external',!report.network.length,report.network);
}finally{await b.close();}report.summary={passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length};fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({run,summary:report.summary}));if(report.summary.failed)process.exitCode=1;})().catch(e=>{report.errors.push(e.stack);fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
