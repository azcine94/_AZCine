/* 新文档项目设计验收；每次独立英文run目录，不覆盖旧稿证据。 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/A/AppData/Local/npm-cache/_npx/381cec31605a419a/node_modules/playwright');
const root=path.resolve(__dirname,'..'),design=path.join(root,'design');
const run=path.join(root,'artifacts/validation','project-document-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(run,{recursive:true});
const report={scope:'Document-first project prototype and shared-page regression; not production',checks:[],files:{},layouts:[],errors:[],requests:[],run};
const files=['design/model-data.js','design/models.js','design/models.css','design/projects.js','design/projects.css','design/app.js','design/pages.js','design/data.js','design/news.js','design/news-data.js','design/news.css','design/tokens.css','design/base.css','design/workspace.css','design/pages.css','design/workspace-a.html','design/workspace-b.html','design/workspace-c.html','assets/brand/logo-lockup.png','design/project-document.html','tests/verify-project-document.cjs'];
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');for(const f of files)report.files[f]=sha(f);
function check(name,passed,detail=''){report.checks.push({name,passed,detail});if(!passed)console.error('FAIL',name,JSON.stringify(detail));}
const kit=fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js','utf8');
async function inspect(p,label,baseline=false){
 if(baseline){const found=await p.evaluate(kit);check(label+' factory overflow',found.length===0,found);}
 const result=await p.evaluate(()=>{
  const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('.sr-label');};
  const rgb=s=>{const a=(s.match(/[\d.]+/g)||[]).map(Number);return a.length>2?[a[0],a[1],a[2],a[3]??1]:[0,0,0,0];};
  const mix=(a,b)=>[...a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3])),1];
  const bg=e=>e?mix(rgb(getComputedStyle(e).backgroundColor),bg(e.parentElement)):[255,255,255,1];
  const lum=c=>c.slice(0,3).map(x=>(x/=255)<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const low=[],small=[],out=[],overlap=[];
  const scope=document.querySelector('dialog[open]')||document.body;
  for(const e of scope.querySelectorAll('*')){if(!visible(e))continue;const s=getComputedStyle(e),r=e.getBoundingClientRect();
   const scrollParent=e.closest('.doc-table-scroll,.chat-messages');
   if((r.right>innerWidth+1||r.left< -1)&&!scrollParent)out.push(e.tagName+'.'+e.className);
   if(e.matches('button,a,input,select,textarea,summary')&&r.height<39.9&&!e.disabled)small.push({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,30),h:r.height});
   if(e.matches('input,textarea,select')||[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())){const contrast=ratio(mix(rgb(s.color),bg(e)),bg(e));if(contrast<4.5&&!e.disabled)low.push({tag:e.tagName,text:e.textContent.slice(0,25),contrast});}
  }
  for(const tr of document.querySelectorAll('.doc-table tr')){let right=-1;for(const td of tr.children){const r=td.getBoundingClientRect();if(r.left<right-1)overlap.push(td.textContent);right=r.right;}}
  return{low,small,out,overlap,documentOverflow:document.documentElement.scrollWidth>innerWidth};
 });
 for(const k of ['low','small','out','overlap'])check(label+' '+k,result[k].length===0,result[k]);check(label+' document width',!result.documentOverflow);
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/A/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
 try{for(const variant of ['A','B','C'])for(const theme of ['light','dark'])for(const[width,height]of [[1440,900],[1280,800],[1024,768]]){
 const context=await browser.newContext({viewport:{width,height}}),p=await context.newPage(),label=`${variant}-${theme}-${width}`;
 p.on('pageerror',e=>report.errors.push({label,error:e.message}));p.on('request',r=>{if(/^https?:/.test(r.url()))report.requests.push(r.url());});
 const base=pathToFileURL(path.join(design,`workspace-${variant.toLowerCase()}.html`)).href+'?theme='+theme;
 const goto=async route=>{await p.evaluate(r=>location.hash=r,route);await p.waitForFunction(r=>location.hash==='#'+r&&document.querySelector('.workspace')?.dataset.route===r,route);};
 const submit=id=>p.locator(`#${id} button[type="submit"]`).click();
 const cell=(row,col)=>p.locator(`[data-row="${row}"][data-doc-cell="${col}"]`);
 await p.goto(base+'#projects');
 check(label+' company cards',await p.locator('.document-project-card').count()===1);
 check(label+' separate modules and personal undecided',await p.locator('.project-company-module').count()===1&&await p.locator('.project-personal-module').innerText().then(t=>t.includes('待定'))&&await p.locator('.project-personal-module button,.project-personal-module a').count()===0);
 check(label+' no old fictional app',!await p.locator('body').innerText().then(t=>t.includes('素材索引器')));
 check(label+' brand loads',await p.locator('.brand-lockup').evaluate(e=>e.complete&&e.naturalWidth>0));
 await inspect(p,label+'/cards',true);await p.screenshot({path:path.join(run,label+'-cards.png')});
 await p.locator('.doc-card-title[data-route="projects/film"]').click();
 check(label+' document not old tabs',await p.locator('.project-document').count()===1&&await p.locator('.project-tabs,.project-node').count()===0&&!await p.locator('#modal').isVisible());
 check(label+' initial grouped summary',await p.locator('.doc-summary-line').count()===2&&await p.locator('#doc-summary').innerText().then(t=>t.includes('FG_021')&&t.includes('FG_024')&&!t.includes('ACOPY')));
 const layout=await p.evaluate(()=>{const r=s=>{const x=document.querySelector(s).getBoundingClientRect();return{left:x.left,right:x.right,top:x.top,bottom:x.bottom}};return{main:r('.workspace'),heading:r('.doc-heading'),summary:r('#doc-summary'),block:r('.document-block')};});report.layouts.push({label,...layout});
 check(label+' document alignment',layout.heading.left===layout.summary.left&&layout.block.right===layout.summary.right);
 await inspect(p,label+'/doc',true);await p.screenshot({path:path.join(run,label+'-document.png'),fullPage:true});
 await p.locator('[data-doc-jump="d3"]').click();check(label+' summary locates source',await p.evaluate(()=>document.activeElement?.dataset.row==='d3'));
 await cell('d2','date').fill('2027-01-05');await cell('d2','note').fill('新交付内容');
 check(label+' cross year summary',await p.locator('#doc-summary').innerText().then(t=>t.includes('2027-01-05')));
 await cell('d3','status').selectOption('已提交');check(label+' submitted excluded',await p.locator('#doc-summary [data-doc-jump="d3"]').count()===0);
 await p.locator('.side [data-nav="today"]').click();check(label+' home derives exact row',await p.locator('[data-select="d2"]').innerText().then(t=>t.includes('2027-01-05'))&&await p.locator('[data-select="d3"]').count()===0);
 await goto('projects/film');check(label+' values survive navigation',await cell('d2','date').inputValue()==='2027-01-05'&&await cell('d2','note').inputValue()==='新交付内容');
 await p.locator('[data-doc-panel="tags"]').click();
 await p.locator('.doc-tag-form[data-tag="bcopy"] input').fill('BCOPY+');await p.locator('.doc-tag-form[data-tag="bcopy"] button').click();
 check(label+' tag rename follows ID',await cell('d2','stage').inputValue()==='bcopy'&&await cell('d2','stage').locator('option:checked').innerText()==='BCOPY+'&&await p.locator('#doc-summary').innerText().then(t=>t.includes('BCOPY+')));
 await p.locator('.doc-tag-form[data-tag="bcopy"] input').fill('ACOPY');await p.locator('.doc-tag-form[data-tag="bcopy"] button').click();check(label+' duplicate tag blocked',await p.locator('.doc-tag-form[data-tag="bcopy"] .err').innerText().then(t=>t.includes('重复')));
 await p.locator('#doc-tag-name').fill('客户版');await submit('doc-add-tag-form');
 await cell('d2','stage').selectOption({label:'客户版'});check(label+' custom stage summary',await p.locator('#doc-summary').innerText().then(t=>t.includes('客户版')));
 await goto('projects/new');await p.locator('#doc-project-name').fill('第二公司项目');await submit('doc-create-form');const secondProject=await p.evaluate(()=>location.hash.split('/')[1]);
 await p.locator('.doc-heading [data-doc-panel="tags"]').click();check(label+' tags scoped to company project',!await p.locator('.doc-tags').innerText().then(t=>t.includes('客户版'))&&await p.locator('.doc-tag-form').count()===0);
 await goto('projects/film');await p.locator('[data-doc-panel="columns:deliveries"]').click();
 check(label+' required role cannot delete while summarized',await p.locator('[data-doc-remove-column="date"]').isDisabled());
 await p.locator('.doc-column-form[data-column="subject"] input').fill('镜头编号');await p.locator('.doc-column-form[data-column="subject"] [type="submit"]').click();
 check(label+' renamed column keeps summary',await p.locator('.doc-table th').first().innerText()==='镜头编号'&&await p.locator('#doc-summary [data-doc-jump="d2"]').count()===1);
 await p.locator('#doc-column-name').fill('输出路径');await submit('doc-add-column-form');const newcol=await p.locator('.doc-column-form').last().getAttribute('data-column');
 await cell('d2',newcol).fill('E:/preview/test.mov');await inspect(p,label+'/extra-column');
 await p.locator(`[data-doc-remove-column="${newcol}"]`).click();await p.locator('[data-action="undo"]').click();check(label+' column undo restores values',await cell('d2',newcol).inputValue()==='E:/preview/test.mov');
 await p.locator('[data-doc-close-panel]').click();
 // 删除语义列→重新启用汇总→撤销，恢复旧数据；有新值冲突时明确提示并允许重试。
 await p.locator('[data-block="deliveries"] [data-doc-summary-toggle]').uncheck();
 await p.locator('[data-doc-panel="columns:deliveries"]').click();await p.locator('[data-doc-remove-column="date"]').click();
 await p.locator('[data-block="deliveries"] [data-doc-summary-toggle]').check();
 await p.locator('[data-action="undo"]').click();check(label+' restore semantic column after auto replacement',await cell('d2','date').inputValue()==='2027-01-05'&&await p.locator('[data-block="deliveries"] .doc-column-form').count()===0);
 await p.locator('[data-block="deliveries"] [data-doc-summary-toggle]').uncheck();await p.locator('[data-doc-remove-column="date"]').click();await p.locator('[data-block="deliveries"] [data-doc-summary-toggle]').check();
 const replacement=await p.locator('[data-doc-row="d2"] input[type="date"]').getAttribute('data-doc-cell');await cell('d2',replacement).fill('2028-02-01');
 await p.locator('[data-action="undo"]').click();check(label+' semantic restore conflict explicit',await p.locator('#toast').innerText().then(t=>t.includes('冲突'))&&await cell('d2',replacement).inputValue()==='2028-02-01');
 await cell('d2',replacement).fill('');await p.locator('[data-action="undo"]').click();check(label+' semantic restore retry preserves old values',await cell('d2','date').inputValue()==='2027-01-05');
 await p.locator('[data-doc-close-panel]').click();await p.locator('[data-doc-add-row="deliveries"]').click();
 const newrow=await p.locator('[data-block="deliveries"] tbody tr').last().getAttribute('data-doc-row');
 check(label+' missing fields visible not guessed',await p.locator('.doc-missing summary').innerText().then(t=>t.includes('待补信息')));
 await cell(newrow,'subject').fill('FG_050');await cell(newrow,'stage').selectOption({label:'客户版'});await cell(newrow,'date').fill('2026-10-03');
 check(label+' added row summarized',await p.locator('#doc-summary [data-doc-jump="'+newrow+'"]').count()===1);
 await p.locator('[data-doc-remove-row="'+newrow+'"]').click();await p.locator('[data-action="undo"]').click();check(label+' row undo restores date',await cell(newrow,'date').inputValue()==='2026-10-03');
 await p.locator('[data-block="deliveries"] [data-doc-summary-toggle]').uncheck();check(label+' non summary excluded',await p.locator('.doc-summary-line').count()===0);
 await p.locator('[data-block="deliveries"] [data-doc-summary-toggle]').check();check(label+' summary reenabled intact',await cell('d2','date').inputValue()==='2027-01-05');
 await p.locator('.doc-heading [data-doc-panel="add"]').click();await p.locator('#doc-block-kind').selectOption('table');await p.locator('#doc-new-block-title').fill('我自己的清单');await submit('doc-add-block-form');
 const blockId=await p.locator('.document-block').last().getAttribute('data-block');
 check(label+' arbitrary list created',await p.locator(`[data-block="${blockId}"] .doc-block-title`).inputValue()==='我自己的清单'&&!await p.locator(`[data-block="${blockId}"] [data-doc-summary-toggle]`).isChecked());
 await p.locator(`[data-doc-add-row="${blockId}"]`).click();const ordinary=await p.locator(`[data-block="${blockId}"] tbody tr`).getAttribute('data-doc-row');const firstcol=await p.locator(`[data-block="${blockId}"] [data-doc-cell]`).first().getAttribute('data-doc-cell');await cell(ordinary,firstcol).fill('下周再做，不猜日期');check(label+' plain list not auto parsed',await p.locator('#doc-summary').innerText().then(t=>!t.includes('下周再做')));
 await p.locator(`[data-block="${blockId}"] [data-doc-summary-toggle]`).check();check(label+' summary roles added without data loss',await cell(ordinary,firstcol).inputValue()==='下周再做，不猜日期'&&await p.locator(`[data-block="${blockId}"] select`).count()===2);
 await p.locator(`[data-doc-move="${blockId}"][data-step="-1"]`).click();check(label+' block order changed',await p.locator('.document-block').last().getAttribute('data-block')!==blockId);
 await p.locator(`[data-doc-remove-block="${blockId}"]`).click();await p.locator('[data-action="undo"]').click();check(label+' block undo restores data',await cell(ordinary,firstcol).inputValue()==='下周再做，不猜日期');
 await p.locator('[data-doc-remove-block="deliveries"]').click();await p.locator('[data-route="projects"]').click();
 await p.locator('[data-action="undo"]').click();const filmCard=p.locator('.document-project-card').filter({has:p.locator('[data-route="projects/film"]')});
 check(label+' undo refreshes project cards',await filmCard.innerText().then(t=>t.includes('10/03')));
 await goto('projects/film');await p.locator('[data-doc-project-title]').fill('第二公司项目');await goto('projects/'+secondProject);await goto('projects/film');
 check(label+' invalid title draft retained',await p.locator('[data-doc-project-title]').inputValue()==='第二公司项目'&&await p.locator('#doc-title-error').innerText().then(t=>t.includes('不能')));
 await p.locator('[data-doc-project-title]').fill('雾港 · 片头');
 await p.locator('[data-block="intro"] textarea').fill('<img src=x onerror=alert(1)> 下周交片');await p.locator('.side [data-nav="news"]').click();await p.goBack();check(label+' text literal preserved',await p.locator('[data-block="intro"] textarea').inputValue().then(t=>t.includes('<img'))&&await p.locator('.doc-blocks img').count()===0);
 check(label+' removed fixed modifications block',await p.locator('[data-block="changes"]').count()===0);
 await p.locator('.doc-heading [data-doc-panel="add"]').click();await p.locator('#doc-block-kind').selectOption('checklist');await p.locator('#doc-new-block-title').fill('自己的清单');await submit('doc-add-block-form');
 const checklistId=await p.locator('.document-block').last().getAttribute('data-block');await p.locator(`[data-doc-add-check="${checklistId}"]`).click();const ci=await p.locator('[data-doc-check-text]').last().getAttribute('data-doc-check-text');await p.locator(`[data-doc-check-text="${ci}"]`).fill('自己的修改');await p.locator(`[data-doc-check="${ci}"]`).check();check(label+' checklist usable',await p.locator(`[data-doc-check="${ci}"]`).isChecked());
 // 原始输入与演示差异分离；来源记录与实际目标一致，不沿用硬编码名称。
 await cell('d2','subject').fill('NEW_999');await cell('d2','stage').selectOption('final');
 const untouchedBefore=await cell('d4','date').inputValue();
 await goto('projects/film/import');await p.locator('#doc-source-name').fill('我的原始文档');await p.locator('#doc-source-text').fill('日期未写年份，先保留原文。');await p.locator('#doc-source-file').setInputFiles({name:'original.txt',mimeType:'text/plain',buffer:Buffer.from('not parsed')});
 await p.locator('[data-route="projects/film/import/pending"]').click();check(label+' unresolved import blocked',await p.locator('#doc-import-apply').isDisabled());
 await p.locator('#doc-import-choice').selectOption('2026-10-17');await p.locator('#doc-import-date').fill('2026-10-18');
 await goto('projects/film');await cell('d2','date').fill('2027-01-06');await goto('projects/film/import/pending');await submit('doc-apply-import');check(label+' stale document baseline blocked',await p.locator('[data-doc-form-error]').innerText().then(t=>t.includes('已改变')));
 await p.locator('[data-doc-recheck-import]').click();await p.locator('#doc-import-choice').selectOption('2026-10-17');await p.locator('#doc-import-date').fill('2026-10-18');await submit('doc-apply-import');check(label+' document import applied',await p.locator('.doc-import-result').isVisible());
 await goto('projects/film');
 check(label+' imported dates and non targets exact',await cell('d2','date').inputValue()==='2026-10-17'&&await cell('d3','date').inputValue()==='2026-10-18'&&await cell('d4','date').inputValue()===untouchedBefore);
 const auditText=await p.locator('[data-doc-text]').last().inputValue();check(label+' source audit names actual target',auditText.includes('文档目标：NEW_999 · FINAL')&&auditText.includes('示例原文标识 FG_021')&&auditText.includes('2027-01-06 → 2026-10-17'));
 await goto('projects/film/import');check(label+' source draft unchanged',await p.locator('#doc-source-name').inputValue()==='我的原始文档'&&await p.locator('#doc-source-text').inputValue()==='日期未写年份，先保留原文。'&&await p.locator('#doc-file-name').innerText()==='original.txt');await submit('doc-source-form');check(label+' raw source not AI dates',await p.locator('[data-doc-text]').last().inputValue()==='日期未写年份，先保留原文。');
 await goto('projects/new');await p.locator('#doc-project-name').fill('<svg onload="window.__injected=1"></svg>');await submit('doc-create-form');const newpid=await p.evaluate(()=>location.hash.split('/')[1]);check(label+' new project text escaped',await p.evaluate(()=>window.__injected!==1)&&await p.locator('.project-document [onload]').count()===0);
 check(label+' new project unopinionated',await p.locator('.document-block').count()===0&&await p.locator('.doc-empty').count()===1);
 await p.locator('.doc-heading [data-doc-panel="add"]').click();await p.locator('#doc-new-block-title').fill('我的说明');await submit('doc-add-block-form');await p.locator('[data-doc-text]').fill('自己的项目内容');await goto('projects/film');check(label+' project content isolated',!await p.locator('.project-document').innerText().then(t=>t.includes('自己的项目内容')));await goto('projects/'+newpid);check(label+' project content returns',await p.locator('[data-doc-text]').inputValue()==='自己的项目内容');
 await p.locator('.side [data-nav="agent"]').click();await p.locator('#chat-input').fill('聊天回归');await p.keyboard.press('Enter');await p.waitForFunction(()=>!document.querySelector('#chat-send').disabled);check(label+' agent inline preserved',await p.locator('.user-message').count()===1&&!await p.locator('#modal').isVisible());
 await p.locator('.side [data-nav="ideas"]').click();check(label+' ideas grid preserved',await p.locator('.idea-card').count()===4);await p.locator('#idea-title').fill('回归卡片');await p.locator('#idea-body').fill('不串项目');await p.locator('#idea-form [type=submit]').click();check(label+' ideas create preserved',await p.locator('.idea-card').count()===5);
 await p.locator('.side [data-nav="news"]').click();check(label+' three domains preserved',await p.locator('[data-news-field]').count()===4);await p.locator('[data-news-field="AI 行业动态"]').click();check(label+' news filter preserved',await p.locator('.news-card').count()===2);
 await goto('projects/film');await p.reload();check(label+' refresh document route works',await p.locator('.project-document').count()===1&&await cell('d2','date').inputValue()==='2026-10-14');
 await p.locator('[data-action="theme"]').click();check(label+' theme toggle works',await p.locator('html').getAttribute('data-theme')!==theme);
 await context.close();
 }
 // 迁移后的英文便捷入口实际跳转。
 const p=await browser.newPage();await p.goto(pathToFileURL(path.join(root,'design/project-document.html')).href);await p.waitForURL('**#projects');check('English entry resolves',await p.locator('.document-project-card').count()===1&&await p.locator('.project-personal-module').count()===1);
 for(const file of files)check('Frozen file '+file,sha(file)===report.files[file]);
 check('Browser errors',!report.errors.length,report.errors);check('External requests',!report.requests.length,report.requests);
 }finally{await browser.close();}
 report.summary={passed:report.checks.filter(c=>c.passed).length,failed:report.checks.filter(c=>!c.passed).length};fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({run,summary:report.summary}));if(report.summary.failed)process.exitCode=1;
})().catch(e=>{report.errors.push({fatal:e.stack});fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
