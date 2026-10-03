// Explicit browser fixtures only for pending/error/timeout paths. Not a real desktop success test.
const fs = require('node:fs');
const path = require('node:path');
const { chromium, executablePath } = require('./support/browser.cjs').browserRuntime();
const { createHash } = require('node:crypto');
(async () => {
  const out = path.join('artifacts/validation', `s00-ui-fixtures-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  const files = ['app/src/App.tsx', 'app/src/use-desktop-check.ts', 'app/src/use-theme.ts', 'app/src/desktop-contract.ts', 'tests/verify-s00-ui-fixtures.cjs'];
  const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  const report = { mode: 'browser with explicit test-only IPC fixture, not Tauri', before: hashes(), checks: [], errors: [] };
  const check = (name, ok, detail) => report.checks.push({ name, ok, detail });
  const browser = await chromium.launch({ executablePath });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, colorScheme: theme });
      page.on('pageerror', e => report.errors.push(e.message));
      await page.addInitScript(() => {
        window.isTauri = true;
        window.__azcineFixtureCalls = 0;
        window.__TAURI_INTERNALS__ = {
          invoke: (command, args) => {
            if (command !== 'check_desktop') throw new Error('Unexpected fixture command');
            window.__azcineFixtureCalls += 1;
            return new Promise((resolve, reject) => { window.__azcineFixture = { resolve, reject, requestId: args.requestId }; });
          },
        };
      });
      await page.goto('http://127.0.0.1:1420/#settings');
      await page.getByRole('button', { name: '检查桌面连接', exact: true }).click();
      await page.waitForSelector('[data-check-state="loading"]');
      check(`${theme} Given等待IPC Then防重复且显示检查中`, await page.getByRole('button', { name: '检查桌面连接', exact: true }).isDisabled());
      await page.getByRole('button', { name: '检查桌面连接', exact: true }).evaluate(e => { e.click(); e.click(); });
      check(`${theme} Given快速重复操作 Then只发一个请求`, await page.evaluate(() => window.__azcineFixtureCalls === 1));
      await page.screenshot({ path: path.join(out, `${theme}-loading-fixture.png`), fullPage: true });
      await page.locator('nav a[href="#projects"]').click();
      await page.evaluate(() => window.__azcineFixture.reject({ code: 'fixture', message: '测试注入：临时目录不可写，输入与正式记录未改变。' }));
      await page.locator('nav a[href="#settings"]').click();
      await page.waitForSelector('[data-check-state="error"]');
      check(`${theme} Given检查时切页且失败 Then错误保留且可重试`, /测试注入/.test(await page.locator('[data-check-state]').innerText()) && await page.getByRole('button', { name: '检查桌面连接', exact: true }).isEnabled());
      await page.screenshot({ path: path.join(out, `${theme}-error-fixture.png`), fullPage: true });
      await page.getByRole('button', { name: '检查桌面连接', exact: true }).click();
      await page.evaluate(() => window.__azcineFixture.resolve({ requestId: 999, appVersion: 'fixture', sqliteVersion: 'fixture', storage: 'temporary', roundTrip: true, rollback: true }));
      await page.waitForSelector('[data-check-state="error"]');
      check(`${theme} Given错误请求编号 Then不能显示成功`, /其他请求/.test(await page.locator('[data-check-state]').innerText()));
      await page.clock.install();
      await page.getByRole('button', { name: '检查桌面连接', exact: true }).click();
      await page.waitForSelector('[data-check-state="loading"]');
      await page.clock.fastForward(15_001);
      await page.waitForSelector('[data-check-state="error"]');
      check(`${theme} Given无终态响应 When超时 Then明确失败`, /超时/.test(await page.locator('[data-check-state]').innerText()));
      await page.evaluate(() => { const f = window.__azcineFixture; f.resolve({ requestId: f.requestId, appVersion: 'fixture', sqliteVersion: 'fixture', storage: 'temporary', roundTrip: true, rollback: true }); });
      check(`${theme} Given超时后迟到响应 Then不覆盖失败`, await page.locator('[data-check-state]').getAttribute('data-check-state') === 'error');
      await page.close();
    }
    const plain = await browser.newPage();
    await plain.goto('http://127.0.0.1:1420/#settings');
    check('Given纯网页 Then标明未连接且禁用桌面命令', /无桌面连接/.test(await plain.locator('.titlebar').innerText()) && await plain.getByRole('button', { name: '检查桌面连接', exact: true }).isDisabled());
    await plain.close();
  } finally { await browser.close(); }
  report.after = hashes();
  check('source stable', JSON.stringify(report.before) === JSON.stringify(report.after));
  check('no browser errors', report.errors.length === 0, report.errors);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const failures = report.checks.filter(c => !c.ok);
  console.log(JSON.stringify({ out, checks: report.checks.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
