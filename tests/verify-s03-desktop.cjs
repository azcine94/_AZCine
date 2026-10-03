// Real Tauri + owned original Pi. Only no-model and synthetic config loading;
// never sends prompt after configuration, never calls a provider or reads host auth.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const{chromium}=require('./support/browser.cjs').browserRuntime();const{validationRun}=require('./support/validation-run.cjs');
(async()=>{
 const run=path.resolve(process.env.AZCINE_VALIDATION_RUN||''),owner=Number(process.env.AZCINE_OWNER_PID);if(!run.startsWith(path.resolve('artifacts/validation')+path.sep)||!Number.isInteger(owner)||owner<1)throw Error('Explicit retained real root and owner PID required');
 const{out,hashes}=validationRun('s03-desktop-ui',['app/src','app/src-tauri/src','scripts','tests/verify-s03-desktop.cjs']);const report={mode:'real Tauri and original Pi, synthetic native config; NO prompt after config, NO inference/network',run,owner,before:hashes(),checks:[],errors:[]};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name);};const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT||9224}`);
 try{
  const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:1420'));if(!page)throw Error('Owned desktop missing');page.on('pageerror',e=>report.errors.push(e.message));
  const ipc=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  await page.locator('nav a[href="#today"]').click();await page.waitForSelector('[data-storage-setup]');await page.locator('#data-root').fill(path.join(run,'data'));await page.getByRole('button',{name:'使用此目录',exact:true}).click();await page.waitForSelector('#todo-title');
  await page.locator('nav a[href="#agent"]').click();const message=()=>page.getByLabel('消息',{exact:true});await message().fill('真实未配置输入，不发送模型');
  check('Given unopened Pi When writing Then draft available and send disabled',await page.getByRole('button',{name:'发送',exact:true}).isDisabled());
  await page.getByRole('button',{name:'连接 / 重连',exact:true}).click();await page.getByText('原版已就绪 · 请先配置模型',{exact:true}).waitFor({timeout:45000});let snap=await ipc('pi_snapshot');
  check('Given original own runtime When handshake Then ready from actual RPC but no usable model',snap.connection==='ready'&&snap.state.model===null&&snap.models.length===0&&snap.projection.messages.length===0);
  check('Given runtime source When displaying Then exact own version and resource path',snap.runtime.piVersion==='0.99.1'&&snap.runtime.nodeVersion==='24.21.0'&&snap.runtime.root.includes('app')&&snap.runtime.root.includes('pi-0.99.1-node-24.21.0'),snap.runtime);
  check('Given empty state When native paths returned Then all user state under selected root',snap.paths.agent.includes('pi')&&snap.paths.sessions.includes('pi')&&snap.cwd.includes('workspaces'));
  const rejection=await ipc('pi_send',{input:{generation:snap.generation,sessionId:snap.state.sessionId,message:'必须在发送之前拒绝，不调用模型',images:[],behavior:null}}).then(()=>null,e=>e);
  check('Given no credentials When backend send attempted Then explicitly rejects before RPC prompt',rejection?.code==='pi_model_required');
  await page.locator('nav a[href="#settings"]').click();await page.getByRole('button',{name:/切换.*色/}).click();await page.locator('nav a[href="#agent"]').click();check('Given real connection and navigation Then input retained',await message().inputValue()==='真实未配置输入，不发送模型');
  await page.getByRole('button',{name:'断开',exact:true}).click();await page.getByText('连接已关闭，未完成内容不算成功。',{exact:true}).waitFor();
  const foreign=path.join(out,'foreign-workspace');fs.mkdirSync(path.join(foreign,'.pi','commands'),{recursive:true});fs.writeFileSync(path.join(foreign,'.pi','commands','unchanged.md'),'synthetic external original, never migrate\n',{flag:'wx'});
  const blocked=await ipc('pi_connect',{cwd:foreign,sessionPath:null}).then(()=>null,e=>e);check('Given external legacy .pi commands When selecting cwd Then no migration of original',blocked?.code==='pi_cwd_migration'&&fs.existsSync(path.join(foreign,'.pi','commands','unchanged.md'))&&!fs.existsSync(path.join(foreign,'.pi','prompts')));
  await page.locator('nav a[href="#settings"]').click();await page.getByLabel('服务标识',{exact:true}).fill('s03-fixture');await page.getByLabel('API 地址',{exact:true}).fill('file:///unavailable');await page.getByLabel('模型 ID',{exact:true}).fill('fixture-no-inference');await page.getByLabel('显示名称',{exact:true}).fill('仅加载配置·从未推理');await page.getByLabel('API Key',{exact:true}).fill('synthetic-fixture-only-not-real');await page.getByRole('button',{name:'保存并由原版加载',exact:true}).click();await page.locator('[role="alert"]').filter({hasText:'模型设置无效'}).waitFor();
  check('Given invalid native endpoint When saving Then exact fixture input retained',await page.getByLabel('API Key',{exact:true}).inputValue()==='synthetic-fixture-only-not-real'&&await page.getByLabel('API 地址',{exact:true}).inputValue()==='file:///unavailable');
  await page.getByLabel('API 地址',{exact:true}).fill('https://example.invalid/v1');await page.getByRole('button',{name:'保存并由原版加载',exact:true}).click();await page.getByText('配置已保存并由原版加载；尚未验证真实回复。',{exact:true}).waitFor({timeout:45000});snap=await ipc('pi_snapshot');
  check('Given explicit synthetic config When loaded Then exact native list and no inference',snap.models.some(m=>m.id==='fixture-no-inference'&&m.provider==='s03-fixture')&&snap.projection.messages.length===0);
  check('Given stored credential When reading snapshot Then never returned in any field',!JSON.stringify(snap).includes('synthetic-fixture-only-not-real')&&await page.getByLabel('API Key',{exact:true}).inputValue()==='');
  await page.locator('nav a[href="#agent"]').click();check('Given configuration replaces empty native session Then unsent draft remains accessible',await message().inputValue()==='真实未配置输入，不发送模型');
  // No send operation past this point: example.invalid configuration is only schema/load evidence.
  await page.getByText('会话名称',{exact:true}).click();await page.getByLabel('新名称',{exact:true}).fill('真实原版命名·未调用模型');await page.getByRole('button',{name:'保存名称',exact:true}).click();await page.getByRole('heading',{name:'真实原版命名·未调用模型',exact:true}).waitFor();
  check('Given name action When acknowledged Then actual native session state reflects it',(await ipc('pi_snapshot')).state.sessionName==='真实原版命名·未调用模型');
  await page.getByRole('button',{name:'新会话',exact:true}).click();await page.getByRole('heading',{name:'新会话',exact:true}).waitFor();check('Given new native session Then no fabricated historical assistant messages',(await ipc('pi_snapshot')).projection.messages.length===0);
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
    execFileSync('pwsh',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(owner),'-Action','resize','-Width',String(width),'-Height',String(height)],{encoding:'utf8'});
    await page.waitForFunction(({width,height})=>Math.abs(innerWidth-width)<=1&&Math.abs(innerHeight-height)<=1,{width,height});
    if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.getByRole('button',{name:/切换.*色/}).click();
    for(const route of ['agent','settings']){
      await page.locator(`nav a[href="#${route}"]`).click();await page.locator('h1').waitFor();
      const measurements=await page.evaluate(()=>({width:innerWidth,height:innerHeight,bodyWidth:document.documentElement.scrollWidth,overlap:[...document.querySelectorAll('.pi-field input,.pi-field textarea,.pi-field select,.pi-actions button')].filter(e=>e.checkVisibility()).some(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left<0;}),focus:document.activeElement?.tagName}));
      check(`Given ${theme} ${width}x${height} ${route} Then no page horizontal overflow or cut control`,measurements.bodyWidth<=measurements.width+1&&!measurements.overlap,measurements);
      await page.screenshot({path:path.join(out,`${theme}-${width}-${route}.png`),fullPage:true});
    }
  }
  await page.locator('nav a[href="#agent"]').click();await page.getByRole('button',{name:'断开',exact:true}).click();await page.getByText('连接已关闭，未完成内容不算成功。',{exact:true}).waitFor();snap=await ipc('pi_snapshot');check('Given disconnect Then no phantom ready or success',snap.connection==='disconnected'&&!snap.busy&&!snap.stopping);
  fs.writeFileSync(path.join(out,'final-safe-snapshot.json'),JSON.stringify(snap,null,2),{flag:'wx'});report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
 }catch(e){report.failure=String(e);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure}));}
})().catch(e=>{console.error(e);process.exitCode=1;});
