import { useEffect, useRef, useState } from 'react';
import { RunClock, taskBranch, taskGit, gitStatus, compactGitStatus, TaskObservation, executionLabel } from './task-panel-observation.tsx';
import { RelationshipGraph } from './task-panel-graph.tsx';
import { ArrowRight, Circle, FolderPlus, FolderGit2, GitBranch, MoreHorizontal, Info, SlidersHorizontal, Settings2, LockKeyhole, Plus, RefreshCw, Search, Terminal, UserRound, X } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { Label } from './components/ui/label.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import { Card } from './components/ui/card.tsx';
import { Badge } from './components/ui/badge.tsx';
import { StatusBadge } from './components/ui/status-badge.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu.tsx';
import { executionLabels, laneLabels, lanes, levelLabels, liveExecution, reasonLabels, taskNumber } from './task-panel-contract.ts';
import type { GraphNode, Lane, TaskEvent, TaskView } from './task-panel-contract.ts';
import { taskPanelClient } from './task-panel-client.ts';
import type { TaskPanelController } from './use-task-panel.ts';
import { TaskSessions, TaskWorkflowDialogs, buildRepositoryGraph } from './task-panel-workflow.tsx';
import { ProjectDialog, ProjectManagerDialog, ProjectMemory, TaskAgentAccess } from './task-panel-project-view.tsx';
import { TaskContent, TaskOriginal } from './task-panel-task-content.tsx';
import { TaskRecords } from './task-panel-task-records.tsx';
import { TaskCreateDialog } from './task-panel-create-dialog.tsx';
import { TaskFeedbackPanel } from './task-panel-feedback.tsx';

const laneHints: Partial<Record<Lane, string>> = { human: '需要决定、补资料或核对异常', blocked: '前置未满足或目标占用', ready: '前置满足，派发仍需授权', running: '查看发送、接收与实际执行状态', verify: '交付、技术检查与本人验收分别核对' };
const tone = (lane: Lane) => lane === 'blocked' ? 'error' : lane === 'human' || lane === 'verify' ? 'warning' : lane === 'done' ? 'success' : 'neutral';
const timeLabel = (date: string) => { const parsed = new Date(date); return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };

export function TaskPanelActions({ model }: { model: TaskPanelController }) {
  const busy = model.openingWorkspace || !!model.action || !!model.workflow.action;
  return <div className="tp-header-actions">
    <Button data-task-project-manager variant="outline" size="sm" disabled={!model.root || busy} onClick={() => { model.setActionError(''); model.setProjectManagerOpen(true); }}><Settings2 />项目管理</Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="更多任务面板操作" disabled={busy}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuItem disabled={!model.root} onSelect={() => model.openProject()}><Plus />新建项目</DropdownMenuItem>
      <DropdownMenuItem disabled={!model.root} onSelect={() => { model.workflow.setGoalDraft(d => ({ ...d, projectId: d.projectId || model.projectFilter })); model.workflow.setGoalOpen(true); }}><GitBranch />从目标开始</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { model.setActionError(''); model.workflow.setAnalysisDraft(d => ({ ...d, incremental: false })); model.setIntake(d => ({ ...d, step: 1 })); model.setIntakeOpen(true); }}><FolderPlus />接手已有仓库</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    <Button size="sm" disabled={!model.root || busy} onClick={() => model.openEditor()}><Plus />新建任务</Button>
  </div>;
}

function WorkspaceBar({ model }: { model: TaskPanelController }) {
  const task = model.snapshot?.tasks.find(item => item.id === model.selectedId && item.objectKind !== 'goal');
  const git = task ? taskGit(task, model.snapshot) : model.snapshot?.monitor?.git;
  const scope = task ? task.executionWorkspace ? '任务分支' : '主工作区' : '总仓库';
  const hasCodeWorkspace = !task || !!task.repositoryId || !!task.executionWorkspace;
  const branch = git?.branch || task?.executionWorkspace?.branch;
  const gitState = gitStatus(git);
  const path = (model.root ?? '').replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  const executionPath = task?.executionWorkspace?.path || (task ? model.snapshot?.repositories.find(item => item.id === task.repositoryId)?.path : path);
  const gitTitle = hasCodeWorkspace ? `${task ? `${taskNumber(task)} · ${task.title}` : '总仓库'}\n${scope}：${branch || '分支待确认'} · ${gitState}\n${executionPath || git?.path || '执行目录待确认'}${git ? `\n最近核对：${timeLabel(git.observedAt)}` : ''}\n${git?.error || '改动数为这个执行目录中尚未提交的文件数。'}` : '所选任务没有代码工作区';
  const state = model.loadError ? 'error' : !model.root ? 'idle' : !model.snapshot || model.openingWorkspace ? 'initial' : 'active';
  const status = state === 'error' ? '同步异常' : state === 'idle' ? '未选择仓库' : state === 'initial' ? '正在同步' : '状态自动同步';
  return <div className="tp-workspace-bar">
    <div className="tp-workspace-picker"><FolderGit2 size={16} aria-hidden="true" /><Label className="sr-only" htmlFor="tp-current-workspace">当前仓库</Label><NativeSelect id="tp-current-workspace" variant="app" value={model.root || ''} disabled={model.openingWorkspace || !!model.action || !!model.workflow.action} onChange={event => { const entry = model.workspaces.find(workspace => workspace.path === event.target.value); if (entry) void model.openWorkspace(entry.path, entry.label); }}><option value="">选择仓库</option>{model.workspaces.map(workspace => <option key={workspace.path} value={workspace.path}>{workspace.label || '未命名仓库'}{model.workspaces.filter(entry => entry.label === workspace.label).length > 1 ? ` · ${workspace.path.replace(/^\\\\\?\\/, '')}` : ''}</option>)}</NativeSelect></div>
    <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="查看仓库位置与分支状态"><Info /></Button></PopoverTrigger><PopoverContent className="tp-workspace-info" align="start"><strong>当前仓库</strong><p className="tp-mono">{path || '接手已有仓库后创建任务'}</p><p className="tp-meta">{gitTitle}</p></PopoverContent></Popover>
    <div className="tp-workspace-status">{model.root && <span className="tp-meta tp-workspace-git" title={gitTitle}><GitBranch size={14} aria-hidden="true" /><span>{hasCodeWorkspace ? `${scope}${branch ? ` · ${branch}` : ''}` : '无代码工作区'}</span>{hasCodeWorkspace && <Badge variant={git?.error ? 'outline' : 'secondary'}>{compactGitStatus(git)}</Badge>}</span>}<span className="tp-meta tp-sync-status" data-state={state} title={model.loadError || (model.snapshot?.monitor?.observedAt ? `最近同步：${timeLabel(model.snapshot.monitor.observedAt)}` : status)}><Circle size={10} aria-hidden="true" />{status}</span></div>
  </div>;
}

