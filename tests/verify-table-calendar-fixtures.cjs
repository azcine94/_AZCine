// Explicit IPC/clock fixture checks for this batch; no model calls or user data.
const fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
const {projectOverflow}=require('./support/project-overflow.cjs');
const uid=n=>`cccccccc-1111-2222-3333-${n.toString(16).padStart(12,'0')}`;
const url=`http://127.0.0.1:${process.env.AZCINE_WEB_PORT||1420}`;
function document(){return {id:uid(1),name:'表格日历显式回放',labels:[{id:uid(2),name:'ACOPY'},{id:uid(3),name:'FINAL'}],blocks:[{id:uid(4),kind:'text',title:'说明',body:'不改原数据'},{id:uid(5),kind:'list',title:'镜头表',included:true,columns:['shot','stage','date','delivered','text'].map((kind,i)=>({id:uid(10+i),name:['镜头','阶段','交期','交完','备注'][i],kind})),rows:[0,1,2].map(i=>({id:uid(20+i),cells:{[uid(10)]:`SH${i+1}`,[uid(11)]:uid(2),[uid(12)]:'2028-02-29',[uid(13)]:'false',[uid(14)]:'保留备注'}}))}],revision:1,createdAt:'2026-10-03T00:00:00Z'};}
(async()=>{
 const {out,hashes}=validationRun('table-calendar-fixtures',['app/src','app/src-tauri/src','scripts','tests/verify-table-calendar-fixtures.cjs']);
 const report={mode:'explicit test-only IPC/clock fixture; not true disk failure, not native sleep',before:hashes(),checks:[],errors:[]};
 const context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{executablePath,headless:true,viewport:{width:1280,height:800}});
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);};
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 try{
  await page.addInitScript(doc=>{
   window.isTauri=true;window.tableFixture={projects:[doc],todos:[],receipts:{},calls:[],pending:[],mode:'success'};
   window.__TAURI_INTERNALS__={invoke:async(command,args)=>{const f=window.tableFixture;f.calls.push({command,args:structuredClone(args)});
    if(command==='storage_workspace')return {root:'D:\\TableFixture',defaultRoot:'D:\\TableFixture',todos:structuredClone(f.todos)};
    if(command==='list_projects')return structuredClone(f.projects);
    if(command==='project_request')return structuredClone(f.receipts[args.requestId]??null);
    if(command==='save_project'){
     if(f.mode==='delay')return new Promise((resolve,reject)=>f.pending.push({resolve,reject,request:structuredClone(args.input)}));
     if(f.mode==='reject')throw Error('显式回放：写入失败');
     const old=f.projects[0],req=args.input;if(f.receipts[req.requestId])return structuredClone(f.receipts[req.requestId]);
     if(old.revision!==req.expectedRevision)throw Error('回放：修订冲突');
     const next={...structuredClone(req.document),revision:old.revision+1,createdAt:old.createdAt};f.projects=[next];f.receipts[req.requestId]=structuredClone(next);return next;
    }
    if(command==='create_todo'){const next={...structuredClone(args.input),completed:false,revision:1,createdAt:'2026-10-03T00:00:00Z'};f.todos.push(next);return next;}
    throw Error('Unexpected fixture command '+command);
   }};
  },document());
  await page.goto(`${url}/#projects/${uid(1)}`);await page.waitForSelector('.office-table');
  const ready=()=>page.waitForFunction(()=>document.querySelector('.document-save-state')?.textContent.includes('已保存')&&!document.querySelector('.pending-note'));
  const dateInput=()=>page.locator('[data-row-id]').first().locator('[data-column-kind=date] input');
  const calendar=()=>page.locator('[data-row-id]').first().getByRole('button',{name:'镜头表，交期：选择日期',exact:true});
  const revision=()=>page.evaluate(()=>window.tableFixture.projects[0].revision);
  const rev=await revision(),height=await page.locator('[data-row-id]').first().evaluate(el=>el.getBoundingClientRect().height);
  await calendar().click();await page.getByRole('button',{name:'2028-02-29',exact:true}).waitFor();
  check('Given date cell When calendar opens Then row height/revision unchanged and valid date focused',await page.locator('[data-row-id]').first().evaluate((el,height)=>el.getBoundingClientRect().height===height,height)&&(await revision())===rev&&await page.getByRole('button',{name:'2028-02-29',exact:true}).evaluate(el=>el===document.activeElement));
  await page.keyboard.press('PageDown');await page.keyboard.press('Enter');await ready();
  check('Given leap day When keyboard advances month and selects Then date only changes with rowID/stage intact',await dateInput().inputValue()==='2028-03-29'&&await page.evaluate(()=>{const b=window.tableFixture.projects[0].blocks[1];return b.rows[0].id==='cccccccc-1111-2222-3333-000000000014'&&b.rows[0].cells[b.columns[1].id]===window.tableFixture.projects[0].labels[0].id;})&&await calendar().evaluate(el=>el===document.activeElement));
  const saved=await revision();await calendar().click();await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');
  check('Given keyboard browsing When Escape Then no write/date change and focus restored',(await revision())===saved&&await dateInput().inputValue()==='2028-03-29'&&await calendar().evaluate(el=>el===document.activeElement));
  await calendar().click();await page.locator('#project-name').click();
  check('Given outside click Then calendar closes without grabbing focus',await calendar().getAttribute('aria-expanded')==='false'&&await page.locator('#project-name').evaluate(el=>el===document.activeElement));
  await calendar().click();await page.getByRole('button',{name:'清空日期',exact:true}).click();await ready();
  check('Given clear calendar Then empty date does not infer current date',await dateInput().inputValue()===''&&(await page.locator('.delivery-summary').innerText()).includes('日期待补'));
  await dateInput().fill('2028-02-30');await page.locator('h1').click();await page.waitForSelector('.form-error');
  check('Given invalid typed date Then raw value retained while official stays empty',await dateInput().inputValue()==='2028-02-30'&&await page.evaluate(()=>window.tableFixture.projects[0].blocks[1].rows[0].cells[window.tableFixture.projects[0].blocks[1].columns[2].id]===''));
  await dateInput().fill('2028-02-29');await page.locator('h1').click();await ready();
  const shot=page.locator('[data-column-kind=shot] input');await shot.first().focus();await page.keyboard.press('Enter');
  check('Given cell focus When Enter Then next row same column focused',await shot.nth(1).evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Shift+Enter');await page.keyboard.press('F2');
  check('Given F2 Then caret goes to text end without changing values',await shot.first().evaluate(el=>el===document.activeElement&&el.selectionStart===el.value.length));
  await page.getByRole('button',{name:'行操作：1',exact:true}).click();await page.getByRole('menuitem',{name:'下方插入行',exact:true}).click();await ready();
  check('Given row short menu When inserting Then one empty row placed next with old IDs preserved',await page.evaluate(()=>window.tableFixture.projects[0].blocks[1].rows.length===4)&&await page.locator('[data-row-id]').nth(2).getAttribute('data-row-id')===uid(21));
  await page.getByRole('button',{name:'行操作：2',exact:true}).click();await page.getByRole('menuitem',{name:'删除行',exact:true}).click();await ready();await page.getByRole('button',{name:'撤销删除',exact:true}).click();await ready();
  check('Given deleted row When undo Then original position restored',await page.locator('[data-row-id]').count()===4);
  const widthBefore=await page.getByRole('separator',{name:'调整列宽：镜头',exact:true}).getAttribute('aria-valuenow');
  await page.getByRole('separator',{name:'调整列宽：镜头',exact:true}).focus();await page.keyboard.press('ArrowRight');await ready();
  check('Given separator keyboard Then persisted width increases by8',await page.evaluate(()=>window.tableFixture.projects[0].blocks[1].columns[0].width)===Number(widthBefore)+8);
  const resize=page.getByRole('separator',{name:'调整列宽：镜头',exact:true}),bounds=await resize.boundingBox();
  await page.mouse.move(bounds.x+4,bounds.y+10);await page.mouse.down();await page.mouse.move(bounds.x+72,bounds.y+10);
  check('Given pointer resize preview Then no per-pixel save',await page.evaluate(()=>window.tableFixture.projects[0].blocks[1].columns[0].width)===Number(widthBefore)+8);
  await page.keyboard.press('Escape');await page.mouse.up();
  check('Given Escape during resize Then preview discarded without write',Number(await resize.getAttribute('aria-valuenow'))===Number(widthBefore)+8);
  await page.evaluate(()=>window.tableFixture.mode='delay');await calendar().click();await page.getByRole('button',{name:'2028-02-28',exact:true}).click();await page.waitForFunction(()=>window.tableFixture.pending.length===1);
  await page.getByRole('button',{name:'添加列',exact:true}).evaluate(el=>{el.click();el.click();});
  check('Given date save pending When repeated structural clicks Then one immutable combined request and no repeated mutation',await page.evaluate(()=>window.tableFixture.pending.length===1&&window.tableFixture.projects[0].blocks[1].columns.length===5));
  await page.locator('#project-name').fill('等待日期保存时的新名称');await page.locator('h1').click();
  await page.evaluate(()=>{const f=window.tableFixture,p=f.pending.shift(),old=f.projects[0],saved={...p.request.document,revision:old.revision+1,createdAt:old.createdAt};f.projects=[saved];f.receipts[p.request.requestId]=structuredClone(saved);p.resolve(saved);});
  await page.waitForFunction(()=>window.tableFixture.pending.length===1);
  check('Given date receipt Then queued later name save retains selected date',await page.evaluate(()=>window.tableFixture.pending[0].request.document.name==='等待日期保存时的新名称'&&window.tableFixture.pending[0].request.document.blocks[1].rows[0].cells[window.tableFixture.pending[0].request.document.blocks[1].columns[2].id]==='2028-02-28'));
  await page.evaluate(()=>{const f=window.tableFixture,p=f.pending.shift();p.reject(Error('显式回放：后续写失败'));f.mode='success';});await page.waitForSelector('.pending-note');
  check('Given queued write fails Then latest draft and request retained',await page.locator('#project-name').inputValue()==='等待日期保存时的新名称'&&await page.locator('.pending-note').count()===1);
  await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).click();await ready();
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
   await page.setViewportSize({width,height});if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
   await calendar().click();const issues=await projectOverflow(page);check(`Given ${theme}/${width} calendar Then no unintended overflow`,issues.valid,issues);await page.screenshot({path:path.join(out,`${theme}-${width}-calendar.png`)});await page.keyboard.press('Escape');
  }
  await page.locator('nav a[href="#today"]').click();await page.waitForSelector('#todo-date');await page.locator('#todo-title').fill('今天日历回放');
  await page.getByRole('button',{name:'待办日期：选择日期',exact:true}).click();await page.getByRole('button',{name:'清空日期',exact:true}).click();
  check('Given Todo calendar cancel/clear Then draft title kept and no forced date',await page.locator('#todo-title').inputValue()==='今天日历回放'&&await page.locator('#todo-date').inputValue()==='');
  report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No browser errors',report.errors.length===0,report.errors);
 }catch(error){report.failure=String(error);process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
