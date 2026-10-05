import { existsSync, readFileSync, mkdirSync, symlinkSync, realpathSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';

export function prepareEnvironment(root) {
  root = path.resolve(root);
  const common = path.resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim());
  const main = path.dirname(common);
  const equal = file => existsSync(path.join(main, file)) && readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n') === readFileSync(path.join(main, file), 'utf8').replaceAll('\r\n', '\n');
  const declarations = base => {
    const pkg = JSON.parse(readFileSync(path.join(base,'app/package.json'),'utf8'));
    return JSON.stringify(Object.fromEntries(['dependencies','devDependencies','optionalDependencies','peerDependencies','overrides','engines'].map(key=>[key,pkg[key]??null])));
  };
  const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const rootPath = canonical(realpathSync(root));
  function inspect(relative) {
    const target = path.join(main, relative), destination = path.join(root, relative);
    // Parent junctions must not turn a whole Cargo Home/app directory into shared state.
    for (let parent = path.dirname(destination); parent !== root; parent = path.dirname(parent)) {
      try { if (lstatSync(parent).isSymbolicLink()) throw Error(`已有 ${relative} 的上级目录是链接，已保留且停止。`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try {
      const existing = lstatSync(destination);
      if (!existing.isDirectory() && !existing.isSymbolicLink()) throw Error(`已有 ${relative} 不是目录，已保留。`);
      if (existing.isSymbolicLink()) {
        if (!existsSync(target) || canonical(realpathSync(destination)) !== canonical(realpathSync(target))) throw Error(`已有 ${relative} 链接不属于本仓库主环境，已保留且停止。`);
        return 'shared';
      }
      if (!canonical(realpathSync(destination)).startsWith(rootPath + path.sep)) throw Error(`已有 ${relative} 不在本工作目录内，已保留且停止。`);
      return 'owned';
    } catch(error) { if (error.code !== 'ENOENT') throw error; }
    return 'missing';
  }
  function link(relative, required = true) {
    const target = path.join(main, relative), destination = path.join(root, relative);
    if (!existsSync(target)) { if (required) throw Error(`主环境缺少 ${relative}，未安装或覆盖任何目录。`); return; }
    mkdirSync(path.dirname(destination), { recursive: true });
    symlinkSync(realpathSync(target), destination, process.platform === 'win32' ? 'junction' : 'dir');
  }
  if (canonical(realpathSync(main)) !== rootPath) {
    const rust = ['.tooling/rustup', '.tooling/cargo/bin', '.tooling/cargo/registry'];
    const resources = [...rust, '.tooling/cargo/git', 'app/node_modules', 'app/resources/runtime'];
    const states = Object.fromEntries(resources.map(relative => [relative, inspect(relative)]));
    const shareRust = rust.some(relative => states[relative] !== 'owned') || states['.tooling/cargo/git'] === 'shared';
    const shareNode = states['app/node_modules'] !== 'owned';
    const shareRuntime = states['app/resources/runtime'] !== 'owned';
    if (shareRust && (!equal('rust-toolchain.toml') || !equal('app/src-tauri/Cargo.lock'))) throw Error('分支 Rust 锁与主环境不一致，请准备独立匹配环境。');
    if (shareNode && (declarations(root) !== declarations(main) || !equal('app/package-lock.json'))) throw Error('分支 Node 依赖与主环境不一致，未链接或安装。');
    if (shareRuntime && !equal('app/resources/runtime-lock.json')) throw Error('应用 runtime 锁不一致，未复用。');
    for (const relative of resources) {
      if (states[relative] !== 'missing') continue;
      if (relative === '.tooling/cargo/git' && !shareRust) continue;
      link(relative, relative !== '.tooling/cargo/git');
    }
  }
  mkdirSync(path.join(root, '.tooling', 'instance'), { recursive: true });
  return main;
}

export async function availablePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(error => error ? reject(error) : resolve(port)); });
  });
}