function TaskCard({ task, model }: { task: TaskView; model: TaskPanelController }) {
  const repository = model.snapshot?.repositories.find(r => r.id === task.repositoryId);
  const git = taskGit(task, model.snapshot);
  const branch = git?.branch || task.executionWorkspace?.branch;
  const binding = model.snapshot?.bindings.find(b => b.taskId === task.id);
  const reason = task.lifecycle === 'cancelled' ? liveExecution(task.executionState) ? '取消待处理 · 原执行尚未结束' : '任务已取消 · 历史和物料保留' : task.stopPending ? '停止待确认' : task.reasonCodes.map(r => reasonLabels[r] ?? r).join(' · ');
  return <Card className="tp-card p-0 gap-0" data-selected={model.selectedId === task.id}>
    <Button variant="app-control" className="tp-task-card" aria-pressed={model.selectedId === task.id} onClick={() => model.select(task.id)}>
      <span className="tp-card-meta"><span className="tp-mono">{taskNumber(task)}</span>{binding && <span><Terminal size={12} />{binding.kind} · {binding.paneId}</span>}</span>
      <strong title={task.title}>{task.title}</strong><span className="tp-card-branch" title={`${task.executionWorkspace ? '任务分支' : '主工作区'} · ${branch || '分支待同步'}\n${git?.error || task.workspaceError || task.executionWorkspace?.path || repository?.path || ''}`}><GitBranch size={13} aria-hidden="true" /><span>{task.executionWorkspace || task.repositoryId ? branch || '分支待同步' : '无代码工作区'}</span>{(task.executionWorkspace || task.repositoryId) && <Badge variant="secondary">{compactGitStatus(git)}</Badge>}</span>
      <span className={`tp-card-reason tp-tone-${tone(task.lane)}`}>{task.lane === 'blocked' ? <LockKeyhole size={13} /> : task.lane === 'human' ? <UserRound size={13} /> : <Circle size={11} />}{reason || (task.executionState ? executionLabel(task) : '前置满足 · 等待本次授权派发')}</span>
      <RunClock task={task} run={model.snapshot?.executions.find(r => r.taskId === task.id)} /><span className="tp-card-tags">{task.plan.projectId && <Badge variant="outline" className="max-w-full whitespace-normal break-all">{model.snapshot?.projects.find(p => p.id === task.plan.projectId)?.name}</Badge>}{task.plan.phase && <Badge variant="secondary" className="max-w-full whitespace-normal break-all">{task.plan.phase}</Badge>}{repository && repository.label !== model.snapshot?.projects.find(p=>p.id===task.plan.projectId)?.name && <Badge variant="secondary" className="max-w-full whitespace-normal">{repository.label}</Badge>}{task.prerequisitesTotal > 0 && <Badge variant="secondary" className="max-w-full whitespace-normal">前置 {task.prerequisitesSatisfied}/{task.prerequisitesTotal}</Badge>}{!repository && <Badge variant="secondary" className="max-w-full whitespace-normal">无仓库目标</Badge>}</span>
      <span className="tp-progress" aria-label={`交付：${task.executionState === 'reported_finished' ? '有声明' : '未交付'}；技术：${task.checkState}；验收：${task.acceptanceState}`}><i data-done={task.executionState === 'reported_finished'} /><i data-done={task.checkState === 'passed'} /><i data-done={task.acceptanceState === 'accepted'} /></span>
    </Button>
  </Card>;
}

