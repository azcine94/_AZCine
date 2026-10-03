// Real WebView2/Tauri popup acceptance; synthetic data is retained, no IPC mock.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {browserRuntime}=require('./support/browser.cjs');
const {validationRun}=require('./support/validation-run.cjs');
const {projectPresentation}=require('./support/project-presentation.cjs');
const {projectOverflow}=require('./support/project-overflow.cjs');
(async()=>{
 const run=path.resolve(process.env.AZCINE_VALIDATION_RUN||''),ownerPid=Number(process.env.AZCINE_OWNER_PID);
 if(!run.startsWith(path.resolve('artifacts/validation')+path.sep)||!Number.isInteger(ownerPid)||ownerPid<1)throw Error('Explicit retained test root and exact owned PID required');
 const {out,hashes}=validationRun('s02-popovers-real',['app/src','app/src-tauri/src','tests/verify-s02-popovers.cjs']);
 const report={mode:'real owned Tauri/WebView2/Rust SQLite; synthetic records; no IPC/model mock',run,ownerPid,before:hashes(),checks:[],screenshots:[],errors:[]};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);};
 const {chromium}=browserRuntime(),browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT||9224}`);
 try{
  const page=browser.contexts()[0].pages().find(p=>p.url().startsWith(`http://127.0.0.1:${process.env.AZCINE_DEV_PORT||1420}`));if(!page)throw Error('Owned desktop page missing');
  page.on('pageerror',e=>report.errors.push(e.message));
  const ipc=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  const {ids,document:sample}=projectPresentation();sample.labels.push({id:randomUUID(),name:'客户自定义的长阶段标签'.repeat(6)});
  // Deliberately wide, real custom columns make horizontal anchor dismissal
  // executable even at 1440px; a 50px overflow cannot hide the stage anchor.
  sample.blocks[1].columns.push(...Array.from({length:4},(_,index)=>({id:randomUUID(),kind:'text',name:`参考 ${index+1}`})));
  await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document:sample}});
  await page.locator('nav a[href="#projects"]').click();await page.waitForSelector('#project-search');await page.locator('#project-search').fill('');await page.getByRole('button',{name:'重新读取项目',exact:true}).click();await page.waitForSelector(`[data-project-id="${ids.project}"]`);
  await page.locator(`[data-project-id="${ids.project}"]`).click();await page.waitForSelector(`[data-project-document="${ids.project}"]`);
  const original=(await ipc('list_projects')).find(p=>p.id===ids.project),list=()=>page.locator(`[data-block-id="${ids.list}"]`),picker=()=>list().locator('.project-stage-picker__trigger').first();
  const rows=()=>list().locator('[data-row-id]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{id:node.dataset.rowId,top:r.top,height:r.height};}));
  const capture=async name=>{await page.screenshot({path:path.join(out,name)});report.screenshots.push(name);};
  const bounds=locator=>locator.evaluate(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,client:node.clientHeight,content:node.scrollHeight,visible:node.matches(':popover-open'),position:s.position,fit:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};});
  const quality=async name=>{
   const overflow=await projectOverflow(page);check(`${name} no unhandled overflow`,overflow.valid,overflow);
   const contrast=await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js','utf8'));check(`${name} popup contrast`,contrast.low.length===0&&contrast.overlap.length===0,contrast);
  };
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
   execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(ownerPid),'-Action','resize','-Width',String(width),'-Height',String(height)]);
   await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<2&&Math.abs(innerHeight-height)<2,{width,height});
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
   // Measure the selected theme after actual CSS transition completion, not an
   // intermediate blend; no fixed-duration sleep or waived contrast threshold.
   await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
   await list().locator('.list-scroll').evaluate(el=>el.scrollLeft=0);await picker().scrollIntoViewIfNeeded();
   const before=await rows();await picker().focus();await page.keyboard.press('End');const box=page.getByRole('listbox');await box.waitFor();
   const after=await rows(),rect=await bounds(box);
   check(`${theme}/${width} stage popup is top-layer in bounds without moving rows`,JSON.stringify(before)===JSON.stringify(after)&&rect.visible&&rect.position==='fixed'&&rect.fit,rect);
   check(`${theme}/${width} long label fully wraps with keyboard focus`,await box.getByRole('option').last().evaluate(node=>node===document.activeElement&&node.scrollWidth<=node.clientWidth+1));
   await quality(`${theme}/${width}/stage`);await capture(`${theme}-${width}-stage.png`);
   await page.keyboard.press('Escape');check(`${theme}/${width} stage Escape restores trigger focus`,await picker().evaluate(node=>node===document.activeElement&&node.getAttribute('aria-expanded')==='false'));
   await picker().click();await page.keyboard.press('Tab');check(`${theme}/${width} stage Tab closes and leaves popup`,await picker().getAttribute('aria-expanded')==='false'&&await page.evaluate(()=>!document.activeElement?.closest('.project-stage-picker')));
   await page.locator('h1').scrollIntoViewIfNeeded();const summaryBefore=await page.locator('.delivery-summary').boundingBox();const add=page.getByRole('button',{name:'添加内容',exact:true});
   await add.click();const menu=page.getByRole('menu');await menu.waitFor();const menuRect=await bounds(menu),summaryAfter=await page.locator('.delivery-summary').boundingBox();
   check(`${theme}/${width} compact add menu does not move summary`,menuRect.fit&&menuRect.visible&&summaryBefore.y===summaryAfter.y&&await menu.getByRole('menuitem').count()===3,menuRect);
   await quality(`${theme}/${width}/add`);await capture(`${theme}-${width}-add-content.png`);await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Home');
   check(`${theme}/${width} add menu keyboard cycles among real types`,await menu.getByRole('menuitem').first().evaluate(node=>node===document.activeElement));
   await page.keyboard.press('Escape');check(`${theme}/${width} add Escape focuses trigger`,await add.evaluate(node=>node===document.activeElement&&node.getAttribute('aria-expanded')==='false'));
   await add.click();await page.locator('#project-name').click();check(`${theme}/${width} add outside click does not steal focus`,await add.getAttribute('aria-expanded')==='false'&&await page.locator('#project-name').evaluate(node=>node===document.activeElement));
   const visibleControl=locator=>locator.evaluate(node=>{const region=node.closest('.list-scroll'),bounds=region.getBoundingClientRect(),control=node.getBoundingClientRect();return{focused:node===document.activeElement,left:control.left,right:control.right,regionLeft:bounds.left,regionRight:bounds.left+region.clientWidth,scroll:region.scrollLeft,visible:control.left>=bounds.left-1&&control.right<=bounds.left+region.clientWidth+1};});
   const firstRow=list().locator('[data-row-id]').first();await firstRow.locator('[data-column-kind="text"] input').last().focus();await page.keyboard.press('Tab');
   const action=await visibleControl(firstRow.getByRole('button',{name:'删除行',exact:true}));check(`${theme}/${width} Tab reveals whole rightmost action inside table`,action.focused&&action.visible&&action.scroll>0,action);
   await page.keyboard.press('Tab');const firstCell=await visibleControl(list().locator('[data-row-id]').nth(1).locator('[data-column-kind="shot"] input'));check(`${theme}/${width} next-row Tab reveals whole leftmost cell inside table`,firstCell.focused&&firstCell.visible,firstCell);
  }
  // Force near-bottom placement using actual scroll/resize and assert flip. No timed sleeps.
  await picker().evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().bottom-(innerHeight-12)));
  const anchor=await picker().boundingBox();await picker().click();const flipped=await bounds(page.getByRole('listbox'));
  check('Given stage anchor at viewport bottom Then popup flips above and remains bounded',flipped.fit&&flipped.bottom<=anchor.y, {anchor,flipped});await capture('bottom-stage-flipped.png');await page.keyboard.press('Escape');
  // The rightward scroll moves this anchor out of its local clipping region.
  await picker().scrollIntoViewIfNeeded();await picker().click();await list().locator('.list-scroll').evaluate(node=>node.scrollLeft=node.scrollWidth);await page.waitForFunction(()=>document.querySelector('.project-stage-picker__trigger')?.getAttribute('aria-expanded')==='false');
  check('Given stage anchor scrolled out of table Then popup closes rather than floating over unrelated content',await page.getByRole('listbox').count()===0);await list().locator('.list-scroll').evaluate(node=>node.scrollLeft=0);
  const bottom=page.getByRole('button',{name:'添加文档内容',exact:true});await bottom.scrollIntoViewIfNeeded();await bottom.click();await page.getByRole('menu').waitFor();check('Given document-end add entry Then same three types and bounded popup',await page.getByRole('menuitem').count()===3&&(await bounds(page.getByRole('menu'))).fit);await capture('bottom-add-content.png');await page.keyboard.press('Escape');
  check('Given all popup open/cancel/navigation operations Then real document and revision unchanged',JSON.stringify((await ipc('list_projects')).find(p=>p.id===ids.project))===JSON.stringify(original));
  report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No WebView errors',report.errors.length===0,report.errors);
 }catch(error){report.failure=String(error);process.exitCode=1;}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
