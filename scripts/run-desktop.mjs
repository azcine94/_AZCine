import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { childExitStatus } from './exit-status.mjs';
import { prepareEnvironment, availablePort } from './dev-environment.mjs';
import { acquireLauncherLock } from './launcher-lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'app');
const cargoHome = path.join(root, '.tooling', 'cargo');
const rustupHome = path.join(root, '.tooling', 'rustup');
const cargo = path.join(cargoHome, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
const cli = path.join(app, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const mode = process.argv[2] || 'dev';
// Keep the existing locator, instance lock and repository catalog with dev.
// The base Tauri configuration owns the separate installed-release identity.
const developmentIdentifier = 'com.azcine.workbench';
if (!['dev', 'test:rust'].includes(mode)) throw new Error(`Unsupported development command: ${mode}`);
const mainRoot = prepareEnvironment(root);
const isolatedValidation = mode==='dev' && Boolean(process.env.AZCINE_TEST_CONFIG_DIR);
const stateDirectory = isolatedValidation ? path.join(path.resolve(process.env.AZCINE_TEST_CONFIG_DIR), 'launcher') : path.join(root, '.tooling', 'instance');
mkdirSync(stateDirectory,{recursive:true});
if (!existsSync(cargo) || !existsSync(cli)) {
  console.error('开发依赖尚未安装。请按 README 的项目内工具链说明配置 .tooling/，并运行 npm --prefix app ci。');
  process.exit(1);
}
const env = {
  ...process.env,
  CARGO_HOME: cargoHome,
  RUSTUP_HOME: rustupHome,
  RUSTUP_TOOLCHAIN: '1.99.0-x86_64-pc-windows-msvc',
  CARGO_TARGET_DIR: isolatedValidation ? path.join(stateDirectory,'target') : path.join(app, 'src-tauri', 'target'),
  AZCINE_VITE_CACHE_DIR: isolatedValidation ? path.join(stateDirectory,'vite-cache') : path.join(root,'.tooling','vite-cache'),
  WEBVIEW2_USER_DATA_FOLDER: process.env.WEBVIEW2_USER_DATA_FOLDER || path.join(root, '.tooling', 'webview-dev'),
};
delete env.AZCINE_DEV_PI_DATA_DIR;
if (mode === 'test:rust') {
  delete env.AZCINE_DEV_USE_MAIN_DATA;
  delete env.AZCINE_DEV_INSTANCE_DIR;
}
if (mode === 'dev') {
  const instance = path.join(root, '.tooling', 'dev-instance');
  env.AZCINE_DEV_INSTANCE_DIR = instance;
  // Business data follows the original application locator. All development
  // Worktrees use main's native Pi directory; UI caches remain per Worktree.
  // Explicit validation overrides stay isolated and never use this Pi root.
  env.AZCINE_DEV_USE_MAIN_DATA = '1';
  env.AZCINE_DEV_PI_DATA_DIR = path.join(mainRoot, '.tooling', 'dev-instance', 'data');
  env.WEBVIEW2_USER_DATA_FOLDER = process.env.WEBVIEW2_USER_DATA_FOLDER || path.join(instance, 'webview');
}
// Scope the development profile to the main window. The process-wide WebView2
// override would also force public article windows into that same environment,
// where their separate proxy/incognito options cannot be created.
const webviewDataFolder = env.WEBVIEW2_USER_DATA_FOLDER;
delete env.WEBVIEW2_USER_DATA_FOLDER;
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) delete env[key];
// Remote debugging is opt-in for this owned validation instance only.
delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
if (process.env.AZCINE_CDP_PORT) {
  const cdp = Number(process.env.AZCINE_CDP_PORT);
  if (!Number.isInteger(cdp) || cdp < 1024 || cdp > 65535) throw Error('Invalid validation CDP port.');
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${cdp}`;
}
// Rust is added to this owned child only. No system/user PATH or Pi runtime changes.
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = `${path.dirname(cargo)}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
const lockPath = path.join(stateDirectory, 'launcher.lock');
let vite, devConfig;
if (mode === 'dev') {
  const releaseLock = acquireLauncherLock(lockPath);
  process.once('exit', () => { stopVite(); releaseLock(); });
  for (let attempt = 0; attempt < 4; attempt++) {
    const port = await availablePort();
    vite = spawn(process.execPath, [path.join(app, 'node_modules/vite/bin/vite.js'), '--configLoader', 'runner', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    vite.stdout.pipe(process.stdout); vite.stderr.pipe(process.stderr);
    const ready = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => { stopVite(); reject(Error('Vite 启动超时，未连接其他版本。')); }, 30_000);
      // Vite bolds the port separately in color terminals, inserting ANSI between ':' and the digits.
      vite.stdout.on('data', chunk => { output += chunk.toString(); if (stripVTControlCharacters(output).includes(`http://127.0.0.1:${port}/`)) { clearTimeout(timer); resolve(true); } });
      vite.once('error', error => { clearTimeout(timer); reject(error); }); vite.once('exit', () => { clearTimeout(timer); resolve(false); });
    });
    if (!ready) continue;
    const source = JSON.parse(readFileSync(path.join(app, 'src-tauri/tauri.conf.json'), 'utf8'));
    devConfig = path.join(stateDirectory, 'tauri-dev.json');
    writeFileSync(devConfig, JSON.stringify({ identifier: developmentIdentifier, build: { beforeDevCommand: null, devUrl: `http://127.0.0.1:${port}` }, app: { windows: source.app.windows.map(window => window.label === 'main' ? {...window, title: 'AZCine · 本地开发版', dataDirectory: webviewDataFolder} : window), security: { csp: source.app.security.csp.replaceAll('127.0.0.1:1420', `127.0.0.1:${port}`) } } }, null, 2));
    const isolated = !!(env.AZCINE_TEST_CONFIG_DIR || env.AZCINE_TEST_DEFAULT_ROOT);
    // Report the real locator target without opening the business database or
    // reading Pi credentials. Rust remains responsible for validating it.
    const config = env.AZCINE_TEST_CONFIG_DIR || (isolated ? path.join(root, '.tooling', 'dev-instance', 'config') : path.join(env.LOCALAPPDATA, developmentIdentifier));
    const locatorPath = path.join(config, 'data-root.json');
    let locatedRoot = null;
    if (existsSync(locatorPath)) {
      try { const locator = JSON.parse(readFileSync(locatorPath, 'utf8')); if (typeof locator.root === 'string' && path.isAbsolute(locator.root)) locatedRoot = locator.root; }
      catch { /* Rust displays the original locator error; no empty-root fallback. */ }
    }
    const data = env.AZCINE_TEST_DEFAULT_ROOT || locatedRoot || (isolated ? path.join(root, '.tooling', 'dev-instance', 'data') : null);
    const state = { root, launcherPid: process.pid, vitePid: vite.pid, port, config, data, dataMode: isolated ? 'isolated-validation' : 'original-main', piData: isolated ? data : env.AZCINE_DEV_PI_DATA_DIR, piDataMode: isolated ? 'isolated-validation' : 'shared-main', webview: webviewDataFolder };
    writeFileSync(path.join(stateDirectory, 'run-state.json'), JSON.stringify(state, null, 2));
    console.log('AZCine Worktree 开发实例：' + JSON.stringify(state));
    break;
  }
  if (!devConfig) throw Error('开发端口竞争重试失败，未连接其他版本。');
}
const command = mode === 'dev' ? process.execPath : cargo;
const args = mode === 'dev' ? [cli, 'dev', '--config', devConfig, ...process.argv.slice(3)] : ['test', '--locked', '--manifest-path', path.join(app, 'src-tauri', 'Cargo.toml'), ...process.argv.slice(3)];
const child = spawn(command, args, { cwd: app, env, stdio: 'inherit', windowsHide: true });
child.once('spawn', () => {
  if (mode === 'dev') {
    const statePath=path.join(stateDirectory,'run-state.json');
    const state=JSON.parse(readFileSync(statePath,'utf8'));
    writeFileSync(statePath,JSON.stringify({...state,cliPid:child.pid},null,2));
  }
});
function stopVite() {
  if (!vite || vite.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(vite.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else vite.kill('SIGTERM');
}
vite?.once('exit', () => { if (child.exitCode === null) { process.exitCode = 1; stop('SIGTERM'); } });
let stopping = false;
let shutdownTimer;
function stop(signal) {
  if (stopping || !child.pid) return;
  stopping = true;
  if (process.platform === 'win32') {
    // Windows broadcasts console Ctrl+C to this tree too. Let Tauri clean up first.
    shutdownTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // Bounded fallback: exact owned PID + descendants, never executable name.
      const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
      if (result.error || result.status !== 0) {
        try { process.kill(child.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') return; }
        console.error(`停止开发进程失败：${result.error?.message || result.stderr.trim() || result.status}`);
        process.exitCode = 1;
      }
    }, 2_000);
  } else child.kill(signal);
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  clearTimeout(shutdownTimer);
  stopVite();
  process.exitCode = childExitStatus({ mode, stopping, code, signal, failureCode: process.exitCode });
  if (mode === 'dev') {
    const statePath=path.join(stateDirectory,'run-state.json');
    const state=JSON.parse(readFileSync(statePath,'utf8'));
    writeFileSync(statePath,JSON.stringify({...state,stoppedAt:new Date().toISOString(),exitCode:process.exitCode},null,2));
  }
});
