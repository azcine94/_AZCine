/* Current card/ranking revision: real offline Chromium, isolated evidence and source hashes. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/A/AppData/Local/npm-cache/_npx/381cec31605a419a/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const run=path.join(root,'artifacts/validation','card-revision-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(run,{recursive:true});
const report={scope:'Today card directions, company/personal entry, document hierarchy and Arena public snapshot; not production or independent review',checks:[],files:{},errors:[],network:[],layouts:[],run};
const check=(name,passed,detail='')=>{report.checks.push({name,passed,detail});if(!passed)console.error('FAIL',name,JSON.stringify(detail));};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const files=[...fs.readdirSync(path.join(root,'design')).filter(f=>/\.(js|css|html)$/.test(f)).map(f=>'design/'+f),'assets/brand/logo-lockup.png','tests/verify-card-revision.cjs','tests/extract-arena-snapshot.py','research/references/arena/overall-top30.json','research/references/arena/arena-text-source-2026-10-02.txt'];
for(const file of files)report.files[file]=sha(file);
const source=JSON.parse(fs.readFileSync(path.join(root,'research/references/arena/overall-top30.json'),'utf8'));
const fixture={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'design/model-data.js'),'utf8'),fixture);
check('model data identical to traceable extraction',JSON.stringify(fixture.window.AZ_MODELS)===JSON.stringify(source));
const extractCode="import runpy,json; m=runpy.run_path('tests/extract-arena-snapshot.py'); b,r=m['extract'](m['SOURCE'].read_text(encoding='utf-8')); print(json.dumps({'rows':r,'voteCutoff':b['voteCutoffISOString'],'totalModels':b['totalModels'],'totalVotes':b['totalVotes']},ensure_ascii=False))";
const extracted=JSON.parse(execFileSync(process.env.PYTHON_PATH||'python',['-B','-c',extractCode],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}}));
check('30 rows independently reread from captured source bytes',JSON.stringify(extracted.rows)===JSON.stringify(source.rows));
check('source metadata matches extraction, not capture time',extracted.voteCutoff===source.voteCutoff&&extracted.totalModels===source.totalModels&&extracted.totalVotes===source.totalVotes&&source.capturedAt==='2026-10-02T09:03:51.154783+00:00');
check('source bytes match captured sha256',sha('research/references/arena/arena-text-source-2026-10-02.txt')===source.sourceSha256);
check('explicit Overall and default style control',source.arena==='Text Arena'&&source.category==='Overall'&&source.styleControl===true);
check('30 sequential ranks, not screenshot percentages',source.rows.length===30&&source.rows.every((r,n)=>r.rank===n+1&&r.rating>100));
const kit=fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js','utf8');
const knownScroll='div.model-table-scroll,div.doc-table-scroll';
async function inspect(p,label){
 const factory=await p.evaluate(kit);
 // Factory reports descendants of intentional horizontal scrollers as right-edge issues.
 // Keep original output and only exempt right-edge/width issues inside the verified scroll container.
 const findings=await p.evaluate(({factory,knownScroll})=>factory.map(issue=>{
  const el=document.querySelector(issue.el),scroller=el?.closest(knownScroll);
  const permitted=scroller&&['右边越过容器','横向溢出没处理'].includes(issue.kind)&&getComputedStyle(scroller).overflowX==='auto'&&scroller.scrollWidth>scroller.clientWidth;
  return {...issue,permitted:!!permitted};
 }),{factory,knownScroll});
 check(label+' factory no unhandled overflow',findings.every(f=>f.permitted),findings);
 const result=await p.evaluate(()=>{
  const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('.sr-label');};
  const rgb=s=>{const a=(s.match(/[\d.]+/g)||[]).map(Number);return a.length>2?[a[0],a[1],a[2],a[3]??1]:[0,0,0,0];};
  const mix=(a,b)=>[...a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3])),1];
  const bg=e=>e?mix(rgb(getComputedStyle(e).backgroundColor),bg(e.parentElement)):[255,255,255,1];
  const lum=c=>c.slice(0,3).map(x=>(x/=255)<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,v,n)=>a+v*[.2126,.7152,.0722][n],0);
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const low=[],small=[],out=[],overlap=[];
  for(const e of document.querySelectorAll('body *')){
   if(!visible(e))continue;
   const r=e.getBoundingClientRect(),s=getComputedStyle(e);
   if((r.left< -1||r.right>innerWidth+1)&&!e.closest('.model-table-scroll,.doc-table-scroll,.chat-messages'))out.push(e.tagName+'.'+e.className);
   if(e.matches('button,a,input,textarea,select,summary')&&!e.disabled&&r.height<39.9)small.push({tag:e.tagName,cls:e.className,h:r.height});
   if(!e.disabled&&(e.matches('input,textarea,select')||[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))){const ratio=contrast(mix(rgb(s.color),bg(e)),bg(e));if(ratio<4.5)low.push({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,35),ratio});}
  }
  const cards=[...document.querySelectorAll('.today-card')];
  for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){const a=cards[i].getBoundingClientRect(),b=cards[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([i,j]);}
  return {low,small,out,overlap,documentOverflow:document.documentElement.scrollWidth>innerWidth};
 });
 for(const key of ['low','small','out','overlap'])check(label+' '+key,result[key].length===0,result[key]);
 check(label+' document stays in viewport',!result.documentOverflow);
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/A/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
 try{
  for(const variant of ['a','b','c'])for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
   const tag=variant+'-'+theme+'-'+width;
   const context=await browser.newContext({viewport:{width,height}}),p=await context.newPage();
   p.on('pageerror',e=>report.errors.push({tag,error:e.message}));p.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});
   const base=pathToFileURL(path.join(root,'design/workspace-'+variant+'.html')).href+'?theme='+theme;
   const goto=async route=>{await p.evaluate(r=>location.hash=r,route);await p.waitForFunction(r=>document.querySelector('.workspace')?.dataset.route===r,route==='research'||route.startsWith('research/')?'models':route);};
   await p.goto(base+'#today');await p.locator('.today-card').first().waitFor();
   check(tag+' four purposeful cards',await p.locator('.today-card').count()===4&&await p.locator('.review-card').count()===1);
   check(tag+' updated nav without research',await p.locator('[data-nav="models"]').count()===1&&await p.locator('[data-nav="research"]').count()===0&&await p.locator('#data-kind').innerText()==='虚构数据');
   const edges=await p.evaluate(()=>{
    const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};};
    const grid=r('.today-cards'),job=r('.job-strip'),page=r('.page-heading'),cards=[...document.querySelectorAll('.today-card')].map(e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};});
    const baselines=[...document.querySelectorAll('.today-card:not(.review-card) .card-heading')].map(e=>{const h=e.querySelector('h2').getBoundingClientRect(),action=e.lastElementChild.getBoundingClientRect();return Math.abs((h.top+h.bottom)/2-(action.top+action.bottom)/2);});
    return {grid,job,page,cards,baselines};
   });
   report.layouts.push({tag,...edges});
   check(tag+' equal right and left grid edges',Math.abs(edges.grid.left-edges.job.left)<1&&Math.abs(edges.grid.right-edges.job.right)<1&&Math.abs(Math.min(...edges.cards.map(c=>c.left))-edges.grid.left)<1&&Math.abs(Math.max(...edges.cards.map(c=>c.right))-edges.grid.right)<1);
   check(tag+' card heading action baselines',edges.baselines.every(x=>x<1),edges.baselines);
   const pairs=variant==='a'?[[0,1],[2,3]]:variant==='b'?[[1,2]]:[[2,0],[1,3]];
   check(tag+' paired card tops and bottoms align',pairs.every(([a,b])=>Math.abs(edges.cards[a].top-edges.cards[b].top)<1&&Math.abs(edges.cards[a].bottom-edges.cards[b].bottom)<1));
   check(tag+' bottom content stays above job strip',Math.abs(Math.max(...edges.cards.map(c=>c.bottom))-edges.grid.bottom)<1&&edges.job.top>=edges.grid.bottom);
   await inspect(p,tag+'/today');await p.screenshot({path:path.join(run,'today-'+tag+'.png'),fullPage:true});
   await p.locator('[data-check="t1"]').focus();await p.keyboard.press('Space');check(tag+' keyboard complete',await p.locator('[data-check="t1"]').getAttribute('aria-pressed')==='true');await p.locator('[data-action="undo"]').click();check(tag+' keyboard undo',await p.locator('[data-check="t1"]').getAttribute('aria-pressed')==='false');
   await p.locator('[data-select="t1"]').click();check(tag+' card object opens normal page',await p.locator('.workspace').getAttribute('data-route')==='todo/t1'&&!await p.locator('#modal').isVisible());await goto('today');
   check(tag+' card object navigation is not a sticky toggle',await p.locator('.today-card [data-select][aria-pressed],.today-card .selected-row').count()===0);
   for(const preview of ['empty','loading','error']){await goto('help');await p.locator(`[data-state="${preview}"]`).click();check(tag+' today '+preview+' preview honest',await p.locator('.preview-state').count()===1&&await p.locator('.today-card').count()===0);await inspect(p,tag+'/today-'+preview);await p.locator('[data-action="normal"]').click();check(tag+' today '+preview+' returns to cards',await p.locator('.today-card').count()===4);}
   await p.locator('.review-card [data-action="review"]').click();check(tag+' confirmation goes to document proposal',await p.locator('.workspace').getAttribute('data-route')==='projects/film/import/pending'&&await p.locator('#doc-import-apply').isDisabled());
   await goto('projects');check(tag+' company and personal modules',await p.locator('#company-projects-title').innerText()==='公司项目'&&await p.locator('#personal-projects-title').innerText()==='个人项目'&&await p.locator('.document-project-card').count()===1);
   check(tag+' personal no speculative feature buttons',await p.locator('.project-personal-module').innerText().then(t=>t.includes('待定'))&&await p.locator('.project-personal-module button,.project-personal-module a,.project-personal-module input').count()===0);
   await inspect(p,tag+'/projects');if(width===1440)await p.screenshot({path:path.join(run,'projects-'+tag+'.png'),fullPage:true});
   await p.locator('.doc-card-title').click();check(tag+' company document preserved',await p.locator('.project-document').count()===1&&await p.locator('.doc-summary-layout').count()===1&&await p.locator('.doc-summary-date').innerText()==='10/14');
   check(tag+' fixed modifications removed',await p.locator('[data-block="changes"]').count()===0&&!(await p.locator('[data-doc-block-title]').evaluateAll(es=>es.map(e=>e.value))).includes('本轮修改'));
   check(tag+' independent deliveries still grouped faithfully',await p.locator('.doc-summary-line').count()===2&&await p.locator('#doc-summary [data-doc-jump]').count()===3);
   await p.locator('[data-doc-jump="d3"]').click();check(tag+' summary source focus',await p.evaluate(()=>document.activeElement?.dataset.row==='d3'));
   await p.locator('[data-row="d3"][data-doc-cell="date"]').fill('2027-01-05');check(tag+' full crossyear visible',await p.locator('#doc-summary').innerText().then(t=>t.includes('2027-01-05')));
   await p.locator('[data-row="d3"][data-doc-cell="date"]').fill('2026-10-14');await inspect(p,tag+'/document');if(width===1440||width===1024)await p.screenshot({path:path.join(run,'company-'+tag+'.png'),fullPage:true});
   await p.locator('.doc-heading [data-doc-panel="tags"]').click();await inspect(p,tag+'/tags');
   await p.locator('.doc-tag-form[data-tag="bcopy"] input').fill('X'.repeat(40));await p.locator('.doc-tag-form[data-tag="bcopy"] button').click();await p.locator('[data-doc-close-panel]').click();
   await p.locator('[data-row="d2"][data-doc-cell="subject"]').fill('S'.repeat(300));await p.locator('[data-doc-project-title]').fill('长项目标题'.repeat(16));await inspect(p,tag+'/long-document');
   await goto('projects');await inspect(p,tag+'/long-project-card');check(tag+' long company title rendered literally',await p.locator('.doc-card-title').innerText()==='长项目标题'.repeat(16));
   await goto('projects/film');await p.reload();await p.locator('[data-doc-add-row="deliveries"]').waitFor();
   for(const day of ['16','17','18']){await p.locator('[data-doc-add-row="deliveries"]').click();const id=await p.locator('[data-block="deliveries"] tbody tr').last().getAttribute('data-doc-row');await p.locator(`[data-row="${id}"][data-doc-cell="subject"]`).fill('FG_EXTRA_'+day);await p.locator(`[data-row="${id}"][data-doc-cell="stage"]`).selectOption('bcopy');await p.locator(`[data-row="${id}"][data-doc-cell="date"]`).fill('2026-10-'+day);}
   check(tag+' extra delivery groups progressively disclosed',await p.locator('.doc-summary-more summary').innerText()==='其余 2 组交付'&&await p.locator('.doc-summary-more').getAttribute('open')===null);
   await p.locator('.doc-summary-more summary').click();check(tag+' all delivery groups remain accessible',await p.locator('.doc-summary-line:visible').count()===5&&await p.locator('#doc-summary [data-doc-jump]:visible').count()===6);await inspect(p,tag+'/more-deliveries');
   await goto('projects/film/import/pending');await p.locator('#doc-import-choice').selectOption('2026-10-17');await p.locator('#doc-import-date').fill('2026-10-18');await p.locator('#doc-import-apply').click();await goto('today');
   check(tag+' updated dates retain right alignment',await p.locator('.date-label').evaluateAll(es=>es.every(e=>getComputedStyle(e).textAlign==='right'&&getComputedStyle(e).marginTop==='0px')));await inspect(p,tag+'/updated-today');
   await goto('models');check(tag+' model heading and data kind',await p.locator('.page-heading h1').innerText()==='模型榜'&&await p.locator('#data-kind').innerText()==='公开快照');
   check(tag+' top30 exactly',await p.locator('[data-model-rank]').count()===30);
   const actual=await p.locator('.model-table tbody tr').evaluateAll(rows=>rows.map(r=>({rank:Number(r.dataset.modelRank),name:r.querySelector('.model-name').textContent,lab:r.querySelector('.model-lab').firstChild.textContent,input:r.children[2].textContent,output:r.children[3].textContent,votes:r.querySelector('.model-votes').textContent,score:r.querySelector('.model-score strong').textContent,uncertainty:r.querySelector('.model-score span').textContent,preliminary:!!r.querySelector('.model-preliminary')})));
   const fmt=new Intl.NumberFormat('en-US');
   for(let n=0;n<source.rows.length;n++){
    const e=source.rows[n],a=actual[n];
    check(tag+' public row '+(n+1),a.rank===e.rank&&a.name===e.modelDisplayName&&a.lab===e.modelOrganization&&a.input===(e.inputPricePerMillion===null?'—':'$'+fmt.format(e.inputPricePerMillion))&&a.output===(e.outputPricePerMillion===null?'—':'$'+fmt.format(e.outputPricePerMillion))&&a.votes===fmt.format(e.votes)&&a.score===String(Math.round(e.rating))&&a.uncertainty==='±'+Math.round((e.ratingUpper-e.ratingLower)/2)&&a.preliminary===(e.releaseType==='pre_release'),a);
   }
   check(tag+' source and time distinct',await p.locator('.model-board-actions a').getAttribute('href')===source.sourceUrl&&await p.locator('.model-snapshot-time time').first().getAttribute('datetime')===source.voteCutoff&&await p.locator('.model-snapshot-time time').last().getAttribute('datetime')===source.capturedAt);
   check(tag+' no invented release cache or percent fields',JSON.stringify(await p.locator('.model-table thead th').allTextContents())===JSON.stringify(['排名','模型','输入价','输出价','票数','分数 ↓']));
   await inspect(p,tag+'/models');if(width===1440||width===1024)await p.screenshot({path:path.join(run,'models-'+tag+'.png')});
   await p.locator('.model-explanation summary').click();check(tag+' method inline not dialog',await p.locator('.model-explanation').getAttribute('open')!==null&&!await p.locator('#modal').isVisible());await inspect(p,tag+'/method');await p.locator('.model-explanation summary').click();
   await p.locator('#model-update').click();check(tag+' disclosed loading keeps all rows',await p.locator('#model-update').isDisabled()&&await p.locator('[data-model-rank]').count()===30&&await p.locator('.model-notice').innerText().then(t=>t.includes('预览')));await p.locator('[data-model-cancel]').click();check(tag+' cancel does not fake update',await p.locator('.model-notice').innerText().then(t=>t.includes('获取时间不变')));
   await p.locator('#model-update').click();await p.waitForFunction(()=>!!document.querySelector('.model-notice-error'));check(tag+' failure retains source timestamps and rows',await p.locator('[data-model-rank]').count()===30&&await p.locator('.model-snapshot-time time').last().getAttribute('datetime')===source.capturedAt);await inspect(p,tag+'/failure');
   await goto('help');await p.locator('[data-model-preview="empty"]').click();check(tag+' empty no invented ranks',await p.locator('.model-empty').isVisible()&&await p.locator('[data-model-rank]').count()===0);await inspect(p,tag+'/empty');await p.locator('[data-model-reset]').click();
   await goto('research/0');check(tag+' old research goes only to models',await p.locator('.workspace').getAttribute('data-route')==='models'&&await p.evaluate(()=>location.hash)==='#models'&&await p.locator('.research-row,.record-section').count()===0);
   await p.locator('.side [data-nav="news"]').click();await p.goBack();await p.waitForFunction(()=>document.querySelector('.workspace')?.dataset.route==='models');check(tag+' model history back restores normal page',await p.locator('[data-model-rank]').count()===30&&!await p.locator('#modal').isVisible());await p.goForward();await p.waitForFunction(()=>document.querySelector('.workspace')?.dataset.route==='news');await goto('models');
   await p.reload();await p.locator('.model-table').waitFor();check(tag+' model deeplink reload',await p.locator('[data-model-rank]').count()===30);
   await p.locator('[data-action="theme"]').click();check(tag+' model theme switch',await p.locator('html').getAttribute('data-theme')!==theme);
   await context.close();
  }
  // Root entry and its local images/links, not merely a file-existence test.
  const p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>report.errors.push(e.message));
  await p.goto(pathToFileURL(path.join(root,'index.html')).href);await p.waitForURL('**/design/index.html');
  check('root enters current showcase',await p.locator('h1').count()===1);
  check('showcase images load',await p.locator('img').evaluateAll(es=>es.every(e=>e.complete&&e.naturalWidth>0)));
  check('showcase model entry replaces research',await p.locator('a[href="workspace-a.html#models"]').count()===1&&await p.locator('a[href$="#research"]').count()===0);
  await p.close();
  for(const file of files)check('frozen tested file '+file,sha(file)===report.files[file]);
  check('no browser errors',report.errors.length===0,report.errors);check('no automatic external requests',report.network.length===0,report.network);
 }finally{await browser.close();}
 report.summary={passed:report.checks.filter(x=>x.passed).length,failed:report.checks.filter(x=>!x.passed).length};
 fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({run,summary:report.summary}));if(report.summary.failed)process.exitCode=1;
})().catch(e=>{report.errors.push({fatal:e.stack});fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
