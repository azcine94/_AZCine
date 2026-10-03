// Matched approved reference versus the actual owned Tauri/SQLite view.
// Newer business/date/auto-height/type rules adapt the reference in memory.
// The reference reserves a real-width native scroll gutter, matching the desktop
// whose persisted-record reload control makes the index longer than the HTML.
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { browserRuntime } = require('./support/browser.cjs');
const { validationRun } = require('./support/validation-run.cjs');
const { projectOverflow } = require('./support/project-overflow.cjs');
const { projectPresentation, referenceScript } = require('./support/project-presentation.cjs');
(async () => {
  const baseline = process.env.AZCINE_RESTORATION_BASELINE === '1';
  const run = path.resolve(process.env.AZCINE_VALIDATION_RUN || ''), ownerPid = Number(process.env.AZCINE_OWNER_PID);
  if (!run.startsWith(path.resolve('artifacts/validation') + path.sep) || !Number.isInteger(ownerPid) || ownerPid < 1) throw Error('Retained test root and exact owned PID required');
  const { out, hashes } = validationRun(baseline ? 's02-restoration-baseline' : 's02-restoration', ['app/src','app/src-tauri/src','design','tests/verify-s02-restoration.cjs','tests/support/project-presentation.cjs']);
  const report = { mode:'real owned Tauri/SQLite vs approved HTML; synthetic shared state; no model/IPC mock', baseline, run, ownerPid, before:hashes(), checks:[], comparisons:[], focus:[], screenshots:[], errors:[], adaptations:['three single-shot rows; delivered independent of FINAL','card copy derived from block titles; specified 13/20 secondary type','feature date year/month-day; full dates in groups','text auto-height from content, not the prototype rows=3 floor; new input limited to the confirmed project name','native thin vertical gutter retained on both surfaces; desktop-only reload action remains a documented functional difference'] };
  const check = (name, ok, detail) => { report.checks.push({name,ok,detail}); if (!ok && !baseline) throw Error(name); };
  const { chromium, executablePath } = browserRuntime();
  const desktop = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT || 9224}`);
  const referenceBrowser = await chromium.launch({headless:true,executablePath,ignoreDefaultArgs:['--hide-scrollbars']});
  try {
    const page = desktop.contexts()[0].pages()[0];
    page.on('pageerror',error=>report.errors.push(error.message));
    const ipc = (command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
    await page.locator('nav a[href="#today"]').click();
    if (await page.locator('[data-storage-setup]').count()) {
      await page.waitForFunction(()=>!!document.querySelector('#data-root')?.value);
      await page.locator('#data-root').fill(path.join(run,'data'));
      await page.getByRole('button',{name:'使用此目录',exact:true}).click();
    }
    await page.waitForSelector('#todo-title');
    await page.locator('nav a[href="#projects"]').click();
    await page.waitForSelector('#project-search');
    const {ids,document:sample} = projectPresentation();
    await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document:sample}});
    await page.getByRole('button',{name:'重新读取项目',exact:true}).click();
    await page.waitForSelector(`[data-project-id="${ids.project}"]`);
    fs.writeFileSync(path.join(out,'presentation.json'),JSON.stringify(sample,null,2),{flag:'wx'});
    const reference = await referenceBrowser.newPage();
    reference.on('pageerror',error=>report.errors.push(`reference: ${error.message}`));
    await reference.route('**/projects.js',route=>route.fulfill({contentType:'text/javascript',body:referenceScript(fs.readFileSync('design/projects.js','utf8'),sample)}));
    const resize = async (width,height) => {
      execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(ownerPid),'-Action','resize','-Width',String(width),'-Height',String(height)]);
      await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<2&&Math.abs(innerHeight-height)<2,{width,height});
      await reference.setViewportSize({width,height});
    };
    const go = async route => {
      await page.evaluate(route=>location.hash=route,`#${route}`);
      await page.waitForSelector(route==='projects'?'#project-search':route==='projects/new'?'#new-project-name':'[data-project-document]');
      await page.locator('h1').scrollIntoViewIfNeeded();
      await page.evaluate(()=>window.scrollTo(0,0));
    };
    const prepareReference = async (theme,view) => {
      await reference.goto(pathToFileURL(path.resolve('design/workspace-b.html')).href+`?theme=${theme}#${view==='document'?'projects/film':view}`);
      await reference.waitForSelector(view==='document'?'.project-document':view==='projects/new'?'#doc-project-name':'.document-project-card');
      // The old prototype date and fixed textarea height predate confirmed rules.
      await reference.evaluate(() => {
        for (const date of document.querySelectorAll('.doc-card-summary time,.doc-summary-date')) {
          date.innerHTML='<span class="restoration-year">2026 年</span><span>10/14</span>';
          date.setAttribute('datetime','2026-10-14');
        }
        for (const date of document.querySelectorAll('.doc-summary-line time')) date.textContent=date.textContent.includes('14')?'2026-10-14':'2026-10-20';
        for (const text of document.querySelectorAll('textarea.doc-text')) {text.style.height='0px';text.style.height=`${text.scrollHeight}px`;} 
      });
      await reference.addStyleTag({content:'html{overflow-y:scroll}.doc-card-summary{line-height:var(--lh-s)}.doc-card-summary time,.doc-summary-date{display:flex;flex-direction:column;gap:var(--s-1)}.restoration-year{font:400 var(--fs-xs)/var(--lh-xs) var(--mono);color:var(--t2)}.doc-next-delivery .restoration-year{color:var(--feature-secondary)}'});
    };
    const measure = (target,production,view)=>target.evaluate(({production,view})=>{
      const selectors = production ? { content:'.project-content',toolbar:'.project-index-toolbar',grid:'.project-grid',card:'.project-card',identity:'.project-card-identity',cardBottom:'.project-card-bottom',cardDate:'.project-card-summary .project-date',crumb:'.document-breadcrumb',heading:'.document-top',summary:'.delivery-summary',feature:'.summary-feature',groups:'.summary-items',line:'.summary-line',records:'.summary-records',block:'.doc-block',blockTitle:'.block-title',body:'.doc-text',table:'.doc-table',tableScroll:'.list-scroll' } : { content:'#home-content',toolbar:'.doc-index-toolbar',grid:'.document-project-grid',card:'.document-project-card',identity:'.doc-card-identity',cardBottom:'.doc-card-bottom',cardDate:'.doc-card-summary time',crumb:'.doc-breadcrumb',heading:'.doc-heading',summary:'.doc-summary',feature:'.doc-next-delivery',groups:'.doc-summary-groups',line:'.doc-summary-line',records:'.doc-summary-line>div',block:'.document-block',blockTitle:'.doc-block-title',body:'.doc-text',table:'.doc-table',tableScroll:'.doc-table-scroll' };
      const result = {}, keys=view==='projects'?['content','toolbar','grid','card','identity','cardBottom','cardDate']:view==='document'?['content','crumb','heading','summary','feature','groups','line','records','block','blockTitle','body','table','tableScroll']:['content'];
      for (const key of keys) {
        const node=document.querySelector(selectors[key]),rect=node.getBoundingClientRect(),style=getComputedStyle(node);
        result[key]={left:rect.left,top:rect.top,width:rect.width,height:rect.height,font:style.fontSize,lineHeight:style.lineHeight,padding:style.padding,background:style.backgroundColor,gap:style.gap};
      }
      if(view==='projects'){const rect=document.querySelector('.project-personal-module').getBoundingClientRect();result.personal={top:rect.top,height:rect.height};}
      result.viewport={width:innerWidth,height:innerHeight};return result;
    },{production,view});
    const capture = async (target,name) => {await target.screenshot({path:path.join(out,name),fullPage:true});report.screenshots.push(name);};
    for (const theme of ['light','dark']) for (const [width,height] of [[1440,900],[1280,800],[1024,768]]) {
      await resize(width,height);
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
      for (const view of ['projects','document']) {
        await go(view==='projects'?'projects':`projects/${ids.project}`);await prepareReference(theme,view);
        await page.mouse.move(0,0);await reference.mouse.move(0,0);
        const actual=await measure(page,true,view),expected=await measure(reference,false,view),differences=[];
        // Compare actual geometry, not just a hard-coded description of intended CSS.
        // New year/auto-height rules are already represented in both data states.
        const comparable=view==='projects'?{toolbar:['left','top','height'],grid:['left','top','width','gap'],card:['width','height'],identity:['height','padding'],cardBottom:['top','height','padding'],personal:['top','height']}:{crumb:['top','height'],heading:['top','height'],summary:['left','top','width','height','padding'],feature:['left','top','width','height'],groups:['left','top'],line:['height'],records:['left'],block:['top'],blockTitle:['height','font'],body:['height','font','lineHeight']};
        for (const [key,fields] of Object.entries(comparable)) for(const field of fields){const a=actual[key][field],b=expected[key][field];if(typeof a==='number'?Math.abs(a-b)>1:a!==b)differences.push({key,field,actual:a,reference:b});}
        report.comparisons.push({theme,width,height,view,actual,reference:expected,differences});
        await capture(reference,`${theme}-${width}-${view}-reference.png`);await capture(page,`${theme}-${width}-${view}-desktop.png`);
        check(`${theme}/${width}/${view} matched reference geometry`,differences.length===0,differences);
        const overflow=await projectOverflow(page);check(`${theme}/${width}/${view} no unhandled overflow`,overflow.valid,overflow);
        const contrast=await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js','utf8'));check(`${theme}/${width}/${view} contrast and overlap`,contrast.low.length===0&&contrast.overlap.length===0,contrast);
        const small=await page.locator('main button:visible,main a:visible').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().height<39.9&&!node.closest('.visually-hidden')).map(node=>node.textContent));check(`${theme}/${width}/${view} targets >=40px`,small.length===0,small);
      }
      await go(`projects/${ids.project}`);
      for(const [name,selector] of [['title','#project-name'],['block title','.block-title'],['body','.doc-text']]){
        await page.locator(selector).first().focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
        const focus=await page.locator(selector).first().evaluate(node=>{const style=getComputedStyle(node);return{active:node===document.activeElement,visible:node.matches(':focus-visible'),outline:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth),offset:style.outlineOffset,border:style.borderWidth,shadow:style.boxShadow};});
        report.focus.push({theme,width,height,name,...focus});await capture(page,`${theme}-${width}-focus-${name.replace(' ','-')}.png`);
        check(`${theme}/${width}/${name} keyboard solid focus ring`,focus.active&&focus.visible&&focus.outline==='solid'&&focus.outlineWidth>=2,focus);
      }
    }
    if(!baseline){
      await resize(1280,800);await go('projects');
      await page.locator('#project-search').fill('不存在');await page.waitForSelector('.project-empty-panel');check('Given unmatched search Then no false cards',await page.locator('[data-project-id]').count()===0);
      await page.getByRole('button',{name:'清除搜索',exact:true}).click();await page.waitForSelector('[data-project-id]');
      await page.locator(`[data-project-id="${ids.project}"]`).focus();await page.keyboard.press('Enter');await page.waitForSelector('#project-name');check('Given card keyboard Enter Then opens persisted document',await page.locator('#project-name').inputValue()===sample.name);
      await page.locator('.document-breadcrumb a').click();await page.waitForSelector('#project-search');await page.locator('a[href="#projects/new"]').first().click();await page.waitForSelector('#new-project-name');
      await page.locator('#new-project-name').fill('');await page.getByRole('button',{name:'新建公司项目',exact:true}).click();await page.waitForSelector('[role="alert"]');check('Given invalid new name Then remains normal form without invented document',(await ipc('list_projects')).length===1);
      await page.locator('#new-project-name').fill('保留的新建草稿');await page.locator('nav a[href="#today"]').click();await page.locator('nav a[href="#projects"]').click();await page.locator('a[href="#projects/new"]').first().click();check('Given new-name draft When navigation Then retained',await page.locator('#new-project-name').inputValue()==='保留的新建草稿');
      for(const theme of ['light','dark']){if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();await capture(page,`${theme}-1280-new-draft.png`);}
      // Long content in a real persisted document, not a fake textarea height assertion.
      const current=(await ipc('list_projects')).find(project=>project.id===ids.project),long=structuredClone(sample);long.blocks[0].body='虚构长文 · https://example.invalid/'+('long-path-'.repeat(40))+'\n'+('较长正文需要自动展开并保留编辑焦点。'.repeat(30));long.labels[1].name='客户自定义的较长阶段标签名称';
      await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:current.revision,document:long}});await go('projects');await page.getByRole('button',{name:'重新读取项目',exact:true}).click();await go(`projects/${ids.project}`);await resize(1024,768);
      const overflow=await projectOverflow(page);check('Given long text and long labels at 1024 Then only named table scrolls',overflow.valid,overflow);
      check('Given long document body Then auto-height shows all content',await page.locator('.doc-text').first().evaluate(node=>node.scrollHeight<=node.clientHeight+1));await capture(page,'long-1024-document.png');
      const latest=(await ipc('list_projects')).find(project=>project.id===ids.project);await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:latest.revision,document:sample}});await go('projects');await page.getByRole('button',{name:'重新读取项目',exact:true}).click();await go(`projects/${ids.project}`);
      // Add a real persisted checklist through its normal menu before checking
      // its previously omitted borderless text input at all six native sizes.
      const ready=()=>page.waitForFunction(()=>!document.querySelector('.pending-note')&&document.querySelector('.document-save-state')?.textContent.includes('已保存'));
      await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('menuitem',{name:/^添加勾选清单/}).click();await ready();
      await page.getByRole('button',{name:'添加清单项',exact:true}).click();await ready();
      const checklistInput=page.getByRole('textbox',{name:'清单项内容',exact:true});await checklistInput.fill('虚构清单 · 键盘焦点核对');await page.locator('h1').click();await ready();
      for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[1280,800],[1024,768]]){
        await resize(width,height);if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
        await checklistInput.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
        const focus=await checklistInput.evaluate(node=>{const s=getComputedStyle(node);return{active:node===document.activeElement,visible:node.matches(':focus-visible'),outline:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth)};});
        report.focus.push({theme,width,height,name:'checklist',...focus});await capture(page,`${theme}-${width}-focus-checklist.png`);
        check(`${theme}/${width}/checklist keyboard solid focus ring`,focus.active&&focus.visible&&focus.outline==='solid'&&focus.outlineWidth>=2,focus);
        const overflow=await projectOverflow(page);check(`${theme}/${width}/checklist no unhandled overflow`,overflow.valid,overflow);
      }
      const withChecklist=(await ipc('list_projects')).find(project=>project.id===ids.project);await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:withChecklist.revision,document:sample}});await go('projects');await page.getByRole('button',{name:'重新读取项目',exact:true}).click();await go(`projects/${ids.project}`);
    }
    report.after=hashes();check('Sources stable during matched comparison',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
  }catch(error){report.failure=String(error);process.exitCode=1;}
  finally{await referenceBrowser.close();await desktop.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({out,checks:report.checks.length,failed:report.checks.filter(check=>!check.ok).length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
