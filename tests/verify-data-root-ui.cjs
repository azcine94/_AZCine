// Explicit fixture UI check; no business database, credentials or model calls.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {browserRuntime} = require('./support/browser.cjs');
const out = path.resolve(process.argv[2] || '');
if (!out.startsWith(path.resolve(__dirname, '../artifacts/validation') + path.sep)) throw Error('Expected an isolated validation directory');
fs.mkdirSync(out, {recursive:true});
const checks = [], images = [];
let server, browser;
(async () => {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  server = spawn(process.execPath, [path.resolve(__dirname, '../app/node_modules/vite/bin/vite.js'), '--configLoader','runner','--host','127.0.0.1','--port',String(port),'--strictPort'],
    {cwd:path.resolve(__dirname,'../app'),env:{...process.env,AZCINE_VITE_CACHE_DIR:path.join(out,'vite-cache')},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log = fs.createWriteStream(path.join(out,'ui-vite.log'),{flags:'wx'});server.stdout.pipe(log);server.stderr.pipe(log);
  await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Vite timeout')),30000);server.stdout.on('data',chunk=>{text+=chunk.toString().replace(/\x1b\[[0-9;]*m/g,'');if(text.includes(`127.0.0.1:${port}`)){clearTimeout(timer);resolve();}});server.once('error',reject);});
  const runtime=browserRuntime();browser=await runtime.chromium.launch({executablePath:runtime.executablePath,headless:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[1280,800],[1024,768]]){
    await page.setViewportSize({width,height});
    await page.goto(`http://127.0.0.1:${port}/ui.html?scene=settings%2Fdata&state=data-migrate&theme=${theme}`);
    const dialog=page.getByRole('dialog');await dialog.waitFor();await page.waitForTimeout(300);
    assert.equal(await page.getByLabel('更改方式').inputValue(),'migrate');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    await page.getByLabel('目标目录').focus();await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);
    const file=path.join(out,`data-change-${theme}-${width}.png`);await page.screenshot({path:file});images.push(file);
    await page.getByLabel('更改方式').selectOption('switch');
    await page.getByRole('button',{name:'保存，下次启动生效'}).click();await dialog.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'取消更改'}).click();assert.equal(await page.getByRole('button',{name:'更改数据目录'}).isEnabled(),true);
    checks.push({theme,width,height,pass:true});
  }
  await page.goto(`http://127.0.0.1:${port}/ui.html?scene=settings%2Fdata&state=data-change-failed&theme=light`);
  await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'保存，下次启动生效'}).click();
  await page.getByText('示例：目标目录不是空目录，原记录保留。').waitFor();assert.equal(await page.getByLabel('目标目录').inputValue(),'D:\\AZCineData-Release');
  assert.deepEqual(errors,[]);checks.push({failureKeepsInput:true});
  fs.writeFileSync(path.join(out,'ui-result.json'),JSON.stringify({mode:'explicit preview fixtures',checks,images,errors},null,2));
  console.log(JSON.stringify({pass:true,checks:checks.length,images}));
})().catch(error=>{console.error(error);process.exitCode=1;fs.writeFileSync(path.join(out,'ui-failure.txt'),String(error.stack));}).finally(async()=>{await browser?.close();server?.kill();});
