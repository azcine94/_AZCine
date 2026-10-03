// Additional real S02 editor acceptance. Keeps every created project/row and all evidence.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
const {projectOverflow}=require('./support/project-overflow.cjs');
(async()=>{
  const run=path.resolve(process.env.AZCINE_VALIDATION_RUN||'');
  if(!run.startsWith(path.resolve('artifacts/validation')+path.sep))throw new Error('Explicit test-only root required');
  const {out,hashes}=validationRun('s02-editor',['app/src','app/src-tauri/src','scripts','tests/verify-s02-editor.cjs']);
  const report={mode:'real Tauri UI and Rust SQLite; retained synthetic records',before:hashes(),checks:[],errors:[]};
  const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw new Error(name);};
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT||9224}`);
  try{
    const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:1420'));if(!page)throw new Error('No owned page');
    page.on('pageerror',error=>report.errors.push(error.message));
    const ipc=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
    await page.locator('nav a[href="#projects"]').click();await page.waitForSelector('#project-search');await page.locator('a[href="#projects/new"]').first().click();await page.waitForSelector('#new-project-name');
    await page.locator('#new-project-name').fill('编辑验收 '+randomUUID().slice(0,8));
    const name=await page.locator('#new-project-name').inputValue();
    await page.getByRole('button',{name:'新建公司项目',exact:true}).click();
    await page.waitForSelector('[data-project-document]');
    const project=(await ipc('list_projects')).find(p=>p.name===name);
    const ready=()=>page.waitForFunction(()=>document.querySelector('.document-save-state')?.textContent.includes('已保存')&&!document.querySelector('.pending-note'));
    const add=async(name)=>{await page.getByRole('button',{name:'添加内容',exact:true}).click();await page.getByRole('menuitem',{name:new RegExp(`^${name}`)}).click();await ready();};
    const read=async()=>(await ipc('list_projects')).find(doc=>doc.id===project.id);
    await add('添加文字');
    let saved=await read();const noteId=saved.blocks[0].id;
    await page.locator('textarea.doc-text').fill('自由正文 <script>只是文字，不执行</script>');await page.locator('h1').click();await ready();
    check('Given added text When edit saved Then raw body kept as text',(await read()).blocks[0].body==='自由正文 <script>只是文字，不执行</script>');
    await add('添加勾选清单');
    await page.getByRole('button',{name:'添加清单项',exact:true}).click();await ready();
    await page.getByLabel('清单项内容',{exact:true}).fill('核对剪辑');await page.locator('h1').click();await ready();
    await page.getByRole('checkbox',{name:'勾选：核对剪辑',exact:true}).check();await ready();
    check('Given checklist When edited and checked Then real checked/text persist',(await read()).blocks.find(b=>b.kind==='checklist').items[0].checked===true);
    await add('添加表格 list');
    saved=await read();const tableId=saved.blocks.find(b=>b.kind==='list').id;
    let table=()=>page.locator(`[data-block-id="${tableId}"]`);
    check('Given new list Then ordinary unselected one text column',saved.blocks.find(b=>b.id===tableId).included===false&&saved.blocks.find(b=>b.id===tableId).columns.length===1);
    await table().getByRole('button',{name:'添加行',exact:true}).click();await ready();
    await table().locator('[data-column-kind="text"] input').fill('普通参考日期 2028-01-01');await page.locator('h1').click();await ready();
    check('Given ordinary list text with date Then not inferred as delivery',!(await page.locator('.delivery-summary').innerText()).includes('2028-01-01'));
    await table().getByLabel('参与交付汇总',{exact:true}).check();await ready();
    saved=await read();const block=saved.blocks.find(b=>b.id===tableId),rowId=block.rows[0].id;
    check('Given user includes list Then four semantic columns added without changing ordinary content',block.columns.length===5&&block.rows[0].cells[block.columns[0].id]==='普通参考日期 2028-01-01');
    await table().locator('[data-column-kind="shot"] input').fill('SH-LONG');await page.locator('h1').click();await ready();
    await page.getByRole('button',{name:'阶段标签',exact:true}).click();
    const long='客户评审阶段名称'.repeat(9); // 72 Chinese characters, under the explicit 80-character limit.
    await page.locator('#new-label').fill(long);await page.getByRole('button',{name:'新增标签',exact:true}).click();await ready();
    const picker=()=>table().locator('.project-stage-picker__trigger');
    await picker().focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');await ready();
    check('Given custom label When selected Then current value from this project',await picker().innerText()===long);
    const focus=await picker().evaluate(el=>document.activeElement===el);
    check('Given keyboard stage selection Then focus returns to trigger',focus);
    await picker().focus();await page.keyboard.press('Space');await page.keyboard.press('Home');await page.keyboard.press('Escape');
    check('Given Escape Then closes without changing value and restores focus',await picker().getAttribute('aria-expanded')==='false'&&await picker().evaluate(el=>el===document.activeElement)&&await picker().innerText()===long);
    await picker().click();await page.locator('#project-name').click();
    check('Given outside click Then picker closes without grabbing focus',await picker().getAttribute('aria-expanded')==='false'&&await page.locator('#project-name').evaluate(el=>el===document.activeElement));
    await table().locator('[data-column-kind="date"] input').fill('2027-');await page.locator('h1').click();await page.waitForSelector('.form-error');
    check('Given incomplete current date Then raw input retained with no guessed date',await table().locator('[data-column-kind="date"] input').inputValue()==='2027-'&&!(await read()).blocks.find(b=>b.id===tableId).rows[0].cells[block.columns.find(c=>c.kind==='date').id]);
    await table().locator('[data-column-kind="date"] input').fill('2028-01-03');await page.locator('h1').click();await ready();
    const originalDate=(await read()).blocks.find(b=>b.id===tableId).columns.find(c=>c.kind==='date').id;
    await table().locator('.column-settings > summary').click();
    await page.locator(`#column-${originalDate}`).locator('..').getByRole('button',{name:'删除列',exact:true}).click();await ready();
    await table().getByLabel('参与交付汇总',{exact:true}).uncheck();await ready();await table().getByLabel('参与交付汇总',{exact:true}).check();await ready();
    await table().locator('[data-column-kind="date"] input').fill('2029-01-01');await page.locator('h1').click();await ready();
    await page.getByRole('button',{name:'撤销删除',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.form-error')].some(e=>e.textContent.includes('新值')));
    check('Given readded column has new data When undo Then conflict retained and no overwrite',await table().locator('[data-column-kind="date"] input').inputValue()==='2029-01-01'&&await page.getByRole('button',{name:'撤销删除',exact:true}).count()===1);
    await table().locator('[data-column-kind="date"] input').fill('');await page.locator('h1').click();await ready();
    await page.getByRole('button',{name:'撤销删除',exact:true}).click();await ready();
    check('Given user clears semantic-column conflict When undo retries Then original column/date restored',(await read()).blocks.find(b=>b.id===tableId).rows[0].cells[originalDate]==='2028-01-03');
    await page.locator(`[data-block-id="${noteId}"]`).getByRole('button',{name:'下移：文字',exact:true}).click();await ready();
    check('Given moved text block Then new order saved',(await read()).blocks[1].id===noteId);
    await page.locator(`[data-block-id="${noteId}"]`).getByRole('button',{name:'移除块',exact:true}).click();await ready();
    const beforeUndo=await read();await page.getByRole('button',{name:'撤销删除',exact:true}).click();await ready();
    check('Given block delete undo Then position and body restored without touching other blocks',(await read()).blocks[1].id===noteId&&beforeUndo.blocks.length+1===(await read()).blocks.length);
    for(const theme of ['light','dark']){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
      await picker().focus();await page.keyboard.press('End');
      const issues=await projectOverflow(page);check(`${theme} long label expanded within wide table`,issues.valid,issues);
      await page.screenshot({path:path.join(out,`${theme}-long-stage-expanded.png`),fullPage:true});await page.keyboard.press('Escape');
    }
    check('Stable row ID after editing and column undo',(await read()).blocks.find(b=>b.id===tableId).rows[0].id===rowId);
    fs.writeFileSync(path.join(out,'s02-editor-expected.json'),JSON.stringify({projects:await ipc('list_projects'),workspace:await ipc('storage_workspace')},null,2),{flag:'wx'});
    report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
  }catch(error){report.failure=String(error);process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
