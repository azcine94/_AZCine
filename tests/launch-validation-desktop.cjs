// Explicit application test launch. No fixture data or credential inheritance is enabled.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validationRun } = require('./support/validation-run.cjs');
const run = process.env.AZCINE_VALIDATION_RUN ? path.resolve(process.env.AZCINE_VALIDATION_RUN) : validationRun('s01-desktop').out;
const validation = path.resolve('artifacts/validation');
if (!run.startsWith(validation + path.sep)) throw new Error('Validation run must be within artifacts/validation.');
fs.mkdirSync(run, { recursive: true });
const port = Number(process.env.AZCINE_CDP_PORT || 9224);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid explicit CDP port.');
const launchId = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(run, `desktop-${launchId}.log`);
const fd = fs.openSync(logFile, 'wx');
const env = {
  ...process.env,
  AZCINE_TEST_CONFIG_DIR: path.join(run, 'local-config'),
  AZCINE_TEST_DEFAULT_ROOT: path.join(run, 'data'),
  WEBVIEW2_USER_DATA_FOLDER: path.join(run, 'webview-profile'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
};
const webPort = Number(process.env.AZCINE_WEB_PORT || 1420);
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) throw new Error('Invalid validation-only web port.');
let devCommand = 'npm run dev';
if (webPort !== 1420) {
  // A second owned dev window must not stop/reuse the user's view or its profile.
  const config = path.join(run, 'validation-tauri.json');
  const source = JSON.parse(fs.readFileSync('app/src-tauri/tauri.conf.json', 'utf8'));
  fs.writeFileSync(config, JSON.stringify({ build: { devUrl: `http://127.0.0.1:${webPort}`,
    beforeDevCommand: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${webPort} --strictPort` },
    app: { security: { csp: source.app.security.csp.replaceAll('127.0.0.1:1420', `127.0.0.1:${webPort}`) } } }, null, 2), { flag: 'wx' });
  const argument = path.relative(path.resolve('app'), config).replaceAll('\\', '/');
  if (/\s/.test(argument)) throw new Error('Validation config argument must have an ASCII path without whitespace.');
  devCommand += ` -- --config ${argument} --no-watch`;
  env.CARGO_TARGET_DIR = path.join(run, 'cargo-target');
}
const child = spawn('cmd.exe', ['/d', '/c', devCommand], { cwd: path.resolve('.'), env, stdio: ['ignore', fd, fd], windowsHide: false });
const record = { mode: 'real root npm run dev; isolated retained test roots, not model/IPC fixture', run, rootPid: child.pid, port, webPort, logFile, started: new Date().toISOString() };
const receipt = path.join(run, `launch-${launchId}.json`);
fs.writeFileSync(receipt, JSON.stringify(record, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...record, receipt }, null, 2));
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  fs.closeSync(fd);
  fs.writeFileSync(path.join(run, `exit-${launchId}.json`), JSON.stringify({ code, signal, ended: new Date().toISOString() }, null, 2), { flag: 'wx' });
  process.exitCode = code ?? 1;
});
