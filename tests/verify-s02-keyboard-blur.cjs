// Limited real Tauri acceptance of deferred, unactivated commit-control focus.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
(async()=>{
 const run=path.resolve(process.env.AZCINE_VALIDATION_RUN||'');if(!run.startsWith(path.resolve('artifacts/validation')+path.sep))throw Error('Retained real root required');
 const {out,hashes}=validationRun('s02-keyboard-blur',['app/src','app/src-tauri/src','scripts','tests/verify-s02-keyboard-blur.cjs']);
 const report={mode:'real Tauri UI/Rust SQLite; focused control never activated',before:hashes(),checks:[],errors:[]};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);};
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
 try{
  const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:1420'));if(!page)throw Error('Owned real page missing');page.on('pageerror',e=>report.errors.push(e.message));
  const ipc=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  const ids=Array.from({length:8},randomUUID);const [projectId,blockId,rowId,labelId,shot,stage,date,done]=ids;
  const doc={id:projectId,name:'键盘移焦真实验收',labels:[{id:labelId,name:'ACOPY'}],blocks:[{id:blockId,kind:'list',title:'移焦表',included:true,columns:[{id:shot,name:'镜头',kind:'shot'},{id:stage,name:'当前阶段',kind:'stage'},{id:date,name:'当前交期',kind:'date'},{id:done,name:'已交完',kind:'delivered'}],rows:[{id:rowId,cells:{[shot]:'SH-TAB',[stage]:labelId,[date]:'2028-01-01',[done]:'false'}}]}]};
  await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document:doc}});
  await page.locator('nav a[href="#projects"]').click();await page.locator('#project-search').fill('');await page.getByRole('button',{name:'重新读取项目',exact:true}).click();await page.waitForSelector(`[data-project-id="${projectId}"]`);await page.locator(`[data-project-id="${projectId}"]`).click();
  await page.locator('[data-column-kind="date"] input').fill('2029-02-03');await page.keyboard.press('Tab');
  check('Given edited date When Tab only Then delivered focused but still unchecked',await page.locator('[data-column-kind="delivered"] input').evaluate(el=>el===document.activeElement&&!el.checked));
  await page.locator('nav a[href="#today"]').click();
  await page.waitForFunction(async({projectId,date,done})=>{const p=(await window.__TAURI_INTERNALS__.invoke('list_projects')).find(p=>p.id===projectId);return p.blocks[0].rows[0].cells[date]==='2029-02-03'&&p.blocks[0].rows[0].cells[done]==='false';},{projectId,date,done});
  const read=async()=>(await ipc('list_projects')).find(p=>p.id===projectId);
  check('Given checkbox never activated When leaving Then real date persists without changing delivered',(await read()).blocks[0].rows[0].cells[date]==='2029-02-03'&&(await read()).blocks[0].rows[0].cells[done]==='false');
  await page.locator('nav a[href="#projects"]').click();await page.locator(`[data-project-id="${projectId}"]`).click();
  await page.locator('#project-name').fill('键盘经过保存按钮仍然保存');await page.keyboard.press('Tab');
  check('Given title edit When Tab only Then save button focused',await page.getByRole('button',{name:'保存文档',exact:true}).evaluate(el=>el===document.activeElement));
  await page.locator('nav a[href="#projects"]').click();await page.waitForFunction(name=>[...document.querySelectorAll('[data-project-id] h2')].some(el=>el.textContent===name),'键盘经过保存按钮仍然保存');
  check('Given unactivated save button When route changes Then real card and storage current',(await read()).name==='键盘经过保存按钮仍然保存');
  await page.locator(`[data-project-id="${projectId}"]`).click();
  // Preserve action must still not auto-save a draft simply because focus moved.
  await page.locator('#project-name').fill('明确保留的未保存草稿');await page.keyboard.press('Tab');await page.getByRole('button',{name:'读取正式记录（保留草稿）',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#project-name').disabled);
  check('Given deferred save When explicit preserve action runs Then official record unchanged and draft kept',(await read()).name==='键盘经过保存按钮仍然保存'&&await page.locator('#project-name').inputValue()==='明确保留的未保存草稿');
  await page.getByRole('button',{name:'保存文档',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.document-save-state')?.textContent.includes('已保存'));
  await page.screenshot({path:path.join(out,'saved-keyboard-draft.png'),fullPage:true});
  fs.writeFileSync(path.join(out,'expected.json'),JSON.stringify({project:await read()},null,2));
  report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
 }catch(error){report.failure=String(error);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