function Board({ model }: { model: TaskPanelController }) {
  const needle = model.query.toLocaleLowerCase();
  const tasks = model.snapshot?.tasks.filter(t => (t.objectKind !== 'goal') && (model.showCancelled ? t.lifecycle === 'cancelled' && !liveExecution(t.executionState) : t.lifecycle !== 'cancelled' || liveExecution(t.executionState)) && (!model.projectFilter || t.plan.projectId === model.projectFilter) && (!model.repositoryFilter || t.repositoryId === model.repositoryFilter) && (!model.branchFilter || taskBranch(t, model.snapshot) === model.branchFilter) && `${taskNumber(t)} ${t.title} ${t.goal} ${t.scope.join(' ')}`.toLocaleLowerCase().includes(needle)) ?? [];
  if (model.showCancelled) return <div className="tp-history" aria-label="已取消的任务">{tasks.map(task => <TaskCard key={task.id} task={task} model={model} />)}{!tasks.length && <p className="tp-meta tp-history-empty">此范围没有已取消的任务。取消只移出活动看板，历史和交接物料仍保留。</p>}</div>;
  return <div className="tp-board" aria-label="任务看板">{lanes.filter(l => model.showDone || l !== 'done').map(lane => <section key={lane} className="tp-lane" aria-label={laneLabels[lane]}>
    <header><span className={`tp-dot tp-tone-${tone(lane)}`} /><h2>{laneLabels[lane]}</h2><span className="tp-count">{tasks.filter(t => t.lane === lane).length}</span></header>
    <p className="tp-lane-hint">{laneHints[lane] ?? '保留本人验收记录与代码版本'}</p>
    <div className="tp-lane-list">{tasks.filter(t => t.lane === lane).map(task => <TaskCard key={task.id} task={task} model={model} />)}{!tasks.some(t => t.lane === lane) && <p className="tp-lane-empty">{needle ? '没有匹配的任务' : '暂无任务'}</p>}</div>
  </section>)}</div>;
}

function DependencyEditor({ task, model }: { task: TaskView; model: TaskPanelController }) {
  const d = model.relationDraft;
  const change = (patch: Partial<typeof d>) => model.setRelationDraft(before => ({ ...before, ...patch }));
  return <details className="tp-disclosure"><summary>添加前置或关联</summary><form className="tp-form" onSubmit={event => { event.preventDefault(); void model.mutate({ type: 'relation', fromId: task.id, toId: d.targetId, kind: d.kind, threshold: d.kind === 'depends_on' ? d.threshold : 'none', source: d.source }, model.snapshot!.graphRevision, '保存关系'); }}>
    <Label className="grid items-start font-normal leading-5">关联任务<NativeSelect variant="app" required value={d.targetId} onChange={e => change({ targetId: e.target.value })}><option value="">选择任务</option>{model.snapshot?.tasks.filter(t => t.id !== task.id && t.objectKind !== 'goal' && t.plan.projectId === task.plan.projectId).map(t => <option key={t.id} value={t.id}>{taskNumber(t)} · {t.title}</option>)}</NativeSelect></Label>
    <div className="tp-grid2"><Label className="grid items-start font-normal leading-5">关系<NativeSelect variant="app" value={d.kind} onChange={e => change({ kind: e.target.value })}><option value="depends_on">明确前置</option><option value="related_to">普通关联</option></NativeSelect></Label><Label className="grid items-start font-normal leading-5">满足门槛<NativeSelect variant="app" value={d.threshold} disabled={d.kind !== 'depends_on'} onChange={e => change({ threshold: e.target.value })}><option value="acceptance">本人验收</option><option value="technical">技术检查通过</option></NativeSelect></Label></div>
    <Label className="grid items-start font-normal leading-5">出处<Input variant="app" required value={d.source} onChange={e => change({ source: e.target.value })} /></Label><Button size="sm" variant="outline" disabled={!!model.action || !d.targetId}>保存关系</Button>
  </form></details>;
}

function TimelineEntry({ event }: { event: TaskEvent }) {
  let summary = event.detail, technical = '';
  try {
    const value: unknown = JSON.parse(event.detail);
    if (value && typeof value === 'object') {
      technical = JSON.stringify(value, null, 2);
      summary = 'reason' in value && typeof value.reason === 'string' ? value.reason : '已保存执行观察，可展开查看详情。';
      if (event.kind === 'herdr_creation_observation') summary = 'state' in value && value.state === 'ready' ? '原窗格已就绪，任务尚未发送。' : '启动未完成，原创建位置已保留，任务尚未发送。';
    }
  } catch { /* Ordinary event text is already suitable for reading. */ }
  return <div><time dateTime={event.createdAt}>{timeLabel(event.createdAt)}</time><span className="tp-dot" /><div className="tp-timeline-content"><p>{summary}<span className="tp-meta"> · {event.actor === 'user' ? '本人操作' : event.actor === 'observed' ? '程序观察' : event.actor}</span></p>{technical && <details className="tp-disclosure"><summary>技术详情</summary><pre className="tp-source">{technical}</pre></details>}</div></div>;
}

