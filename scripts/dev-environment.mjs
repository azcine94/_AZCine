import { existsSync, readFileSync, mkdirSync, symlinkSync, realpathSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';

export function prepareEnvironment(root) {
  const common = path.resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim());
  const main = path.dirname(common);
  const equal = file => existsSync(path.join(main, file)) && readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n') === readFileSync(path.join(main, file), 'utf8').replaceAll('\r\n', '\n');
  const declarations = base => {
    const pkg = JSON.parse(readFileSync(path.join(base,'app/package.json'),'utf8'));
    return JSON.stringify(Object.fromEntries(['dependencies','devDependencies','optionalDependencies','peerDependencies','overrides','engines'].map(key=>[key,pkg[key]??null])));
  };
  function link(relative, required = true) {
    const target = path.join(main, relative), destination = path.join(root, relative);
    try {
      const existing = lstatSync(destination);
      if (!existing.isDirectory() && !existing.isSymbolicLink()) throw Error(`已有 ${relative} 不是目录，已保留。`);
      if (existing.isSymbolicLink() && (!existsSync(target) || realpathSync(destination).toLowerCase() !== realpathSync(target).toLowerCase())) throw Error(`已有 ${relative} 链接不属于本仓库主环境，已保留且停止。`);
      return;
    } catch(error) { if (error.code !== 'ENOENT') throw error; }
    if (!existsSync(target)) { if (required) throw Error(`主环境缺少 ${relative}，未安装或覆盖任何目录。`); return; }
    mkdirSync(path.dirname(destination), { recursive: true });
    symlinkSync(realpathSync(target), destination, process.platform === 'win32' ? 'junction' : 'dir');
  }
  if (main !== root) {
    if (!equal('rust-toolchain.toml') || !equal('app/src-tauri/Cargo.lock')) throw Error('分支 Rust 锁与主环境不一致，请准备匹配环境。');
    for (const item of ['rustup', 'cargo/bin', 'cargo/registry']) link(`.tooling/${item}`);
    link('.tooling/cargo/git', false);
    if (declarations(root) !== declarations(main) || !equal('app/package-lock.json')) throw Error('分支 Node 依赖与主环境不一致，未链接或安装。');
    link('app/node_modules');
    if (!equal('app/resources/runtime-lock.json')) throw Error('应用 runtime 锁不一致，未复用。');
    link('app/resources/runtime');
  }
  mkdirSync(path.join(root, '.tooling', 'instance'), { recursive: true });
}

export async function availablePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(error => error ? reject(error) : resolve(port)); });
  });
}
