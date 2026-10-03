// Offline framing probe only. Imports Pi's pure JSONL helper, never RpcClient/CLI.
// No agents, models, auth, network, dependencies, or host configuration are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PassThrough } = require('node:stream');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'validation', `rpc-framing-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(output, { recursive: true });
const checks = [];
const hashes = {};
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function check(name, test) {
  try { test(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); }
}

(async () => {
  let version = null;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--pi-root') {
      throw new Error('Usage: node tests/verify-integration-contracts.cjs --pi-root <installed-pi-package-directory>');
    }
    const piRoot = path.resolve(args[1]);
    const packageFile = path.join(piRoot, 'package.json');
    const helperFile = path.join(piRoot, 'dist', 'modes', 'rpc', 'jsonl.js');
    const metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    version = metadata.version;
    assert.equal(metadata.name, '@earendil-works/pi-coding-agent');
    assert.equal(version, '0.99.1', 'This probe targets the inspected Pi version, not arbitrary installed versions');
    hashes.scriptBefore = digest(__filename);
    hashes.packageBefore = digest(packageFile);
    hashes.helperBefore = digest(helperFile);
    const { serializeJsonLine, attachJsonlLineReader } = await import(pathToFileURL(helperFile).href);
    const record = { type: 'probe', text: '中文 🎬\u2028段\u2029落\n原文', id: 'fictional-1' };
    const line = serializeJsonLine(record);

    check('Serializer emits exactly one LF and preserves payload', () => {
      assert.equal((line.match(/\n/g) || []).length, 1);
      assert.ok(line.endsWith('\n'));
      assert.deepEqual(JSON.parse(line), record);
    });
    check('One-byte UTF-8 fragments do not split Chinese, emoji, U+2028 or U+2029', () => {
      const stream = new PassThrough();
      const received = [];
      const detach = attachJsonlLineReader(stream, value => received.push(value));
      for (const byte of Buffer.from(line)) stream.emit('data', Buffer.from([byte]));
      assert.equal(received.length, 1);
      assert.deepEqual(JSON.parse(received[0]), record);
      detach(); stream.destroy();
    });
    check('CRLF accepted; batched records stay distinct', () => {
      const stream = new PassThrough();
      const received = [];
      const detach = attachJsonlLineReader(stream, value => received.push(JSON.parse(value)));
      stream.emit('data', Buffer.from(line.replace(/\n$/, '\r\n') + serializeJsonLine({ id: 'fictional-2' })));
      assert.deepEqual(received, [record, { id: 'fictional-2' }]);
      detach(); stream.destroy();
    });
    check('Partial record waits until LF arrives', () => {
      const stream = new PassThrough();
      const received = [];
      const detach = attachJsonlLineReader(stream, value => received.push(value));
      stream.emit('data', Buffer.from(line.slice(0, -1)));
      assert.equal(received.length, 0);
      stream.emit('data', Buffer.from('\n'));
      assert.deepEqual(received, [line.slice(0, -1)]);
      detach(); stream.destroy();
    });
    check('String chunks also preserve Unicode separators', () => {
      const stream = new PassThrough();
      const received = [];
      const detach = attachJsonlLineReader(stream, value => received.push(value));
      stream.emit('data', line);
      assert.deepEqual(received.map(value => JSON.parse(value)), [record]);
      detach(); stream.destroy();
    });
    check('End flushes one unterminated tail without duplicating records', () => {
      const stream = new PassThrough();
      const received = [];
      const detach = attachJsonlLineReader(stream, value => received.push(value));
      stream.emit('data', Buffer.from(line.slice(0, -1)));
      stream.emit('end'); stream.emit('end');
      assert.deepEqual(received, [line.slice(0, -1)]);
      detach(); stream.destroy();
    });
    check('Detach removes both listeners and stops delivery', () => {
      const stream = new PassThrough();
      const received = [];
      const before = [stream.listenerCount('data'), stream.listenerCount('end')];
      const detach = attachJsonlLineReader(stream, value => received.push(value));
      detach();
      assert.deepEqual([stream.listenerCount('data'), stream.listenerCount('end')], before);
      stream.emit('data', Buffer.from(line)); stream.emit('end');
      assert.deepEqual(received, []);
      stream.destroy();
    });
    check('Inspected helper, package metadata and test script are unchanged', () => {
      hashes.helperAfter = digest(helperFile);
      hashes.packageAfter = digest(packageFile);
      hashes.scriptAfter = digest(__filename);
      assert.equal(hashes.helperAfter, hashes.helperBefore);
      assert.equal(hashes.packageAfter, hashes.packageBefore);
      assert.equal(hashes.scriptAfter, hashes.scriptBefore);
    });
  } catch (error) {
    checks.push({ name: 'Probe setup', passed: false, error: error.message });
  }
  const summary = { passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length };
  const report = {
    scope: 'Pure installed Pi JSONL helper; no Pi process or app integration',
    runtime: { node: process.version, platform: process.platform, arch: process.arch, piPackage: version },
    createdAt: new Date().toISOString(), hashes, summary, checks,
    notTested: ['Pi startup/readiness', 'model calls', 'RPC event lifecycle/cancellation', 'extension UI', 'Tauri/Rust bridge', 'process tree shutdown', 'backpressure/deadlines/invalid-record validation'],
  };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: path.relative(root, path.join(output, 'report.json')).split(path.sep).join('/'), summary }));
  process.exitCode = summary.failed ? 1 : 0;
})();