function TaskControls({ task, model }: { task: TaskView; model: TaskPanelController }) {
  const w = model.workflow, busy = !!model.action || !!w.action;
  const run = model.snapshot?.executions.find(r => r.taskId === task.id && liveExecution(r.state));
  const binding = model.snapshot?.bindings.find(b => run ? b.id === run.bindingId : b.taskId === task.id);
  const confirmStop = w.cancelTaskId === task.id;
  const setConfirmStop = (open: boolean) => w.setCancelTaskId(open ? task.id : '');
  const [checked, setChecked] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; w.setCancelTaskId(''); }; }, [w.setCancelTaskId]);
  const resume = model.resumeDrafts[task.id] ?? task.resumeSummary;
  const canOpen = !!binding || !!task.pendingCreation?.paneId;
  async function cancel() {
    const result = await model.mutate({ type: 'lifecycle', id: task.id, lifecycle: 'cancelled', reason: resume }, task.revision, '取消任务');
    if (result && alive.current) w.setError('');
  }
  async function restore(retry: boolean) {
    const result = await model.mutate({ type: 'lifecycle', id: task.id, lifecycle: 'active', reason: resume }, task.revision, '恢复任务');
    if (result && alive.current) { model.setShowCancelled(false); w.setError(''); }
    if (result && retry && alive.current) w.openDispatch({ ...task, lifecycle: 'active', revision: result.revision });
  }
  async function confirmCancelled() {
    if (!run || !checked) return;
    const result = await model.mutate({ type: 'cancel_stopped_execution', id: task.id, executionId: run.id, reason: '本人已在原 Herdr 窗格核对，此次执行已停止。', approved: true }, task.revision, '取消已停止的任务');
    if (result && alive.current) setConfirmStop(false);
  }
  return <footer className="tp-detail-foot tp-detail-foot--actions"><div className="tp-acts">
    {run ? <><Button size="sm" variant="outline" disabled={busy || task.stopPending} onClick={() => void w.input('execution_action', '请求停止原执行', { executionId: run.id, action: 'interrupt', reason: '本人点击停止此任务的原执行。', approved: true })}>{task.stopPending ? '停止待确认' : '停止执行'}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void w.input('execution_action', '核对原执行', { executionId: run.id, action: 'reconcile', reason: '', approved: false })}>核对状态</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setChecked(false); model.setActionError(''); w.setError(''); setConfirmStop(true); }}>确认停止并取消</Button></>
      : task.lifecycle === 'cancelled' ? <Button size="sm" disabled={busy} onClick={() => void restore(false)}>恢复任务</Button>
      : <>{task.lifecycle === 'paused' ? <><Button size="sm" disabled={busy} onClick={() => void restore(true)}>恢复并重试</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void restore(false)}>仅恢复</Button></> : <><Button size="sm" disabled={busy || !task.allowedActions.includes('dispatch')} onClick={() => w.openDispatch(task)}>{task.pendingCreation || task.executionState === 'failed' ? '重试任务' : '开始任务'}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void model.mutate({ type: 'lifecycle', id: task.id, lifecycle: 'paused', reason: resume }, task.revision, '暂停任务')}>暂停</Button></>}<Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>取消任务</Button></>}
    {canOpen && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void w.perform('打开原窗格', () => task.pendingCreation?.paneId ? taskPanelClient(model.root).focusCreation(task.id) : taskPanelClient(model.root).focus(binding!.id))}>{task.observation?.state === 'blocked' ? '去回答' : '打开原窗格'}</Button>}
  </div><p className="tp-meta">{run ? '停止请求不等于已停止；核对原窗格后再取消任务。' : task.lifecycle === 'cancelled' ? '已移出活动看板，历史和交接物料保留。' : `取消保留历史和交接物料 · ${taskNumber(task)} · r${task.revision}`}</p>
  <FormDialog open={confirmStop} onOpenChange={setConfirmStop} title="确认原执行已停止" description="仅在你已核对原 Herdr 窗格后取消任务；不会关闭窗格或删除文件。"><div className="tp-form"><p>{task.title}</p><p className="tp-meta">原窗格：{binding?.paneId ?? '请从 Herdr 核对'} · 执行：{run?.id ?? '已结束'}</p><Label className="tp-check"><Checkbox checked={checked} onCheckedChange={value => setChecked(value === true)} />我已核对原窗格，此次任务已停止</Label>{model.actionError && <Feedback tone="error">{model.actionError}</Feedback>}{w.error && <Feedback tone="error">{w.error}</Feedback>}<div className="tp-acts"><Button variant="outline" onClick={() => setConfirmStop(false)}>返回</Button><Button variant="destructive" disabled={busy || !checked || !run} onClick={() => void confirmCancelled()}>确认停止并取消任务</Button></div></div></FormDialog>
  </footer>;
}

