// Attach to an explicitly launched AZCine WebView2. Never launches another browser as a substitute.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('./support/browser.cjs').browserRuntime();
const port = Number(process.env.AZCINE_CDP_PORT || 9223);
const ownerPid = Number(process.env.AZCINE_OWNER_PID);
if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error('AZCINE_OWNER_PID must identify the owned AZCine executable.');
const nativeScript = path.resolve('tests/support/native-window.ps1');
function native(action, width = 1440, height = 900) {
  return JSON.parse(execFileSync('pwsh.exe', ['-NoProfile', '-File', nativeScript, '-OwnerPid', String(ownerPid), '-Action', action, '-Width', String(width), '-Height', String(height)], { encoding: 'utf8' }).trim());
}
const sourceFiles = [];
for (const root of ['app/src', 'app/src-tauri/src', 'scripts']) {
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else sourceFiles.push(file); } };
  walk(root);
}
sourceFiles.push('app/package-lock.json', 'app/src-tauri/Cargo.lock', 'app/src-tauri/tauri.conf.json', 'tests/verify-s00-desktop.cjs', 'tests/support/native-window.ps1', 'tests/support/find-native-window.ps1', 'tests/support/inspect-contrast.js');
const hashes = () => Object.fromEntries(sourceFiles.map(f => [f.replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));

async function todayLayout(page) {
  return page.evaluate(() => {
    const selectors = ['.review-card', '.today-tasks-card', '.today-delivery-card', '.today-news-card'];
    const areas = selectors.map(selector => ({ selector, count: document.querySelectorAll(selector).length }));
    const exists = areas.every(area => area.count === 1);
    if (!exists) return { exists: false, areas, equalWidth: false, ordered: false };
    const [review, tasks, delivery, news] = selectors.map(selector => document.querySelector(selector).getBoundingClientRect());
    return { exists: true, areas, equalWidth: Math.abs(tasks.width - delivery.width) < 1, ordered: review.bottom < tasks.top && Math.abs(tasks.top - delivery.top) < 1 && Math.max(tasks.bottom, delivery.bottom) < news.top };
  });
}

(async () => {
  const out = path.join('artifacts/validation', `s00-desktop-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  const report = { mode: 'actual Tauri WebView2 via CDP, native Win32 resizing', native: native('measure'), before: hashes(), checks: [], errors: [] };
  const check = (name, ok, detail) => report.checks.push({ name, ok, detail });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().startsWith('http://127.0.0.1:1420'));
  if (!page) throw new Error('Owned AZCine app page not found. Do not fall back to a browser page.');
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  const overflow = fs.readFileSync(process.env.AZCINE_OVERFLOW_SCRIPT || 'E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js', 'utf8');
  check('Given真实桌面 When读取运行环境 ThenTauri IPC存在', await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__)));
  try {
    await page.waitForSelector('h1');
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /切换.*色/ }).click();
      for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768]]) {
        native('resize', width, height);
        await page.waitForFunction(({ width, height }) => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1, { width, height });
        for (const route of ['today', 'projects', 'news', 'models', 'ideas', 'agent', 'jobs', 'settings']) {
          const current = await page.locator('main').getAttribute('data-page');
          await page.locator(`nav a[href="#${route}"]`).click();
          await page.waitForFunction(r => document.querySelector('main').dataset.page === r, route);
          const prefix = `${theme}/${width}/${route}`;
          check(`${prefix} Given切页 Then当前导航正确`, await page.locator(`nav a[href="#${route}"]`).getAttribute('aria-current') === 'page');
          if (current !== route) check(`${prefix} Given切页 Then标题接收焦点`, await page.locator('h1').evaluate(e => document.activeElement === e));
          const issues = await page.evaluate(overflow);
          check(`${prefix} Given三尺寸 Then没有横向溢出或裁按钮`, issues.length === 0, issues);
          const layout = await page.evaluate(() => {
            const side = document.querySelector('.side').getBoundingClientRect();
            const main = document.querySelector('main').getBoundingClientRect();
            const heading = document.querySelector('h1').getBoundingClientRect();
            const meta = document.querySelector('.page-heading .meta').getBoundingClientRect();
            return { viewport: [innerWidth, innerHeight], scrollbar: innerWidth - document.documentElement.clientWidth, right: document.documentElement.clientWidth - main.right, left: side.left, top: main.top - side.top, bottom: main.bottom - side.bottom, headingCenter: (heading.top + heading.bottom - meta.top - meta.bottom) / 2 };
          });
          check(`${prefix} Given通用壳 Then边缘与标题基线一致`, layout.left === 16 && layout.right === 16 && Math.abs(layout.top) < 1 && Math.abs(layout.bottom) < 1 && Math.abs(layout.headingCenter) < 1, layout);
          if (route === 'today') {
            const home = await todayLayout(page);
            check(`${prefix} Given首页B Then四区域齐全且双栏顺序正确`, home.exists && home.equalWidth && home.ordered, home);
          }
          const targets = await page.locator('button:visible, nav a:visible, main a:visible').evaluateAll(elements => elements.filter(e => { const r = e.getBoundingClientRect(); return r.height < 40 || r.width < 40; }).map(e => e.textContent));
          check(`${prefix} Given可点控件 Then目标至少40px`, targets.length === 0, targets);
          const visual = await page.evaluate(fs.readFileSync('tests/support/inspect-contrast.js', 'utf8'));
          check(`${prefix} Given两主题 Then文字对比度4.5与卡片不重叠`, visual.low.length === 0 && visual.overlap.length === 0, visual);
          if (route === 'today' || route === 'settings') await page.screenshot({ path: path.join(out, `${theme}-${width}-${route}.png`), fullPage: true });
        }
        await page.getByRole('button', { name: '检查桌面连接', exact: true }).click();
        await page.waitForSelector('[data-check-state="success"]');
        const text = await page.locator('[data-check-state]').innerText();
        check(`${theme}/${width} Given真实Rust检查 Then临时SQLite通过`, /SQLite/.test(text) && /回滚/.test(text) && /正常/.test(text), text);
      }
    }
    // Real backend rejection, without simulating a successful command.
    const rejected = await page.evaluate(async () => {
      try { await window.__TAURI_INTERNALS__.invoke('check_desktop', { requestId: 0 }); return false; }
      catch (error) { return error.code === 'invalid_request'; }
    });
    check('Given无效参数 When真实IPC ThenRust拒绝', rejected);
    await page.locator('nav a[href="#projects"]').click();
    await page.waitForSelector('main[data-page="projects"]');
    await page.locator('nav a[href="#ideas"]').click();
    await page.waitForSelector('main[data-page="ideas"]');
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#projects' && document.querySelector('main').dataset.page === 'projects' && document.activeElement === document.querySelector('h1')); 
    check('Given前进后退 When返回 Then页面与焦点恢复', await page.locator('h1').evaluate(e => document.activeElement === e));
    await page.goForward(); await page.waitForSelector('main[data-page="ideas"]');
    await page.reload(); await page.waitForSelector('main[data-page="ideas"]');
    check('Given刷新深链接 Then仍在灵感页', await page.locator('h1').innerText() === '灵感');
    check('Given已选深色 When重载 Then偏好保留', await page.locator('html').getAttribute('data-theme') === 'dark');
    await page.locator('nav a[href="#settings"]').focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('main[data-page="settings"]');
    await page.getByRole('button', { name: /切换.*色/ }).focus(); await page.keyboard.press('Enter');
    check('Given键盘导航主题 Then均可操作且焦点可见', await page.locator('html').getAttribute('data-theme') === 'light' && await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
    await page.getByRole('button', { name: '检查桌面连接', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('[data-check-state="success"]');
    await page.screenshot({ path: path.join(out, 'desktop-check-success.png'), fullPage: true });
    // Failure/loading UI is exercised in a separate clearly labelled browser fixture.
    // Tauri's real invoke property is immutable; never patch its runtime to manufacture errors.
    check('Given成功检查 Then明确显示真实SQLite版本', /SQLite 3\.53\.2/.test(await page.locator('[data-check-state]').innerText()));
    // Negative control: prove this assertion fails when any one required home region is missing.
    // Restore the exact DOM node immediately; no app file/state is modified.
    await page.locator('nav a[href="#today"]').click();
    await page.waitForSelector('main[data-page="today"]');
    for (const selector of ['.review-card', '.today-tasks-card', '.today-delivery-card', '.today-news-card']) {
      await page.evaluate(selector => {
        const node = document.querySelector(selector);
        window.__removedRegion = { node, parent: node.parentNode, next: node.nextSibling };
        node.remove();
      }, selector);
      try {
        const missing = await todayLayout(page);
        check(`Given首页缺${selector} Then布局验收必须拒绝`, !missing.exists && !missing.ordered && !missing.equalWidth, missing);
      } finally {
        await page.evaluate(() => { const { node, parent, next } = window.__removedRegion; parent.insertBefore(node, next); delete window.__removedRegion; });
      }
    }
    report.after = hashes();
    check('Given验证期间 Then被测源码未改变', JSON.stringify(report.before) === JSON.stringify(report.after));
    check('Given真实窗口验证 Then无页面错误', report.errors.length === 0, report.errors);
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); // Disconnects this CDP client; lifecycle tested separately with owned native WM_CLOSE.
  }
  const failures = report.checks.filter(check => !check.ok);
  console.log(JSON.stringify({ out, checks: report.checks.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
