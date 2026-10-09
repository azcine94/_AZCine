// Component fixtures only. Real-model evidence is produced by the Rust integration test.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{browserRuntime}=require('./support/browser.cjs');
const out=path.resolve(process.argv[2]||'');
if(!out.startsWith(path.resolve(__dirname,'../artifacts/validation')+path.sep)||fs.existsSync(out))throw Error('New isolated output required');
fs.mkdirSync(out,{recursive:true});const report={checks:[],images:[],errors:[]};let server,browser;
(async()=>{
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 server=spawn(process.execPath,[path.resolve(__dirname,'../app/node_modules/vite/bin/vite.js'),'--configLoader','runner','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:path.resolve(__dirname,'../app'),env:{...process.env,AZCINE_VITE_CACHE_DIR:path.join(out,'vite-cache')},windowsHide:true,stdio:'ignore'});
 for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/ui.html`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 const runtime=browserRuntime();browser=await runtime.chromium.launch({executablePath:runtime.executablePath,headless:true});const page=await browser.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));
 const go=(state,theme='light')=>page.goto(`http://127.0.0.1:${port}/ui.html?scene=self-evolution&state=${state}&theme=${theme}`);
 for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[1280,800],[1024,768]]){
  await page.setViewportSize({width,height});await go('normal',theme);const panel=page.locator('.evolution-page');await panel.getByText('48 条结果',{exact:true}).waitFor();
  assert.ok(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  const boxes=await page.locator('.evolution-columns').evaluate(n=>[...n.children].map(c=>{const r=c.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height};}));
  assert.ok(boxes[0].right<=boxes[1].x&&Math.abs(boxes[0].y-boxes[1].y)<1);assert.ok(boxes.every(b=>b.height>200));
  const rows=page.locator('.evolution-list tbody tr');
  await rows.nth(1).click();assert.equal(await rows.nth(1).getAttribute('data-active'),'true');
  assert.equal(await rows.nth(1).getByRole('checkbox').getAttribute('data-state'),'unchecked');
  await rows.nth(4).click({modifiers:['Shift']});await panel.getByText('已选 4 项',{exact:true}).waitFor();
  await rows.nth(2).click({modifiers:['Control']});await panel.getByText('已选 3 项',{exact:true}).waitFor();
  await rows.nth(2).getByRole('checkbox').click();await panel.getByText('已选 4 项',{exact:true}).waitFor();
  await rows.nth(1).focus();await page.keyboard.press('Enter');assert.equal(await rows.nth(1).getAttribute('data-active'),'true');
  await panel.getByRole('button',{name:'改写',exact:true}).click();await panel.getByRole('textbox',{name:'改写候选',exact:true}).fill('未保存的候选草稿');
  await rows.nth(3).click();await rows.nth(1).click();assert.equal(await panel.getByRole('textbox',{name:'改写候选',exact:true}).inputValue(),'未保存的候选草稿');
  await panel.getByRole('button',{name:'取消改写',exact:true}).click();await panel.getByRole('button',{name:'查看原文及前后文',exact:true}).click();await panel.getByText('好的。',{exact:true}).waitFor();
  await page.locator('.evolution-table-scroll,.evolution-review-body').evaluateAll(nodes=>nodes.forEach(node=>node.scrollTop=0));
  const file=path.join(out,`evolution-${theme}-${width}.png`);await page.screenshot({path:file});report.images.push(file);
  report.checks.push(`${theme} ${width}x${height}: independent columns, row review, Shift/Ctrl, checkbox, keyboard, draft, source`);
 }
 await go('long');await page.locator('.evolution-page').getByText('48 条结果',{exact:true}).waitFor();assert.ok(await page.locator('.evolution-page').evaluate(n=>n.scrollWidth<=n.clientWidth+1));report.checks.push('long text without horizontal overflow');
 await go('normal');await page.getByRole('button',{name:'提取设置',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Tab');assert.ok(await page.getByRole('dialog').evaluate(n=>n.contains(document.activeElement)));await page.keyboard.press('Escape');report.checks.push('settings dialog and focus');
 for(const state of ['empty','loading','error']){await go(state);await page.locator('.evolution-page').waitFor();report.checks.push(state);}
 assert.deepEqual(report.errors,[]);report.pass=true;
})().catch(error=>{report.pass=false;report.failure=error.stack;process.exitCode=1;}).finally(async()=>{await browser?.close();server?.kill();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
