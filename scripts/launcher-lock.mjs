import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function processIdentity(pid) {
  if (process.platform !== 'win32') {
    try { process.kill(pid, 0); return { createdAt: null }; }
    catch (error) { if (error.code === 'ESRCH') return null; throw error; }
  }
  // A PID can belong to a different program after the launcher exits. Read
  // creation time only; never inspect command lines, credentials or environment.
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = `$ErrorActionPreference='Stop'; $ownedProcess=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $ownedProcess) { 'null' } else { @{createdAt=$ownedProcess.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress }`;
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
  if (result.error || result.status !== 0) throw Error(`无法核对启动锁所属进程（PID ${pid}），已保留锁文件。`);
  let identity;
  try { identity = JSON.parse(result.stdout.trim()); }
  catch { throw Error(`启动进程信息无法读取（PID ${pid}），已保留锁文件。`); }
  if (identity === null) return null;
  if (typeof identity.createdAt !== 'string' || !Number.isFinite(Date.parse(identity.createdAt))) throw Error(`启动进程时间无效（PID ${pid}），已保留锁文件。`);
  return identity;
}

function readLock(lockPath) {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const modifiedAt = statSync(lockPath).mtimeMs;
    return { raw, modifiedAt };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function lockOwner(raw) {
  let owner;
  try {
    owner = /^\d+$/.test(raw.trim()) ? { pid: Number(raw.trim()), createdAt: null } : JSON.parse(raw);
  } catch { throw Error('启动锁内容无效，请保留文件并核对。'); }
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.pid > 0xffffffff
    || (owner.createdAt != null && (typeof owner.createdAt !== 'string' || !Number.isFinite(Date.parse(owner.createdAt))))) {
    throw Error('启动锁内容无效，请保留文件并核对。');
  }
  return owner;
}

export function acquireLauncherLock(lockPath) {
  const ownIdentity = processIdentity(process.pid);
  if (!ownIdentity) throw Error('无法确认当前启动器进程，未创建启动锁。');
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = readLock(lockPath);
    if (!existing) break;
    const owner = lockOwner(existing.raw);
    const running = processIdentity(owner.pid);
    const stale = !running || (owner.createdAt != null
      ? running.createdAt !== owner.createdAt
      // Older launchers stored only a PID. A process created after that lock
      // was written cannot be its original owner, even when the PID matches.
      : running.createdAt != null && Date.parse(running.createdAt) > existing.modifiedAt);
    if (!stale) throw Error(`本 Worktree 已有启动器（PID ${owner.pid}），请先关闭原开发实例；已保留启动锁。`);
    const current = readLock(lockPath);
    if (!current || current.raw !== existing.raw || current.modifiedAt !== existing.modifiedAt) continue;
    try { renameSync(lockPath, `${lockPath}.retained-${Date.now()}-${randomUUID()}`); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    break;
  }
  let descriptor;
  try { descriptor = openSync(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error('本 Worktree 已有启动器或启动锁正在变化，请稍后重试；不会覆盖。');
    throw error;
  }
  const raw = JSON.stringify({ version: 1, pid: process.pid, createdAt: ownIdentity.createdAt, token: randomUUID() });
  try { writeFileSync(descriptor, raw); }
  catch (error) { closeSync(descriptor); throw error; }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(descriptor);
    // Do not remove a replacement lock created by another launcher.
    const current = readLock(lockPath);
    if (current?.raw === raw) unlinkSync(lockPath);
  };
}
