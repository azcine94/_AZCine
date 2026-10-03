const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./support/browser.cjs').browserRuntime();
const { validationRun } = require('./support/validation-run.cjs');
(async () => {
  const run = path.resolve(process.env.AZCINE_VALIDATION_RUN || '');
  if (!run.startsWith(path.resolve('artifacts/validation') + path.sep)) throw new Error('Explicit retained test run required.');
  const { out, hashes } = validationRun('s01-reopen');
  const report = { mode: 'actual new Tauri process after previous native WM_CLOSE; retained root', run, before: hashes(), checks: [] };
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT || 9224}`);
  try {
    const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://127.0.0.1:1420'));
    if (!page) throw new Error('Actual Tauri window not found');
    await page.waitForSelector('h1');
    const workspace = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('storage_workspace'));
    const expectedFile = path.join(run, 'ui-expected.json');
    if (fs.existsSync(expectedFile)) {
      const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
      report.checks.push({ name: 'Given production UI saved records and process exit When reopening Then exact root and all records persist', ok: JSON.stringify(workspace) === JSON.stringify(expected), workspace, expected });
      await page.waitForSelector('#todo-title');
      report.checks.push({ name: 'Given reopened app Then persisted todo rows visible in real UI', ok: await page.locator('[data-todo-id]').count() === expected.todos.filter(t => !t.completed).length });
    } else {
      const todo = workspace.todos.find(t => t.id === 'abcdefab-1111-2222-3333-abcdefabcdef');
      report.checks.push({ name: 'Given exit and new process When opening Then selected root and same restored todo persist', ok: workspace.root !== null && workspace.todos.length === 1 && todo?.title === '真实 IPC 待办' && todo.dueDate === null && todo.completed === false && todo.revision === 3, workspace });
    }
    const secondRoot = await page.evaluate(async root => { try { await window.__TAURI_INTERNALS__.invoke('select_data_root', { path: root }); return null; } catch (error) { return error; } }, path.join(run,'unapproved-switch'));
    report.checks.push({ name: 'Given persisted root When directly switching Then rejected without empty fallback', ok: secondRoot?.code === 'root_already_selected' && !fs.existsSync(path.join(run,'unapproved-switch')), secondRoot });
    report.after = hashes(); report.checks.push({ name:'Source unchanged', ok:JSON.stringify(report.before)===JSON.stringify(report.after) });
    if (report.checks.some(c => !c.ok)) process.exitCode=1;
  } catch(error) { report.failure=String(error);process.exitCode=1; }
  finally { await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify({out,checks:report.checks.length,failure:report.failure},null,2)); }
})().catch(error => {console.error(error);process.exitCode=1;});
