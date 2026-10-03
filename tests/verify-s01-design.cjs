const { chromium, executablePath } = require('./support/browser.cjs').browserRuntime();
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const out = path.join('artifacts/validation', `s01-design-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(out, 'browser-profile'), { executablePath, headless: true });
  const report = { mode: 'static design only', checks: [], errors: [] };
  const check = (name, ok, details) => report.checks.push({ name, ok, details });
  const overflow = fs.readFileSync('E:/skills-manager/product_6.0/.agents/skills/design/scripts/overflow-check.js', 'utf8');
  try {
    const kit = await context.newPage();
    await kit.goto(pathToFileURL('E:/skills-manager/product_6.0/.agents/skills/design/starter/kit.html').href);
    await kit.screenshot({ path: path.join(out, 'factory-kit.png'), fullPage: true }); await kit.close();
    for (const theme of ['light', 'dark']) for (const [width, height] of [[1440,900],[1280,800],[1024,768]]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height });
      page.on('pageerror', e => report.errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve('design/s01-storage.html')).href);
      if (theme === 'dark') await page.locator('#theme').click();
      for (const route of ['setup','today','settings']) {
        await page.locator(`nav a[href="#${route}"]`).click();
        await page.waitForSelector(`main[data-page="${route}"]`);
        check(`${theme}/${width}/${route} overflow`, (await page.evaluate(overflow)).length === 0);
        const edges = await page.evaluate(() => {
          const side = document.querySelector('.side').getBoundingClientRect(), main = document.querySelector('main').getBoundingClientRect();
          const title = document.querySelector('h1').getBoundingClientRect(), meta = document.querySelector('.page-heading .meta').getBoundingClientRect();
          return { left: side.left, right: document.documentElement.clientWidth-main.right, bottom: side.bottom-main.bottom, baseline: (title.top+title.bottom-meta.top-meta.bottom)/2 };
        });
        check(`${theme}/${width}/${route} edges`, edges.left === edges.right && Math.abs(edges.bottom)<1 && Math.abs(edges.baseline)<1, edges);
        await page.locator('summary').focus(); await page.keyboard.press('Enter');
        for (const state of ['loading','error','success','empty']) {
          await page.locator(`[data-state="${state}"]`).click();
          check(`${theme}/${width}/${route}/${state}`, await page.locator('.feedback').getAttribute('data-kind') === state && (await page.evaluate(overflow)).length === 0);
        }
        await page.locator('[data-state="error"]').click();
        await page.screenshot({ path: path.join(out, `${theme}-${width}-${route}.png`), fullPage: true });
      }
      await page.close();
    }
  } finally { await context.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
  const failures = report.checks.filter(c => !c.ok);
  console.log(JSON.stringify({ out, checks: report.checks.length, failures, errors: report.errors }, null, 2));
  if (failures.length || report.errors.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