function TaskDetail({ task, model }: { task: TaskView; model: TaskPanelController }) {
  const repository = model.snapshot?.repositories.find(r => r.id === task.repositoryId);
  const relations = model.snapshot?.relations.filter(r => r.active && r.fromId === task.id && r.kind === 'depends_on') ?? [];
  const events = model.snapshot?.events.filter(e => e.objectId === task.id || model.snapshot?.executions.some(r => r.id === e.objectId && r.taskId === task.id)).slice(-12).reverse() ?? [];
  const resume = model.resumeDrafts[task.id] ?? task.resumeSummary;
  return <aside className="tp-detail" aria-label="任务详情">
    <header className="tp-detail-head"><div className="tp-row"><span className="tp-mono tp-meta">{taskNumber(task)}</span><StatusBadge tone={task.lifecycle === 'cancelled' ? 'neutral' : tone(task.lane)}>{task.lifecycle === 'cancelled' ? liveExecution(task.executionState) ? '取消待处理' : '已取消' : task.stopPending ? '停止待确认' : laneLabels[task.lane]}</StatusBadge><Button className="tp-detail-close" variant="ghost" size="icon-sm" onClick={() => model.select(null)} aria-label="关闭任务详情"><X /></Button></div><h2>{task.title}</h2><p className="tp-meta">{model.snapshot?.projects.find(p => p.id === task.plan.projectId)?.name ?? '未归属项目'}{task.plan.goalId && ' / ' + model.snapshot?.tasks.find(t => t.id === task.plan.goalId)?.title}{task.plan.phase && ' / ' + task.plan.phase} · {repository?.label ?? '无仓库目标'} · r{task.revision}</p></header>
    <div className="tp-detail-body">
      <TaskContent task={task} />
      {task.workspaceError && <Feedback tone="error">执行目录不可用：{task.workspaceError}。原分支归属和记录保留，请恢复原目录后重新核对。</Feedback>}
      <TaskFeedbackPanel task={task} model={model}/>
      <section className="tp-next">{task.pendingCreation && task.lifecycle !== 'cancelled' && <><strong>启动待核对，任务尚未发送</strong><p className="tp-meta">{task.pendingCreation.reason}</p><p className="tp-meta">{task.pendingCreation.paneId ? `原窗格：${task.pendingCreation.paneId}。重试会核对原位置。` : '创建结果待核对，请先到 Herdr 查看实际位置。'}</p></>}<p>{task.reasonCodes.length ? task.reasonCodes.map(r => reasonLabels[r] ?? r).join('；') : laneHints[task.lane] ?? '本人验收记录已保存。'}</p><div className="tp-acts"><Button size="sm" onClick={() => model.openEditor(task)}>核对任务</Button><Button size="sm" variant="outline" onClick={() => { model.setGraphMode('task'); model.setTab('graph'); }}>项目执行图</Button><Button size="sm" variant="outline" onClick={() => { model.setGraphCenter(task.id); model.setGraphMode('architecture'); model.setTab('graph'); }}>相关代码</Button><Button size="sm" variant="outline" onClick={() => model.workflow.openDispatch(task)}>上下文与派发</Button><Button size="sm" variant="ghost" onClick={() => { model.workflow.setDeliveryTaskId(task.id); model.workflow.setDeliveryDraft(d => ({ ...d, executionId: model.snapshot?.executions.find(r => r.taskId === task.id)?.id ?? '', approved: false })); model.workflow.setDeliveryOpen(true); }}>回执与验收</Button></div></section>
      <section><h3>交付依据<span className="tp-meta">三项分别记录</span></h3><div className="tp-facts"><div><span>执行</span><span>{task.executionState ? executionLabels[task.executionState] ?? task.executionState : '尚未派发'}</span></div><div><span>技术检查</span><span>{task.checkState === 'passed' ? '当前修订有检查证据' : task.checkState === 'failed' ? '检查失败' : task.checkState === 'stale' ? '代码已变化 · 待重新核对' : '尚未完成全部检查'}</span></div><div><span>本人验收</span><span>{task.acceptanceState === 'accepted' ? '已验收' : '未接受当前修订'}</span></div></div></section>
      <Disclosure key={`${task.id}-runtime`}><summary>运行与 Git 详情 · {executionLabel(task)}</summary><TaskObservation task={task} snapshot={model.snapshot} /></Disclosure>
      <TaskAgentAccess model={model} task={task} />
      <section><h3>前置任务<span className="tp-meta">{task.prerequisitesSatisfied}/{task.prerequisitesTotal}</span></h3>{relations.map(r => { const t = model.snapshot?.tasks.find(t => t.id === r.toId); return <div className="tp-relation-row" key={r.id}><Button variant="ghost" size="sm" onClick={() => model.select(r.toId)}>{t ? taskNumber(t) : r.toId} · {t?.title}</Button><span className="tp-meta">{r.threshold === 'technical' ? '技术通过' : '本人验收'}</span><Button variant="ghost" size="icon-xs" aria-label="移除这条前置关系并保留历史" disabled={!!model.action} onClick={() => void model.mutate({ type: 'invalidate_relation', id: r.id }, model.snapshot!.graphRevision, '移除前置')}><X /></Button></div>; })}{!relations.length && <p className="tp-meta">未登记前置。普通关联不影响调度。</p>}<DependencyEditor task={task} model={model} /></section>
      <TaskRecords key={task.id} task={task} snapshot={model.snapshot} />
      <section><h3>接续摘要与暂停点</h3><Textarea variant="app" aria-label="接续摘要与暂停点" rows={4} value={resume} onChange={e => model.setResumeDrafts(before => ({ ...before, [task.id]: e.target.value }))} placeholder="已完成、发现、未完成与下一步" /><Button variant="outline" size="sm" disabled={!!model.action || resume === task.resumeSummary} onClick={() => void model.mutate({ type: 'resume_summary', id: task.id, summary: resume }, task.revision, '保存暂停点')}>保存暂停点</Button></section>
      <TaskOriginal task={task} />
      <Disclosure key={`${task.id}-timeline`}><summary>任务时间线 · {events.length} 条</summary><div className="tp-timeline">{events.map(e => <TimelineEntry key={e.sequence} event={e} />)}</div>{!events.length && <p className="tp-meta">暂无事件。</p>}</Disclosure>
    </div><TaskControls key={`${model.root}:${task.id}`} task={task} model={model} />
  </aside>;
}

