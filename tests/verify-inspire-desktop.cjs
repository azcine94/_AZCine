// Real Tauri IPC and retained synthetic data. Explicit response-delay fixtures are reported separately.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('./support/browser.cjs').browserRuntime();
const { validationRun } = require('./support/validation-run.cjs');
const { inspireOverflow } = require('./support/inspire-overflow.cjs');

(async () => {
  const run = process.env.AZCINE_VALIDATION_RUN || fs.readFileSync('.tooling/instance/validation-run.txt', 'utf8').trim();
  assert.ok(run.startsWith(path.resolve('artifacts/validation') + path.sep));
  const launch = JSON.parse(fs.readFileSync(path.join(run, 'launch.json')));
  const state = JSON.parse(fs.readFileSync('.tooling/instance/run-state.json'));
  assert.equal(state.config, path.join(run, 'local-config')); assert.equal(state.data, path.join(run, 'data'));
  const out = validationRun('inspire-ui', ['app/src','app/src-tauri/src','scripts','tests/verify-inspire-desktop.cjs']);
  const report = { mode:'real Tauri WebView2 + Rust SQLite; synthetic retained data; fixture checks individually labelled', run, state, before:out.hashes(), checks:[], errors:[], screenshots:[] };
  const deadline=Date.now()+90000;
  while(true) {
    try { const response=await fetch(`http://127.0.0.1:${launch.cdpPort}/json/version`);if(response.ok)break; } catch {}
    if(Date.now()>deadline)throw Error('Owned desktop CDP did not become ready');
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith(`http://127.0.0.1:${state.port}`));
  assert.ok(page, 'owned desktop page'); page.setDefaultTimeout(25000);
  page.on('pageerror', e => report.errors.push(e.message));
  const check = (name, ok, detail, mode='real') => { report.checks.push({name,ok,detail,mode}); assert.ok(ok,name); };
  const ipc = (command,args) => page.evaluate(({command,args}) => window.__TAURI_INTERNALS__.invoke(command,args), {command,args});
  const card = id => page.locator(`[data-idea-id="${id}"]`);
  const ready = () => page.waitForFunction(() => document.querySelector('.ideas-feedback [role=status]')?.textContent.includes('灵感已保存'));
  try {
    await page.locator('nav a[href="#ideas"]').click();
    if (await page.locator('[data-storage-setup]').count()) {
      await page.waitForFunction(() => !!document.querySelector('#data-root')?.value);
      check('Given 首次打开 Then默认根为本轮隔离虚构数据根', path.resolve(await page.locator('#data-root').inputValue()) === path.join(run,'data'));
      await page.getByRole('button',{name:'使用此目录',exact:true}).click();
    }
    await page.waitForSelector('#idea-new-body');
    if (process.argv.includes('--reopen')) {
      const saved=JSON.parse(fs.readFileSync(path.join(run,'expected-reopen.json')));
      const current=await ipc('list_ideas'), todos=(await ipc('storage_workspace')).todos;
      check('Given 退出重开 Then正式灵感内容/标签/公司/删除状态/待办回链全部一致', JSON.stringify(current)===JSON.stringify(saved.ideas));
      check('Given 退出重开 Then待办编号/无日期/完成状态持久一致', JSON.stringify(todos)===JSON.stringify(saved.todos));
      await page.screenshot({path:path.join(out.out,'reopened.png')});report.screenshots.push('reopened.png');
      return;
    }
    await page.getByRole('button',{name:'收集灵感',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.ideas-feedback [role=alert]')?.textContent.includes('内容'));
    check('Given 空内容 When保存 Then明确提示且未生成卡片', (await ipc('list_ideas')).length===0);
    const projectId=randomUUID();
    await ipc('save_project',{input:{requestId:randomUUID(),expectedRevision:null,document:{id:projectId,name:'雾港 · 验证公司',labels:[],blocks:[]}}});
    await page.locator('nav a[href="#projects"]').click();await page.getByRole('button',{name:'重新读取项目',exact:true}).click();await page.waitForSelector(`[data-project-id="${projectId}"]`);
    await page.locator('nav a[href="#ideas"]').click();
    await page.locator('#idea-new-title').fill('雨夜港口的光线变化');await page.locator('#idea-new-body').fill('近处暖光，远处冷雾。\n先看见反光，再显出船体轮廓。');
    await page.locator('#idea-new-tags').fill('画面，灯光');await page.locator('#idea-new-project').selectOption(projectId);
    await page.getByRole('button',{name:'收集灵感',exact:true}).evaluate(el=>{el.click();el.click();});await ready();
    let all=await ipc('list_ideas');const a=all.find(i=>i.title==='雨夜港口的光线变化');
    check('Given 连点保存 Then只生成一张卡片且公司/标签/换行真实落盘', all.length===1 && a.projectId===projectId && a.tags.join(',')==='画面,灯光' && a.body.includes('\n'));
    await page.locator('#idea-new-body').fill('把失败样例也留在项目资料里。');await page.locator('#idea-new-tags').fill('流程');await page.locator('#idea-new-body').focus();await page.keyboard.press('Control+Enter');await ready();
    all=await ipc('list_ideas');const b=all.find(i=>!i.title);
    check('Given 只有内容 When快捷键保存 Then无标题/无公司同样保存', all.length===2 && b.projectId===null);
    await page.locator('#idea-new-body').fill('新建区的未提交念头');
    await card(a.id).getByRole('button',{name:'编辑',exact:true}).click();await page.locator(`#idea-${a.id}-body`).fill('A 的独立编辑草稿');
    await page.locator('nav a[href="#today"]').click();await page.getByRole('button',{name:/切换.*色/}).click();await page.locator('nav a[href="#ideas"]').click();
    check('Given 新建和卡片草稿 When切页/主题 Then分别保留', await page.locator('#idea-new-body').inputValue()==='新建区的未提交念头' && await page.locator(`#idea-${a.id}-body`).inputValue()==='A 的独立编辑草稿');
    await card(a.id).getByRole('button',{name:'收起编辑',exact:true}).click();await card(b.id).getByRole('button',{name:'编辑',exact:true}).click();await page.locator(`#idea-${b.id}-body`).fill('交付前整理一份版本清单。');await card(b.id).getByRole('button',{name:'保存修改',exact:true}).click();await ready();
    await card(a.id).getByRole('button',{name:'编辑',exact:true}).click();
    check('Given 保存B卡 When返回A ThenA和新建草稿未被覆盖', await page.locator(`#idea-${a.id}-body`).inputValue()==='A 的独立编辑草稿' && await page.locator('#idea-new-body').inputValue()==='新建区的未提交念头');
    await card(a.id).getByRole('button',{name:'收起编辑',exact:true}).click();
    await page.getByRole('textbox',{name:'搜索灵感',exact:true}).fill('不会匹配的内容');await page.getByRole('button',{name:'清除筛选',exact:true}).waitFor();
    check('Given 无搜索结果 Then明确空态并可恢复', await page.locator('[data-idea-id]').count()===0);await page.getByRole('button',{name:'清除筛选',exact:true}).click();
    await page.locator('.idea-filter').filter({hasText:'灯光'}).click();check('Given 自由标签 When筛选 Then只有匹配卡片', await page.locator('[data-idea-id]').count()===1);
    await page.getByRole('combobox',{name:'按公司筛选灵感',exact:true}).selectOption(projectId);check('Given 标签与公司组合筛选 Then准确匹配',await page.locator('[data-idea-id]').count()===1);
    await page.locator('.idea-filter').first().click();await page.getByRole('combobox',{name:'按公司筛选灵感',exact:true}).selectOption('');
    await card(a.id).getByRole('button',{name:/移除灵感/}).click();await page.getByRole('button',{name:'撤销移除',exact:true}).waitFor();
    check('Given 移除 Then原记录软删除且未删除关联公司', (await ipc('list_ideas')).find(i=>i.id===a.id).deleted);
    await page.getByRole('button',{name:'撤销移除',exact:true}).click();await card(a.id).waitFor();await card(a.id).getByRole('button',{name:'编辑',exact:true}).click();
    check('Given 删除撤销 Then原卡编号/关联/未提交编辑草稿恢复', await page.locator(`#idea-${a.id}-body`).inputValue()==='A 的独立编辑草稿');
    await card(a.id).getByRole('button',{name:'保存修改',exact:true}).click();await ready();
    const beforeTodos=(await ipc('storage_workspace')).todos.length;
    await card(a.id).getByRole('button',{name:'转待办',exact:true}).evaluate(el=>{el.click();el.click();});await card(a.id).getByRole('link',{name:'打开待办',exact:true}).waitFor();
    const converted=(await ipc('list_ideas')).find(i=>i.id===a.id),workspace=await ipc('storage_workspace');
    const todo=workspace.todos.find(t=>t.id===converted.todoId);
    await ipc('convert_idea',{id:a.id,revision:1});
    check('Given 连点/旧版本重试转换 Then仅一条无日期待办且原卡保留', workspace.todos.length===beforeTodos+1 && todo.dueDate===null && todo.projectId===projectId && (await ipc('storage_workspace')).todos.length===beforeTodos+1);
    await card(a.id).getByRole('link',{name:'打开待办',exact:true}).click();await page.waitForSelector(`[data-todo-id="${todo.id}"]`);
    check('Given 打开待办 Then定位正确待办且有来源回链',await page.locator(`[data-todo-id="${todo.id}"]`).getByRole('link',{name:'查看来源灵感',exact:true}).count()===1);
    await page.locator(`[data-todo-id="${todo.id}"]`).getByRole('button',{name:/完成待办/}).click();await page.getByRole('button',{name:'已完成',exact:true}).click();
    await page.locator(`[data-todo-id="${todo.id}"]`).getByRole('link',{name:'查看来源灵感',exact:true}).click();await card(a.id).waitFor();
    check('Given 来源回链 Then打开原灵感且过滤条件不遮挡',await page.locator('[data-idea-id]').count()===1 && await card(a.id).getAttribute('class').then(c=>c.includes('idea-card--target')));
    await card(a.id).getByRole('link',{name:'打开待办',exact:true}).click();await page.waitForSelector(`[data-todo-id="${todo.id}"]`);
    check('Given 已完成待办 When从灵感打开 Then自动切到已完成并定位',await page.getByRole('button',{name:'已完成',exact:true}).getAttribute('aria-pressed')==='true');
    await page.evaluate(id=>window.location.hash=`ideas/${id}`,randomUUID());
    await page.getByRole('heading',{name:'没有找到这张来源灵感',exact:true}).waitFor();
    check('Given 合法但不存在的来源编号 Then明确空态且不展示其他卡片',await page.locator('[data-idea-id]').count()===0);
    await page.locator('nav a[href="#ideas"]').click();
    // Explicitly delay the response of a real Rust save. The write itself is never mocked.
    await page.evaluate(() => { const original=window.fetch;window.__inspireOriginal=original;
      window.fetch=async (...args) => { const response=await original(...args);if(String(args[0]).endsWith('/save_idea')){window.__inspireSaved=await response.clone().json();return new Promise(resolve=>{window.__inspireRelease=()=>resolve(response);});}return response;}; });
    await page.locator('#idea-new-title').fill('延迟回执测试');await page.locator('#idea-new-body').fill('已提交的原版本');await page.getByRole('button',{name:'收集灵感',exact:true}).click();
    await page.waitForFunction(()=>!!window.__inspireRelease);await page.locator('#idea-new-body').fill('保存过程中继续手改的版本');await page.locator('nav a[href="#today"]').click();await page.locator('nav a[href="#ideas"]').click();
    await page.evaluate(()=>{window.fetch=window.__inspireOriginal;window.__inspireRelease();});await ready();
    const delayed=await page.evaluate(()=>window.__inspireSaved);
    check('Given 实写延迟回执 When继续输入/切页 Then回执不覆盖后续手改',await page.locator(`#idea-${delayed.id}-body`).inputValue()==='保存过程中继续手改的版本' && (await ipc('list_ideas')).find(i=>i.id===delayed.id).body==='已提交的原版本',null,'real Rust write + explicit delayed-response fixture');
    await card(delayed.id).getByRole('button',{name:'保存修改',exact:true}).click();await ready();
    // A dropped reply tests reconciliation after a committed write, using the same retained request.
    await page.evaluate(()=>{const original=window.fetch;window.__inspireOriginal=original;let once=true;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/save_idea')&&once){once=false;return new Response(JSON.stringify({message:'显式验证 fixture：保存回执丢失'}),{headers:{'Tauri-Response':'error','Content-Type':'application/json'}});}return response;};});
    await page.locator('#idea-new-title').fill('回执丢失测试');await page.locator('#idea-new-body').fill('真实写入后丢失回执');await page.getByRole('button',{name:'收集灵感',exact:true}).click();await page.getByRole('button',{name:'核对保存结果',exact:true}).waitFor();
    check('Given 回执丢失 Then保留输入而不报成功',await page.locator('#idea-new-body').inputValue()==='真实写入后丢失回执',null,'explicit lost-response fixture');
    await page.evaluate(()=>{window.fetch=window.__inspireOriginal;});
    await page.getByRole('button',{name:'重新读取',exact:true}).click();
    const lost=(await ipc('list_ideas')).find(i=>i.title==='回执丢失测试');await card(lost.id).waitFor();
    check('Given 新建回执丢失后重新读取 Then原请求占用新卡，不能绕过编辑/转换/删除',await card(lost.id).getByRole('button',{name:'编辑',exact:true}).isDisabled() && await card(lost.id).getByRole('button',{name:'转待办',exact:true}).isDisabled() && await card(lost.id).getByRole('button',{name:/移除灵感/}).isDisabled(),null,'real Rust write + explicit lost-response fixture');
    await page.locator('.idea-composer').getByRole('button',{name:'核对保存结果',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ideas-feedback [role=status]')?.textContent.includes('已确认保存成功'));
    check('Given 核对保存结果 Then只一条真实记录且已确认保存', (await ipc('list_ideas')).filter(i=>i.title==='回执丢失测试').length===1,null,'real reconciliation after explicit fixture');
    await card(b.id).getByRole('button',{name:'编辑',exact:true}).click();await page.locator(`#idea-${b.id}-body`).fill('删除回执丢失后保留的草稿');await card(b.id).getByRole('button',{name:'收起编辑',exact:true}).click();
    await page.evaluate(()=>{const original=window.fetch;window.__inspireOriginal=original;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/set_idea_deleted'))return new Response(JSON.stringify({message:'显式验证 fixture：删除回执丢失'}),{headers:{'Tauri-Response':'error','Content-Type':'application/json'}});return response;};});
    await card(b.id).getByRole('button',{name:/移除灵感/}).click();await page.waitForFunction(()=>document.querySelector('.ideas-feedback [role=alert]')?.textContent.includes('删除回执丢失'));await page.evaluate(()=>window.fetch=window.__inspireOriginal);
    await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByRole('button',{name:/^已移除/}).click();await card(b.id).waitFor();
    await card(b.id).getByRole('button',{name:'恢复灵感',exact:true}).click();await page.getByRole('button',{name:'查看灵感',exact:true}).click();await card(b.id).getByRole('button',{name:'编辑',exact:true}).click();
    check('Given 删除落库后回执丢失 When重新读取/恢复 Then编辑草稿仍在',await page.locator(`#idea-${b.id}-body`).inputValue()==='删除回执丢失后保留的草稿',null,'real Rust write + explicit lost-delete-response fixture');
    await card(b.id).getByRole('button',{name:'保存修改',exact:true}).click();await ready();
    check('Given 恢复后的编辑草稿 When保存 Then版本已恢复且不永久冲突',(await ipc('list_ideas')).find(i=>i.id===b.id).body==='删除回执丢失后保留的草稿',null,'real recovery after fixture');
    // True content conflicts require an explicit user choice; no automatic overwrite.
    await card(b.id).getByRole('button',{name:'编辑',exact:true}).click();await page.locator(`#idea-${b.id}-body`).fill('保留的手改草稿');
    const baseline=(await ipc('list_ideas')).find(i=>i.id===b.id);
    await ipc('save_idea',{input:{requestId:randomUUID(),expectedRevision:baseline.revision,content:{id:b.id,title:baseline.title,body:'另一份已保存版本',tags:baseline.tags,projectId:baseline.projectId}}});
    await card(b.id).getByRole('button',{name:'保存修改',exact:true}).click();await card(b.id).getByRole('button',{name:'核对保存结果',exact:true}).waitFor();await card(b.id).getByRole('button',{name:'核对保存结果',exact:true}).click();
    await card(b.id).getByRole('button',{name:'保留草稿，在当前版本上继续编辑',exact:true}).waitFor();
    check('Given 内容版本冲突 Then不自动覆盖且保留手改',(await ipc('list_ideas')).find(i=>i.id===b.id).body==='另一份已保存版本' && await page.locator(`#idea-${b.id}-body`).inputValue()==='保留的手改草稿');
    await card(b.id).getByRole('button',{name:'保留草稿，在当前版本上继续编辑',exact:true}).click();await card(b.id).getByRole('button',{name:'保存修改',exact:true}).click();await ready();
    check('Given 明确核对当前版本后继续 Then草稿可正常保存',(await ipc('list_ideas')).find(i=>i.id===b.id).body==='保留的手改草稿');
    // Seed additional genuine records for dense cards, long text and the selected screenshot reference.
    for (const [title,body,tags] of [
      ['交付前生成一份版本清单','整理本轮镜头、版本和输出位置，确认后再更新正式记录。',['项目']],
      ['把原始资料说明留在项目文档里','回到项目时，可以直接找到当时的要求和出处。',['流程']],
      ['节点实验，留一份可复用的笔记','记录节点连接方式、输入条件与失败样例，下次从已有的结论开始。',['工具']],
      ['长文本与链接验证','长文本'.repeat(120)+'\nhttps://example.invalid/'+ 'longpath'.repeat(60),['长标签'.repeat(13)]]
    ]) await ipc('save_idea',{input:{requestId:randomUUID(),expectedRevision:null,content:{id:randomUUID(),title,body,tags,projectId:null}}});
    await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-idea-id]').length>=8);
    await page.locator('#idea-new-title').fill('');await page.locator('#idea-new-body').fill('');await page.locator('#idea-new-tags').fill('');
    const ownerPid=Number(process.env.AZCINE_OWNER_PID || execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${path.resolve('app/src-tauri/target/debug/azcine.exe').replaceAll("'","''")}' }).ProcessId`],{encoding:'utf8',windowsHide:true}).trim());
    assert.ok(ownerPid>0);report.ownerPid=ownerPid;
    for (const theme of ['light','dark']) for (const [width,height] of [[1440,900],[1280,800],[1024,768]]) {
      execFileSync('powershell.exe',['-NoProfile','-File','tests/support/native-window.ps1','-OwnerPid',String(ownerPid),'-Action','resize','-Width',String(width),'-Height',String(height)],{windowsHide:true});
      await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
      if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme) await page.getByRole('button',{name:/切换.*色/}).click();
      await page.locator('.workspace-scroll').evaluate(el=>el.scrollTop=0);
      const overflow=await inspireOverflow(page),contrast=await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js','utf8'));
      check(`Given ${theme} ${width}×${height} Then无横向溢出/控件裁切`,overflow.valid,overflow);
      check(`Given ${theme} ${width}×${height} Then正文对比度达标`,contrast.low.length===0,contrast);
      const file=`${theme}-${width}x${height}.png`;await page.screenshot({path:path.join(out.out,file)});report.screenshots.push(file);
    }
    await page.locator('#idea-new-body').focus();const focus=await page.locator('#idea-new-body').evaluate(el=>({outline:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth}));
    // Force keyboard modality, then check the real focus ring.
    await page.keyboard.press('Tab');const focusRing=await page.evaluate(()=>({style:getComputedStyle(document.activeElement).outlineStyle,width:parseFloat(getComputedStyle(document.activeElement).outlineWidth)}));
    check('Given 键盘Tab Then焦点环实体可见',focusRing.style!=='none'&&focusRing.width>=2,{focus,focusRing});
    const current=await ipc('list_ideas'),todos=(await ipc('storage_workspace')).todos;
    fs.writeFileSync(path.join(run,'expected-reopen.json'),JSON.stringify({ideas:current,todos},null,2));
    check('Given 实际页面操作 Then没有未捕获JS异常',report.errors.length===0,report.errors);
  } catch(e) { report.failure=e.stack; process.exitCode=1;console.error(e);await page.screenshot({path:path.join(out.out,'failure.png')}).catch(()=>{}); }
  finally { report.after=out.hashes();fs.writeFileSync(path.join(out.out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out:out.out,checks:report.checks.length,passed:report.checks.filter(c=>c.ok).length,failure:report.failure, screenshots:report.screenshots}));await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
