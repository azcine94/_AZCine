// Targeted layout regression after bounding the delivery summary, using existing real records.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
const {projectOverflow}=require('./support/project-overflow.cjs');
(async()=>{
  const ownerPid=Number(process.env.AZCINE_OWNER_PID);if(!Number.isInteger(ownerPid)||ownerPid<1)throw new Error('Explicit owned PID required');
  const {out,hashes}=validationRun('s02-layout',['app/src','app/src-tauri/src','scripts','tests/verify-s02-layout.cjs','tests/support/project-overflow.cjs','tests/support/inspect-contrast.js']);
  const report={mode:'real Tauri targeted delivery summary/layout regression',before:hashes(),checks:[],errors:[]};
  const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw new Error(name);};
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT||9224}`);
  try{
    const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:1420'));if(!page)throw new Error('Owned page missing');page.on('pageerror',error=>report.errors.push(error.message));
    const ipc=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
    const pid=randomUUID(),bid=randomUUID(),lid=randomUUID(),cols=Array.from({length:4},randomUUID);
    const document={id:pid,name:'分组回归验收',labels:[{id:lid,name:'ACOPY'}],blocks:[{id:bid,kind:'list',title:'四个日期',included:true,columns:['shot','stage','date','delivered'].map((kind,i)=>({id:cols[i],name:kind,kind})),rows:['2027-01-01','2027-02-01','2027-03-01','2027-04-01'].map((date,i)=>({id:randomUUID(),cells:{[cols[0]]:`SH${i}`,[cols[1]]:lid,[cols[2]]:date,[cols[3]]:'false'}}))}]};
    await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document}});
    await page.locator('nav a[href="#projects"]').click();await page.waitForSelector('#project-search');await page.locator('#project-search').fill('');await page.getByRole('button',{name:'重新读取项目',exact:true}).click();await page.waitForSelector(`[data-project-id="${pid}"]`);await page.locator(`[data-project-id="${pid}"]`).click();await page.waitForSelector('[data-project-document]');
    check('Given four delivery dates Then first three groups initially visible',await page.locator('.delivery-group').count()===3);
    await page.getByRole('button',{name:'展开其余 1 个日期分组',exact:true}).click();check('Given more dates When expanding Then fourth date and original-row link available',await page.locator('.delivery-group').count()===4&&await page.locator('.delivery-link').filter({hasText:'2027-04-01'}).count()===1);
    await page.getByRole('button',{name:'收起更多日期',exact:true}).click();
    for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
      execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(ownerPid),'-Action','resize','-Width',String(width),'-Height',String(height)]);
      await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<2&&Math.abs(innerHeight-height)<2,{width,height});
      await page.locator('h1').scrollIntoViewIfNeeded();
      const issues=await projectOverflow(page);check(`${theme}/${width} no unhandled overflow`,issues.valid,issues);
      const contrast=await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js','utf8'));check(`${theme}/${width} contrast and overlap`,contrast.low.length===0&&contrast.overlap.length===0,contrast);
      const metrics=await page.evaluate(()=>{const feature=document.querySelector('.summary-feature').getBoundingClientRect(),group=document.querySelector('.summary-items').getBoundingClientRect(),date=document.querySelector('.summary-feature .project-date').getBoundingClientRect();return{featureTop:feature.top,featureHeight:feature.height,groupTop:group.top,dateTop:date.top,dateBottom:date.bottom,height:innerHeight};});
      check(`${theme}/${width} latest date stays in first viewport`,metrics.dateTop>=0&&metrics.dateBottom<metrics.height&&metrics.featureHeight<400,metrics);
      await page.screenshot({path:path.join(out,`${theme}-${width}-summary.png`),fullPage:true});
    }
    report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
  }catch(error){report.failure=String(error);process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
