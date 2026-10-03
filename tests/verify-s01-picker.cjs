const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('./support/browser.cjs').browserRuntime();
const { validationRun } = require('./support/validation-run.cjs');
(async () => {
  const owner = Number(process.env.AZCINE_OWNER_PID);
  if (!Number.isSafeInteger(owner) || owner < 1) throw new Error('Explicit owned app PID required');
  const { out, hashes } = validationRun('s01-native-picker');
  const folder = path.join(out, 'chosen-folder');
  fs.mkdirSync(folder);
  const report = { mode: 'actual Tauri folder picker and Windows UIAutomation; no IPC fixture', out, owner, before: hashes(), checks: [] };
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  let outstanding = false;
  function operate(action) {
    return new Promise((resolve, reject) => {
      const args = ['-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', 'tests/support/folder-picker.ps1', '-OwnerPid', String(owner), '-Action', action];
      if (action === 'select') args.push('-FolderPath', folder);
      const child = spawn('powershell.exe', args, { windowsHide: true, timeout: 20000 });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        const receipt = { code, signal, stdout, stderr };
        fs.writeFileSync(path.join(out, `${action}-${Date.now()}.json`), JSON.stringify(receipt, null, 2), { flag: 'wx' });
        if (code !== 0) reject(new Error(`${action} UIAutomation failed: ${stdout}\n${stderr}`));
        else resolve(JSON.parse(stdout.trim()));
      });
    });
  }
  try {
    const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://127.0.0.1:1420'));
    assert.ok(page, 'Actual app page');
    await page.evaluate(() => { location.hash = '#today'; });
    await page.waitForSelector('#todo-title');
    await page.locator('#todo-title').fill('目录选择时保留的未保存输入');
    const before = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('storage_workspace'));
    for (const action of ['cancel', 'select']) {
      await page.evaluate(() => {
        window.__pickerTestResult = null;
        void window.__TAURI_INTERNALS__.invoke('pick_data_root').then(value => { window.__pickerTestResult = { done: true, value }; }, error => { window.__pickerTestResult = { done: true, error }; });
      });
      outstanding = true;
      const native = await operate(action);
      await page.waitForFunction(() => window.__pickerTestResult?.done, { timeout: 12000 });
      outstanding = false;
      const result = await page.evaluate(() => window.__pickerTestResult);
      assert.equal(result.error, undefined);
      if (action === 'cancel') assert.equal(result.value, null);
      else assert.equal(path.normalize(result.value).toLowerCase(), folder.toLowerCase());
      assert.deepEqual(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('storage_workspace')), before);
      assert.equal(await page.locator('#todo-title').inputValue(), '目录选择时保留的未保存输入');
      report.checks.push({ name: `Given native picker When ${action} Then return exact result without changing saved root, rows or input`, ok: true, native, result });
    }
    await page.locator('#todo-title').fill('');
    report.after = hashes();
    assert.deepEqual(report.after, report.before);
    report.checks.push({ name: 'Production source unchanged', ok: true });
  } catch (error) {
    report.failure = String(error); process.exitCode = 1;
  } finally {
    if (outstanding) {
      try { report.cancelAfterFailure = await operate('cancel'); } catch (error) { report.cancelFailure = String(error); }
    }
    await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ out, checks: report.checks.length, failure: report.failure }, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
