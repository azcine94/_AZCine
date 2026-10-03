// Targeted independent-review reproduction: explicit delayed/mock IPC, never normal app mode.
const fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
const uuid=n=>`aaaaaaaa-1111-2222-3333-${n.toString(16).padStart(12,'0')}`;
function fixture(rowCount=1,columnCount=4){
 const columns=['shot','stage','date','delivered',...Array(Math.max(0,columnCount-4)).fill('text')].map((kind,i)=>({id:uuid(10+i),name:kind,kind}));
 return {id:uuid(1),name:'审查回放原记录',labels:[{id:uuid(2),name:'ACOPY'}],blocks:[{id:uuid(3),kind:'text',title:'文字',body:'原文字'},{id:uuid(4),kind:'checklist',title:'勾选清单',items:[{id:uuid(5),text:'核对',checked:false}]},{id:uuid(6),kind:'list',title:'镜头表',included:true,columns,rows:Array.from({length:rowCount},(_,i)=>({id:uuid(1000+i),cells:{[uuid(10)]:`SH${i}`,[uuid(11)]:uuid(2),[uuid(12)]:'2028-01-01',[uuid(13)]:'false'}}))}],revision:1,createdAt:'2026-10-03T00:00:00Z'};
}
(async()=>{
 const {out,hashes}=validationRun('s02-review-fixtures',['app/src','app/src-tauri/src','scripts','tests/verify-s02-review-fixtures.cjs']);
 const report={mode:'explicit test-only IPC replay; independent-review reproductions',before:hashes(),checks:[],errors:[]};
 const context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{executablePath,headless:true,viewport:{width:1280,height:800}});
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);};
 async function open(doc){const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));await page.addInitScript(doc=>{
  window.isTauri=true;window.reviewFixture={projects:[doc],receipts:{},calls:[],mode:'success',pending:[],failRead:false};
  window.__TAURI_INTERNALS__={invoke:async(command,args)=>{const f=window.reviewFixture;f.calls.push({command,args:structuredClone(args)});
   if(command==='storage_workspace')return {root:'D:\\ReviewFixture',defaultRoot:'D:\\ReviewFixture',todos:[]};
   if(command==='list_projects'){if(f.failRead)throw Error('回放：读取失败');return structuredClone(f.projects);}
   if(command==='project_request')return structuredClone(f.receipts[args.requestId]??null);
   if(command==='save_project'){
    const req=args.input;if(f.mode==='delay')return new Promise((resolve,reject)=>f.pending.push({resolve,reject,request:structuredClone(req)}));
    if(f.mode==='reject')throw Error('回放：写入失败');
    if(f.receipts[req.requestId])return structuredClone(f.receipts[req.requestId]);
    const old=f.projects.find(d=>d.id===req.document.id);if(old.revision!==req.expectedRevision)throw Error('回放：旧修订拒绝');
    const saved={...structuredClone(req.document),revision:old.revision+1,createdAt:old.createdAt};f.projects=[saved];f.receipts[req.requestId]=structuredClone(saved);
    if(f.mode==='lost')throw Error('回放：提交后响应丢失');return saved;
   }throw Error('Unexpected '+command);
  }};
 },doc);await page.goto(`http://127.0.0.1:1420/#projects/${doc.id}`);await page.waitForSelector('#project-name');return page;}
 async function scenario(name,doc,work){const page=await open(doc);try{await work(page);await page.screenshot({path:path.join(out,name+'.png')});}catch(error){report.checks.push({name:name+' scenario',ok:false,detail:String(error)});await page.screenshot({path:path.join(out,name+'-failure.png')}).catch(()=>{});}finally{await page.close();}}
 const ready=page=>page.waitForFunction(()=>!document.querySelector('.pending-note')&&document.querySelector('.document-save-state')?.textContent.includes('已保存'));
 const finishNext=page=>page.evaluate(()=>{
  const f=window.reviewFixture,p=f.pending.shift();if(!p)throw Error('No delayed save to resolve');
  const old=f.projects.find(doc=>doc.id===p.request.document.id);
  if(old.revision!==p.request.expectedRevision)throw Error('回放：续存基线错误');
  const saved={...structuredClone(p.request.document),revision:old.revision+1,createdAt:old.createdAt};
  f.projects=[saved];f.receipts[p.request.requestId]=structuredClone(saved);p.resolve(structuredClone(saved));
 });
 try{
  for(const [type,selector] of [['delivered','[data-column-kind="delivered"] input'],['included','[data-block-id="'+uuid(6)+'"] > .form-actions input[type=checkbox]'],['checklist','.project-checklist input[type=checkbox]']]){
   await scenario('direct-'+type,fixture(),async page=>{await page.evaluate(()=>window.reviewFixture.mode='delay');await page.locator('textarea.doc-text').fill('直接点击前的新文字');await page.locator(selector).click();await page.waitForFunction(()=>window.reviewFixture.pending.length>0);
    const value=await page.evaluate(type=>{const r=window.reviewFixture.pending[0].request.document;return {body:r.blocks[0].body,checked:type==='delivered'?r.blocks[2].rows[0].cells[r.blocks[2].columns[3].id]:type==='included'?r.blocks[2].included:r.blocks[1].items[0].checked};},type);
    check(`Given new text When directly clicking ${type} with delayed IPC Then one combined save includes both changes`,value.body==='直接点击前的新文字'&&value.checked===(type==='delivered'?'true':type==='included'?false:true),value);
   });
  }
  await scenario('queued-success-blurred',fixture(),async page=>{
   await page.evaluate(()=>window.reviewFixture.mode='delay');
   await page.locator('#project-name').fill('首笔保存中的名称');await page.locator('textarea.doc-text').focus();
   await page.waitForFunction(()=>window.reviewFixture.pending.length===1);
   const first=await page.evaluate(()=>structuredClone(window.reviewFixture.pending[0].request));
   await page.locator('textarea.doc-text').fill('首笔等待期间已失焦的后续正文');await page.locator('h1').click();
   check('Given first save pending When editing and blurring another field Then original request stays immutable and only one request is in flight',await page.evaluate(first=>window.reviewFixture.calls.filter(c=>c.command==='save_project').length===1&&JSON.stringify(window.reviewFixture.pending[0].request)===JSON.stringify(first),first)&&await page.locator('textarea.doc-text').inputValue()==='首笔等待期间已失焦的后续正文',first);
   await finishNext(page);await page.waitForFunction(()=>window.reviewFixture.pending.length===1&&window.reviewFixture.calls.filter(c=>c.command==='save_project').length===2);
   const next=await page.evaluate(()=>({request:window.reviewFixture.pending[0].request,official:window.reviewFixture.projects[0]}));
   check('Given successful first receipt Then queued second request uses revision 2, a new request ID and the complete later draft',next.request.expectedRevision===2&&next.request.requestId!==first.requestId&&next.request.document.name==='首笔保存中的名称'&&next.request.document.blocks[0].body==='首笔等待期间已失焦的后续正文'&&next.official.revision===2&&next.official.blocks[0].body==='原文字',next);
   check('Given queued second request still pending Then later input is retained and UI does not claim saved',await page.locator('textarea.doc-text').inputValue()==='首笔等待期间已失焦的后续正文'&&(await page.locator('.document-save-state').innerText()).includes('正在保存'));
   await finishNext(page);await ready(page);
   check('Given both successful receipts Then official revision 3 contains both edits, exactly two saves and no pending request',await page.evaluate(()=>{const f=window.reviewFixture;return f.projects[0].revision===3&&f.projects[0].name==='首笔保存中的名称'&&f.projects[0].blocks[0].body==='首笔等待期间已失焦的后续正文'&&f.pending.length===0&&f.calls.filter(c=>c.command==='save_project').length===2;})&&(await page.locator('.document-save-state').innerText()).includes('修订 3'));
  });
  await scenario('queued-success-unblurred',fixture(),async page=>{
   await page.evaluate(()=>window.reviewFixture.mode='delay');
   await page.locator('#project-name').fill('先保存名称');await page.locator('textarea.doc-text').focus();
   await page.waitForFunction(()=>window.reviewFixture.pending.length===1);
   await page.locator('textarea.doc-text').fill('仍在输入且尚未失焦的正文');await finishNext(page);
   await page.waitForFunction(()=>window.reviewFixture.pending.length===0&&document.querySelector('.document-save-state')?.textContent.includes('有未保存编辑'));
   check('Given first receipt while later field remains focused Then current input and focus survive without a premature second save',await page.locator('textarea.doc-text').evaluate(el=>el===document.activeElement&&el.value==='仍在输入且尚未失焦的正文')&&await page.evaluate(()=>window.reviewFixture.projects[0].revision===2&&window.reviewFixture.projects[0].blocks[0].body==='原文字'&&window.reviewFixture.calls.filter(c=>c.command==='save_project').length===1));
   await page.locator('h1').click();await page.waitForFunction(()=>window.reviewFixture.pending.length===1);
   const next=await page.evaluate(()=>window.reviewFixture.pending[0].request);
   check('Given later blur after first receipt Then second save has the new baseline and previously retained input',next.expectedRevision===2&&next.document.name==='先保存名称'&&next.document.blocks[0].body==='仍在输入且尚未失焦的正文',next);
   await finishNext(page);await ready(page);
   check('Given later blur save succeeds Then revision 3 and saved UI agree on all retained edits',await page.evaluate(()=>window.reviewFixture.projects[0].revision===3&&window.reviewFixture.projects[0].blocks[0].body==='仍在输入且尚未失焦的正文'&&window.reviewFixture.pending.length===0&&window.reviewFixture.calls.filter(c=>c.command==='save_project').length===2)&&await page.locator('textarea.doc-text').inputValue()==='仍在输入且尚未失焦的正文'&&(await page.locator('.document-save-state').innerText()).includes('修订 3'));
  });
  await scenario('edit-then-page',fixture(150),async page=>{await page.evaluate(()=>window.reviewFixture.mode='delay');await page.locator('[data-column-kind="shot"] input').first().fill('EDIT-BEFORE-PAGE');await page.locator('.list-pagination').getByRole('button',{name:'下一页',exact:true}).click();
   check('Given cell edit When directly changing page Then save queued and page changes',await page.evaluate(()=>window.reviewFixture.pending.length===1&&window.reviewFixture.pending[0].request.document.blocks[2].rows[0].cells[window.reviewFixture.projects[0].blocks[2].columns[0].id]==='EDIT-BEFORE-PAGE')&&(await page.locator('.list-pagination').innerText()).includes('第 2 / 2 页'));
  });
  await scenario('tab-checkbox-no-activation',fixture(),async page=>{await page.locator('[data-column-kind="date"] input').fill('2029-02-03');await page.keyboard.press('Tab');
   check('Given date edit When Tab moves to delivered Then checkbox focused without being changed',await page.locator('[data-column-kind="delivered"] input').evaluate(el=>el===document.activeElement&&!el.checked));
   await page.locator('nav a[href="#today"]').click();await page.waitForSelector('.today-delivery-card');
   check('Given commit checkbox only focused When leaving to Today Then date saved without delivered change',await page.evaluate(()=>window.reviewFixture.projects[0].blocks[2].rows[0].cells[window.reviewFixture.projects[0].blocks[2].columns[2].id]==='2029-02-03'&&window.reviewFixture.projects[0].blocks[2].rows[0].cells[window.reviewFixture.projects[0].blocks[2].columns[3].id]==='false')&&(await page.locator('.today-delivery-card').innerText()).includes('2029-02-03'));
  });
  await scenario('tab-save-no-activation',fixture(),async page=>{await page.locator('#project-name').fill('键盘经过保存按钮的新名称');await page.keyboard.press('Tab');
   check('Given title edit When Tab moves to save Then no click required to continue',await page.getByRole('button',{name:'保存文档',exact:true}).evaluate(el=>el===document.activeElement));await page.locator('nav a[href="#projects"]').click();
   check('Given save button only focused When leaving Then title saved and card current',(await page.locator('[data-project-id] h2').innerText())==='键盘经过保存按钮的新名称');
  });
  await scenario('preserve-is-not-autosave',fixture(),async page=>{await page.locator('#project-name').fill('只读取时保留未保存名称');await page.keyboard.press('Tab');await page.getByRole('button',{name:'读取正式记录（保留草稿）',exact:true}).click();
   check('Given deferred blur When explicit preserve action activated Then no save is invented',await page.evaluate(()=>window.reviewFixture.calls.filter(call=>call.command==='save_project').length===0)&&await page.locator('#project-name').inputValue()==='只读取时保留未保存名称');
  });
  await scenario('row-limit',fixture(10000),async page=>{await page.locator('textarea.doc-text').fill('上限前未保存文字');await page.getByRole('button',{name:'添加行',exact:true}).click();
   check('Given 10000 rows and unsaved text When adding over limit Then original draft remains recoverable',await page.locator('textarea.doc-text').inputValue()==='上限前未保存文字'&&(await page.locator('.list-pagination').innerText()).includes('共 10000 行')&&await page.evaluate(()=>window.reviewFixture.calls.filter(c=>c.command==='save_project').length===0));
   await page.getByRole('button',{name:'保存文档',exact:true}).click();await ready(page);check('Given rejected row addition When saving prior text Then text survives without discarding draft',await page.evaluate(()=>window.reviewFixture.projects[0].blocks[0].body==='上限前未保存文字'&&window.reviewFixture.projects[0].blocks[2].rows.length===10000));
  });
  await scenario('column-limit',fixture(1,64),async page=>{await page.locator('.column-settings summary').click();await page.locator('textarea.doc-text').fill('列上限前未保存文字');await page.getByRole('button',{name:'新增普通列',exact:true}).click();
   check('Given 64 columns When adding a 65th Then previous draft not poisoned',await page.locator('.column-row').count()===64&&await page.locator('textarea.doc-text').inputValue()==='列上限前未保存文字');await page.getByRole('button',{name:'保存文档',exact:true}).click();await ready(page);check('Given refused column addition Then prior text can save normally',await page.evaluate(()=>window.reviewFixture.projects[0].blocks[0].body==='列上限前未保存文字'));
  });
  await scenario('old-receipt',fixture(),async page=>{await page.evaluate(()=>window.reviewFixture.mode='lost');await page.locator('#project-name').fill('r2旧回执名称');await page.locator('h1').click();await page.waitForSelector('.pending-note');
   await page.evaluate(()=>{window.reviewFixture.projects[0].name='r3最新正式名称';window.reviewFixture.projects[0].revision=3;window.reviewFixture.mode='success';});await page.getByRole('button',{name:'读取正式记录（保留草稿）',exact:true}).click();await page.waitForSelector('.project-conflict');
   await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.pending-note'));await page.locator('nav a[href="#projects"]').click();
   check('Given old r2 receipt and known r3 When retrying Then official card never rolls back to r2',(await page.locator('[data-project-id] h2').innerText())==='r3最新正式名称');
  });
  await scenario('old-receipt-read-failure',fixture(),async page=>{await page.evaluate(()=>window.reviewFixture.mode='lost');await page.locator('#project-name').fill('旧请求内容');await page.locator('h1').click();await page.waitForSelector('.pending-note');
   await page.evaluate(()=>{window.reviewFixture.projects[0].name='比回执更新的正式记录';window.reviewFixture.projects[0].revision=3;window.reviewFixture.mode='success';window.reviewFixture.failRead=true;});
   await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).click();await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).waitFor();
   check('Given historical receipt but latest read fails Then request remains pending and draft retained',await page.locator('#project-name').inputValue()==='旧请求内容'&&await page.locator('.pending-note').count()===1);
   await page.evaluate(()=>window.reviewFixture.failRead=false);await page.getByRole('button',{name:'核对保存结果',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.pending-note'));
   check('Given later successful reconciliation Then only latest official revision is accepted',await page.locator('#project-name').inputValue()==='比回执更新的正式记录'&&(await page.locator('.document-save-state').innerText()).includes('修订 3'));
  });
  for(const retryButton of [false,true]) await scenario(retryButton?'undo-retry-button':'undo-recovery',fixture(),async page=>{await page.locator('[data-row-id]').first().getByRole('button',{name:'删除行',exact:true}).click();await ready(page);await page.evaluate(()=>window.reviewFixture.mode='reject');await page.getByRole('button',{name:'撤销删除',exact:true}).click();await page.waitForSelector('.pending-note');
   await page.getByRole('button',{name:'核对保存结果',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.pending-note'));await page.evaluate(()=>window.reviewFixture.mode='success');await page.getByRole('button',{name:retryButton?'保存恢复的内容':'保存文档',exact:true}).click();await ready(page);
   check(`Given undo write failure and no receipt When ${retryButton?'retry restoration':'ordinary save'} Then undo intent is consumed`,await page.getByRole('button',{name:'撤销删除',exact:true}).count()===0&&await page.evaluate(()=>window.reviewFixture.projects[0].blocks[2].rows.length===1));
  });
  await scenario('same-link',fixture(150),async page=>{const link=page.locator('.delivery-summary .delivery-link').first();await link.click();await page.waitForFunction(row=>document.activeElement?.getAttribute('data-row-id')===row,uuid(1000));await page.locator('.list-pagination').getByRole('button',{name:'下一页',exact:true}).click();await link.click();
   check('Given same hash backlink after paging away When clicked again Then original row shown and focused',await page.locator(`[data-row-id="${uuid(1000)}"]`).count()===1&&await page.evaluate(row=>document.activeElement?.getAttribute('data-row-id')===row,uuid(1000)));
  });
  report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
 }catch(error){report.failure=String(error);process.exitCode=1;}finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failed:report.checks.filter(c=>!c.ok)},null,2));}
 if(report.checks.some(c=>!c.ok)||report.errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
