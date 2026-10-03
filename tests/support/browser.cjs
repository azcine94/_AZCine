const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function browserRuntime() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  let modulePath = process.env.PLAYWRIGHT_MODULE || process.env.AZCINE_PLAYWRIGHT;
  if (!modulePath) {
    const cache = path.join(local, 'npm-cache', '_npx');
    const found = fs.existsSync(cache) && fs.readdirSync(cache).map(dir => path.join(cache, dir, 'node_modules', 'playwright')).find(p => fs.existsSync(path.join(p, 'package.json')));
    if (found) modulePath = found;
  }
  if (!modulePath) throw new Error('未找到已有 Playwright；请设置 PLAYWRIGHT_MODULE，不会自动安装。');
  let executablePath = process.env.CHROMIUM_PATH || process.env.AZCINE_CHROMIUM;
  if (!executablePath) {
    const cache = path.join(local, 'ms-playwright');
    const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
    executablePath = dirs.map(dir => path.join(cache, dir, 'chrome-win64', 'chrome.exe')).find(p => fs.existsSync(p));
  }
  if (!executablePath) throw new Error('未找到已有 Chromium；请设置 CHROMIUM_PATH，不会自动安装。');
  return { chromium: require(modulePath).chromium, executablePath };
}
module.exports = { browserRuntime };
