// S01 production UI in a real owned Tauri window. No IPC fixture or browser substitute.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('./support/browser.cjs').browserRuntime();
const { validationRun } = require('./support/validation-run.cjs');
(async () => {
  const ownerPid = Number(process.env.AZCINE_OWNER_PID);
  const run = path.resolve(process.env.AZCINE_VALIDATION_RUN || '');
  if (!Number.isInteger(ownerPid) || ownerPid < 1 || !run.startsWith(path.resolve('artifacts/validation') + path.sep)) throw new Error('Explicit owned PID and isolated validation run required.');
  const { out, hashes } = validationRun('s01-desktop-ui');
  const report = { mode:'real Tauri WebView2/native window; no fixture',run,ownerPid,before:hashes(),checks:[],errors:[] };
  const check = (name,ok,detail) => { report.checks.push({name,ok,detail});if(!ok) throw new Error(name); };
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT || 9224}`);
  try {
    const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:1420'));
    if(!page)throw new Error('No owned desktop page');
    page.on('pageerror',e=>report.errors.push(e.message));
    const overflow=fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js','utf8');
    await page.locator('nav a[href="#today"]').click();
    await page.waitForSelector('[data-storage-setup]');
    await page.waitForFunction(()=>document.querySelector('#data-root')?.value.length>0);
    check('Given first start Then default root is test-only and not created yet',path.resolve(await page.locator('#data-root').inputValue())===path.join(run,'data')&&!fs.existsSync(path.join(run,'data')));
    const foreign=path.join(run,'ui-foreign');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'original.txt'),'preserve');
    await page.locator('#data-root').fill(foreign);await page.getByRole('button',{name:'使用此目录',exact:true}).click();
    await page.waitForSelector('.form-error');
    check('Given nonempty foreign directory When selecting Then input retained and no false success',await page.locator('#data-root').inputValue()===foreign&&!fs.existsSync(path.join(foreign,'db')));
    await page.locator('#data-root').fill(path.join(run,'data'));await page.getByRole('button',{name:'使用此目录',exact:true}).click();
    await page.waitForSelector('#todo-title');
    await page.getByRole('button',{name:'保存待办',exact:true}).click();await page.waitForSelector('.form-error');
    check('Given empty title When saving Then required error and no row',(await page.locator('.form-error').innerText()).includes('标题')&&await page.locator('[data-todo-id]').count()===0);
    await page.locator('#todo-title').fill('真实界面灯光检查');
    await page.locator('#todo-date').focus();await page.keyboard.type('2026-10-');
    await page.getByRole('button',{name:'保存待办',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.form-error')?.textContent.includes('完整日期'));
    check('Given partial keyboard date When saving Then no row and raw date retained',await page.locator('[data-todo-id]').count()===0&&await page.locator('#todo-date').inputValue()==='2026-10-');
    await page.locator('nav a[href="#projects"]').click();await page.locator('nav a[href="#today"]').click();
    check('Given partial date When navigating Then incomplete input is not lost',await page.locator('#todo-date').inputValue()==='2026-10-');
    await page.locator('#todo-date').fill('');
    check('Given draft When navigating Then input retained',await page.locator('#todo-title').inputValue()==='真实界面灯光检查');
    await page.getByRole('button',{name:/切换.*色/}).click();check('Given draft When changing theme Then input retained',await page.locator('#todo-title').inputValue()==='真实界面灯光检查');
    await page.getByRole('button',{name:'保存待办',exact:true}).evaluate(button=>{button.click();button.click();});
    await page.waitForSelector('[data-todo-id]');
    check('Given rapid save without date Then single real row and empty date',await page.locator('[data-todo-id]').count()===1&&(await page.locator('[data-todo-id]').innerText()).includes('未设日期'));
    const id=await page.locator('[data-todo-id]').getAttribute('data-todo-id');
    await page.getByRole('button',{name:'完成待办：真实界面灯光检查',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-todo-id]').length===0);
    await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForSelector('[data-todo-id]');
    check('Given completion When undoing Then same row restored',await page.locator('[data-todo-id]').getAttribute('data-todo-id')===id);
    check('Given successful undo Then action consumed rather than silently becoming redo',await page.getByRole('button',{name:'撤销',exact:true}).count()===0);
    await page.getByRole('button',{name:'完成待办：真实界面灯光检查',exact:true}).click();
    await page.getByRole('button',{name:'已完成',exact:true}).click();await page.waitForSelector('[data-todo-id]');
    await page.getByRole('button',{name:'恢复待办：真实界面灯光检查',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-todo-id]').length===0);
    await page.getByRole('button',{name:'未完成',exact:true}).click();await page.waitForSelector('[data-todo-id]');
    const today=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
    await page.locator('#todo-title').fill('今日待办');await page.locator('#todo-date').fill(today);await page.getByRole('button',{name:'保存待办',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-todo-id]').length===2);
    await page.getByRole('button',{name:'今天',exact:true}).click();
    check('Given dated and undated rows When today filter Then only today row visible',await page.locator('[data-todo-id]').count()===1&&(await page.locator('[data-todo-id]').innerText()).includes('今日待办'));
    await page.getByRole('button',{name:'未完成',exact:true}).click();
    for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
      execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(ownerPid),'-Action','resize','-Width',String(width),'-Height',String(height)]);
      await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<2&&Math.abs(innerHeight-height)<2,{width,height});
      for(const route of ['today','settings']){
        await page.locator(`nav a[href="#${route}"]`).click();await page.waitForSelector(`main[data-page="${route}"]`);
        const issues=await page.evaluate(overflow);check(`${theme}/${width}/${route} no overflow`,issues.length===0,issues);
        const metrics=await page.evaluate(()=>{const side=document.querySelector('.side').getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect(),title=document.querySelector('h1').getBoundingClientRect(),meta=document.querySelector('.page-heading .meta').getBoundingClientRect();return {left:side.left,right:document.documentElement.clientWidth-main.right,bottom:side.bottom-main.bottom,baseline:(title.top+title.bottom-meta.top-meta.bottom)/2};});
        check(`${theme}/${width}/${route} edges and heading`,metrics.left===metrics.right&&Math.abs(metrics.bottom)<1&&Math.abs(metrics.baseline)<1,metrics);
        const contrast=await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js','utf8'));check(`${theme}/${width}/${route} readable contrast/no card overlap`,contrast.low.length===0&&contrast.overlap.length===0,contrast);
        const small=await page.locator('main button:visible').evaluateAll(buttons=>buttons.filter(b=>b.getBoundingClientRect().height<40).map(b=>b.textContent));check(`${theme}/${width}/${route} controls 40px`,small.length===0,small);
        await page.screenshot({path:path.join(out,`${theme}-${width}-${route}.png`),fullPage:true});
      }
    }
    await page.locator('nav a[href="#today"]').focus();await page.keyboard.press('Enter');await page.waitForSelector('#todo-title');
    await page.locator('#todo-title').focus();await page.keyboard.type('键盘保存');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-todo-id]').length===3);
    check('Given keyboard When Enter saves Then title reset after real save',await page.locator('#todo-title').inputValue()==='');
    await page.reload();await page.waitForSelector('[data-todo-id]');check('Given reload Then actual saved rows still rendered',await page.locator('[data-todo-id]').count()===3);
    const saved=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('storage_workspace'));fs.writeFileSync(path.join(run,'ui-expected.json'),JSON.stringify(saved,null,2),{flag:'wx'});
    report.after=hashes();check('Source unchanged',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
  }catch(error){report.failure=String(error);process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
