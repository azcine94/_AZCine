// Shared by current application tests. All evidence stays in a unique project-local run.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
function validationRun(prefix, roots = ['app/src', 'app/src-tauri/src', 'scripts']) {
  const out = path.resolve('artifacts/validation', `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  const files = [];
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else files.push(file); } }
  roots.forEach(root => fs.statSync(root).isDirectory() ? walk(root) : files.push(root));
  for (const file of ['app/package-lock.json', 'app/src-tauri/Cargo.lock', 'app/src-tauri/tauri.conf.json', 'app/src-tauri/build.rs', 'app/src-tauri/capabilities/main.json']) if (!files.includes(file)) files.push(file);
  const hashes = () => Object.fromEntries(files.map(file => [file.replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  return { out, hashes };
}
module.exports = { validationRun };
