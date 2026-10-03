// S02 real Tauri acceptance. The seed uses actual Rust IPC with synthetic data;
// editing, labels, dates, undo, navigation and association use the visible UI.
const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('./support/browser.cjs').browserRuntime();
const { validationRun } = require('./support/validation-run.cjs');
const { projectOverflow } = require('./support/project-overflow.cjs');
(async () => {
  const ownerPid = Number(process.env.AZCINE_OWNER_PID), run = path.resolve(process.env.AZCINE_VALIDATION_RUN || '');
  if (!Number.isInteger(ownerPid) || ownerPid < 1 || !run.startsWith(path.resolve('artifacts/validation') + path.sep)) throw new Error('Explicit owned PID and retained validation root required.');
  const { out, hashes } = validationRun('s02-desktop-ui', ['app/src','app/src-tauri/src','scripts','tests/verify-s02-desktop.cjs','tests/support/project-overflow.cjs']);
  const report = { mode:'real Tauri/native window/SQLite; synthetic business records, no IPC mock', run, ownerPid, before:hashes(), checks:[], errors:[] };
  const check = (name, ok, detail) => { report.checks.push({name,ok,detail}); if (!ok) throw new Error(name); };
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT || 9224}`);
  try {
    const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://127.0.0.1:1420'));
    if (!page) throw new Error('Owned desktop page missing');
    page.on('pageerror', error => report.errors.push(error.message));
    const ipc = (command, args) => page.evaluate(({command,args}) => window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
    await page.locator('nav a[href="#today"]').click();
    await page.waitForSelector('[data-storage-setup]');
    await page.waitForFunction(() => document.querySelector('#data-root')?.value.length > 0);
    await page.locator('#data-root').fill(path.join(run,'data'));
    await page.getByRole('button',{name:'使用此目录',exact:true}).click();
    await page.waitForSelector('#todo-title');
    await page.locator('nav a[href="#projects"]').click();
    await page.waitForSelector('#project-search');
    check('Given new root When opening projects Then no fixture projects',await page.locator('[data-project-id]').count() === 0);
    await page.locator('a[href="#projects/new"]').first().click();await page.waitForSelector('#new-project-name');
    await page.waitForFunction(() => !document.querySelector('#new-project-name').disabled);
    await page.getByRole('button',{name:'新建公司项目',exact:true}).click();
    await page.waitForSelector('.form-error');
    check('Given empty company title When creating Then no saved card',await page.locator('[data-project-id]').count() === 0);
    await page.locator('#new-project-name').fill('真实空文档');
    await page.getByRole('button',{name:'新建公司项目',exact:true}).evaluate(button => { button.click(); button.click(); });
    await page.waitForSelector('[data-project-document]');await page.locator('nav a[href="#projects"]').click();await page.waitForSelector('[data-project-id]');
    check('Given rapid create When saved Then exactly one project',await page.locator('[data-project-id]').count() === 1);
    const blank = (await ipc('list_projects'))[0];
    check('Given company created Then labels and blocks start empty',blank.labels.length === 0 && blank.blocks.length === 0);
    const ids = Object.fromEntries(['project','other','acopy','final','foreign','list','ordinary','note','checklist','checkitem','row','missing','ordinaryRow','shot','stage','date','done','text','ordinaryText'].map(key => [key,randomUUID()]));
    const project = { id:ids.project,name:'S02 雾港',labels:[{id:ids.acopy,name:'ACOPY'},{id:ids.final,name:'FINAL'}],blocks:[
      {id:ids.note,kind:'text',title:'原始多日期笔记',body:'ACOPY 2026-12-30；FINAL 2027-01-05。仅保留原文，不自动选当前日期。'},
      {id:ids.list,kind:'list',title:'镜头交片表',included:true,columns:[{id:ids.shot,name:'镜头',kind:'shot'},{id:ids.stage,name:'当前阶段',kind:'stage'},{id:ids.date,name:'当前交期',kind:'date'},{id:ids.done,name:'交完状态',kind:'delivered'},{id:ids.text,name:'备注',kind:'text'}],rows:[{id:ids.row,cells:{[ids.shot]:'SH010',[ids.stage]:ids.acopy,[ids.date]:'2027-01-05',[ids.done]:'false',[ids.text]:'保留备注'}},{id:ids.missing,cells:{[ids.shot]:'SH020',[ids.stage]:ids.final}}]},
      {id:ids.ordinary,kind:'list',title:'普通参考表',included:false,columns:[{id:ids.ordinaryText,name:'内容',kind:'text'}],rows:[{id:ids.ordinaryRow,cells:{[ids.ordinaryText]:'2026-01-01 不推断成交期'}}]},
      {id:ids.checklist,kind:'checklist',title:'检查清单',items:[{id:ids.checkitem,text:'核对样片',checked:false}]}
    ]};
    const other = {id:ids.other,name:'S02 远山',labels:[{id:ids.foreign,name:'ACOPY'}],blocks:[]};
    await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document:project}});
    await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document:other}});
    await page.getByRole('button',{name:'重新读取项目',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-project-id]').length === 3);
    await page.locator(`[data-project-id="${ids.project}"]`).click();
    await page.waitForSelector(`[data-project-document="${ids.project}"]`);
    const read = async () => (await ipc('list_projects')).find(doc => doc.id === ids.project);
    const ready = () => page.waitForFunction(() => document.querySelector('.document-save-state')?.textContent.includes('已保存') && !document.querySelector('.pending-note'));
    const row = () => page.locator(`[data-row-id="${ids.row}"]`);
    const stage = () => row().locator('.project-stage-picker__trigger');
    await stage().focus();await page.keyboard.press('End');await page.keyboard.press('Enter');await ready();
    let saved = await read(), list = saved.blocks.find(block => block.id === ids.list);
    check('Given ACOPY row When keyboard switches FINAL Then same row/date/count and not delivered',list.rows.length === 2 && list.rows[0].id === ids.row && list.rows[0].cells[ids.date] === '2027-01-05' && list.rows[0].cells[ids.stage] === ids.final && list.rows[0].cells[ids.done] === 'false');
    await row().locator('[data-column-kind="date"] input').fill('2027-02-03');
    await page.locator('h1').click();await ready();
    saved=await read();list=saved.blocks.find(block=>block.id===ids.list);
    check('Given date edit When saved Then current stage unchanged',list.rows[0].cells[ids.stage] === ids.final && list.rows[0].cells[ids.date] === '2027-02-03');
    check('Given missing date Then explicit pending not inferred',(await page.locator('.delivery-summary').innerText()).includes('日期待补'));
    await row().locator('[data-column-kind="shot"] input').fill('SH010');
    await page.locator(`[data-block-id="${ids.note}"] textarea`).fill('直接勾交完前的备注仍保存');
    await row().locator('[data-column-kind="delivered"] input').check();await ready();
    check('Given text edited When directly checking delivered Then both changes really persist',(await read()).blocks.find(block=>block.id===ids.note).body==='直接勾交完前的备注仍保存'&&(await read()).blocks.find(block=>block.id===ids.list).rows[0].cells[ids.done]==='true');
    check('Given delivered checked Then excluded from pending summary',!(await page.locator('.delivery-summary').innerText()).includes('SH010'));
    await row().locator('[data-column-kind="delivered"] input').uncheck();await ready();
    check('Given delivered restored Then summary includes row',(await page.locator('.delivery-summary').innerText()).includes('SH010'));
    await page.locator('nav a[href="#today"]').click();
    check('Given saved delivery When opening home Then same date/stage and no ordinary-table date',(await page.locator('.today-delivery-card').innerText()).includes('2027-02-03') && !(await page.locator('.today-delivery-card').innerText()).includes('2026-01-01'));
    await page.locator('.today-delivery-card a').filter({hasText:'SH010'}).click();
    await page.waitForFunction(({block,row}) => document.activeElement?.id === `row-${block}-${row}`,{block:ids.list,row:ids.row});
    check('Given home link When clicked Then original stable row receives focus',await row().evaluate(el=>el===document.activeElement));
    await page.getByRole('button',{name:'阶段标签',exact:true}).click();
    await page.locator(`#label-${ids.final}`).fill('客户 FINAL');await page.locator('h1').click();await ready();
    const others = await ipc('list_projects');
    check('Given project A label renamed Then B label independent',others.find(doc=>doc.id===ids.other).labels[0].name==='ACOPY' && (await stage().innerText()).includes('客户 FINAL'));
    await page.locator(`#label-${ids.final}`).locator('..').getByRole('button',{name:'删除标签',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.tag-settings .form-error')?.textContent.includes('引用'));
    check('Given referenced label When delete attempted Then label still exists',(await read()).labels.some(label=>label.id===ids.final));
    const note = page.locator(`[data-block-id="${ids.note}"] textarea`);
    await note.fill('保留跨页输入与原始多日期 2026-12-30 / 2027-01-05');
    // Invalid title creates a real validation failure without overwriting official content.
    await page.locator('#project-name').fill('');await page.locator('nav a[href="#projects"]').click();
    await page.locator(`[data-project-id="${ids.project}"]`).click();await page.waitForSelector('#project-name');
    check('Given invalid title draft When navigating Then input retained and official title unmodified',await page.locator('#project-name').inputValue()===''&&(await read()).name==='S02 雾港');
    await page.locator('#project-name').fill('S02 雾港');await page.locator('h1').click();await ready();
    await row().getByRole('button',{name:'删除行',exact:true}).click();await ready();
    check('Given row deletion Then official summary and document both removed',!(await read()).blocks.find(block=>block.id===ids.list).rows.some(row=>row.id===ids.row));
    await page.getByRole('button',{name:'撤销删除',exact:true}).click();await ready();
    check('Given undo deletion Then same row date/stage restored',(await read()).blocks.find(block=>block.id===ids.list).rows[0].cells[ids.date]==='2027-02-03');
    const listRegion=page.locator(`[data-block-id="${ids.list}"]`);
    await note.fill('直接切汇总前的文字');await listRegion.getByLabel('参与交付汇总',{exact:true}).uncheck();await ready();
    saved=await read();check('Given text edit When directly excluding list Then text and selection saved together',saved.blocks.find(block=>block.id===ids.note).body==='直接切汇总前的文字'&&!saved.blocks.find(block=>block.id===ids.list).included);
    await listRegion.getByLabel('参与交付汇总',{exact:true}).check();await ready();
    await page.locator(`[data-block-id="${ids.checklist}"] input[aria-label="清单项内容"]`).fill('直接勾选的新清单文字');await page.locator(`[data-block-id="${ids.checklist}"] input[type="checkbox"]`).check();await ready();
    saved=await read();check('Given checklist text edit When directly checking Then text and checked persist',saved.blocks.find(block=>block.id===ids.checklist).items[0].text==='直接勾选的新清单文字'&&saved.blocks.find(block=>block.id===ids.checklist).items[0].checked);
    await listRegion.locator('.column-settings > summary').click();
    await page.locator(`#column-${ids.date}`).locator('..').getByRole('button',{name:'删除列',exact:true}).click();await ready();
    await listRegion.getByLabel('参与交付汇总',{exact:true}).uncheck();await ready();
    await listRegion.getByLabel('参与交付汇总',{exact:true}).check();await ready();
    await page.getByRole('button',{name:'撤销删除',exact:true}).click();await ready();
    list=(await read()).blocks.find(block=>block.id===ids.list);
    check('Given semantic column removed/readded empty When undo Then original column values restored',list.columns.some(column=>column.id===ids.date)&&list.rows[0].cells[ids.date]==='2027-02-03');
    // Project association is real, not a fabricated select option.
    await page.locator('nav a[href="#today"]').click();
    await page.locator('#todo-title').fill('关联公司核对');await page.locator('#todo-project').selectOption(ids.project);
    await page.getByRole('button',{name:'保存待办',exact:true}).click();await page.waitForSelector('[data-todo-id]');
    const workspace=await ipc('storage_workspace');
    check('Given selected real company When saving todo Then association persists',workspace.todos.find(todo=>todo.title==='关联公司核对').projectId===ids.project);
    const contrast=fs.readFileSync('tests/support/inspect-contrast.js','utf8');
    for (const theme of ['light','dark']) for (const [width,height] of [[1440,900],[1280,800],[1024,768]]) {
      if (await page.locator('html').getAttribute('data-theme')!==theme) await page.getByRole('button',{name:/切换.*色/}).click();
      execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(ownerPid),'-Action','resize','-Width',String(width),'-Height',String(height)]);
      await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<2&&Math.abs(innerHeight-height)<2,{width,height});
      for(const route of ['projects',`projects/${ids.project}`,'today']) {
        await page.evaluate(route=>{location.hash=`#${route}`;},route);await page.waitForFunction(route=>location.hash===`#${route}`,route);
        if(route.includes('/')) await page.waitForSelector('[data-project-document]');else await page.waitForSelector(route==='projects'?'#project-search':'#todo-title');
        const issues=await projectOverflow(page);check(`${theme}/${width}/${route} overflow`,issues.valid,issues);
        const measured=await page.evaluate(contrast);check(`${theme}/${width}/${route} contrast`,measured.low.length===0&&measured.overlap.length===0,measured);
        const edges=await page.evaluate(()=>{const s=document.querySelector('.side').getBoundingClientRect(),m=document.querySelector('main').getBoundingClientRect(),h=document.querySelector('h1').getBoundingClientRect(),meta=document.querySelector('.page-heading .meta').getBoundingClientRect();return{left:s.left,right:document.documentElement.clientWidth-m.right,bottom:s.bottom-m.bottom,baseline:(h.top+h.bottom-meta.top-meta.bottom)/2};});
        check(`${theme}/${width}/${route} aligned edges and heading`,Math.abs(edges.left-edges.right)<1&&Math.abs(edges.bottom)<1&&Math.abs(edges.baseline)<1,edges);
        if(route.includes('/')&&width<=1280){
          const firstRow=page.locator(`[data-row-id="${ids.row}"]`);
          await firstRow.locator('[data-column-kind="text"] input').focus();await page.keyboard.press('Tab');
          const reachable=await firstRow.getByRole('button',{name:'删除行',exact:true}).evaluate(button=>{const region=button.closest('.list-scroll'),r=region.getBoundingClientRect(),b=button.getBoundingClientRect();return{focused:document.activeElement===button,left:b.left,right:b.right,regionLeft:r.left,regionRight:r.right,scroll:region.scrollLeft,needsScroll:region.scrollWidth>region.clientWidth};});
          check(`${theme}/${width} offscreen action reached by keyboard with local scroll`,reachable.focused&&reachable.left>=reachable.regionLeft-1&&reachable.right<=reachable.regionRight+1&&(!reachable.needsScroll||reachable.scroll>0),reachable);
          await page.locator(`[data-block-id="${ids.list}"] .list-scroll`).evaluate(el=>{el.scrollLeft=0;});
        }
        const small=await page.locator('main button:visible').evaluateAll(buttons=>buttons.filter(b=>b.getBoundingClientRect().height<40).map(b=>b.textContent));check(`${theme}/${width}/${route} control targets`,small.length===0,small);
        await page.screenshot({path:path.join(out,`${theme}-${width}-${route.replaceAll('/','-')}.png`),fullPage:true});
      }
    }
    fs.writeFileSync(path.join(run,'s02-expected.json'),JSON.stringify({projects:await ipc('list_projects'),workspace:await ipc('storage_workspace')},null,2),{flag:'wx'});
    report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
  } catch(error) { report.failure=String(error);process.exitCode=1; }
  finally { await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
