import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childExitStatus } from './exit-status.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'app');
const cargoHome = path.join(root, '.tooling', 'cargo');
const rustupHome = path.join(root, '.tooling', 'rustup');
const cargo = path.join(cargoHome, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
const cli = path.join(app, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const mode = process.argv[2] || 'dev';
if (!['dev', 'test:rust'].includes(mode)) throw new Error(`Unsupported development command: ${mode}`);
if (!existsSync(cargo) || !existsSync(cli)) {
  console.error('开发依赖尚未安装。请按 README 的项目内工具链说明配置 .tooling/，并运行 npm --prefix app ci。');
  process.exit(1);
}
const env = {
  ...process.env,
  CARGO_HOME: cargoHome,
  RUSTUP_HOME: rustupHome,
  RUSTUP_TOOLCHAIN: '1.99.0-x86_64-pc-windows-msvc',
  WEBVIEW2_USER_DATA_FOLDER: process.env.WEBVIEW2_USER_DATA_FOLDER || path.join(root, '.tooling', 'webview-dev'),
};
// Rust is added to this owned child only. No system/user PATH or Pi runtime changes.
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = `${path.dirname(cargo)}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
const command = mode === 'dev' ? process.execPath : cargo;
const args = mode === 'dev' ? [cli, 'dev', ...process.argv.slice(3)] : ['test', '--locked', '--manifest-path', path.join(app, 'src-tauri', 'Cargo.toml'), ...process.argv.slice(3)];
const child = spawn(command, args, { cwd: app, env, stdio: 'inherit', windowsHide: false });
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
  process.exitCode = childExitStatus({ mode, stopping, code, signal, failureCode: process.exitCode });
});
