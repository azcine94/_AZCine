const { chromium, executablePath } = require('./support/browser.cjs').browserRuntime();
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { validationRun } = require('./support/validation-run.cjs');
(async () => {
  const { out, hashes } = validationRun('s02-design', ['design/s02-projects.html','design/s02-projects.css','design/s02-projects.js','app/src/styles']);
  const report = { mode:'design-only in-memory preview, not production',before:hashes(),checks:[],errors:[] };
  const context = await chromium.launchPersistentContext(path.join(out, 'browser-profile'), { executablePath, headless:true });
  const overflow = fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js','utf8');
  function check(name,ok,detail) { report.checks.push({name,ok,detail});assert.ok(ok,name); }
  try {
    const kit = await context.newPage();
    await kit.goto(pathToFileURL('E:/skills-manager/product_6.0/.agents/skills/design/starter/kit.html').href);
    await kit.screenshot({path:path.join(out,'factory-kit.png'),fullPage:true});await kit.close();
    for (const theme of ['light','dark']) for (const [width,height] of [[1440,900],[1280,800],[1024,768]]) {
      const page = await context.newPage();await page.setViewportSize({width,height});page.on('pageerror',error=>report.errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve('design/s02-projects.html')).href);
      if(theme==='dark')await page.locator('#theme').click();
      for(const route of ['projects','document']) {
        await page.locator(`nav a[href="#${route}"]`).click();await page.waitForSelector(`main[data-page="${route}"]`);
        check(`${theme}/${width}/${route} overflow`,(await page.evaluate(overflow)).length===0,await page.evaluate(overflow));
        check(`${theme}/${width}/${route} unique navigation`,await page.locator('nav [aria-current="page"]').count()===1);
        const metrics=await page.evaluate(()=>{const s=document.querySelector('.side').getBoundingClientRect(),m=document.querySelector('main').getBoundingClientRect(),h=document.querySelector('h1').getBoundingClientRect(),a=document.querySelector('.page-heading .meta').getBoundingClientRect();return{left:s.left,right:document.documentElement.clientWidth-m.right,bottom:s.bottom-m.bottom,baseline:(h.top+h.bottom-a.top-a.bottom)/2};});
        check(`${theme}/${width}/${route} edges`,metrics.left===metrics.right&&Math.abs(metrics.bottom)<1&&Math.abs(metrics.baseline)<1,metrics);
        const contrast=await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js','utf8'));check(`${theme}/${width}/${route} contrast`,contrast.low.length===0,contrast.low);
        if (!await page.locator('.state-preview').evaluate(e=>e.open)) await page.locator('.state-preview summary').click();
        for(const state of ['empty','loading','error','conflict','saved']) {
          await page.locator(`[data-state="${state}"]`).click();
          const issues=await page.evaluate(overflow);check(`${theme}/${width}/${route}/${state}`,issues.length===0&&!!await page.locator('.status-line').innerText(),issues);
          if (state==='loading') check(`${theme}/${width}/${route} loading locks inputs`,await page.locator('#content input:enabled').count()===0);
          if (state==='empty'&&route==='document') check(`${theme}/${width} empty hides saved blocks`,!await page.locator('#rows').isVisible());
        }
        await page.screenshot({path:path.join(out,`${theme}-${width}-${route}.png`),fullPage:true});
      }
      const initialDate=await page.locator('#date').inputValue();
      await page.locator('#stage').focus();await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
      check(`${theme}/${width} stage independent`,await page.locator('#stage').innerText()==='FINAL'&&await page.locator('#date').inputValue()===initialDate&&!await page.locator('#delivered').isChecked()&&await page.locator('#rows tr').count()===1);
      await page.locator('#date').fill('2028-02-29');await page.locator('#date').press('Tab');check(`${theme}/${width} date independent`,await page.locator('#stage').innerText()==='FINAL'&&(await page.locator('[data-summary-date]').innerText()).includes('2028-02-29'));
      await page.locator('#delivered').check();check(`${theme}/${width} complete excludes`,await page.locator('[data-summary-date]').innerText()==='暂无待交');await page.locator('#delivered').uncheck();
      await page.locator('#include').uncheck();check(`${theme}/${width} explicit list only`,await page.locator('[data-summary-date]').innerText()==='暂无待交');await page.locator('#include').check();
      await page.locator('[data-action="remove-row"]').click();await page.locator('[data-action="undo"]').click();check(`${theme}/${width} undo same row`,await page.locator('#row-sh010').isVisible()&&await page.locator('#date').inputValue()==='2028-02-29');
      await page.locator('#stage').click();await page.keyboard.press('End');await page.keyboard.press('Enter');
      check(`${theme}/${width} long label`,await page.locator('#stage').innerText()==='客户补充后的较长阶段标签'&&(await page.evaluate(overflow)).length===0);
      await page.locator('#stage').click();await page.keyboard.press('Escape');check(`${theme}/${width} Escape focus`,await page.locator('#stage').evaluate(e=>document.activeElement===e)&&!await page.locator('#stage-options').isVisible());
      await page.locator('.tag-settings summary').click();await page.locator('[data-action="remove-tag"]').click();check(`${theme}/${width} reference protection preview`,(await page.locator('.status-line').innerText()).includes('仍被镜头引用'));
      await page.locator('#go-row').click();check(`${theme}/${width} source row focus`,await page.locator('#row-sh010').evaluate(e=>document.activeElement===e));
      await page.screenshot({path:path.join(out,`${theme}-${width}-states.png`),fullPage:true});await page.close();
    }
    check('No page errors',report.errors.length===0,report.errors);report.after=hashes();check('Preview source stable',JSON.stringify(report.before)===JSON.stringify(report.after));
  } catch(error) {report.failure=String(error);process.exitCode=1;}
  finally {await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
