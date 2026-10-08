// Regression: real React hook/chat, explicit delayed IPC responses; no user data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {browserRuntime}=require('./support/browser.cjs');
const {validationRun}=require('./support/validation-run.cjs');
const {installTitleFixture}=require('./support/pi-session-title-fixture.cjs');
const baseline=process.argv.includes('--baseline');
const {out,hashes}=validationRun(baseline?'agent-title-refresh-before':'agent-title-refresh-after',['app/src/use-pi.ts','app/tests/fixtures/pi-session-title-refresh.tsx','tests/verify-agent-session-title-refresh.cjs','tests/support/pi-session-title-fixture.cjs']);
const report={mode:'production React hook/chat with explicit delayed IPC replay; no native model or user-data access',baseline,before:hashes(),checks:[],errors:[]};
const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});assert.ok(ok,name);console.log('PASS',name);};
(async()=>{
  let server,browser;
  try{
    const {createServer}=await import(pathToFileURL(path.resolve('app/node_modules/vite/dist/node/index.js')).href);
    server=await createServer({root:path.resolve('app'),configFile:path.resolve('app/vite.config.ts'),configLoader:'runner',cacheDir:path.join(out,'vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:true},clearScreen:false});
    await server.listen();
    const {chromium,executablePath}=browserRuntime();
    browser=await chromium.launch({executablePath,headless:true});
    const cases=baseline?[{theme:'light',width:1440,height:900}]:['light','dark'].flatMap(theme=>[{width:1440,height:900},{width:1280,height:800},{width:1024,height:768}].map(size=>({theme,...size})));
    for(const current of cases){
      const context=await browser.newContext({viewport:{width:current.width,height:current.height}});
      const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
      await page.addInitScript(installTitleFixture);
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pi-session-title-refresh.html`);
      await page.waitForFunction(()=>window.titleModel?.sessions.length===1);
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.titleFixture.emit();},current.theme);
      await page.waitForFunction(()=>window.titleModel?.runtimeSummary?.conversations.length===1);
      const opener=page.getByRole('button',{name:'打开会话列表',exact:true});
      if(await opener.count())await opener.click();
      await page.evaluate(()=>{window.titleModel.setText('保留中的未发送草稿');window.titleFixture.holdSummary=true;window.titleFixture.emit();});
      await page.waitForFunction(()=>!!window.titleFixture.heldSummary);
      await page.evaluate(()=>{window.titleFixture.rename('整理镜头交付');setTimeout(()=>window.titleFixture.releaseSummary(),250);});
      await page.waitForFunction(()=>window.titleModel.snapshot.state.sessionName==='整理镜头交付');
      await page.waitForTimeout(650);
      const result=await page.evaluate(()=>({header:document.querySelector('.pi-chat-identity h2')?.textContent,row:document.querySelector('.pi-session-item strong')?.textContent,nativeName:window.titleFixture.snapshot.state.sessionName,historyName:window.titleModel.sessions[0]?.name,draft:window.titleModel.draft.text,key:window.titleModel.conversationKey}));
      report.checks.push({name:'Observed title metadata after delayed old response',ok:true,detail:{...current,...result}});
      if(baseline){check('Given new native title and delayed old response When staying in chat Then reproduce stale conversation name',result.nativeName==='整理镜头交付'&&(result.row!=='整理镜头交付'||result.historyName!=='整理镜头交付'),result);}
      else{
        check(`${current.theme} ${current.width}: 自动命名后标题、列表及历史原地更新`,result.header==='整理镜头交付'&&result.row==='整理镜头交付'&&result.historyName==='整理镜头交付',result);
        check(`${current.theme} ${current.width}: 更新名称保持当前会话和输入`,result.key==='default'&&result.draft==='保留中的未发送草稿');
        await page.evaluate(()=>{window.titleFixture.holdSessions=true;void window.titleModel.reloadSessions();});
        await page.waitForFunction(()=>!!window.titleFixture.heldSessions);
        await page.evaluate(()=>{window.titleFixture.rename('本人修改后的标题');setTimeout(()=>window.titleFixture.releaseSessions(),250);});
        await page.waitForFunction(()=>window.titleModel.sessions[0]?.name==='本人修改后的标题');
        check(`${current.theme} ${current.width}: 历史读取期间再次改名不会漏掉最后一次更新`,await page.locator('.pi-session-item strong').textContent()==='本人修改后的标题');
        await page.evaluate(()=>{
          const f=window.titleFixture;
          f.background={conversationKey:'background',generation:1,seq:2,connection:'ready',active:false,waiting:false,sessionId:'background-fixture',sessionFile:'X:/ExplicitTitleRefresh/pi/sessions/background.jsonl',name:'后台自动生成的名称',outcome:'none',cwd:f.snapshot.cwd};
          f.sessions.push({id:'background-fixture',path:f.background.sessionFile,name:f.background.name,cwd:f.snapshot.cwd,updatedAt:'2026-10-07T00:00:00Z',messageCount:2});
          f.emit('background');
        });
        await page.waitForFunction(()=>window.titleModel.sessions.find(row=>row.id==='background-fixture')?.name==='后台自动生成的名称');
        check(`${current.theme} ${current.width}: 后台会话命名立即更新列表，不切换当前会话`,await page.locator('.pi-session-item strong').filter({hasText:'后台自动生成的名称'}).isVisible()&&await page.locator('.pi-chat-identity h2').textContent()==='本人修改后的标题');
        const reads=await page.evaluate(()=>window.titleFixture.calls.filter(call=>call.command==='pi_sessions').length);
        await page.evaluate(async()=>{window.titleFixture.snapshot.seq++;window.titleFixture.emit();await window.titleModel.refreshRuntime();});
        await page.waitForTimeout(100);
        check(`${current.theme} ${current.width}: 普通流式事件不重复扫描历史文件`,await page.evaluate(()=>window.titleFixture.calls.filter(call=>call.command==='pi_sessions').length)===reads);
      }
      await page.screenshot({path:path.join(out,`${current.theme}-${current.width}.png`)});
      await context.close();
    }
    check('浏览器无异常',report.errors.length===0,report.errors);
    report.after=hashes();check('测试期间对应源码稳定',JSON.stringify(report.before)===JSON.stringify(report.after));
  }catch(error){report.failure=String(error);console.error(error);process.exitCode=1;}
  finally{if(browser)await browser.close();if(server)await server.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure}));}
})();
