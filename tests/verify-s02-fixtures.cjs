// Explicit browser-only replay of failures and uncertain responses. Never in normal application startup.
const fs=require('node:fs'),path=require('node:path');
const {chromium,executablePath}=require('./support/browser.cjs').browserRuntime();
const {validationRun}=require('./support/validation-run.cjs');
(async()=>{
  const {out,hashes}=validationRun('s02-ui-fixtures',['app/src','app/src-tauri/src','scripts','tests/verify-s02-fixtures.cjs']);
  const report={mode:'explicit test-only IPC replay, not real disk/process failure',before:hashes(),checks:[],errors:[]};
  const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw new Error(name);};
  const context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{executablePath,headless:true,viewport:{width:1024,height:768}});
  try{
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await page.addInitScript(()=>{
      window.isTauri=true;
      const project={id:'aaaaaaaa-1111-2222-3333-111111111111',name:'回放项目',labels:[],blocks:[{id:'bbbbbbbb-1111-2222-3333-111111111111',kind:'text',title:'文字块',body:'原始正文'}],revision:1,createdAt:'2026-10-03T00:00:00.000Z'};
      window.projectFixture={projects:[project],receipts:{},calls:[],mode:'reject',pending:null};
      window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
        const f=window.projectFixture;f.calls.push({command,args:structuredClone(args)});
        if(command==='storage_workspace')return {root:'D:\S02Replay',defaultRoot:'D:\S02Replay',todos:[]};
        if(command==='list_projects')return structuredClone(f.projects);
        if(command==='project_request')return structuredClone(f.receipts[args.requestId]??null);
        if(command==='save_project'){
          const request=args.input;
          if(f.mode==='pending')return new Promise((resolve,reject)=>{f.pending={resolve,reject,request};});
          if(f.mode==='reject')throw {code:'storage_database',message:'测试回放：磁盘不能写入，输入保留。'};
          if(f.receipts[request.requestId])return structuredClone(f.receipts[request.requestId]);
          const old=f.projects.find(doc=>doc.id===request.document.id);
          if((old?.revision??null)!==request.expectedRevision)throw {code:'stale_record',message:'测试回放：正式记录已改变，整批未保存。'};
          const saved={...request.document,revision:(request.expectedRevision??0)+1,createdAt:old?.createdAt??'2026-10-03T00:00:00.000Z'};
          if(f.mode==='mismatch')return {...saved,id:'cccccccc-1111-2222-3333-111111111111'};
          f.receipts[request.requestId]=structuredClone(saved);f.projects=f.projects.filter(doc=>doc.id!==saved.id).concat(saved);
          if(f.mode==='lost')throw {code:'lost_response',message:'测试回放：提交后响应断开，结果待核对。'};
          return structuredClone(saved);
        }
        throw new Error('Unexpected replay command '+command);
      }};
    });
    const projectId='aaaaaaaa-1111-2222-3333-111111111111';
    await page.goto(`http://127.0.0.1:1420/#projects/${projectId}`);await page.waitForSelector('#project-name');
    await page.locator('#project-name').fill('保存失败的草稿');await page.locator('h1').click();await page.waitForSelector('.form-error');
    check('Given rejected project save Then draft retained and official summary unchanged',await page.locator('#project-name').inputValue()==='保存失败的草稿'&&await page.evaluate(()=>window.projectFixture.projects[0].name)==='回放项目');
    const first=await page.evaluate(()=>window.projectFixture.calls.find(call=>call.command==='save_project').args.input.requestId);
    await page.locator('nav a[href="#today"]').click();await page.getByRole('button',{name:/切换.*色/}).click();
    await page.locator('nav a[href="#projects"]').click();await page.locator(`[data-project-id="${projectId}"]`).click();
    check('Given rejected save When route/theme changes Then immutable pending request and input survive',await page.locator('#project-name').inputValue()==='保存失败的草稿'&&await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).count()===1);
    await page.evaluate(()=>window.projectFixture.mode='pending');
    await page.getByRole('button',{name:'重试保存（同一请求）',exact:true}).click();await page.waitForFunction(()=>!!window.projectFixture.pending);
    const add=page.getByRole('button',{name:'添加内容',exact:true});
    await add.evaluate(button=>button.click());
    check('Given retry pending Then same request ID and conflicting structure blocked',await page.evaluate(first=>window.projectFixture.pending.request.requestId===first,first)&&await add.getAttribute('aria-disabled')==='true'&&await add.getAttribute('aria-expanded')==='false'&&await page.getByRole('menuitem').count()===0);
    await page.locator('textarea.doc-text').fill('保存期间输入的新正文');
    check('Given a pending save When editing next text field Then new input is accepted',await page.locator('textarea.doc-text').inputValue()==='保存期间输入的新正文');
    await page.locator('nav a[href="#today"]').click();
    await page.evaluate(()=>{
      const f=window.projectFixture,p=f.pending;const old=f.projects[0];const saved={...p.request.document,revision:old.revision+1,createdAt:old.createdAt};
      f.projects=[saved];f.receipts[p.request.requestId]=structuredClone(saved);p.reject({code:'lost_response',message:'测试回放：响应丢失，原请求保留。'});
    });
    await page.locator('nav a[href="#projects"]').click();await page.locator(`[data-project-id="${projectId}"]`).click();
    await page.getByRole('button',{name:'核对保存结果',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#project-name').disabled&&!document.querySelector('.pending-note'));
    check('Given committed but response lost When receipt queried Then one project and current saved draft',await page.evaluate(()=>window.projectFixture.projects.length===1)&&await page.locator('#project-name').inputValue()==='保存失败的草稿');
    check('Given later text draft When original receipt accepted Then newer draft is not erased',await page.locator('textarea.doc-text').inputValue()==='保存期间输入的新正文'&&await page.evaluate(()=>window.projectFixture.projects[0].blocks[0].body)==='原始正文');
    await page.evaluate(()=>{window.projectFixture.mode='success';window.projectFixture.projects[0]={...window.projectFixture.projects[0],name:'其他路径的新正式名称',revision:3};});
    await page.locator('#project-name').fill('不覆盖新基线的草稿');await page.locator('h1').click();await page.waitForSelector('.form-error');
    await page.getByRole('button',{name:'核对保存结果',exact:true}).click();await page.waitForSelector('.project-conflict');
    check('Given stale document When reconcile Then draft retained and official data not overwritten',await page.locator('#project-name').inputValue()==='不覆盖新基线的草稿'&&await page.evaluate(()=>window.projectFixture.projects[0].name)==='其他路径的新正式名称');
    await page.getByRole('button',{name:'已核对，将草稿改用当前修订',exact:true}).click();
    check('Given explicit new baseline Then still not auto-saved',await page.evaluate(()=>window.projectFixture.projects[0].name)==='其他路径的新正式名称');
    await page.getByRole('button',{name:'保存文档',exact:true}).click();await page.waitForFunction(()=>window.projectFixture.projects[0].revision===4);
    check('Given explicit save after comparison Then one CAS update',await page.evaluate(()=>window.projectFixture.projects[0].name)==='不覆盖新基线的草稿');
    await page.evaluate(()=>window.projectFixture.mode='mismatch');
    await page.locator('#project-name').fill('错误响应不得丢草稿');await page.locator('h1').click();await page.waitForSelector('.form-error');
    check('Given wrong response ID Then not accepted as success',await page.locator('#project-name').inputValue()==='错误响应不得丢草稿'&&await page.getByRole('button',{name:'核对保存结果',exact:true}).count()===1);
    await page.getByRole('button',{name:'核对保存结果',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#project-name').disabled&&!document.querySelector('.pending-note'));
    check('Given receipt missing Then original draft editable without fresh write',await page.locator('#project-name').inputValue()==='错误响应不得丢草稿');
    await page.screenshot({path:path.join(out,'recovered-draft.png'),fullPage:true});
    await page.evaluate(()=>window.projectFixture.mode='lost');
    await page.locator('nav a[href="#projects"]').click();await page.locator('a[href="#projects/new"]').first().click();await page.locator('#new-project-name').fill('响应中断的新项目');await page.getByRole('button',{name:'新建公司项目',exact:true}).click();await page.waitForSelector('.pending-note');
    await page.getByRole('button',{name:'核对创建结果',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#new-project-name')?.value==='');
    check('Given create committed response lost Then receipt clears only submitted input',await page.locator('#new-project-name').inputValue()==='');
    await page.locator('nav a[href="#projects"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-project-id]').length===2);
    check('Given confirmed create When returning to index Then exactly one new card',await page.locator('[data-project-id]').count()===2);
    report.after=hashes();check('Source stable',JSON.stringify(report.before)===JSON.stringify(report.after));check('No page errors',report.errors.length===0,report.errors);
  }catch(error){report.failure=String(error);process.exitCode=1;}
  finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
