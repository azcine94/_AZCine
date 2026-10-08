// Build the installed application with repository-owned tools and pinned runtime.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareEnvironment } from './dev-environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
prepareEnvironment(root);
const app = path.join(root, 'app');
const lock = JSON.parse(readFileSync(path.join(app, 'resources/runtime-lock.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(app, 'src-tauri/tauri.conf.json'), 'utf8'));
const relative = `../resources/runtime/${lock.directory}/`;
if (config.bundle?.resources?.[relative] !== `runtime/${lock.directory}/`) throw Error('正式打包资源与 runtime 锁不一致。');
const runtime = path.join(app, 'resources/runtime', lock.directory);
for (const key of ['node', 'pi', 'packageLock']) {
  const hash = createHash('sha256').update(readFileSync(path.join(runtime, lock[key]))).digest('hex');
  if (hash !== lock.entrySha256[key]) throw Error(`应用自有 runtime 校验失败：${key}`);
}
if (!existsSync(path.join(runtime, 'runtime-manifest.json'))) throw Error('缺少 runtime 安装清单。');
const cargoHome = path.join(root, '.tooling/cargo');
const env = { ...process.env, CARGO_HOME: cargoHome, RUSTUP_HOME: path.join(root, '.tooling/rustup'),
  RUSTUP_TOOLCHAIN: '1.99.0-x86_64-pc-windows-msvc',
  CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(app, 'src-tauri/target'),
  AZCINE_VITE_CACHE_DIR: path.join(root, '.tooling/vite-cache') };
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === 'path' || key.startsWith('AZCINE_DEV_') || key.startsWith('AZCINE_TEST_') ||
      ['NODE_OPTIONS','NODE_PATH','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER'].includes(key)) delete env[key];
}
env.PATH = [path.join(cargoHome, 'bin'), process.env.PATH || process.env.Path || ''].join(path.delimiter);
const child = spawn(process.execPath, [path.join(app, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', ...process.argv.slice(2)],
  { cwd: app, env, stdio: 'inherit', windowsHide: true });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
