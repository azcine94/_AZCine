import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { compile } from 'tailwindcss';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Plainva CSS remains valid and identical after a Windows CRLF checkout', { timeout: 30_000 }, async () => {
  const editor = resolve('plainva-editor');
  const fixture = mkdtempSync(join(tmpdir(), 'azcine-plainva-css-'));
  const sources = ['packages/ui/src/styles/ui.css', 'packages/ui/src/styles/tokens.css', 'packages/ui/src/styles/base-colors.css', 'apps/desktop/src/App.css'];
  try {
    writeFileSync(join(fixture, 'bundle.mjs'), readFileSync(join(editor, 'bundle.mjs')));
    writeFileSync(join(fixture, 'desktop-host.ts'), 'export const fixture = true;');
    writeFileSync(join(fixture, 'package-lock.json'), JSON.stringify({ packages: {} }));
    const outputs: string[] = [];
    for (const ending of ['\n', '\r\n']) {
      for (const source of sources) {
        const target = join(fixture, 'vendor', source);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(editor, 'vendor', source), 'utf8').replace(/\r\n?/g, '\n').replaceAll('\n', ending));
      }
      execFileSync(process.execPath, [join(fixture, 'bundle.mjs'), join(editor, 'node_modules')], { windowsHide: true });
      const css = readFileSync(join(fixture, 'assets/upstream-ui.css'), 'utf8');
      await compile(css);
      outputs.push(css);
    }
    assert.equal(outputs[1], outputs[0]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
