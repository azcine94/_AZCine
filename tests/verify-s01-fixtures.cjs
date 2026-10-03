// Explicit fixture injection into a separate retained Chromium profile. Never enabled by production UI.
const fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
(async()=>{
  const {out,hashes}=validationRun('s01-ui-fixtures');
  const report={mode:'explicit test-only IPC replay; not true disk/network failures',before:hashes(),checks:[]};
  const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw new Error(name);};
  const context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{executablePath,headless:true,viewport:{width:1024,height:768}});
  try{
    const page=await context.newPage();
    await page.addInitScript(()=>{
      window.isTauri=true;
      window.fixture={rows:[],calls:[],pending:null,mode:'reject',root:'D:\\FixtureData'};
      window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
        const f=window.fixture;f.calls.push({command,args});
        if(command==='storage_workspace')return {root:f.root,defaultRoot:'D:\\FixtureData',todos:f.rows};
        if(command==='create_todo'){
          if(f.mode==='pending')return new Promise((resolve,reject)=>{f.pending={resolve,reject,input:args.input};});
          if(f.mode==='reject')throw {code:'storage_io',message:'测试回放：磁盘不能写入，输入已保留。'};
          const saved={...args.input,completed:false,revision:1,createdAt:'2026-10-03T00:00:00.000Z'};
          if(f.mode==='mismatch')return {...saved,id:'11111111-1111-1111-1111-111111111111'};
          if(!f.rows.some(t=>t.id===saved.id))f.rows.push(saved);return saved;
        }
        if(command==='complete_todo'){
          if(f.mode==='stale')throw {code:'stale_record',message:'测试回放：待办已改变，请重新核对。'};
          throw new Error('unexpected completion mode');
        }
        if(command==='pick_data_root')return null;
        if(command==='select_data_root')throw {code:'storage_io',message:'测试回放：目录不可写。'};
        if(command==='open_data_root')throw {code:'folder_open_failed',message:'测试回放：Windows 未打开目录。'};
        throw new Error('Unexpected fixture command '+command);
      }};
    });
    await page.goto('http://127.0.0.1:1420/#today');await page.waitForSelector('#todo-title');
    await page.locator('#todo-title').fill('回放保存草稿');await page.getByRole('button',{name:'保存待办',exact:true}).click();await page.waitForSelector('.form-error');
    check('Given write failure Then draft retained and no row',await page.locator('#todo-title').inputValue()==='回放保存草稿'&&await page.locator('[data-todo-id]').count()===0);
    const firstId=await page.evaluate(()=>window.fixture.calls.find(c=>c.command==='create_todo').args.input.id);
    await page.locator('nav a[href="#projects"]').click();await page.getByRole('button',{name:/切换.*色/}).click();await page.locator('nav a[href="#today"]').click();
    check('Given failure When route/theme changed Then request and draft retained',await page.locator('#todo-title').inputValue()==='回放保存草稿'&&await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).count()===1);
    await page.evaluate(()=>window.fixture.mode='pending');await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).click();
    await page.waitForFunction(()=>!!window.fixture.pending);
    check('Given pending retry Then same request ID',await page.evaluate(id=>window.fixture.pending.input.id===id,firstId));
    const retry=page.getByRole('button',{name:'保存待办',exact:true});
    await retry.evaluate(button=>{button.click();button.click();});
    check('Given pending write Then controls block repeat clicks without fading or relabelling',await retry.getAttribute('aria-disabled')==='true'&&await page.locator('#todo-title').evaluate(input=>input.readOnly)&&await page.evaluate(()=>window.fixture.calls.filter(call=>call.command==='create_todo').length)===2);
    await page.locator('nav a[href="#settings"]').click();
    await page.evaluate(()=>{const f=window.fixture,p=f.pending;const saved={...p.input,completed:false,revision:1,createdAt:'2026-10-03T00:00:00.000Z'};f.rows.push(saved);p.reject({code:'lost_response',message:'测试回放：响应中断，保存结果待核对。'});});
    await page.locator('nav a[href="#today"]').click();await page.waitForSelector('.form-error');
    await page.getByRole('button',{name:'重新核对保存结果',exact:true}).click();await page.waitForSelector('[data-todo-id]');
    check('Given commit but lost response When reconcile Then one row and no duplicate',await page.locator('[data-todo-id]').count()===1&&await page.locator('#todo-title').inputValue()==='');
    await page.evaluate(()=>window.fixture.mode='stale');await page.getByRole('button',{name:'完成待办：回放保存草稿',exact:true}).click();await page.waitForSelector('.form-error');
    check('Given stale revision Then failure shown and no optimistic completion',(await page.locator('.form-error').innerText()).includes('已改变')&&await page.getByRole('button',{name:'完成待办：回放保存草稿',exact:true}).count()===1);
    await page.evaluate(()=>window.fixture.mode='mismatch');await page.locator('#todo-title').fill('响应校验');await page.getByRole('button',{name:'保存待办',exact:true}).click();await page.waitForSelector('.form-error');
    check('Given wrong response ID Then no false success or draft loss',await page.locator('#todo-title').inputValue()==='响应校验'&&await page.locator('[data-todo-id]').count()===1);
    await page.getByRole('button',{name:'重新核对保存结果',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#todo-title').readOnly&&document.querySelector('#todo-title').getAttribute('aria-disabled')==='false');
    check('Given absent request When reconcile Then draft becomes editable',await page.locator('#todo-title').inputValue()==='响应校验'&&await page.locator('#todo-title').isEnabled());
    await page.locator('nav a[href="#settings"]').click();await page.getByRole('button',{name:'打开目录',exact:true}).click();await page.waitForSelector('.form-error');check('Given open-folder failure Then error visible',(await page.locator('.form-error').innerText()).includes('Windows'));
    await page.screenshot({path:path.join(out,'dark-errors.png'),fullPage:true});
    await page.evaluate(()=>{window.fixture.root=null;window.fixture.rows=[];});await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.waitForSelector('#data-root');await page.locator('#data-root').fill('D:\\UserTypedRoot');
    await page.getByRole('button',{name:'选择目录',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.workspace-feedback')?.textContent.includes('取消'));
    check('Given picker cancellation Then typed path retained',await page.locator('#data-root').inputValue()==='D:\\UserTypedRoot');
    await page.getByRole('button',{name:'使用此目录',exact:true}).click();await page.waitForSelector('.form-error');check('Given root write failure Then selection remains unsaved',await page.locator('#data-root').inputValue()==='D:\\UserTypedRoot'&&await page.locator('[data-current-root]').count()===0);
    const clockPage=await context.newPage();
    // Explicit controlled clock + rows; not the Windows scheduler or a real midnight wait.
    await clockPage.clock.install({time:new Date(2026,9,3,23,59,59)});
    await clockPage.clock.pauseAt(new Date(2026,9,3,23,59,59));
    await clockPage.addInitScript(()=>{
      window.isTauri=true;
      window.__TAURI_INTERNALS__={invoke:async(command)=>{
        if(command!=='storage_workspace')throw new Error('Unexpected clock fixture command');
        return {root:'D:\\ClockFixture',defaultRoot:'D:\\ClockFixture',todos:['2026-10-03','2026-10-04','2026-10-05'].map((dueDate,i)=>({id:`11111111-1111-1111-1111-${String(i).padStart(12,'0')}`,title:`时钟回放 ${dueDate}`,dueDate,projectId:null,completed:false,revision:1,createdAt:'2026-10-01T00:00:00Z'}))};
      }};
    });
    await clockPage.goto('http://127.0.0.1:1420/#today');await clockPage.waitForSelector('#todo-title');
    await clockPage.getByRole('button',{name:'今天',exact:true}).click();
    check('Given clock before midnight Then today filter shows current calendar date',(await clockPage.locator('[data-todo-id]').innerText()).includes('2026-10-03'));
    await clockPage.clock.runFor(1001);
    await clockPage.waitForFunction(()=>document.querySelector('[data-todo-id]')?.textContent.includes('2026-10-04'));
    check('Given open today filter When midnight timer fires Then next day row replaces old row',await clockPage.locator('[data-todo-id]').count()===1);
    await clockPage.clock.setSystemTime(new Date(2026,9,5,10,0));
    await clockPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await clockPage.waitForFunction(()=>document.querySelector('[data-todo-id]')?.textContent.includes('2026-10-05'));
    check('Given sleep-like clock jump When window regains focus Then local date refreshes',await clockPage.locator('[data-todo-id]').count()===1);
    await clockPage.screenshot({path:path.join(out,'controlled-midnight.png'),fullPage:true});await clockPage.close();
    report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));
  }catch(error){report.failure=String(error);process.exitCode=1;}finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
