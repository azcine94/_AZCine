// Run current application checks with preserved logs, exit codes and before/after fingerprints.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { validationRun } = require('./support/validation-run.cjs');
const requested = process.argv.slice(2);
const allowed = ['check', 'test', 'build:web', 'test:rust'];
const commands = requested.length ? requested : allowed;
if (!commands.every(command => allowed.includes(command))) throw new Error('Unsupported check command');
const { out, hashes } = validationRun('app-checks', ['app/src','app/src-tauri/src','scripts','app/tests']);
const report = { before: hashes(), commands: [] };
for (const command of commands) {
  const log = path.join(out, `${command.replaceAll(':', '-')}.log`), fd = fs.openSync(log,'wx');
  const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'sh', process.platform === 'win32' ? ['/d','/c',`npm run ${command}`] : ['-c',`npm run ${command}`], { stdio:['ignore', fd, fd], timeout: 600_000 });
  fs.closeSync(fd);
  report.commands.push({ command: `npm run ${command}`, code: result.status, signal: result.signal, error: result.error?.message, log });
  console.log(`${command}: ${result.status} (${log})`);
  if (result.status !== 0) process.exitCode = 1;
}
report.after = hashes(); report.sourceStable = JSON.stringify(report.before) === JSON.stringify(report.after);
if (!report.sourceStable) process.exitCode = 1;
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);
