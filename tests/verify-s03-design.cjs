const { chromium, executablePath } = require('./support/browser.cjs').browserRuntime();
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validationRun } = require('./support/validation-run.cjs');
(async () => {
  const { out, hashes } = validationRun('s03-design', ['design/s03-agent.html','design/s03-agent.css','app/src/styles/tokens.css','app/src/styles/base.css','app/src/styles/app.css','tests/verify-s03-design.cjs','tests/support/inspect-contrast.js']);
  const context = await chromium.launchPersistentContext(path.join(out,'browser-profile'), {executablePath,headless:true});
  const report = {mode:'static design only, no Pi or model or saved credentials',before:hashes(),checks:[],errors:[]};
  const check = (name,ok,detail) => {report.checks.push({name,ok,detail});if(!ok)throw Error(name);};
  const overflow = fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js','utf8');
  const contrast = fs.readFileSync('tests/support/inspect-contrast.js','utf8');
  try {
    const kit = await context.newPage();await kit.goto(pathToFileURL('E:/skills-manager/product_6.0/.agents/skills/design/starter/kit.html').href);await kit.screenshot({path:path.join(out,'factory-kit.png'),fullPage:true});await kit.close();
    for(const theme of ['light','dark']) for(const [width,height] of [[1440,900],[1280,800],[1024,768]]) {
      const page=await context.newPage();await page.setViewportSize({width,height});page.on('pageerror',e=>report.errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve('design/s03-agent.html')).href);if(theme==='dark')await page.locator('#theme').click();
      for(const route of ['agent','settings']) {
        await page.locator(`nav a[href="#${route}"]`).click();await page.waitForSelector(`main[data-page="${route}"]`);
        const states=route==='agent'?['unconfigured','connecting','empty','streaming','stopping','interrupted','disconnected','restored','unsupported']:['configerror','saved'];
        for(const state of states) {
          await page.locator('.preview-states summary').evaluate(el=>{el.parentElement.open=true;});await page.locator(`[data-state="${state}"]`).click();
          const issues=await page.evaluate(overflow);check(`${theme}/${width}/${route}/${state} overflow`,issues.length===0,issues);
          if(route==='agent'&&['unconfigured','connecting','disconnected','unsupported'].includes(state))check(`${theme}/${width}/${state} no send`,await page.locator('.composer button[type=submit]').isDisabled());
        }
        await page.locator('.preview-states summary').evaluate(el=>{el.parentElement.open=false;});
        check(`${theme}/${width}/${route} only current nav`,await page.locator('nav a[aria-current]').count()===1&&await page.locator(`nav a[href="#${route}"]`).getAttribute('aria-current')==='page');
        const edges=await page.evaluate(()=>{const s=document.querySelector('.side').getBoundingClientRect(),m=document.querySelector('main').getBoundingClientRect(),h=document.querySelector('h1').getBoundingClientRect(),meta=document.querySelector('.page-heading .meta').getBoundingClientRect();return {left:s.left,right:document.documentElement.clientWidth-m.right,bottom:s.bottom-m.bottom,baseline:(h.top+h.bottom-meta.top-meta.bottom)/2};});
        check(`${theme}/${width}/${route} edges`,edges.left===edges.right&&Math.abs(edges.bottom)<1&&Math.abs(edges.baseline)<1,edges);
        const result=await page.evaluate(contrast);check(`${theme}/${width}/${route} contrast`,result.low.length===0&&result.overlap.length===0,result);
        await page.screenshot({path:path.join(out,`${theme}-${width}-${route}.png`),fullPage:true});
        if(route==='agent') {await page.locator('.preview-states summary').evaluate(el=>{el.parentElement.open=true;});await page.locator('[data-state="streaming"]').click();await page.locator('.preview-states summary').evaluate(el=>{el.parentElement.open=false;});await page.screenshot({path:path.join(out,`${theme}-${width}-streaming.png`),fullPage:true});}
      }
      await page.locator('nav a[href="#agent"]').click();await page.locator('#prompt').fill('跨页仍保留的输入');await page.locator('nav a[href="#settings"]').click();await page.locator('nav a[href="#agent"]').click();
      check(`${theme}/${width} draft kept`,await page.locator('#prompt').inputValue()==='跨页仍保留的输入');
      await page.locator('.preview-states summary').focus();await page.keyboard.press('Enter');check(`${theme}/${width} keyboard state details`,await page.locator('.preview-states').getAttribute('open')!==null);
      await page.close();
    }
    report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
  } catch(error){report.failure=String(error);process.exitCode=1;} finally {await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({out,checks:report.checks.length,failed:report.checks.filter(c=>!c.ok),failure:report.failure}));
})().catch(error=>{console.error(error);process.exitCode=1;});
