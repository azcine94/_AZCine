const { chromium, executablePath } = require('./support/browser.cjs').browserRuntime();
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');

(async () => {
  const out = path.join('artifacts/validation', `s00-design-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  const overflow = fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js', 'utf8');
  const files = ['design/s00-foundation.html', 'design/s00-foundation.js', 'design/s00-foundation.css', 'design/tokens.css', 'design/base.css', 'design/workspace.css', 'tests/verify-s00-design.cjs', 'tests/support/browser.cjs'];
  const hashes = () => Object.fromEntries(files.map(f => [f, createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
  const report = { scope: 'S00 static design only, not desktop', before: hashes(), checks: [], errors: [] };
  const check = (name, ok, detail) => report.checks.push({ name, ok, detail });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768]]) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme });
      page.on('pageerror', e => report.errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve('design/s00-foundation.html')).href + '#settings');
      async function verifyRoute(expected, action, focus = true) {
        await page.waitForFunction(route => location.hash === `#${route}` && document.querySelector('main').dataset.page === route, expected);
        const routeState = await page.evaluate(() => ({ hash: location.hash, page: document.querySelector('main').dataset.page, current: [...document.querySelectorAll('#nav [aria-current="page"]')].map(a => a.hash), titleFocused: document.activeElement === document.querySelector('h1') }));
        check(`${theme}/${width} Given${action} Then路由高亮与焦点一致`, routeState.hash === `#${expected}` && routeState.page === expected && routeState.current.length === 1 && routeState.current[0] === `#${expected}` && (!focus || routeState.titleFocused), routeState);
      }
      for (const route of ['today', 'projects', 'news', 'models', 'ideas', 'agent', 'jobs', 'settings']) {
        await page.locator(`#nav a[href="#${route}"]`).click();
        await page.waitForFunction(r => document.querySelector('main').dataset.page === r, route);
        const prefix = `${theme}/${width}/${route}`;
        const issues = await page.evaluate(overflow);
        check(`${prefix} no overflow`, issues.length === 0, issues);
        await verifyRoute(route, `跨页到${route}`);
        const metrics = await page.evaluate(() => {
          const s = document.querySelector('.side').getBoundingClientRect();
          const m = document.querySelector('main').getBoundingClientRect();
          const h = document.querySelector('h1').getBoundingClientRect();
          const meta = document.querySelector('.page-heading .meta').getBoundingClientRect();
          return { right: innerWidth - m.right, left: s.left, top: s.top - m.top, bottom: s.bottom - m.bottom, headingCenter: (h.top + h.bottom - meta.top - meta.bottom) / 2 };
        });
        check(`${prefix} edges and heading`, metrics.right === 16 && metrics.left === 16 && Math.abs(metrics.top) < 1 && Math.abs(metrics.bottom) < 1 && Math.abs(metrics.headingCenter) < 1, metrics);
        if (['today', 'settings'].includes(route)) await page.screenshot({ path: path.join(out, `${theme}-${width}-${route}.png`), fullPage: true });
      }
      await page.locator('summary').focus();
      await page.keyboard.press('Enter');
      check(`${theme}/${width} keyboard expands states`, await page.locator('details').evaluate(e => e.open));
      for (const state of ['loading', 'success', 'error']) {
        await page.locator(`button[data-state=${state}]`).click();
        const issues = await page.evaluate(overflow);
        check(`${theme}/${width}/${state} state and overflow`, await page.locator('#check').getAttribute('data-state') === state && issues.length === 0, issues);
      }
      await page.locator('#nav a[href="#projects"]').click(); await verifyRoute('projects', '跨页项目');
      await page.locator('#nav a[href="#ideas"]').click(); await verifyRoute('ideas', '跨页灵感');
      await page.goBack(); await verifyRoute('projects', '浏览器后退');
      await page.goForward(); await verifyRoute('ideas', '浏览器前进');
      await page.reload(); await verifyRoute('ideas', '刷新深链接');
      const originalTheme = await page.locator('html').getAttribute('data-theme');
      await page.locator('#theme').focus(); await page.keyboard.press('Enter');
      check(`${theme}/${width} keyboard theme`, await page.locator('html').getAttribute('data-theme') !== originalTheme);
      await verifyRoute('ideas', '切换主题不改页面', false);
      check(`${theme}/${width} theme keeps focus`, await page.locator('#theme').evaluate(e => document.activeElement === e));
      await page.reload();
      check(`${theme}/${width} theme persisted`, await page.locator('html').getAttribute('data-theme') !== originalTheme);
      await verifyRoute('ideas', '切主题后刷新');
      await page.close();
    }
  } finally { await browser.close(); }
  report.after = hashes();
  check('source stable', JSON.stringify(report.before) === JSON.stringify(report.after));
  check('no browser errors', report.errors.length === 0, report.errors);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const failures = report.checks.filter(c => !c.ok);
  console.log(JSON.stringify({ out, checks: report.checks.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
