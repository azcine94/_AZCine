import { useEffect, useState } from 'react';
import type { Execution, GitObservation, PanelSnapshot, TaskView } from './task-panel-contract.ts';
import { executionLabels, liveExecution } from './task-panel-contract.ts';

export const terminalLabels: Record<string, string> = { working: '运行中', blocked: '待你回答', idle: '空闲', done: '本轮已停止输出', unknown: '状态未知', disconnected: '失联待核对' };
export function executionLabel(task: TaskView) {
  const o = task.observation;
  if (o && liveExecution(task.executionState)) {
    if (Date.now() - Date.parse(o.observedAt) > 15000) return '状态过期 · 等待重新核对';
    if (o.state === 'working') return task.executionState === 'awaiting_receipt' ? '窗格运行中 · 尚无接收回执' : '窗格运行中';
    if (o.state === 'blocked') return '待你回答';
    if (o.state === 'idle' || o.state === 'done') return '窗格空闲 · 等待交付回执';
    return terminalLabels[o.state] || o.state;
  }
  return task.executionState ? executionLabels[task.executionState] ?? task.executionState : '尚未派发';
}
export function RunClock({ run, task }: { run?: Execution; task: TaskView }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!run) return null;
  const elapsed = (at: string) => { const seconds = Math.max(0, Math.floor(((liveExecution(run.state) ? now : Date.parse(run.updatedAt)) - Date.parse(at)) / 1000)); return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`; };
  return <span className="tp-meta tp-run-clock">派发后 {elapsed(run.createdAt)}{task.observation?.state === 'blocked' && ` · 等待回答 ${elapsed(task.observation.stateSince)}`}{task.observation && <span>最近核对 {new Date(task.observation.observedAt).toLocaleTimeString('zh-CN')}</span>}</span>;
}
export function taskGit(task: TaskView, snapshot: PanelSnapshot | null) {
  if (task.executionWorkspace) return snapshot?.monitor?.worktrees?.[task.executionWorkspace.path];
  const repository = snapshot?.repositories.find(item => item.id === task.repositoryId);
  if (!repository) return undefined;
  const git = snapshot?.monitor?.git;
  const directory = (path: string) => path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase();
  return git && directory(git.path) === directory(repository.path) ? git : undefined;
}
export function taskBranch(task: TaskView, snapshot: PanelSnapshot | null) {
  return taskGit(task, snapshot)?.branch || task.executionWorkspace?.branch || (task.repositoryId ? '主工作区' : '无代码工作区');
}
export function gitStatus(git: GitObservation | undefined) {
  if (!git) return '状态待同步';
  if (git.error) return '读取失败';
  const observedAt = Date.parse(git.observedAt);
  if (!Number.isFinite(observedAt) || Date.now() - observedAt > 15000) return '状态待刷新';
  return git.changedFiles ? `${git.changedFiles} 个文件未提交` : '工作区干净';
}
/** Compact labels; full status and path remain in titles/details. */
export function compactGitStatus(git: GitObservation | undefined) {
  const status=gitStatus(git);
  if(status==='工作区干净')return '干净';
  if(status.endsWith('个文件未提交'))return `${git?.changedFiles} 处改动`;
  return status==='状态待同步'?'待同步':status==='状态待刷新'?'待刷新':status;
}
export function TaskObservation({ task, snapshot }: { task: TaskView; snapshot: PanelSnapshot | null }) {
  const run = snapshot?.executions.find(r => r.taskId === task.id), git = taskGit(task, snapshot);
  return <section className="tp-runtime-summary"><h3>运行状态</h3><p>{executionLabel(task)}</p><RunClock run={run} task={task} />{(task.repositoryId || task.executionWorkspace) && <><h3>任务执行目录 · Git</h3><p>{task.executionWorkspace ? '任务分支' : '主工作区'} · {git?.branch || task.executionWorkspace?.branch || '分支待确认'} · {gitStatus(git)}</p>{git?.error && <p className="tp-meta">{git.error}</p>}<p className="tp-meta tp-mono">{(task.executionWorkspace?.path || git?.path || snapshot?.repositories.find(item => item.id === task.repositoryId)?.path || '').replace(/^\\\\\?\\/, '')}</p>{git && <p className="tp-meta">HEAD {git.head.slice(0, 12) || '未知'} · {new Date(git.observedAt).toLocaleTimeString('zh-CN')}</p>}</>}</section>;
}
