// Real Tauri, upstream Pi and real local read tools; model responses are an explicit localhost fixture.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
const {out,hashes}=validationRun('agent-native',['app/src','app/src-tauri/src','scripts','tests/verify-agent-native.cjs']);
const report={mode:'real Tauri IPC + unmodified upstream Pi + real local read tools; explicit localhost model responses, not paid inference',before:hashes(),checks:[],requests:[],errors:[],screenshots:[]};
const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});assert.ok(ok,name);console.log('PASS',name);};
const ownedPid=Number(process.env.AZCINE_OWNER_PID),pending=[];let browser,page,fixtureFile,mode='read',stage=0;
const waitFor=async(condition)=>{const until=Date.now()+45000;while(!condition()){if(Date.now()>until)throw Error('Explicit fixture request did not arrive');await new Promise(r=>setTimeout(r,25));}};
const server=http.createServer((req,res)=>{let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{try{
  const body=JSON.parse(raw);report.requests.push({model:body.model,mode,stage:stage++,toolResults:body.messages.filter(m=>m.role==='tool').length,toolNames:body.tools?.map(t=>t.function?.name)});
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const frame=(delta,reason=null)=>({id:'explicit-local-agent-fixture',object:'chat.completion.chunk',created:1791072000,model:body.model,choices:[{index:0,delta,finish_reason:reason}]});
  const delta=value=>res.write('data: '+JSON.stringify(frame(value))+'\n\n');
  delta({role:'assistant'});
  if(stage===1)delta({reasoning_content:'明确本地模型回放：准备读取测试资料，工具由真实原版 Pi 执行。'});
  pending.push({res,delta,finish(reason='stop'){res.write('data: '+JSON.stringify(frame({},reason))+'\n\ndata: [DONE]\n\n');res.end();}});
}catch(error){report.errors.push('fixture server: '+error.message);res.end();}});});
const next=async()=>{await waitFor(()=>pending.length>0);return pending.shift();};
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  if(!ownedPid)throw Error('Explicit owned native PID is required');
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+process.env.AZCINE_CDP_PORT);
  page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:'+process.env.AZCINE_WEB_PORT+'/'));if(!page)throw Error('Owned native WebView unavailable');
  page.on('pageerror',error=>report.errors.push(error.message));
  const invoke=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  let storage=await invoke('storage_workspace');const ownedRoot=path.resolve(process.env.AZCINE_EXPECTED_DATA_ROOT||'.tooling/dev-instance/data');
  if(!storage.root&&process.env.AZCINE_EXPECTED_DATA_ROOT){await invoke('select_data_root',{path:ownedRoot});await page.reload();storage=await invoke('storage_workspace');}
  const root=path.resolve(storage.root.replace(/^\\\\\?\\/,''));
  check('真实桌面使用本 Worktree 独立虚构根',root===ownedRoot,{root});
  await page.evaluate(()=>location.hash='agent');const input=page.getByLabel('消息',{exact:true});await input.waitFor();await input.fill('无模型保留的真实桌面草稿');
  await page.getByRole('button',{name:'连接 / 重连',exact:true}).click();await page.getByText('原版已就绪 · 请先配置模型',{exact:true}).waitFor();
  let snap=await invoke('pi_snapshot');check('原版 Pi 真实连接，无模型不发送不补造回复',snap.connection==='ready'&&snap.runtime.piVersion==='0.99.1'&&snap.models.length===0&&report.requests.length===0&&await input.inputValue()==='无模型保留的真实桌面草稿');
  const cwd=path.resolve(snap.cwd.replace(/^\\\\\?\\/,''));check('工具工作目录位于独立数据根',cwd.startsWith(root+path.sep),{cwd});
  fixtureFile=path.join(cwd,'explicit-agent-test-'+path.basename(out)+'.md');fs.writeFileSync(fixtureFile,'EXPLICIT LOCAL TEST FILE\n项目交期待本人确认；没有修改正式记录。\n',{flag:'wx'});
  const saved=await invoke('pi_save_model',{input:{provider:'explicit-agent-fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',modelId:'explicit-local-agent',name:'明确本地回放 · 非真实推理',contextWindow:128000,maxTokens:8192,reasoning:true,supportsImages:false,apiKey:'explicit-test-only-not-a-real-key'}});
  check('仅向本应用测试根保存本地模型配置',saved.saved===true);
  await page.locator('select[aria-label="当前模型"]').waitFor();await page.locator('select[aria-label="当前模型"]').selectOption(JSON.stringify(['explicit-agent-fixture','explicit-local-agent']));
  await input.fill('EXPLICIT FIXTURE：只读取测试资料两次，返回核对结果。');await page.getByRole('button',{name:'发送',exact:true}).click();
  let response=await next();await page.getByText('明确本地模型回放：准备读取测试资料，工具由真实原版 Pi 执行。',{exact:true}).waitFor();
  check('真实流式思考默认展开，发送接受后草稿清空',await page.locator('.pi-process-toggle').getAttribute('aria-expanded')==='true'&&await input.inputValue()==='');
  response.delta({tool_calls:[{index:0,id:'explicit-real-read-one',type:'function',function:{name:'read',arguments:JSON.stringify({path:path.basename(fixtureFile)})}}]});response.finish('tool_calls');
  response=await next();await page.waitForFunction(()=>['finished','success'].includes(document.querySelector('.pi-call[data-call-id="explicit-real-read-one"]')?.dataset.status));
  check('真实 read 结果合并在原调用行，工具结束后整轮仍处理中',await page.locator('.pi-call').count()===1&&await page.locator('.pi-process').getAttribute('data-live')==='true'&&await page.locator('.pi-process-toggle').getAttribute('aria-expanded')==='true'&&report.requests.at(-1).toolResults===1);
  await page.screenshot({path:path.join(out,'real-tool-waiting.png')});
  response.delta({reasoning_content:'第一份工具结果已返回；明确回放要求第二次读取同一测试文件。'});
  response.delta({tool_calls:[{index:0,id:'explicit-real-read-two',type:'function',function:{name:'read',arguments:JSON.stringify({path:path.basename(fixtureFile)})}}]});response.finish('tool_calls');
  response=await next();await page.waitForFunction(()=>['finished','success'].includes(document.querySelector('.pi-call[data-call-id="explicit-real-read-two"]')?.dataset.status));
  check('同名两次工具按不同真实 ID 各一行',await page.locator('.pi-call').count()===2&&report.requests.at(-1).toolResults===2);
  response.delta({content:'明确本地模型回放：已收到两次真实 read 返回。\n\n测试文件中的项目交期仍待本人确认；未改正式记录。'});response.finish();
  await page.getByText('本轮：实际回复已完成',{exact:true}).waitFor();snap=await invoke('pi_snapshot');
  check('正式正文保持，原版会话真实写入两次工具结果',snap.projection.messages.filter(m=>m.role==='toolResult').length===2&&snap.projection.outcome==='success'&&await page.locator('.pi-message--assistant').count()===1);
  await page.locator('.pi-process-toggle').click();await page.locator('.pi-call-toggle').first().click();check('工具详细输出为真实文件内容',await page.locator('.pi-call-details pre').nth(1).innerText().then(s=>s.includes('EXPLICIT LOCAL TEST FILE')));
  await page.locator('.pi-call-toggle').first().click();check('原版空 system 消息不产生孤立标题',await page.locator('.pi-message--system').count()===0);
  const sessionFile=snap.state.sessionFile,sessionId=snap.state.sessionId;
  await page.locator('.pi-chat-options>summary').click();await page.getByLabel('新名称',{exact:true}).fill('真实工具核对 · 明确回放');await page.getByRole('button',{name:'保存名称',exact:true}).click();await page.getByRole('heading',{name:'真实工具核对 · 明确回放',exact:true}).waitFor();await page.keyboard.press('Escape');check('名称回执使按钮失焦后 Escape 仍关闭更多浮层',await page.locator('.pi-chat-options').getAttribute('open')===null);
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
   execFileSync('powershell.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(ownedPid),'-Action','resize','-Width',String(width),'-Height',String(height)],{stdio:'pipe'});
   await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
   if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.getByRole('button',{name:theme==='light'?'切换浅色':'切换深色',exact:true}).click();
   if(width<=1100&&await page.locator('.pi-sessions').getAttribute('open')!==null)await page.locator('.pi-sessions>summary').click();
   await input.focus();const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bottom:document.querySelector('.pi-composer').getBoundingClientRect().bottom,height:innerHeight,outline:getComputedStyle(document.querySelector('#pi-message-input')).outlineWidth}));
   check(`真实桌面 ${theme}/${width} 输入常驻、无页面横溢出、焦点可见`,metrics.scrollWidth<=width+1&&metrics.bottom<=height+1&&parseFloat(metrics.outline)>=2,metrics);
   const contrast=await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js','utf8'));check(`真实桌面 ${theme}/${width} 功能文字对比度`,contrast.low.length===0,contrast.low);
   const screenshot=`real-${theme}-${width}.png`;await page.screenshot({path:path.join(out,screenshot)});report.screenshots.push(screenshot);
  }
  await invoke('pi_disconnect');await invoke('pi_connect',{cwd:snap.cwd,sessionPath:sessionFile});await page.getByRole('heading',{name:'真实工具核对 · 明确回放',exact:true}).waitFor();snap=await invoke('pi_snapshot');
  await page.locator('.pi-process-toggle').evaluate(el=>{if(el.getAttribute('aria-expanded')==='false')el.click();});
  check('重开原生历史从消息恢复工具，事件数组为空仍无重复',snap.state.sessionId===sessionId&&snap.projection.tools.length===0&&await page.locator('.pi-call').count()===2&&await page.locator('.pi-message--toolResult,.pi-tools').count()===0);
  mode='missing';stage=0;await input.fill('EXPLICIT FIXTURE：尝试读取不存在的测试文件，保留真实失败。');await page.getByRole('button',{name:'发送',exact:true}).click();response=await next();
  response.delta({tool_calls:[{index:0,id:'explicit-real-missing',type:'function',function:{name:'read',arguments:JSON.stringify({path:path.basename(fixtureFile)+'.missing'})}}]});response.finish('tool_calls');response=await next();
  const failedProcess=page.locator('.pi-process').filter({has:page.locator('.pi-call[data-call-id="explicit-real-missing"]')});await failedProcess.locator('.pi-call[data-status="error"]').waitFor();await failedProcess.locator('.pi-process-toggle').click();
  check('运行中的真实失败即使折叠仍在标题提醒',await failedProcess.locator('.pi-process-toggle').innerText().then(t=>t.includes('有异常'))&&await failedProcess.locator('.pi-process-toggle').getAttribute('aria-expanded')==='false');
  response.delta({content:'明确回放：文件不存在，保留实际 read 错误。'});response.finish();await page.getByText('本轮：实际回复已完成',{exact:true}).waitFor();
  mode='cancel';stage=0;await input.fill('EXPLICIT FIXTURE：取消等待中的请求。');await page.getByRole('button',{name:'发送',exact:true}).click();response=await next();await input.fill('停止后保留真实桌面草稿');await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByText('本轮：已中断',{exact:true}).waitFor();
  check('真实停止不报成功并保留新草稿',await input.inputValue()==='停止后保留真实桌面草稿'&&(await invoke('pi_snapshot')).projection.outcome==='interrupted');response.res.destroy();
  await page.locator('nav a[href="#today"]').click();await page.locator('nav a[href="#agent"]').click();check('真实切模块保留草稿和失败折叠状态',await input.inputValue()==='停止后保留真实桌面草稿'&&await failedProcess.locator('.pi-process-toggle').getAttribute('aria-expanded')==='false');
  await page.screenshot({path:path.join(out,'real-stopped.png')});await invoke('pi_disconnect');
  report.after=hashes();check('验证期间源码稳定',JSON.stringify(report.before)===JSON.stringify(report.after));check('无前端或本地 fixture 异常',report.errors.length===0,report.errors);
 }catch(error){report.failure=String(error);console.error(error);process.exitCode=1;if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});report.state=await page.evaluate(()=>({text:document.body.innerText})).catch(()=>null);}}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(browser)await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
