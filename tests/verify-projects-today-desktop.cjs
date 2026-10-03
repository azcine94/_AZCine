// Current batch, real owned Tauri WebView2 + Rust SQLite. No IPC/model mocks.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
const {projectOverflow}=require('./support/project-overflow.cjs');
(async()=>{
 const run=path.resolve(process.env.AZCINE_VALIDATION_RUN||''),ownerPid=Number(process.env.AZCINE_OWNER_PID),webPort=Number(process.env.AZCINE_WEB_PORT||1421);
 if(!run.startsWith(path.resolve('artifacts/validation')+path.sep)||!Number.isInteger(ownerPid)||ownerPid<1)throw Error('Exact owned app PID and isolated validation root required');
 const {out,hashes}=validationRun('projects-today-real',['app/src','app/src-tauri/src','scripts','tests/verify-projects-today-desktop.cjs']);
 const report={mode:'real Tauri/WebView2 + Rust SQLite, synthetic retained data, no fixture',run,ownerPid,before:hashes(),checks:[],errors:[],screenshots:[]};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);};
 const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT||9230}`);
 let page;
 try{
  page=browser.contexts()[0].pages().find(p=>p.url().startsWith(`http://127.0.0.1:${webPort}`));if(!page)throw Error('Owned test desktop page not found');page.setDefaultTimeout(25000);page.on('pageerror',error=>report.errors.push(error.message));
  const ipc=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  await page.locator('nav a[href="#today"]').click();
  if(await page.locator('[data-storage-setup]').count()){
   await page.waitForFunction(()=>!!document.querySelector('#data-root')?.value);check('Given first start Then isolated test root is explicit',path.resolve(await page.locator('#data-root').inputValue())===path.join(run,'data'));
   await page.getByRole('button',{name:'使用此目录',exact:true}).click();
  }
  await page.waitForSelector('#todo-title');
  const initial=(await ipc('storage_workspace')).todos.length;
  await page.getByRole('button',{name:'保存待办',exact:true}).click();await page.waitForSelector('.todo-feedback .form-error');
  check('Given empty title When save Then error and no new record',(await ipc('storage_workspace')).todos.length===initial);
  await page.locator('#todo-title').fill('双模块无日期待办 '+randomUUID().slice(0,6));const noDateTitle=await page.locator('#todo-title').inputValue();
  await page.locator('#todo-date').fill('2028-02-');await page.getByRole('button',{name:'保存待办',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.todo-feedback .form-error')?.textContent.includes('完整日期'));
  await page.locator('nav a[href="#projects"]').click();await page.getByRole('button',{name:/切换.*色/}).click();await page.locator('nav a[href="#today"]').click();
  check('Given incomplete todo date When route/theme changes Then raw title and date survive',await page.locator('#todo-title').inputValue()===noDateTitle&&await page.locator('#todo-date').inputValue()==='2028-02-');
  await page.getByRole('button',{name:'待办日期：选择日期',exact:true}).click();await page.getByRole('button',{name:'清空日期',exact:true}).click();
  await page.getByRole('button',{name:'保存待办',exact:true}).evaluate(el=>{el.click();el.click();});await page.waitForFunction(()=>document.querySelector('#todo-title')?.value==='');
  let workspace=await ipc('storage_workspace');const noDate=workspace.todos.find(t=>t.title===noDateTitle);
  check('Given rapid save without date Then one ID and null date with no duplicates',!!noDate&&noDate.dueDate===null&&workspace.todos.filter(t=>t.title===noDateTitle).length===1);
  await page.getByRole('button',{name:`完成待办：${noDateTitle}`,exact:true}).click();await page.waitForFunction(id=>!document.querySelector(`[data-todo-id="${id}"]`),noDate.id);await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForSelector(`[data-todo-id="${noDate.id}"]`);
  check('Given completion undo Then same ID restored and undo consumed',await page.getByRole('button',{name:'撤销',exact:true}).count()===0&&!(await ipc('storage_workspace')).todos.find(t=>t.id===noDate.id).completed);
  await page.locator('nav a[href="#projects"]').click();await page.locator('a[href="#projects/new"]').first().click();await page.waitForSelector('#new-project-name');
  const newName='表格真实新建 '+randomUUID().slice(0,6);await page.locator('#new-project-name').fill(newName);await page.getByRole('button',{name:'新建公司项目',exact:true}).click();await page.waitForSelector('[data-project-document]');
  const fresh=(await ipc('list_projects')).find(p=>p.name===newName);check('Given UI new company Then no default labels or blocks',fresh.labels.length===0&&fresh.blocks.length===0);
  const ready=()=>page.waitForFunction(()=>document.querySelector('.document-save-state')?.textContent.includes('已保存')&&!document.querySelector('.pending-note'));
  await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('menuitem',{name:/^添加表格 list/}).click();await ready();
  check('Given compact add menu Then new table ordinary and not included',(await ipc('list_projects')).find(p=>p.id===fresh.id).blocks[0].included===false);
  const keys=['project','other','acopy','final','foreign','list','ordinary','text','check','item','shot','stage','date','done','note','plain','row1','row2','row3','plainRow'];
  const ids=Object.fromEntries(keys.map(k=>[k,randomUUID()]));
  const document={id:ids.project,name:'公司表格交付 '+randomUUID().slice(0,6),labels:[{id:ids.acopy,name:'ACOPY'},{id:ids.final,name:'FINAL'}],blocks:[
   {id:ids.text,kind:'text',title:'项目说明',body:'ACOPY 2026-12-30；FINAL 2027-01-05。只保留原文。'},
   {id:ids.list,kind:'list',title:'镜头清单',included:true,columns:[{id:ids.shot,name:'镜头',kind:'shot'},{id:ids.stage,name:'当前阶段',kind:'stage'},{id:ids.date,name:'当前交期',kind:'date'},{id:ids.done,name:'已交完',kind:'delivered'},{id:ids.note,name:'备注',kind:'text'}],rows:[ids.row1,ids.row2,ids.row3].map((id,i)=>({id,cells:{[ids.shot]:`SH${(i+1)*10}`,[ids.stage]:ids.acopy,[ids.date]:i===2?'':'2028-02-29',[ids.done]:'false',[ids.note]:'保留原备注'}}))},
   {id:ids.ordinary,kind:'list',title:'普通参考',included:false,columns:[{id:ids.plain,name:'原文',kind:'text'}],rows:[{id:ids.plainRow,cells:{[ids.plain]:'2029-01-01 不猜成交期'}}]},
   {id:ids.check,kind:'checklist',title:'核对清单',items:[{id:ids.item,text:'保留勾选清单',checked:false}]}
  ]};
  await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document}});await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document:{id:ids.other,name:'标签独立对照',labels:[{id:ids.foreign,name:'ACOPY'}],blocks:[]}}});
  await page.locator('nav a[href="#projects"]').click();await page.getByRole('button',{name:'重新读取项目',exact:true}).click();await page.waitForSelector(`[data-project-id="${ids.project}"]`);
  await page.locator('#project-search').fill(document.name);check('Given project search Then matching card only',await page.locator('[data-project-id]').count()===1);await page.locator(`[data-project-id="${ids.project}"]`).click();await page.waitForSelector('.office-table');
  const read=async()=>(await ipc('list_projects')).find(p=>p.id===ids.project),list=()=>page.locator(`[data-block-id="${ids.list}"]`),row=id=>page.locator(`[data-row-id="${id}"]`);
  await row(ids.row1).locator('.project-stage-picker__trigger').focus();await page.keyboard.press('End');await page.keyboard.press('Enter');await ready();let saved=await read(),b=saved.blocks.find(b=>b.id===ids.list);
  check('Given switch FINAL Then same row ID/count/date and not auto delivered',b.rows.length===3&&b.rows[0].id===ids.row1&&b.rows[0].cells[ids.stage]===ids.final&&b.rows[0].cells[ids.date]==='2028-02-29'&&b.rows[0].cells[ids.done]==='false');
  const calendar=()=>row(ids.row1).getByRole('button',{name:'镜头清单，当前交期：选择日期',exact:true});
  const beforeHeight=await row(ids.row1).evaluate(el=>el.getBoundingClientRect().height),rev=saved.revision;await calendar().click();await page.keyboard.press('Escape');
  check('Given calendar cancel Then no revision/height/date mutation and focus restored',(await read()).revision===rev&&await row(ids.row1).evaluate((el,h)=>el.getBoundingClientRect().height===h,beforeHeight)&&await calendar().evaluate(el=>el===document.activeElement));
  await calendar().click();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await ready();
  check('Given leap day next selection Then real date2028-03-01 and stage independent',(await read()).blocks.find(b=>b.id===ids.list).rows[0].cells[ids.date]==='2028-03-01'&&(await read()).blocks.find(b=>b.id===ids.list).rows[0].cells[ids.stage]===ids.final);
  const shot1=row(ids.row1).locator('[data-column-kind=shot] input');await shot1.focus();await page.keyboard.press('Enter');check('Given Enter cell Then next row same field focused',await row(ids.row2).locator('[data-column-kind=shot] input').evaluate(el=>el===document.activeElement));
  async function drag(source,target,after,vertical){
   await source.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();const a=await source.boundingBox(),z=await target.boundingBox();
   await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+10,a.y+a.height/2+8,{steps:3});
   await page.mouse.move(z.x+z.width*(vertical?.5:after?.8:.2),z.y+z.height*(vertical?(after?.8:.2):.5),{steps:12});await page.mouse.up();
  }
  await drag(row(ids.row1).getByRole('button',{name:'拖动行：1',exact:true}),row(ids.row3),true,true);await ready();b=(await read()).blocks.find(b=>b.id===ids.list);
  check('Given actual WebView2 mouse row drag Then IDs reorder with all cells unchanged',b.rows.map(r=>r.id).join(',')===[ids.row2,ids.row3,ids.row1].join(',')&&b.rows[2].cells[ids.date]==='2028-03-01',b.rows.map(r=>r.id));
  await drag(list().getByRole('button',{name:'拖动列：镜头',exact:true}),list().locator(`thead th[data-column-id="${ids.date}"]`),true,false);await ready();b=(await read()).blocks.find(b=>b.id===ids.list);
  check('Given actual mouse column drag Then column IDs reorder without cell conversion',b.columns.map(c=>c.id).join(',')===[ids.stage,ids.date,ids.shot,ids.done,ids.note].join(','),b.columns.map(c=>c.id));
  const separator=list().getByRole('separator',{name:'调整列宽：镜头',exact:true});await separator.scrollIntoViewIfNeeded();const resize=await separator.boundingBox();await page.mouse.move(resize.x+3,resize.y+20);await page.mouse.down();await page.mouse.move(resize.x+99,resize.y+20,{steps:8});await page.mouse.up();await ready();
  check('Given real pointer column resize Then new width stored',(await read()).blocks.find(b=>b.id===ids.list).columns.find(c=>c.id===ids.shot).width>=250);
  const orderBefore=b.rows.map(r=>r.id);await row(ids.row2).getByRole('button',{name:'行操作：1',exact:true}).click();await page.getByRole('menuitem',{name:'下方插入行',exact:true}).click();await ready();b=(await read()).blocks.find(b=>b.id===ids.list);const inserted=b.rows[1].id;
  check('Given row menu insert Then empty new row next and original IDs kept',b.rows.length===4&&!Object.keys(b.rows[1].cells).length&&b.rows.filter(r=>r.id!==inserted).map(r=>r.id).join(',')===orderBefore.join(','));
  await row(inserted).getByRole('button',{name:'行操作：2',exact:true}).click();await page.getByRole('menuitem',{name:'删除行',exact:true}).click();await ready();await page.getByRole('button',{name:'撤销删除',exact:true}).click();await ready();
  check('Given row delete undo Then same inserted ID/cells/position restored',(await read()).blocks.find(b=>b.id===ids.list).rows[1].id===inserted);
  await list().getByRole('button',{name:'列操作：备注',exact:true}).click();await page.getByRole('menuitem',{name:'右侧插入列',exact:true}).click();await ready();b=(await read()).blocks.find(b=>b.id===ids.list);const newColumn=b.columns[b.columns.length-1];
  check('Given column insert Then plain text column only with original data kept',newColumn.kind==='text'&&b.columns.length===6&&b.rows.find(r=>r.id===ids.row1).cells[ids.note]==='保留原备注');
  await list().getByRole('button',{name:'列操作：新列',exact:true}).click();await page.locator(`#column-${newColumn.id}`).fill('审核说明');await page.keyboard.press('Escape');await page.locator('h1').click();await ready();
  check('Given column rename Escape Then entered label saved on leaving',(await read()).blocks.find(b=>b.id===ids.list).columns.find(c=>c.id===newColumn.id).name==='审核说明');
  await page.getByRole('button',{name:'阶段标签',exact:true}).click();await page.locator(`#label-${ids.final}`).fill('客户 FINAL');await page.locator('h1').click();await ready();
  check('Given label rename Then other project unchanged',(await ipc('list_projects')).find(p=>p.id===ids.other).labels[0].name==='ACOPY');
  await page.locator(`#label-${ids.final}`).locator('..').getByRole('button',{name:'删除标签',exact:true}).click();await page.waitForSelector('.tag-settings .form-error');check('Given referenced label deletion Then rejected without losing reference',(await read()).labels.some(l=>l.id===ids.final));
  const note=page.locator(`[data-block-id="${ids.text}"] textarea`);await note.fill('直接交完之前的自由正文');await row(ids.row1).locator('[data-column-kind=delivered] input').check();await ready();
  check('Given edited body direct completed click Then combined real save and excluded delivery',(await read()).blocks.find(b=>b.id===ids.text).body==='直接交完之前的自由正文'&&!(await page.locator('.delivery-summary').innerText()).includes('SH10'));
  await row(ids.row1).locator('[data-column-kind=delivered] input').uncheck();await ready();
  await note.fill('直接取消汇总前正文');await list().getByLabel('参与交付汇总',{exact:true}).uncheck();await ready();check('Given include unchecked Then raw body persists and no delivery from list',(await read()).blocks.find(b=>b.id===ids.text).body==='直接取消汇总前正文'&&!(await page.locator('.delivery-summary').innerText()).includes('SH10'));
  await list().getByLabel('参与交付汇总',{exact:true}).check();await ready();
  await page.locator(`[data-block-id="${ids.check}"] input[aria-label="清单项内容"]`).fill('真实清单手改');await page.locator(`[data-block-id="${ids.check}"] input[type=checkbox]`).check();await ready();check('Given checklist edit/check Then both persist',(await read()).blocks.find(b=>b.id===ids.check).items[0].text==='真实清单手改'&&(await read()).blocks.find(b=>b.id===ids.check).items[0].checked);
  await page.locator('nav a[href="#today"]').click();await page.locator('#todo-title').fill('项目关联日历 '+randomUUID().slice(0,6));const datedTitle=await page.locator('#todo-title').inputValue();await page.locator('#todo-project').selectOption(ids.project);
  await page.getByRole('button',{name:'待办日期：选择日期',exact:true}).click();await page.getByRole('dialog',{name:'待办日期日历',exact:true}).getByRole('button',{name:'今天',exact:true}).click();const today=await page.locator('#todo-date').inputValue();await page.getByRole('button',{name:'保存待办',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#todo-title')?.value==='');
  workspace=await ipc('storage_workspace');const dated=workspace.todos.find(t=>t.title===datedTitle);check('Given Today calendar/project Then full local date/company reference really persist',dated.dueDate===today&&dated.projectId===ids.project);
  await page.getByRole('button',{name:'今天',exact:true}).click();check('Given today filter Then dated row shown and undated excluded',await page.locator(`[data-todo-id="${dated.id}"]`).count()===1&&await page.locator(`[data-todo-id="${noDate.id}"]`).count()===0);
  await page.getByRole('button',{name:'未完成',exact:true}).click();check('Given delivery card Then complete next date with year and source appears',(await page.locator('.today-delivery-card').innerText()).includes('2028 年')&&(await page.locator('.today-delivery-card').innerText()).includes('2028-03-01')&&!(await page.locator('.today-delivery-card').innerText()).includes('2029-01-01'));
  await page.locator('.today-delivery-card a').filter({hasText:'SH10'}).click();await page.waitForFunction(({b,r})=>document.activeElement?.id===`row-${b}-${r}`,{b:ids.list,r:ids.row1});check('Given home backlink Then stable original row focused',await row(ids.row1).evaluate(el=>el===document.activeElement));
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(ownerPid),'-Action','resize','-Width',String(width),'-Height',String(height)]);
   await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
   for(const route of ['projects',`projects/${ids.project}`,'today']){
    await page.evaluate(route=>location.hash=`#${route}`,route);await page.waitForSelector(route==='projects'?'#project-search':route==='today'?'#todo-title':'[data-project-document]');await page.locator('h1').scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollTo(0,0));
    const issues=await projectOverflow(page);check(`Given ${theme}/${width}/${route} Then no unintended overflow`,issues.valid,issues);
    const measured=await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js','utf8'));check(`${theme}/${width}/${route} contrast and overlaps`,measured.low.length===0&&measured.overlap.length===0,measured);
    const edges=await page.evaluate(()=>{const s=document.querySelector('.side').getBoundingClientRect(),m=document.querySelector('main').getBoundingClientRect(),h=document.querySelector('h1').getBoundingClientRect(),meta=document.querySelector('.page-heading .meta').getBoundingClientRect();return {left:s.left,right:document.documentElement.clientWidth-m.right,bottom:s.bottom-m.bottom,baseline:(h.top+h.bottom-meta.top-meta.bottom)/2};});check(`${theme}/${width}/${route} shell edges and title centre aligned`,Math.abs(edges.left-edges.right)<1&&Math.abs(edges.bottom)<1&&Math.abs(edges.baseline)<1,edges);
    const shotPath=path.join(out,`${theme}-${width}-${route.includes('/')?'document':route}.png`);await page.screenshot({path:shotPath,fullPage:true});report.screenshots.push(shotPath);
    if(route.includes('/')){
     const last=list().locator('[data-column-kind=text] input').first();await last.focus();const focus=await last.evaluate(el=>{const r=el.getBoundingClientRect(),s=el.closest('.list-scroll').getBoundingClientRect(),c=getComputedStyle(el);return {visible:r.left>=s.left-1&&r.right<=s.right+1,focused:document.activeElement===el,outline:c.outlineStyle,outlineWidth:c.outlineWidth};});check(`${theme}/${width} keyboard reachable cell focus visible`,focus.visible&&focus.focused&&focus.outline==='solid'&&focus.outlineWidth==='2px',focus);
     await calendar().click();const popup=await projectOverflow(page);check(`${theme}/${width} real calendar top layer without overflow`,popup.valid,popup);const popupPath=path.join(out,`${theme}-${width}-calendar.png`);await page.screenshot({path:popupPath});report.screenshots.push(popupPath);await page.keyboard.press('Escape');
    }
   }
  }
  await page.reload();await page.waitForSelector('#todo-title');check('Given page reload Then saved real records remain',(await ipc('storage_workspace')).todos.some(t=>t.id===dated.id));
  const expected={projects:await ipc('list_projects'),workspace:await ipc('storage_workspace')};fs.writeFileSync(path.join(out,'expected.json'),JSON.stringify(expected,null,2),{flag:'wx'});fs.writeFileSync(path.join(out,'identifiers.json'),JSON.stringify({ids,noDateId:noDate.id,datedId:dated.id},null,2),{flag:'wx'});
  report.after=hashes();check('Source stable during real acceptance',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
 }catch(error){report.failure=String(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
