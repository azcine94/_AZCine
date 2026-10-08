// Explicit UI fixtures only. Does not check the network or install updates.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
const {browserRuntime}=require('./support/browser.cjs');
const out=path.resolve(process.argv[2]||'');
if(!out.startsWith(path.resolve(__dirname,'../artifacts/validation')+path.sep)||fs.existsSync(out))throw Error('New isolated output required');
fs.mkdirSync(out,{recursive:true});
const report={checks:[],images:[],errors:[]};let server,browser;
(async()=>{
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 server=spawn(process.execPath,[path.resolve(__dirname,'../app/node_modules/vite/bin/vite.js'),'--configLoader','runner','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:path.resolve(__dirname,'../app'),env:{...process.env,AZCINE_VITE_CACHE_DIR:path.join(out,'vite-cache')},windowsHide:true,stdio:'ignore'});
 for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/ui.html`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 const runtime=browserRuntime();browser=await runtime.chromium.launch({executablePath:runtime.executablePath,headless:true});const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 const go=(scene,state,theme='light')=>page.goto(`http://127.0.0.1:${port}/ui.html?scene=${encodeURIComponent(scene)}&state=${state}&theme=${theme}`);
 for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[1280,800],[1024,768]]){
  await page.setViewportSize({width,height});await go('settings/about','normal',theme);
  await page.getByRole('button',{name:'下载更新',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'下载更新',exact:true}).click();await page.getByRole('button',{name:'安装并重启',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(node=>node.contains(document.activeElement)));
  await page.getByRole('button',{name:'暂不安装',exact:true}).click();assert.equal(await page.getByRole('button',{name:'安装并重启',exact:true}).count(),1);
  const file=path.join(out,`about-${theme}-${width}.png`);await page.screenshot({path:file});report.images.push(file);report.checks.push(`${theme} ${width}x${height}: layout, download, cancel, focus`);
 }
 for(const state of ['update-current','update-error','update-downloading','update-development']){
  await go('settings/about',state);await page.getByRole('heading',{name:'关于与更新',exact:true}).waitFor();
  if(state==='update-error'){await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'下载更新',exact:true}).waitFor();}
  if(state==='update-development')assert.equal(await page.getByRole('button',{name:'检查更新',exact:true}).count(),0);
  if(state==='update-downloading')assert.ok(await page.getByRole('button',{name:'检查更新',exact:true}).isDisabled());
  if(state==='update-current')await page.getByText('当前已是最新版本。',{exact:true}).waitFor();
  report.checks.push(state);
 }
 for(const state of ['data-path-prefixed','data-path-long']){
  await go('settings/data',state);const root=page.locator('[data-current-root]');await root.waitFor();assert.ok(!(await root.innerText()).startsWith('\\\\?\\'));
  assert.ok(await root.evaluate(node=>node.scrollWidth<=node.clientWidth+1));report.checks.push(state);
 }
 assert.deepEqual(report.errors,[]);report.pass=true;
})().catch(error=>{report.pass=false;report.failure=error.stack;process.exitCode=1;}).finally(async()=>{await browser?.close();server?.kill();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
