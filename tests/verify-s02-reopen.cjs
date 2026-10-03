// Relaunch acceptance reads an immutable snapshot from a retained test-only root.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
(async()=>{
  const run=path.resolve(process.env.AZCINE_VALIDATION_RUN||'');
  if(!run.startsWith(path.resolve('artifacts/validation')+path.sep))throw new Error('Explicit retained test run required');
  const expectedName=process.env.AZCINE_REOPEN_EXPECTED||'s02-expected.json';
  if(path.basename(expectedName)!==expectedName||!expectedName.endsWith('.json'))throw Error('Expected snapshot must be a JSON filename in this test root');
  const expected=JSON.parse(fs.readFileSync(path.join(run,expectedName),'utf8'));
  const {out,hashes}=validationRun('s02-reopen',['app/src','app/src-tauri/src','scripts','tests/verify-s02-reopen.cjs']);
  const report={mode:'real second Tauri process opening same data root',run,expectedName,before:hashes(),checks:[]};
  const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw new Error(name);};
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT||9224}`);
  try{
    const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:1420'));
    if(!page)throw new Error('Owned page missing');
    await page.waitForSelector('nav');
    const actual=await page.evaluate(async()=>({workspace:await window.__TAURI_INTERNALS__.invoke('storage_workspace'),projects:await window.__TAURI_INTERNALS__.invoke('list_projects')}));
    check('Given process exited When same root reopens Then complete project documents exactly preserved',JSON.stringify(actual.projects)===JSON.stringify(expected.projects));
    check('Given linked todo When process reopens Then same identity/state/company association',JSON.stringify(actual.workspace)===JSON.stringify(expected.workspace));
    await page.locator('nav a[href="#projects"]').click();await page.waitForSelector('[data-project-id]');
    check('Given reopened database Then real saved cards rendered',await page.locator('[data-project-id]').count()===expected.projects.length);
    const project=expected.projects.find(p=>p.blocks.some(b=>b.kind==='list'&&b.included));
    if(!project)throw new Error('Expected populated project missing from receipt');
    await page.locator(`[data-project-id="${project.id}"]`).click();await page.waitForSelector('[data-project-document]');
    check('Given saved company document Then title and stable row rendered',await page.locator('#project-name').inputValue()===project.name&&await page.locator('[data-row-id]').count()>0);
    await page.screenshot({path:path.join(out,'reopened-document.png'),fullPage:true});
    report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));
  }catch(error){report.failure=String(error);process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