function NodeDetail({ node, model }: { node: GraphNode; model: TaskPanelController }) {
  const edges = model.graph?.relations.filter(r => r.fromId === node.id || r.toId === node.id) ?? [];
  const relatedTasks = model.snapshot?.tasks.filter(t => t.id === node.id || !!node.path && t.repositoryId === node.repositoryId && t.scope.some(scope => scope === '.' || node.path === scope.replaceAll('\\', '/') || node.path.startsWith(scope.replaceAll('\\', '/') + '/')) || edges.some(r => r.fromId === t.id && r.toId === node.id || r.toId === t.id && r.fromId === node.id)) ?? [];
  return <aside className="tp-detail" aria-label="架构对象详情"><header className="tp-detail-head"><div className="tp-row"><Badge variant="outline">{node.kind}</Badge><Button variant="ghost" size="icon-sm" className="tp-detail-close" onClick={() => model.selectNode(null)} aria-label="关闭对象详情"><X /></Button></div><h2>{node.label}</h2><span className="tp-meta">{levelLabels[node.evidenceLevel]}{node.stale && ' · 待复核'}</span></header><div className="tp-detail-body"><Button variant="outline" size="sm" onClick={() => model.setGraphCenter(node.id)}>以此对象展开关联</Button><section><h3>代码定位</h3><p className="tp-mono">{node.path || '不是代码对象'}</p><p>{node.symbol}</p></section><section><h3>关联任务</h3><p className="tp-meta">按任务声明范围和当前已加载关系定位；不代表实际已修改或已验证。</p>{relatedTasks.map(t => <Button key={t.id} variant="ghost" size="sm" className="tp-related-task" onClick={() => { model.select(t.id); model.setTab('board'); }}>{taskNumber(t)} · {t.title}</Button>)}{!relatedTasks.length && <p className="tp-meta">当前已加载邻域没有关联任务，可继续展开关系。</p>}</section><section><h3>来源</h3><pre className="tp-source">{JSON.stringify(node.sources, null, 2)}</pre></section><section><h3>相关关系</h3>{edges.map(r => <div className="tp-evidence" key={r.id}><p>{r.kind} · {model.graph?.nodes.find(n => n.id === (r.fromId === node.id ? r.toId : r.fromId))?.label}</p><p className="tp-meta">{levelLabels[r.evidenceLevel]}</p><details className="tp-disclosure"><summary>查看这条关系的出处</summary><pre className="tp-source">{r.source}</pre></details>{['imports','calls','registers','reads','writes','contains','may_affect','supported_by'].includes(r.kind) && <><Label className="grid items-start font-normal leading-5">语义查证结论<Textarea variant="app" rows={2} value={model.semanticDrafts[r.id] ?? ''} onChange={e => model.setSemanticDrafts(d => ({ ...d, [r.id]: e.target.value }))} placeholder="填写实际查证的结论和未覆盖项" /></Label><div className="tp-acts"><Button variant="outline" size="sm" disabled={!!model.action || r.evidenceLevel === 'stale' || !(model.semanticDrafts[r.id] ?? '').trim()} onClick={() => void model.mutate({ type: 'review_relation', id: r.id, reason: model.semanticDrafts[r.id] }, model.snapshot!.graphRevision, '记录本人语义复核')}>本人已查证这条关系</Button><Button variant="ghost" size="sm" disabled={!!model.action || !(model.semanticDrafts[r.id] ?? '').trim()} onClick={async () => { const result = await model.mutate({ type: 'invalidate_relation', id: r.id }, model.snapshot!.graphRevision, '明确使关系失效'); if (result) model.setSemanticDrafts(d => ({ ...d, [r.id]: '' })); }}>确认失效并保留历史</Button></div></>}</div>)}</section></div><footer className="tp-detail-foot">出处定位、语义核对与批准导入分别记录。</footer></aside>;
}

function MemoryView({ model }: { model: TaskPanelController }) { return <ProjectMemory model={model} />; }

function TaskEditor({ model }: { model: TaskPanelController }) {
  return <TaskCreateDialog model={model}/>;
}

