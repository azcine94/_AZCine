// Actual Tauri IPC storage checks; only the explicitly isolated application launch is accepted.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./support/browser.cjs').browserRuntime();
const { validationRun } = require('./support/validation-run.cjs');
(async () => {
  const launchRun = path.resolve(process.env.AZCINE_VALIDATION_RUN || '');
  const validation = path.resolve('artifacts/validation');
  if (!launchRun.startsWith(validation + path.sep)) throw new Error('Must identify isolated AZCine launch run.');
  const { out, hashes } = validationRun('s01-storage-ipc');
  const report = { mode: 'actual Tauri Rust IPC, retained isolated test root', launchRun, before: hashes(), checks: [] };
  const check = (name, ok, details) => { report.checks.push({ name, ok, details }); if (!ok) throw new Error(name); };
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.AZCINE_CDP_PORT || 9224}`);
  try {
    const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://127.0.0.1:1420'));
    if (!page) throw new Error('Real desktop page not found');
    const invoke = (command, args = {}) => page.evaluate(async ({ command, args }) => {
      try { return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(command, args) }; }
      catch (error) { return { ok: false, error }; }
    }, { command, args });
    const initial = await invoke('storage_workspace');
    check('Given isolated first launch When inspecting Then no root created', initial.ok && initial.value.root === null && !fs.existsSync(path.join(launchRun, 'data')), initial);
    check('Given debug override Then suggested root is retained test directory', path.resolve(initial.value.defaultRoot) === path.join(launchRun, 'data'));
    const foreign = path.join(launchRun, 'foreign-root'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'original.txt'), 'retained original');
    const refused = await invoke('select_data_root', { path: foreign });
    check('Given unknown nonempty root When selecting Then original kept and root not selected', !refused.ok && refused.error.code === 'unknown_root' && !fs.existsSync(path.join(foreign, 'db')), refused);
    const selected = await invoke('select_data_root', { path: path.join(launchRun, 'data') });
    check('Given empty dedicated root When selecting Then real database exists', selected.ok && fs.existsSync(path.join(launchRun, 'data/db/azcine.sqlite3')), selected);
    const id = 'abcdefab-1111-2222-3333-abcdefabcdef';
    const input = { id, title: '真实 IPC 待办', dueDate: null, projectId: null };
    const invalid = await invoke('create_todo', { input: { ...input, title: '   ' } });
    check('Given empty title When saving Then Rust rejects', !invalid.ok && invalid.error.code === 'invalid_title', invalid);
    const invalidDate = await invoke('create_todo', { input: { ...input, dueDate: '2026-02-30' } });
    check('Given invalid date When saving Then Rust rejects without guessing', !invalidDate.ok && invalidDate.error.code === 'invalid_date', invalidDate);
    const saved = await invoke('create_todo', { input }); check('Given no date When saving Then null date persists', saved.ok && saved.value.dueDate === null, saved);
    const repeated = await invoke('create_todo', { input }); check('Given repeated request When saving Then same stable row', repeated.ok && repeated.value.id === id && repeated.value.revision === 1, repeated);
    const done = await invoke('complete_todo', { id, revision: 1, completed: true }); check('Given incomplete When completing Then revision and completed update', done.ok && done.value.completed && done.value.revision === 2, done);
    const stale = await invoke('complete_todo', { id, revision: 1, completed: false }); check('Given stale completion When restoring Then new state not overwritten', !stale.ok && stale.error.code === 'stale_record', stale);
    const undo = await invoke('complete_todo', { id, revision: 2, completed: false }); check('Given completed When undoing Then same row restored', undo.ok && !undo.value.completed && undo.value.id === id, undo);
    await page.reload(); await page.waitForSelector('h1');
    const reloaded = await invoke('storage_workspace'); check('Given page reload When reading Then one actual stored row remains', reloaded.ok && reloaded.value.todos.length === 1 && reloaded.value.todos[0].title === input.title, reloaded);
    const locator = JSON.parse(fs.readFileSync(path.join(launchRun, 'local-config/data-root.json'), 'utf8'));
    check('Given selection Then locator points to real root identity', locator.version === 1 && locator.identity.length === 32);
    report.after = hashes(); check('Given verification Then source stayed unchanged', JSON.stringify(report.before) === JSON.stringify(report.after));
  } catch (error) { report.failure = String(error); process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, checks: report.checks.length, failure: report.failure }, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
