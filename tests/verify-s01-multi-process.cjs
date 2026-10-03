// A second actual application process must not become another writer of the retained test root.
const { spawn, execFileSync }=require('node:child_process');
const { setTimeout: delay }=require('node:timers/promises');
const { once }=require('node:events');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
(async()=>{
 const first=path.resolve(process.env.AZCINE_VALIDATION_RUN||'');
 if(!first.startsWith(path.resolve('artifacts/validation')+path.sep))throw new Error('Retained isolated first launch required');
 const {out}=validationRun('s01-multi-process');const report={mode:'two actual azcine processes; no mock',first,checks:[]};
 for(const kind of ['locator-lock','root-lock']){
  const config=kind==='locator-lock'?path.join(first,'local-config'):path.join(out,'second-config');
  if(kind==='root-lock'){fs.mkdirSync(config);fs.copyFileSync(path.join(first,'local-config/data-root.json'),path.join(config,'data-root.json'),fs.constants.COPYFILE_EXCL);}
  const port=9225,fd=fs.openSync(path.join(out,`${kind}.log`),'wx');
  const child=spawn(path.resolve('app/src-tauri/target/debug/azcine.exe'),[],{cwd:path.resolve('app'),env:{...process.env,AZCINE_TEST_CONFIG_DIR:config,AZCINE_TEST_DEFAULT_ROOT:path.join(out,'unused-root'),WEBVIEW2_USER_DATA_FOLDER:path.join(out,`${kind}-profile`),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},stdio:['ignore',fd,fd]});
  const exit=once(child,'exit');let browser;
  try{
   const deadline=Date.now()+20000;let ready=false;
   while(Date.now()<deadline&&child.exitCode===null){try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);if(r.ok){ready=true;break}}catch{}await delay(100);}
   if(!ready)throw new Error('Owned second WebView did not become ready');
   browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
   const context=browser.contexts()[0];
   const page=context.pages()[0] || await context.waitForEvent('page');
   await page.waitForURL('http://127.0.0.1:1420/**');
   await page.waitForSelector('.form-error');const message=await page.locator('.form-error').innerText();
   const rejected=await page.evaluate(async()=>{try{await window.__TAURI_INTERNALS__.invoke('storage_workspace');return null}catch(error){return error}});
   const ok=rejected?.code==='root_busy'&&message.includes('另一个')&&!fs.existsSync(path.join(out,'unused-root'));
   report.checks.push({kind,ownerPid:child.pid,ok,rejected});if(!ok)process.exitCode=1;
   await page.screenshot({path:path.join(out,`${kind}.png`),fullPage:true});
  }catch(error){report.checks.push({kind,ok:false,error:String(error)});process.exitCode=1;}
  finally{
   if(browser)await browser.close();
   if(child.exitCode===null){execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(child.pid),'-Action','close']);}
   await exit;fs.closeSync(fd);
  }
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
