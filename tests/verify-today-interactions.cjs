// Explicit delayed IPC, failure and controlled-clock replay. Not a real disk fault/sleep.
const fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
const {projectOverflow}=require('./support/project-overflow.cjs');
const uid=n=>`dddddddd-1111-2222-3333-${String(n).padStart(12,'0')}`;
(async()=>{
 const {out,hashes}=validationRun('today-interactions',['app/src','app/src-tauri/src','scripts','tests/verify-today-interactions.cjs']);
 const report={mode:'explicit delayed IPC + controlled clock fixture, not native disk fault/sleep',before:hashes(),checks:[],errors:[]};
 const context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{executablePath,headless:true,viewport:{width:1280,height:800}});
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);};let page;
 try{
  page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.addInitScript(({uid1,uid2,projectId})=>{
   window.isTauri=true;window.todayFixture={todos:[{id:uid1,title:'延迟完成示例',dueDate:'2026-10-03',projectId:null,completed:false,revision:1,createdAt:'2026-10-01T00:00:00Z'},{id:uid2,title:'保留原来事项',dueDate:null,projectId:null,completed:false,revision:1,createdAt:'2026-10-01T00:00:00Z'}],projects:[{id:projectId,name:'关联回放公司',labels:[],blocks:[],revision:1,createdAt:'2026-10-01T00:00:00Z'}],calls:[],pending:null,readError:false};
   window.__TAURI_INTERNALS__={invoke:async(command,args)=>{const f=window.todayFixture;f.calls.push({command,args:structuredClone(args)});
    if(command==='storage_workspace'){if(f.readError)throw Error('显式回放：读取失败');return {root:'D:\\TodayReplay',defaultRoot:'D:\\TodayReplay',todos:structuredClone(f.todos)};}
    if(command==='list_projects')return structuredClone(f.projects);
    if(['create_todo','complete_todo'].includes(command))return new Promise((resolve,reject)=>{f.pending={command,args:structuredClone(args),resolve,reject};});
    throw Error('Unexpected fixture command '+command);
   }};
  },{uid1:uid(1),uid2:uid(2),projectId:uid(3)});
  await page.goto('http://127.0.0.1:1420/#today');await page.waitForSelector('[data-todo-id]');
  const metrics=()=>page.evaluate(()=>{
   const selectors=['.todo-composer','.todo-feedback','.todo-filters','.todo-list','.todo-footer'];const rects=Object.fromEntries(selectors.map(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return [sel,{x:r.x,y:r.y,width:r.width,height:r.height}];}));
   const selectors2=['.todo-save','#todo-title','.todo-toggle'];const styles=Object.fromEntries(selectors2.map(sel=>{const c=getComputedStyle(document.querySelector(sel));return [sel,{background:c.backgroundColor,color:c.color,opacity:c.opacity}];}));return {rects,styles};
  });
  await page.locator('#todo-title').fill('日历保存草稿');await page.getByRole('button',{name:'待办日期：选择日期',exact:true}).click();const calendar=page.getByRole('dialog',{name:'待办日期日历',exact:true});await calendar.getByRole('button',{name:'今天',exact:true}).click();await page.locator('#todo-project').selectOption(uid(3));
  await page.getByRole('button',{name:'保存待办',exact:true}).focus();const before=await metrics();await page.keyboard.press('Enter');await page.waitForFunction(()=>!!window.todayFixture.pending);
  const during=await metrics();check('Given delayed todo save Then list/composer/footer positions and unrelated styles unchanged',JSON.stringify(before)===JSON.stringify(during),{before,during});
  await page.getByRole('button',{name:'保存待办',exact:true}).evaluate(el=>{el.click();el.click();});await page.getByRole('button',{name:'待办日期：选择日期',exact:true}).evaluate(el=>el.click());await page.getByRole('button',{name:'完成待办：保留原来事项',exact:true}).evaluate(el=>el.click());
  check('Given delayed create When rapid structural clicks Then one request/list remains and no calendar opens',await page.evaluate(()=>window.todayFixture.calls.filter(c=>c.command==='create_todo').length===1&&window.todayFixture.calls.filter(c=>c.command==='complete_todo').length===0)&&await page.locator('[data-todo-id]').count()===2&&await page.getByRole('button',{name:'待办日期：选择日期',exact:true}).getAttribute('aria-expanded')==='false');
  const request=await page.evaluate(()=>window.todayFixture.pending.args.input);await page.locator('nav a[href="#projects"]').click();await page.getByRole('button',{name:/切换.*色/}).click();await page.evaluate(()=>{const p=window.todayFixture.pending;window.todayFixture.pending=null;p.reject(Error('显式回放：保存失败，草稿保留'));});await page.locator('nav a[href="#today"]').click();await page.waitForSelector('.form-error');
  check('Given delayed failure across route/theme Then title/date/company and immutable request kept',await page.locator('#todo-title').inputValue()===request.title&&await page.locator('#todo-date').inputValue()===request.dueDate&&await page.locator('#todo-project').inputValue()===request.projectId);
  await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).click();await page.waitForFunction(()=>!!window.todayFixture.pending);
  check('Given retry Then exact submitted ID/date/company unchanged',JSON.stringify(await page.evaluate(()=>window.todayFixture.pending.args.input))===JSON.stringify(request));
  await page.evaluate(()=>{const f=window.todayFixture,p=f.pending,record={...p.args.input,completed:false,revision:1,createdAt:'2026-10-03T00:00:00Z'};f.todos.push(record);f.pending=null;p.resolve(record);});await page.waitForFunction(()=>document.querySelector('#todo-title')?.value==='');
  check('Given successful retry Then one new row and draft cleared only after receipt',await page.locator('[data-todo-id]').count()===3&&await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).count()===0);
  for(const theme of ['light','dark']){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();await page.getByRole('button',{name:'完成待办：延迟完成示例',exact:true}).focus();const base=await metrics();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.todayFixture.pending?.command==='complete_todo');
   const mid=await metrics();check(`Given ${theme} delayed completion Then list not replaced/faded and filter/footer stable`,JSON.stringify(base)===JSON.stringify(mid),{base,mid});
   await page.evaluate(()=>{const f=window.todayFixture,p=f.pending;f.pending=null;p.reject(Error('显式回放：状态修改失败'));});await page.waitForSelector('.form-error');
   check(`Given ${theme} completion failure Then same ID/state remains no false success`,await page.locator(`[data-todo-id="${uid(1)}"]`).count()===1&&await page.getByRole('button',{name:'完成待办：延迟完成示例',exact:true}).count()===1);
  }
  const idsBefore=await page.locator('[data-todo-id]').evaluateAll(els=>els.map(el=>el.dataset.todoId));await page.evaluate(()=>window.todayFixture.readError=true);await page.getByRole('button',{name:'重新读取待办',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.todo-feedback .form-error')?.textContent.includes('读取失败'));
  check('Given refresh fails Then old todos/composer remain in Today with error rather than replacing panel',JSON.stringify(await page.locator('[data-todo-id]').evaluateAll(els=>els.map(el=>el.dataset.todoId)))===JSON.stringify(idsBefore)&&await page.locator('#todo-title').count()===1&&await page.locator('[data-storage-setup]').count()===0);
  await page.evaluate(()=>window.todayFixture.readError=false);await page.getByRole('button',{name:'重新读取待办',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.todo-panel').getAttribute('data-working')||document.querySelector('.todo-panel').getAttribute('data-working')==='false');
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();await page.setViewportSize({width,height});await page.getByRole('button',{name:'待办日期：选择日期',exact:true}).click();const overflow=await projectOverflow(page);check(`${theme}/${width} Todo calendar fits`,overflow.valid,overflow);await page.screenshot({path:path.join(out,`${theme}-${width}-todo-calendar.png`)});await page.keyboard.press('Escape');
  }
  const clock=await context.newPage();await clock.clock.install({time:new Date(2026,9,3,23,59,59)});await clock.clock.pauseAt(new Date(2026,9,3,23,59,59));
  await clock.addInitScript(()=>{window.isTauri=true;window.__TAURI_INTERNALS__={invoke:async command=>{if(command==='list_projects')return [];if(command==='storage_workspace')return {root:'D:\\ControlledClock',defaultRoot:'D:\\ControlledClock',todos:['2026-10-03','2026-10-04','2026-10-05'].map((dueDate,i)=>({id:`eeeeeeee-1111-2222-3333-${String(i).padStart(12,'0')}`,title:'时钟 '+dueDate,dueDate,projectId:null,completed:false,revision:1,createdAt:'2026-10-01T00:00:00Z'}))};throw Error(command);}};});
  await clock.goto('http://127.0.0.1:1420/#today');await clock.waitForSelector('#todo-title');await clock.getByRole('button',{name:'今天',exact:true}).click();check('Given controlled pre-midnight Then only same-date row shown',(await clock.locator('[data-todo-id]').innerText()).includes('2026-10-03'));
  await clock.clock.runFor(1001);await clock.waitForFunction(()=>document.querySelector('[data-todo-id]')?.textContent.includes('2026-10-04'));check('Given controlled midnight timer Then next date replaces today row',await clock.locator('[data-todo-id]').count()===1);
  await clock.clock.setSystemTime(new Date(2026,9,5,10,0));await clock.evaluate(()=>window.dispatchEvent(new Event('focus')));await clock.waitForFunction(()=>document.querySelector('[data-todo-id]')?.textContent.includes('2026-10-05'));check('Given controlled jump on focus Then today date refreshed',await clock.locator('[data-todo-id]').count()===1);
  await clock.clock.setSystemTime(new Date(2026,9,3,10,0));await clock.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await clock.waitForFunction(()=>document.querySelector('[data-todo-id]')?.textContent.includes('2026-10-03'));check('Given controlled visibility activation Then only actual current fixture date shown',await clock.locator('[data-todo-id]').count()===1);await clock.close();
  report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
 }catch(error){report.failure=String(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
