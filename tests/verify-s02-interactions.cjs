// Explicit delayed IPC replay catches transient visual/focus changes; not real storage failure.
const fs=require('node:fs'),path=require('node:path');
const {browserRuntime}=require('./support/browser.cjs');
const {validationRun}=require('./support/validation-run.cjs');
const {projectPresentation}=require('./support/project-presentation.cjs');
(async()=>{
 const baseline=process.argv.includes('--baseline'),{out,hashes}=validationRun(baseline?'s02-interactions-before':'s02-interactions-replay',['app/src','tests/verify-s02-interactions.cjs']);
 const report={mode:'explicit test-only delayed IPC replay; synthetic project; no normal-entry mocks',baseline,before:hashes(),checks:[],screenshots:[],errors:[]};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok&&!baseline)throw Error(name);};
 const {chromium,executablePath}=browserRuntime(),browser=await chromium.launch({headless:true,executablePath});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>report.errors.push(e.message));
 const {document:sample,ids}=projectPresentation();
 sample.blocks.push({id:'bbbbbbbb-1111-2222-3333-000000000001',kind:'checklist',title:'焦点核对清单',items:[{id:'bbbbbbbb-1111-2222-3333-000000000002',text:'虚构核对项',checked:false}]});
 await page.addInitScript(doc=>{
  window.isTauri=true;
  window.interactionFixture={project:{...doc,revision:1,createdAt:'2026-10-03T00:00:00Z'},pending:null,calls:[],receipts:{},delay:true};
  window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
   const f=window.interactionFixture;f.calls.push({command,args:structuredClone(args)});
   if(command==='storage_workspace')return{root:'D:\\InteractionReplay',defaultRoot:'D:\\InteractionReplay',todos:[]};
   if(command==='list_projects')return[structuredClone(f.project)];
   if(command==='project_request')return structuredClone(f.receipts[args.requestId]??null);
   if(command==='save_project'){
    const req=structuredClone(args.input);
    if(f.delay)return new Promise((resolve,reject)=>f.pending={req,resolve,reject});
    if(f.receipts[req.requestId])return structuredClone(f.receipts[req.requestId]);
    if(req.expectedRevision!==f.project.revision)throw Error('回放：旧修订拒绝');
    f.project={...req.document,revision:f.project.revision+1,createdAt:f.project.createdAt};f.receipts[req.requestId]=structuredClone(f.project);return structuredClone(f.project);
   }
   throw Error('Unexpected replay command '+command);
  }};
 },sample);
 const list=()=>page.locator(`[data-block-id="${ids.list}"]`),picker=()=>list().locator('.project-stage-picker__trigger').first();
 // A popup is viewport-relative: fullPage changes the headless viewport and
 // can legitimately dismiss its anchor. Capture the real viewport instead.
 const screenshot=async name=>{await page.screenshot({path:path.join(out,name)});report.screenshots.push(name);};
 const snapshot=()=>page.evaluate(()=>{
  const selectors=['#project-name','.block-title','.doc-text','.doc-add-row','.doc-row-action','.project-stage-picker__trigger'];
  return Object.fromEntries(selectors.map(selector=>{const el=document.querySelector(selector),s=getComputedStyle(el);return[selector,{opacity:s.opacity,color:s.color,background:s.backgroundColor}];}));
 });
 const finish=async()=>{await page.evaluate(()=>{const f=window.interactionFixture,p=f.pending;f.project={...p.req.document,revision:f.project.revision+1,createdAt:f.project.createdAt};f.receipts[p.req.requestId]=structuredClone(f.project);f.pending=null;p.resolve(structuredClone(f.project));});await page.waitForFunction(()=>document.querySelector('.document-save-state')?.textContent.includes('已保存')&&!window.interactionFixture.pending);};
 try{
  await page.goto(`http://127.0.0.1:${process.env.AZCINE_DEV_PORT||1420}/#projects/${ids.project}`);await page.waitForSelector('#project-name');
  for(const action of ['add','remove','included']){
   await page.mouse.move(0,0);const before=await snapshot();const button=action==='add'?list().getByRole('button',{name:'添加行',exact:true}):action==='remove'?list().getByRole('button',{name:'删除行',exact:true}).last():list().getByRole('checkbox',{name:'参与交付汇总',exact:true});
   await button.click();await page.waitForFunction(()=>!!window.interactionFixture.pending);
   await page.mouse.move(0,0);const during=await snapshot();
   check(`Given ${action} with delayed save Then unrelated controls do not fade or change palette`,JSON.stringify(before)===JSON.stringify(during),{before,during});
   check(`Given ${action} pending Then trigger or adjacent row action retains keyboard focus`,action==='remove'?await list().locator('.doc-row-action').evaluateAll(buttons=>buttons.some(el=>el===document.activeElement)):await button.evaluate(el=>el===document.activeElement));
   const calls=await page.evaluate(()=>window.interactionFixture.calls.filter(c=>c.command==='save_project').length),rowCount=await list().locator('[data-row-id]').count();
   await list().getByRole('button',{name:'添加行',exact:true}).evaluate(el=>el.click());
   await list().getByRole('checkbox',{name:'参与交付汇总',exact:true}).evaluate(el=>el.click());
   check(`Given ${action} pending When another structural action activated Then no duplicate save or extra row`,await page.evaluate(calls=>window.interactionFixture.calls.filter(c=>c.command==='save_project').length===calls,calls)&&await list().locator('[data-row-id]').count()===rowCount);
   await screenshot(`pending-${action}.png`);await finish();
  }
  // Enable delivery again and settle before measuring the anchored stage options.
  await list().getByRole('checkbox',{name:'参与交付汇总',exact:true}).check();await page.waitForFunction(()=>!!window.interactionFixture.pending);await finish();
  const rects=()=>list().locator('[data-row-id]').evaluateAll(rows=>rows.map(row=>({id:row.dataset.rowId,top:row.getBoundingClientRect().top,height:row.getBoundingClientRect().height})));
  await picker().scrollIntoViewIfNeeded();const before=await rects();await picker().click();await page.getByRole('listbox').waitFor();
  const after=await rects();check('Given stage picker When opened Then every list row keeps its height and position',JSON.stringify(before)===JSON.stringify(after),{before,after});
  await screenshot('stage-floating.png');await page.keyboard.press('End');await page.keyboard.press('Enter');await page.waitForFunction(()=>!!window.interactionFixture.pending);await finish();
  check('Given keyboard stage choice Then value saved without changing date or row IDs',await page.evaluate(({ids,sample})=>{const b=window.interactionFixture.project.blocks.find(b=>b.id===ids.list);return b.rows[0].id===sample.blocks[1].rows[0].id&&b.rows[0].cells[ids.stage]===ids.final&&b.rows[0].cells[ids.date]===sample.blocks[1].rows[0].cells[ids.date];},{ids,sample}));
  check('Given stage choice Then focus returns to the trigger',await picker().evaluate(el=>el===document.activeElement));
  await picker().click();await page.keyboard.press('Escape');check('Given Escape Then popup closes without changing focus',await picker().getAttribute('aria-expanded')==='false'&&await picker().evaluate(el=>el===document.activeElement));
  await picker().click();await page.locator('#project-name').click();check('Given outside click Then popup closes without taking focus',await picker().getAttribute('aria-expanded')==='false'&&await page.locator('#project-name').evaluate(el=>el===document.activeElement));
  const summaryBefore=await page.locator('.delivery-summary').boundingBox();await page.getByRole('button',{name:'添加内容',exact:true}).click();
  const summaryAfter=await page.locator('.delivery-summary').boundingBox();check('Given add-content trigger When opened Then compact anchored menu does not push the summary',summaryBefore.y===summaryAfter.y,{summaryBefore,summaryAfter});
  if(!baseline){
   check('Given add-content menu Then three named types with short descriptions',await page.getByRole('menuitem').count()===3&&await page.getByRole('menuitem',{name:/表格/}).count()===1);
   await screenshot('add-content-menu.png');await page.keyboard.press('End');
   const menuBeforeEscape=await page.evaluate(()=>({active:document.activeElement?.getAttribute('role'),text:document.activeElement?.textContent?.slice(0,120),expanded:document.querySelector('.document-heading-actions .project-add-menu button')?.getAttribute('aria-expanded'),panel:document.querySelector('.project-add-menu__panel:popover-open')?.getBoundingClientRect().toJSON()}));
   await page.keyboard.press('Escape');
   const menuAfterEscape=await page.evaluate(()=>({active:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,120),pending:!!window.interactionFixture.pending,expanded:document.querySelector('.document-heading-actions .project-add-menu button')?.getAttribute('aria-expanded')}));
   check('Given add-menu Escape Then no document change and trigger focused',await page.getByRole('button',{name:'添加内容',exact:true}).evaluate(el=>el===document.activeElement)&&!menuAfterEscape.pending,{menuBeforeEscape,menuAfterEscape});
   await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('menuitem',{name:/文字/}).click();await page.waitForFunction(()=>!!window.interactionFixture.pending);await finish();
   check('Given menu selection Then one new text block and prior data retained',await page.evaluate(sample=>window.interactionFixture.project.blocks.length===sample.blocks.length+1&&window.interactionFixture.project.blocks.at(-1).kind==='text',sample));
   await picker().scrollIntoViewIfNeeded();const ownRows=await rects();await picker().click();await list().locator('.list-scroll').evaluate(el=>el.scrollLeft=300);await page.waitForFunction(()=>document.querySelector('.project-stage-picker__trigger')?.getAttribute('aria-expanded')==='false'||document.querySelector('.project-stage-picker__listbox:popover-open'));
   check('Given horizontal scrolling Then table rows remain intact',JSON.stringify(ownRows)===JSON.stringify(await rects()));await page.keyboard.press('Escape');
  }else await page.getByRole('button',{name:'添加内容',exact:true}).click();
  for(const selector of ['#project-name','.block-title','.doc-text','.project-checklist .input']){
   await page.locator(selector).first().focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
   const focus=await page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return{visible:el.matches(':focus-visible'),outline:s.outlineStyle,width:parseFloat(s.outlineWidth)};});
   check(`Given ${selector} When reached by keyboard Then solid visible focus ring`,focus.visible&&focus.outline==='solid'&&focus.width>=2,focus);
  }
  report.after=hashes();check('Source stable while testing',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',!report.errors.length,report.errors);
 }catch(error){report.failure=String(error);process.exitCode=1;await screenshot('failure.png').catch(()=>{});}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({out,checks:report.checks.length,failed:report.checks.filter(c=>!c.ok).length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
