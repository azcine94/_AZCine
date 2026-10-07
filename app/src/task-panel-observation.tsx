import { useEffect, useState } from 'react';
import type { Execution, PanelSnapshot, TaskView } from './task-panel-contract.ts';
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
  return task.executionWorkspace ? snapshot?.monitor?.worktrees?.[task.executionWorkspace.path] : snapshot?.monitor?.git;
}
export function taskBranch(task: TaskView, snapshot: PanelSnapshot | null) {
  return taskGit(task, snapshot)?.branch || task.executionWorkspace?.branch || '主工作区';
}
export function TaskObservation({ task, snapshot }: { task: TaskView; snapshot: PanelSnapshot | null }) {
  const run = snapshot?.executions.find(r => r.taskId === task.id), git = taskGit(task, snapshot);
  return <section className="tp-runtime-summary"><h3>运行状态</h3><p>{executionLabel(task)}</p><RunClock run={run} task={task} />{task.executionWorkspace && !git && <p className="tp-meta">{task.executionWorkspace.branch} · 正在读取分支状态</p>}{git && <><h3>任务执行目录 · Git</h3><p>{git.error || `${git.branch} · ${git.changedFiles ? `${git.changedFiles} 个文件未提交` : '工作区干净'}`}</p><p className="tp-meta tp-mono">{git.path.replace(/^\\\\\?\\/, '')}</p><p className="tp-meta">HEAD {git.head.slice(0, 12)} · {new Date(git.observedAt).toLocaleTimeString('zh-CN')}</p></>}</section>;
}