function IntakeDialog({ model }: { model: TaskPanelController }) {
  const d = model.intake, update = (patch: Partial<typeof d>) => model.setIntake(before => ({ ...before, ...patch }));
  const [dispatchNow, setDispatchNow] = useState(true);
  return <FormDialog open={model.intakeOpen} onOpenChange={model.setIntakeOpen} title="接手已有仓库" description="任务、关系、确认记录和 Agent 交接材料都保存在这个仓库的 .azcine 中。" wide>
    <ol className="tp-stepper"><li data-current={d.step === 1}><span>1</span>仓库与范围</li><li data-current={d.step === 2}><span>2</span>建图与执行工具</li></ol>
    <form className="tp-form" onSubmit={e => { e.preventDefault(); void (d.step === 1 ? model.saveRepository() : buildRepositoryGraph(model, dispatchNow)); }}>
      {d.step === 1 ? <><Label className="grid items-start font-normal leading-5">仓库名称<Input variant="app" autoFocus required value={d.label} onChange={e => update({ label: e.target.value })} /></Label><Label className="grid items-start font-normal leading-5">仓库绝对目录<Input variant="app" required value={d.path} onChange={e => update({ path: e.target.value })} placeholder="已有的本机仓库或 Worktree 目录" /></Label><Label className="grid items-start font-normal leading-5">允许读取范围<Textarea variant="app" rows={3} required value={d.scope} onChange={e => update({ scope: e.target.value })} placeholder="每行一个相对目录，. 表示仓库范围" /></Label><Label className="grid items-start font-normal leading-5">重点了解什么<Textarea variant="app" rows={3} value={d.goal} onChange={e => update({ goal: e.target.value })} /></Label></> : <><p><strong>{d.label}</strong><span className="tp-mono tp-meta"> · {d.path}</span></p><div className="tp-grid2"><Label className="grid items-start font-normal leading-5">执行工具<NativeSelect variant="app" value={d.agentKind} onChange={e => update({ agentKind: e.target.value })}><option value="codex">Codex（codex）</option><option value="openpi">OpenPI（opi）</option></NativeSelect></Label><Label className="grid items-start font-normal leading-5">Herdr 窗格名称<Input variant="app" maxLength={100} value={d.paneName} onChange={e => update({ paneName: e.target.value })} placeholder={`${d.label} · 建图`} /></Label></div><p className="tp-meta">自动创建 PowerShell 窗格、启动所选工具并交接。三件建图产物写入本次执行的 output 目录。</p><details className="tp-disclosure"><summary>Archify 设置与交付说明</summary><div className="tp-form"><Label className="grid items-start font-normal leading-5">Archify Skill 路径<Input variant="app" value={d.skillPath} onChange={e => update({ skillPath: e.target.value })} /></Label><p className="tp-meta">candidate.json 保存图规格，architecture.html 供阅读，graph-facts.json 保存关系与来源。默认使用 E:\skills-manager\archify，启动前核对实际文件。</p></div></details><Label className="tp-check"><Checkbox checked={dispatchNow} onCheckedChange={v => setDispatchNow(v === true)} />创建后开始只读建图与渲染</Label></>}
      {model.actionError && <Feedback tone="error" role="alert">{model.actionError}</Feedback>}{model.workflow.error && <Feedback tone="error" role="alert">{model.workflow.error}</Feedback>}<footer className="tp-form-footer">{d.step === 2 && <Button type="button" variant="outline" onClick={() => { model.setIntakeOpen(false); model.openEditor(); model.updateDraft({ repositoryId: d.id, projectId: d.projectId }); }}>直接创建任务</Button>}{d.step === 2 && <Button type="button" variant="ghost" onClick={() => update({ step: 1 })}>返回</Button>}<span className="tp-meta">关闭保留输入</span><Button type="button" variant="outline" onClick={() => model.setIntakeOpen(false)}>关闭</Button><Button disabled={!!model.action || !!model.workflow.action || model.openingWorkspace || d.step === 2 && !d.skillPath}>{model.action || model.workflow.action || (d.step === 1 ? '打开仓库' : dispatchNow ? '确认名称并开始建图' : '仅创建建图任务')}<ArrowRight /></Button></footer>
    </form>
  </FormDialog>;
}

