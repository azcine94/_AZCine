const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
(async()=>{
 const run=path.resolve(process.env.AZCINE_VALIDATION_RUN),owner=Number(process.env.AZCINE_OWNER_PID);
 if(!run.startsWith(path.resolve('artifacts/validation')+path.sep)||!owner)throw Error('Explicit retained test root and owned PID required');
 const {out,hashes}=validationRun('model-ranking-live',['app/src','app/src-tauri/src','app/vite.config.ts','app/package.json','tests/verify-model-ranking-desktop.cjs']);
 const report={mode:'real desktop IPC/SQLite/public HTTPS; temporary per-test-process proxy; explicit fault injection only in failure checks',run,owner,before:hashes(),checks:[],network:[],pageErrors:[],screenshots:[]};
 const check=(name,fn,detail)=>{assert.ok(fn,name);report.checks.push({name,passed:true,detail});console.log('PASS',name)};
 const b=await chromium.connectOverCDP('http://127.0.0.1:9237');const page=b.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:1420'));
 const pending=[];let recordNetwork=true;
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 page.on('response',response=>{if(recordNetwork&&response.url().startsWith('https://datasets-server.huggingface.co/'))pending.push((async()=>{const body=await response.json();report.network.push({url:response.url(),status:response.status(),revision:response.headers()['x-revision'],body});})().catch(e=>report.network.push({error:String(e)})))});
 const ipc=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
 const states=()=>ipc('model_ranking_workspace');
 const until=async predicate=>{const deadline=Date.now()+70000;while(!await predicate()){if(Date.now()>deadline)throw Error('Timed out waiting for actual IPC state');await page.waitForTimeout(200)}};
 const idle=()=>page.waitForFunction(()=>!document.querySelector('.ranking-notice [role="status"]')?.textContent.includes('正在'),null,{timeout:70000});
 try{
  if(await page.locator('#data-root').count()){
   await page.locator('#data-root').fill(path.join(run,'data'));
   await page.getByRole('button',{name:'使用此目录',exact:true}).click();
  }
  await page.locator('nav a[href="#models"]').click();
  await until(async()=> (await states()).every(x=>x.snapshot&&x.snapshot.rows.length===50));
  await idle();
  // A user may have opened the newly launched window before CDP attaches. In
  // that case acquire new live receipts via the normal refresh buttons.
  for(const board of ['agent','text-to-image'].filter(board=>!report.network.some(n=>n.status===200&&new URL(n.url).searchParams.get('config')===(board==='agent'?'agent':'text_to_image')))){
   const before=(await states()).find(s=>s.board===board).snapshotId;
   await page.getByRole('button',{name:board==='agent'?'Agent 综合榜':'文生图综合榜',exact:true}).click();
   await page.getByRole('button',{name:'刷新榜单',exact:true}).click();
   await until(async()=> (await states()).find(s=>s.board===board).snapshotId!==before);
   await idle();
  }
  await Promise.all(pending);recordNetwork=false;
  const saved=await states(); fs.writeFileSync(path.join(out,'initial-saved.json'),JSON.stringify(saved,null,2));
  const source=config=>{const n=report.network.find(n=>n.status===200&&new URL(n.url).searchParams.get('config')===config);assert.ok(n,config+' live response');return n.body.rows.map(x=>x.row)};
  const expectedMetric=r=>({value:r.score*100,lower:r.score_ci_lower*100,upper:r.score_ci_upper*100});
  for(const s of saved){const base=source(s.board==='agent'?'agent':'text_to_image').slice(0,50);assert.deepEqual(s.snapshot.rows.map(r=>r.model),base.map(r=>r.model_name));
   for(let j=0;j<50;j++){const row=s.snapshot.rows[j],raw=base[j];assert.equal(row.rank,raw.rank);assert.equal(row.organization,raw.organization);assert.equal(row.license,raw.license);assert.equal(row.rankLow,null);assert.equal(row.rankHigh,null);
    if(s.board==='agent'){assert.deepEqual(row.netImprovement,expectedMetric(raw));for(const [field,config] of [['confirmedSuccess','agent_task_outcome_explicit'],['praiseVsComplaint','agent_praise_complaint'],['steerability','agent_steerability']]){const detail=source(config).find(r=>r.model_name===row.model);assert.deepEqual(row[field],expectedMetric(detail));assert.equal(detail.leaderboard_publish_date,s.snapshot.dataUpdatedAt)}}
    else {assert.equal(row.score,raw.rating);assert.equal(row.scoreLower,raw.rating_lower);assert.equal(row.scoreUpper,raw.rating_upper);assert.equal(row.votes,raw.vote_count);assert.equal(row.preliminary,null)}
    assert.equal(s.snapshot.dataUpdatedAt,raw.leaderboard_publish_date);
   }
   check('自动取数后 '+s.board+' 50 行全部字段与真实接口一致',true,{dataDate:s.snapshot.dataUpdatedAt,first:base[0].model_name,last:base[49].model_name});
  }
  check('主入口没有要求用户文件导入',await page.getByRole('button',{name:/导入/}).count()===0);
  const expected=saved.map(s=>s.snapshotId);
  await page.reload();await page.locator('nav a[href="#models"]').click();await page.waitForSelector('.ranking-table tbody tr');
  check('刷新页面重读 SQLite 且同日不重复自动取数',JSON.stringify((await states()).map(s=>s.snapshotId))===JSON.stringify(expected));
  const contrast=fs.readFileSync('tests/support/inspect-contrast.js','utf8');
  execFileSync('pwsh.exe',['-NoProfile','-File','artifacts/validation/model-ranking-auto-2026-10-04/show-owned-window.ps1','-OwnerPid',String(owner)]);
  for(const theme of ['light','dark'])for(const [width,height]of [[1440,900],[1280,800],[1024,768]]){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.theme-button').click();
   execFileSync('pwsh.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(owner),'-Action','resize','-Width',String(width),'-Height',String(height)]);
   await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
   for(const board of ['agent','text-to-image']){
    await page.getByRole('button',{name:board==='agent'?'Agent 综合榜':'文生图综合榜',exact:true}).click();
    const s=saved.find(s=>s.board===board);
    check(`${theme}/${width}/${board} 显示完整50行与日期`,await page.locator('.ranking-table tbody tr').count()===50&&(await page.locator('.ranking-times').innerText()).includes(s.snapshot.dataUpdatedAt));
    assert.deepEqual(await page.locator('.ranking-model-name').allTextContents(),s.snapshot.rows.map(r=>r.model));
    const layout=await page.evaluate(()=>{const region=document.querySelector('.ranking-table-scroll'),r=region.getBoundingClientRect();return{pageFits:document.body.scrollWidth<=innerWidth+1,regionFits:r.left>=0&&r.right<=innerWidth+1,client:region.clientWidth,scroll:region.scrollWidth,rows:[...document.querySelectorAll('.ranking-table tbody tr')].every(r=>r.cells[1].getBoundingClientRect().top===r.cells[2].getBoundingClientRect().top)}});
    check(`${theme}/${width}/${board} 页面不溢出且横向区域有边界`,layout.pageFits&&layout.regionFits&&layout.rows,layout);
    const c=await page.evaluate(contrast);check(`${theme}/${width}/${board} 文字对比度`,c.low.length===0,c.low);
    const region=page.locator('.ranking-table-scroll');await region.focus();await page.keyboard.press('ArrowRight');
    check(`${theme}/${width}/${board} 键盘焦点可见`,await region.evaluate(el=>document.activeElement===el&&getComputedStyle(el).outlineStyle!=='none'));
    await page.waitForTimeout(200);
    await region.evaluate(el=>{el.blur();el.scrollTo({left:0,behavior:'instant'})});
    await page.locator('.ranking-board').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
    const shot=`${theme}-${width}-${board}.png`;await page.screenshot({path:path.join(out,shot)});report.screenshots.push(shot);
   }
  }
  await page.getByRole('button',{name:'Agent 综合榜',exact:true}).click();
  const before=(await states())[0];
  await page.getByRole('button',{name:'刷新榜单',exact:true}).click();
  check('刷新期间旧榜50行保持可见',await page.locator('.ranking-table tbody tr').count()===50);
  await idle();const after=(await states())[0];
  check('手动真实刷新取得新获取时间且保留另一榜',after.snapshotId!==before.snapshotId&&after.snapshot.capturedAt>before.snapshot.capturedAt&&(await states())[1].snapshotId===saved[1].snapshotId);
  const sameSnapshot=(a,b)=>a.snapshotId===b.snapshotId&&JSON.stringify(a.snapshot)===JSON.stringify(b.snapshot)&&a.savedAt===b.savedAt;
  await page.route('https://datasets-server.huggingface.co/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"explicit test outage"}'}));
  await page.getByRole('button',{name:'刷新榜单',exact:true}).click();await idle();
  check('显式503故障保留完整旧榜和全部快照时间',sameSnapshot(after,(await states())[0])&&(await page.locator('.ranking-error').innerText()).includes('503'));
  await page.unroute('https://datasets-server.huggingface.co/**');
  await page.route('https://datasets-server.huggingface.co/**',async route=>{await new Promise(r=>setTimeout(r,3000));await route.abort().catch(()=>{})});
  await page.getByRole('button',{name:'刷新榜单',exact:true}).click();await page.getByRole('button',{name:'取消获取',exact:true}).click();await idle();
  check('取消获取保留旧快照且不报更新成功',sameSnapshot(after,(await states())[0])&&(await page.locator('.ranking-board').innerText()).includes('已取消获取'));
  await page.unroute('https://datasets-server.huggingface.co/**');
  await page.locator('nav a[href="#today"]').click();await page.locator('nav a[href="#models"]').click();
  await page.waitForSelector('.ranking-table tbody tr');
  check('切页后保留已保存榜和取消反馈',await page.locator('.ranking-table tbody tr').count()===50&&(await page.locator('.ranking-board').innerText()).includes('已取消获取'));
  fs.writeFileSync(path.join(run,'expected-reopen.json'),JSON.stringify(await states(),null,2),{flag:'wx'});
  check('无页面JS异常',report.pageErrors.length===0,report.pageErrors);
  report.after=hashes();check('验证期间源码未改变',JSON.stringify(report.before)===JSON.stringify(report.after));
 }catch(e){report.failure=String(e);console.error(e);process.exitCode=1}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(out,'report.json'));await b.close()}
})().catch(e=>{console.error(e);process.exit(1)});
