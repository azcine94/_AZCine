import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, lstatSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareEnvironment } from '../scripts/dev-environment.mjs';

const main = fileURLToPath(new URL('../', import.meta.url));
// Retain these synthetic resource-selection fixtures; they are not executable toolchains.
const evidence = path.join(main, 'artifacts/validation/dev-environment');
mkdirSync(evidence, { recursive: true });
const run = mkdtempSync(path.join(evidence, 'run-'));
const declarations = ['rust-toolchain.toml', 'app/src-tauri/Cargo.lock', 'app/package.json', 'app/package-lock.json', 'app/resources/runtime-lock.json'];
const resources = ['.tooling/rustup', '.tooling/cargo/bin', '.tooling/cargo/registry', 'app/node_modules', 'app/resources/runtime'];
function fixture(name, owned = true) {
  const root = path.join(run, name);
  for (const relative of declarations) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    copyFileSync(path.join(main, relative), path.join(root, relative));
  }
  if (owned) for (const relative of resources) mkdirSync(path.join(root, relative), { recursive: true });
  return root;
}
function mismatch(root, relative) { writeFileSync(path.join(root, relative), readFileSync(path.join(root, relative), 'utf8') + '\nbranch fixture difference\n'); }
function junction(target, destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
}

test('independent directories permit different Rust, Node and runtime versions without sharing optional caches', () => {
  const root = fixture('owned-different');
  for (const relative of declarations.filter(file => file !== 'app/package.json')) mismatch(root, relative);
  const pkg = JSON.parse(readFileSync(path.join(root, 'app/package.json'), 'utf8'));
  pkg.dependencies = { ...pkg.dependencies, 'fixture-only': '1.0.0' };
  writeFileSync(path.join(root, 'app/package.json'), JSON.stringify(pkg));
  prepareEnvironment(root);
  for (const relative of resources) assert.equal(lstatSync(path.join(root, relative)).isSymbolicLink(), false);
  assert.equal(existsSync(path.join(root, '.tooling/cargo/git')), false);
  assert.equal(existsSync(path.join(root, '.tooling/instance')), true);
});

test('matching missing resources link only to this repository main environment', () => {
  const root = fixture('matching-missing', false);
  prepareEnvironment(root);
  for (const relative of resources) {
    assert.equal(lstatSync(path.join(root, relative)).isSymbolicLink(), true);
    assert.equal(realpathSync(path.join(root, relative)), realpathSync(path.join(main, relative)));
  }
  prepareEnvironment(root); // Existing valid links remain usable.
});

for (const [label, relative, pattern] of [
  ['Rust', 'app/src-tauri/Cargo.lock', /Rust 锁/],
  ['Node', 'app/package-lock.json', /Node 依赖/],
  ['runtime', 'app/resources/runtime-lock.json', /runtime 锁/],
]) test(`missing shared ${label} with a different lock rejects before creating any links`, () => {
  const root = fixture(`missing-${label}`, false);
  mismatch(root, relative);
  assert.throws(() => prepareEnvironment(root), pattern);
  for (const resource of resources) assert.equal(existsSync(path.join(root, resource)), false);
});

test('an existing shared resource cannot bypass version comparison', () => {
  const root = fixture('shared-rust', false);
  junction(path.join(main, '.tooling/rustup'), path.join(root, '.tooling/rustup'));
  mismatch(root, 'rust-toolchain.toml');
  assert.throws(() => prepareEnvironment(root), /Rust 锁/);
  assert.equal(realpathSync(path.join(root, '.tooling/rustup')), realpathSync(path.join(main, '.tooling/rustup')));
});

test('foreign links are rejected and preserved', () => {
  const root = fixture('foreign-link', false);
  const foreign = path.join(run, 'foreign-node');
  mkdirSync(foreign);
  junction(foreign, path.join(root, 'app/node_modules'));
  assert.throws(() => prepareEnvironment(root), /链接不属于本仓库/);
  assert.equal(realpathSync(path.join(root, 'app/node_modules')), realpathSync(foreign));
});

test('sharing the whole Cargo Home through a parent junction is rejected', () => {
  const root = fixture('cargo-home', false);
  junction(path.join(main, '.tooling/cargo'), path.join(root, '.tooling/cargo'));
  assert.throws(() => prepareEnvironment(root), /上级目录是链接/);
  assert.equal(lstatSync(path.join(root, '.tooling/cargo')).isSymbolicLink(), true);
});

test('a resource under an ancestor junction cannot masquerade as an independent directory', () => {
  const root = fixture('ancestor-app', false);
  const foreign = path.join(run, 'foreign-tooling');
  mkdirSync(path.join(foreign, 'rustup'), { recursive: true });
  junction(foreign, path.join(root, '.tooling'));
  assert.throws(() => prepareEnvironment(root), /上级目录是链接/);
  assert.equal(realpathSync(path.join(root, '.tooling/rustup')), realpathSync(path.join(foreign, 'rustup')));
});