export function TaskPanel({ model }: { model: TaskPanelController }) {
  const task = model.snapshot?.tasks.find(t => t.id === model.selectedId);
  const node = model.graph?.nodes.find(n => n.id === model.selectedNode);
  const hasDetail = !!task && (model.tab === 'board' || model.tab === 'graph' && model.graphMode === 'task') || !!node && model.tab === 'graph' && model.graphMode === 'architecture';
  return <Tabs className="task-panel gap-4" value={model.tab} onValueChange={model.setTab}>
    <WorkspaceBar model={model} />
    <div className="tp-toolbar">
      <TabsList aria-label="任务面板视图" className="h-9"><TabsTrigger value="board">看板{model.snapshot?.tasks.filter(t=>t.objectKind!=='goal'&&t.lifecycle!=='cancelled').length ? ` ${model.snapshot.tasks.filter(t=>t.objectKind!=='goal'&&t.lifecycle!=='cancelled').length}` : ''}</TabsTrigger><TabsTrigger value="graph">关系图</TabsTrigger><TabsTrigger value="sessions">Herdr 会话</TabsTrigger><TabsTrigger value="memory">记忆</TabsTrigger></TabsList>
      <div className="tp-search"><Search size={16}/><Input variant="app" aria-label="搜索任务、编号或文件" placeholder="搜索任务、编号或文件" value={model.query} onChange={e=>model.setQuery(e.target.value)}/></div>
      <NativeSelect variant="app" aria-label="任务分支筛选" value={model.branchFilter} onChange={e=>model.setBranchFilter(e.target.value)}><option value="">全部分支</option>{[...new Set(model.snapshot?.tasks.filter(t=>t.objectKind!=='goal').map(t=>taskBranch(t,model.snapshot)).filter((b):b is string=>!!b))].map(b=><option key={b} value={b}>{b}</option>)}</NativeSelect>
      <div className="tp-toolbar-end"><Popover><PopoverTrigger asChild><Button variant="outline" size="sm" aria-label="任务面板筛选与显示设置"><SlidersHorizontal/>筛选{(model.projectFilter||model.repositoryFilter||model.showDone||model.showCancelled)&&' · 已启用'}</Button></PopoverTrigger><PopoverContent className="tp-filter-popover" align="end">
        <Label className="grid gap-2 font-normal">项目<NativeSelect variant="app" value={model.projectFilter} onChange={e=>model.setProjectFilter(e.target.value)}><option value="">全部项目</option>{model.snapshot?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Label>
        <Label className="grid gap-2 font-normal">代码仓库<NativeSelect variant="app" value={model.repositoryFilter} onChange={e=>model.setRepositoryFilter(e.target.value)}><option value="">全部仓库</option>{model.snapshot?.repositories.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</NativeSelect></Label>
        <Label className="tp-check"><Checkbox checked={model.showDone} onCheckedChange={v=>model.setShowDone(v===true)}/>显示已验收</Label><Button variant="outline" size="sm" aria-pressed={model.showCancelled} onClick={()=>{model.setShowCancelled(!model.showCancelled);model.setTab('board');model.select(null);}}>{model.showCancelled?'返回活动看板':'查看已取消任务'}</Button>
        <p className="tp-meta">{model.workflow.capabilities?.fixture?'Herdr fixture':model.snapshot?.monitor?.error|| (model.snapshot?.monitor?.sessions.length ? `Herdr 已连接 · ${model.snapshot.monitor.sessions.length} 个窗格` : '按任务自动连接')}</p>
      </PopoverContent></Popover><Button size="icon-sm" variant="ghost" disabled={!model.root||model.openingWorkspace} onClick={()=>void model.refresh()} aria-label="刷新任务记录"><RefreshCw/></Button></div>
    </div>
    {(model.snapshot?.projects.find(p=>p.id===model.projectFilter)?.summary || model.snapshot?.tasks.some(t=>t.objectKind==='goal'&&(!model.projectFilter||t.plan.projectId===model.projectFilter))) && <div className="tp-project-context"><strong>{model.snapshot?.projects.find(p => p.id === model.projectFilter)?.name ?? '全部项目的目标'}</strong><span className="tp-meta">{model.snapshot?.projects.find(p => p.id === model.projectFilter)?.summary}</span><div className="tp-acts">{model.snapshot?.tasks.filter(t => t.objectKind === 'goal' && (!model.projectFilter || t.plan.projectId === model.projectFilter)).map(t => <Button key={t.id} size="sm" variant="ghost" onClick={() => { model.select(t.id); model.setGraphMode('task'); model.setTab('graph'); }}>目标：{t.title}</Button>)}</div></div>}{model.loadError && <Feedback tone="error" role="alert">{model.loadError}<Button variant="ghost" size="sm" onClick={() => void model.refresh()}>重试</Button></Feedback>}
    {model.actionError && !model.workflow.cancelTaskId && !model.editorOpen && !model.intakeOpen && !model.projectOpen && !model.projectManagerOpen && <Feedback tone="error" role="alert">{model.actionError}</Feedback>}{model.workflow.error && !model.workflow.cancelTaskId && !model.workflow.dispatchOpen && !model.workflow.importOpen && !model.workflow.goalOpen && !model.workflow.deliveryOpen && !model.editorOpen && !model.intakeOpen && <Feedback tone="error" role="alert">{model.workflow.error}</Feedback>}
    <div className={`tp-body${hasDetail ? ' tp-with-detail' : ''}`}><TabsContent value="board" className="tp-view"><Board model={model} /></TabsContent><TabsContent value="graph" className="tp-view"><RelationshipGraph model={model} /></TabsContent><TabsContent value="sessions" className="tp-view"><TaskSessions model={model} /></TabsContent><TabsContent value="memory" className="tp-view"><MemoryView model={model} /></TabsContent>{model.tab === 'graph' && model.graphMode === 'architecture' && node ? <NodeDetail node={node} model={model} /> : hasDetail && task && <TaskDetail task={task} model={model} />}</div>
    {!model.snapshot?.tasks.length && !model.loading && model.tab === 'board' && <p className="tp-empty-hint">先选择或接手仓库，任务记录会保存在该仓库的 .azcine 中。</p>}
    <ProjectManagerDialog model={model} /><ProjectDialog model={model} /><TaskEditor model={model} /><IntakeDialog model={model} /><TaskWorkflowDialogs model={model} />
  </Tabs>;
}
