import { useEffect, useState } from 'react';
import { useTaskPanel } from '../use-task-panel.ts';
import type { TaskPanelController } from '../use-task-panel.ts';
import { liveExecution, newTaskDraft, nonEmptyLines } from '../task-panel-contract.ts';
import type { ContextPackage, GraphNode, GraphQuery, GraphView, PanelSnapshot, Relation, TaskView } from '../task-panel-contract.ts';
import { notifyOperation } from '../components/ui/operation-toast.tsx';

const at = '2026-10-07T02:30:00+08:00';
function sample(number: number, title: string, lane: TaskView['lane']): TaskView {
  return { plan: { projectId: 'fixture-project', goalId: 'fixture-goal', phase: '任务闭环' }, objectKind: 'task', id: `fixture-task-${number}`, number, title, goal: '按已确认范围补齐真实功能与交付依据。', scope: ['src'], criteria: ['保存后能重开接续', '前置与交付状态同源', '失败保留输入'], repositoryId: 'fixture-repository', lifecycle: 'active', pauseReason: '', source: 'UI 总览 · 虚构示例', resumeSummary: '已保存任务与决定，下次从当前暂停点继续。', revision: 3, createdAt: at, updatedAt: at, lane, reasonCodes: lane === 'human' ? ['missing_scope'] : lane === 'blocked' ? ['prerequisites'] : [], blockers: lane === 'blocked' ? ['fixture-task-110'] : [], allowedActions: lane === 'ready' ? ['edit', 'context', 'bind', 'dispatch'] : ['edit', 'context'], prerequisitesTotal: lane === 'blocked' ? 1 : 0, prerequisitesSatisfied: 0, executionState: lane === 'running' ? 'running' : lane === 'verify' ? 'reported_finished' : null, checkState: 'not_run', acceptanceState: lane === 'done' ? 'accepted' : 'not_accepted' };
}
export function taskPanelFixture(state: string): PanelSnapshot {
  const tasks = state === 'empty' ? [] : [sample(104, '选择要绑定的 Herdr server 与工作区', 'human'), sample(108, '依赖计算与阻塞原因解释', 'blocked'), sample(109, 'Herdr 会话列表与绑定', 'blocked'), sample(110, '派发预览与任务上下文包', 'running'), sample(111, '结果回执解析与证据登记', 'ready'), sample(112, '首次了解 previz-engine：Archify 建图', 'human'), sample(113, '修复关键帧插值跳变', 'ready'), sample(115, '关系图邻域查询、分页与截断提示', 'blocked'), sample(116, '交付文件与版本核对', 'verify')];
  if (state !== 'empty') {
    const goal = { ...sample(100, '完成影视工具任务闭环', 'human'), id: 'fixture-goal', objectKind: 'goal', repositoryId: null, plan: { projectId: 'fixture-project', goalId: null, phase: '' }, scope: [] };
    const other = { ...sample(201, '资产库：等待 Agent 接收确认', 'running'), repositoryId: 'fixture-repository-b', plan: { projectId: 'fixture-project-b', goalId: null, phase: '资产整理' }, executionState: 'awaiting_receipt' };
    tasks.push(goal, other);
  }
  if (state === 'long') for (const t of tasks) { t.title += ' · 包含长名称、中文标点及多个相关文件的任务'.repeat(5); t.goal = '长目标与理由。'.repeat(60); t.plan.phase = '包含较长名称的阶段与待核对事项'.repeat(3); }
  const branchPath='C:/AZCineTest/previz-engine/.azcine/worktrees/fix-component-color';
  const branchTask=tasks.find(t => t.id==='fixture-task-113');
  if(branchTask) branchTask.executionWorkspace={path:branchPath,branch:'fix/component-color',base:'fixture-head'};
  const target = tasks.find(t => t.id === 'fixture-task-112');
  if (target && ['task-panel-start-failed','task-panel-paused','task-panel-cancelled','long'].includes(state)) {
    target.pendingCreation = { kind: 'codex', paneName: '虚构仓库 · 建图', serverId: 'fixture-only', state: 'uncertain', workspaceId: 'fixture-workspace', paneId: 'fixture-pane', binding: null, reason: '示例：原窗格已创建，Agent 启动待核对；任务尚未发送。' };
    target.reasonCodes = ['creation_pending']; target.allowedActions = ['edit','context','bind','dispatch'];
    if (state === 'task-panel-paused') { target.lifecycle = 'paused'; target.reasonCodes.unshift('paused'); target.allowedActions = ['edit','context']; }
    if (state === 'task-panel-cancelled') { target.lifecycle = 'cancelled'; target.reasonCodes = ['cancelled']; target.allowedActions = ['edit','context']; }
  }
  if (target && ['task-panel-stopping','task-panel-stop-confirm'].includes(state)) {
    target.lane = 'running'; target.executionState = 'running'; target.stopPending = true; target.reasonCodes = ['stop_pending']; target.allowedActions = ['edit','context'];
  }
  if (state === 'conflict') tasks[0].revision = 4;
  const observedAt = new Date().toISOString();
  const sessions = ['working','blocked','unknown'].map((status,i)=>({ serverId:'fixture-only',workspaceId:'fixture-workspace',paneId:`fixture-pane-${i+1}`,agentId:`fixture-agent-${i+1}`,terminalId:`fixture-terminal-${i+1}`,kind:i===1?'pi':'codex',name:null,cwd:i===1?'C:/AZCineTest/asset-library':'C:/AZCineTest/previz-engine',state:status,interactiveReady:false,identityConfirmed:false,identitySource:'unverified' as const,processId:null,processCreatedAt:null,fixture:true,observedAt }));
  return { monitor:{observedAt,error:'UI 虚构示例 · 未连接 Herdr',sessions,runs:{},worktrees:{[branchPath]:{branch:'fix/component-color',head:'fixture-head',path:branchPath,changedFiles:1,observedAt,error:''}},git:{branch:'main',head:'fixture-head',path:'C:/AZCineTest/previz-engine',changedFiles:1,observedAt,error:''}}, projects: [{ id: 'fixture-project', name: state === 'long' ? '影视预演工具与场景资产管理长项目名称'.repeat(3) : '影视预演工具', summary: '本项目目标、代码与记忆分别可追溯。', repositoryIds: ['fixture-repository'], revision: 1, createdAt: at }, { id: 'fixture-project-b', name: '素材资产库', summary: '独立目录与独立 Herdr 会话推进。', repositoryIds: ['fixture-repository-b'], revision: 1, createdAt: at }], graphRevision: 3, tasks, repositories: [{ id: 'fixture-repository', label: 'previz-engine', path: 'C:\\AZCineTest\\previz-engine', scope: ['src'], revision: 1, createdAt: at }, { id: 'fixture-repository-b', label: 'asset-library', path: 'C:\\AZCineTest\\asset-library', scope: ['src'], revision: 1, createdAt: at }], relations: tasks.filter(t => t.lane === 'blocked').map(t => ({ id: `fixture-rel-${t.number}`, fromId: t.id, toId: 'fixture-task-110', kind: 'depends_on', threshold: 'acceptance', source: '虚构的本人决定', evidenceLevel: 'fixture', active: true, revision: 1 })), memories: [{ projectId: 'fixture-project', category: 'decision', originLevel: 'user_confirmed', sourceRefs: [{ description: '虚构的本人决定' }], stale: false, id: 'fixture-memory-1', taskId: null, repositoryId: null, kind: 'decision', body: '先保留来源和代码版本，关系导入由本人核对，不从图的颜色推断业务状态。', source: 'UI 总览虚构资料', status: 'active', supersedes: null, baseTaskRevision: 3, revision: 1, createdAt: at }, { projectId: 'fixture-project', category: 'reference', originLevel: 'claim', sourceRefs: [{ id: 'fixture-source', path: 'src/interpolation.ts', sha256: 'fixture-not-a-real-hash' }], stale: false, id: 'fixture-memory-2', taskId: 'fixture-task-113', repositoryId: null, kind: 'memory', body: '首次分析有三项未知，需要限定范围补充查证。', source: '虚构 Agent 交付片段', status: 'draft', supersedes: null, baseTaskRevision: 3, revision: 1, createdAt: at }, { id: 'fixture-memory-3', taskId: null, repositoryId: null, projectId: 'fixture-project-b', kind: 'decision', body: '建议调整资产导入范围，等待本人确认。', source: '虚构 Agent 建议', category: 'decision', originLevel: 'claim', sourceRefs: [], stale: false, status: 'draft', supersedes: null, baseTaskRevision: null, revision: 1, createdAt: at }], executions: tasks.filter(t => t.lane === 'running').map(t => ({ id: 'fixture-run-' + t.number, taskId: t.id, taskRevision: t.revision, contextId: 'fixture-context-' + t.number, bindingId: 'fixture-binding-' + t.number, bindingGeneration: 1, state: t.executionState ?? 'running', attempt: 1, requestId: 'fixture-request-' + t.number, authorization: [], snapshotId: null, reason: 'UI 虚构执行观察，未连接实际 Herdr。', createdAt: at, updatedAt: at })), bindings: [], evidence: [], events: tasks.map((t, i) => ({ sequence: i + 1, requestId: `fixture-event-${i}`, objectId: t.id, kind: t.pendingCreation ? 'herdr_creation_observation' : 'mutation', actor: 'user', detail: t.pendingCreation ? JSON.stringify(t.pendingCreation) : '虚构任务已保存，实际未执行任何外部操作。', createdAt: at })), lastSequence: tasks.length };
}
export function usePreviewTaskPanel(state: string): TaskPanelController {
  const base = useTaskPanel(null, false);
  useEffect(() => { if (state === 'task-panel-graph') base.setGraphMode('task'); else if (state === 'task-panel-code-graph' || state === 'task-panel-graph-long') base.setGraphMode('architecture'); }, [state]);
  useEffect(() => { if (state === 'task-panel-memory-reference') base.setMemoryFilter('reference'); else if (state === 'task-panel-memory-pending') base.setMemoryFilter('pending'); else base.setMemoryFilter('active'); }, [state]);
  const [snapshot, setSnapshot] = useState(() => taskPanelFixture(state));
  useEffect(() => { if (state === 'task-panel-cancelled') base.setShowCancelled(true); if (state === 'task-panel-stop-confirm') base.workflow.setCancelTaskId('fixture-task-112'); }, [state]);
  const [error, setError] = useState(state === 'error' || state === 'conflict' ? '示例：保存失败或正式记录已改变，原内容与草稿保留。' : '');
  const [graph, setGraph] = useState<GraphView | null>(null);
  const notify = () => notifyOperation('UI 示例：只改变本页虚构记录。');
  async function saveTask() {
    if (state === 'error' || state === 'conflict') { setError('示例：旧修订未覆盖新记录，输入保留。'); return null; }
    const task: TaskView = { ...sample(snapshot.tasks.length + 120, base.draft.title, 'ready'), id: base.draft.id, title: base.draft.title, goal: base.draft.goal, scope: nonEmptyLines(base.draft.scope), criteria: nonEmptyLines(base.draft.criteria), repositoryId: base.draft.repositoryId || null, plan: { projectId: base.draft.projectId || null, goalId: base.draft.goalId || null, phase: base.draft.phase }, revision: (base.draft.expectedRevision ?? 0) + 1 };
    setSnapshot(before => ({ ...before, tasks: [...before.tasks.filter(t => t.id !== task.id), task] }));
    base.closeEditor(false); base.updateDraft(newTaskDraft()); notify(); return { objectId: task.id, revision: task.revision, sequence: 0 };
  }
  return { ...base, root: 'C:\\ui-fixture\\repository', workspaces: [{ path: 'C:\\ui-fixture\\repository', label: '虚构工作仓库' }], openWorkspace: async () => { notify(); return null; }, snapshot, selectedId: base.selectedId ?? (state === 'empty' ? null : 'fixture-task-112'), loading: state === 'loading', loadError: state === 'error' ? '示例读取失败，保留现有任务。' : '', action: state === 'pending' ? '保存结果待核对' : '', actionError: error, setActionError: setError, graph,
    tab: ['task-panel-graph','task-panel-code-graph','task-panel-graph-long'].includes(state) ? 'graph' : state.startsWith('task-panel-memory') ? 'memory' : state === 'task-panel-sessions' ? 'sessions' : base.tab,
    editorOpen: state === 'dirty' || state === 'conflict' || state === 'task-panel-editor' || base.editorOpen,
    intakeOpen: ['task-panel-intake','task-panel-intake-launch'].includes(state) || base.intakeOpen,
    intake: state === 'task-panel-intake-launch' ? { ...base.intake, id: 'fixture-repository', label: '虚构工作仓库', path: 'C:\\ui-fixture\\repository', step: 2, paneName: '虚构工作仓库 · 建图' } : base.intake,
    projectOpen: state === 'task-panel-project' || base.projectOpen,
    workflow: { ...base.workflow,
      launch: async () => { notify(); return null; },
      input: async <T,>(name: string, _label: string, payload: Record<string, unknown>): Promise<T | null> => {
        if (name === 'execution_action') {
          const run = snapshot.executions.find(r => r.id === payload.executionId);
          if (run) setSnapshot(before => ({ ...before, tasks: before.tasks.map(t => t.id === run.taskId && payload.action === 'interrupt' ? { ...t, stopPending: true, reasonCodes: ['stop_pending'] } : t) }));
        }
        notify(); return null;
      },
      loadAccesses: async () => {},
      context: state === 'task-panel-context' ? previewContext(snapshot) : base.workflow.context,
      goalOpen: state === 'task-panel-goal' || base.workflow.goalOpen,
      dispatchOpen: ['task-panel-dispatch','task-panel-context'].includes(state) || base.workflow.dispatchOpen,
      dispatchTaskId: ['task-panel-dispatch','task-panel-context'].includes(state) ? 'fixture-task-113' : base.workflow.dispatchTaskId,
      importOpen: state === 'task-panel-import' || base.workflow.importOpen,
      deliveryOpen: state === 'task-panel-delivery' || base.workflow.deliveryOpen,
      deliveryTaskId: state === 'task-panel-delivery' ? 'fixture-task-116' : base.workflow.deliveryTaskId,
      recoveryOpen: state === 'task-panel-recovery' || base.workflow.recoveryOpen,
      recovery: state === 'task-panel-recovery' ? { task: snapshot.tasks.find(t => t.number === 116)!, execution: { id: 'fixture-run', taskId: 'fixture-task-116', taskRevision: 3, contextId: 'fixture-context', bindingId: 'fixture-binding', bindingGeneration: 1, state: 'disconnected', attempt: 1, requestId: 'fixture-request', authorization: [], snapshotId: null, reason: '虚构的失联记录', createdAt: at, updatedAt: at }, files: [{ path: 'src/interpolation.ts', beforeHash: 'fixture-before', currentHash: 'fixture-after', change: 'modified', restorable: false, reason: '只保留哈希，未保存源文件原文；不能声称可直接恢复。' }], evidence: [], missing: ['UI 虚构恢复材料，不代表真实代码已运行或可回滚。'], currentFingerprint: 'fixture-fingerprint', preservedSources: [], affectedTasks: ['fixture-task-115'] } : base.workflow.recovery,
    },
    refresh: async () => { notify(); }, saveTask,
    saveProject: async () => { const d = base.projectDraft; const revision = (d.expectedRevision ?? 0) + 1; setSnapshot(before => ({ ...before, projects: [...before.projects.filter(p => p.id !== d.id), { id: d.id, name: d.name, summary: d.summary, repositoryIds: d.repositoryIds, revision, createdAt: at }] })); base.closeProject(false); base.setProjectFilter(d.id); notify(); return { objectId: d.id, revision, sequence: 0 }; },
    mutate: async (action, revision) => {
      if (state === 'error' || state === 'conflict') { setError('示例操作失败，输入已保留。'); return null; }
      if (action.type === 'lifecycle' || action.type === 'cancel_stopped_execution') {
        const current = snapshot.tasks.find(t => t.id === action.id);
        if (current?.revision !== revision) { setError('示例：任务版本已改变，请核对。'); return null; }
        if (action.type === 'lifecycle' && action.lifecycle === 'cancelled' && snapshot.executions.some(r => r.taskId === action.id && liveExecution(r.state))) { setError('示例：原执行尚未停止，请先核对。'); return null; }
        const lifecycle = (action.type === 'lifecycle' ? action.lifecycle : 'cancelled') as TaskView['lifecycle'];
        setSnapshot(before => ({ ...before, tasks: before.tasks.map<TaskView>(t => t.id === action.id ? { ...t, lifecycle, stopPending: false, revision: t.revision + 1, lane: lifecycle === 'active' && !t.pendingCreation ? 'ready' : 'human', reasonCodes: lifecycle === 'active' ? t.pendingCreation ? ['creation_pending'] : [] : [lifecycle], allowedActions: lifecycle === 'active' ? ['edit','context','bind','dispatch'] : ['edit','context'], executionState: action.type === 'cancel_stopped_execution' ? 'cancelled' : t.executionState } : t), executions: before.executions.map(r => action.type === 'cancel_stopped_execution' && r.id === action.executionId ? { ...r, state: 'cancelled' } : r) }));
      }
      if (action.type === 'apply_memory' || action.type === 'cancel_memory') setSnapshot(before => ({ ...before, memories: before.memories.map(m => m.id === action.id ? { ...m, status: action.type === 'apply_memory' ? 'active' : 'cancelled', revision: m.revision + 1 } : m) }));
      if (action.type === 'update_memory_draft') setSnapshot(before => ({ ...before, memories: before.memories.map(m => m.id === action.id ? { ...m, body: action.body, source: action.source, kind: action.kind, stale: false, revision: m.revision + 1 } : m) }));
      if (action.type === 'memory_draft') setSnapshot(before => ({ ...before, memories: [...before.memories, { ...action, projectId: action.projectId ?? before.tasks.find(t => t.id === action.taskId)?.plan.projectId, status: 'draft', baseTaskRevision: revision, revision: 1, createdAt: at, category: ['memory','pause'].includes(action.kind) ? 'reference' : 'decision', originLevel: 'user_confirmed', sourceRefs: [], stale: false }] }));
      notify(); return { objectId: 'id' in action ? action.id : 'fixture', revision: (revision ?? 0) + 1, sequence: 0 };
    },
    loadGraph: async input => { const next = previewGraph(snapshot, input); if (state === 'task-panel-graph-long') for (const node of next.nodes) node.label += ' · 很长的中文名称与文件定位'.repeat(8); setGraph(next); },
    saveRepository: async () => { base.setIntake(before => ({ ...before, step: 2 })); notify(); return { path: 'C:\\ui-fixture\\repository', label: '虚构工作仓库', repositoryId: 'fixture-repository', projectId: 'fixture-project', dataDirectory: 'C:\\ui-fixture\\repository\\.azcine\\task-panel', skillPath: 'E:\\skills-manager\\archify', scope: ['.'], migration: '' }; },

  };
}

function previewContext(snapshot: PanelSnapshot): ContextPackage {
  const task = snapshot.tasks.find(t => t.id === 'fixture-task-113')!;
  return { id: 'fixture-context-preview', taskId: task.id, taskRevision: task.revision, graphRevision: 3, title: task.title, goal: task.goal, scope: task.scope, acceptanceCriteria: task.criteria, workspaceSnapshot: null, dependencies: [], decisions: snapshot.memories.filter(m => m.status === 'active'), references: snapshot.memories.filter(m => m.category === 'reference'), evidence: [], relatedFiles: [], impactCandidates: [], resumeSummary: '虚构示例：已定位候选文件，尚未实际修改。', sourceRefs: ['UI 总览虚构资料'], missingInformation: ['UI 虚构上下文，未读取真实目录或运行 Agent。'], hash: 'fixture-not-a-real-hash', project: snapshot.projects[0], plan: task.plan, omittedItems: 0 };
}

function previewGraph(snapshot: PanelSnapshot, input: GraphQuery): GraphView {
  if (input.layer === 'code') return previewCodeGraph();
  const selected = snapshot.tasks.filter(t => !input.projectId || t.plan.projectId === input.projectId);
  const projects = snapshot.projects.filter(p => !input.projectId || p.id === input.projectId);
  const nodes: GraphNode[] = selected.map(t => ({ id: t.id, repositoryId: t.repositoryId, kind: t.objectKind, label: t.title, path: '', symbol: '', evidenceLevel: 'fixture', sources: ['虚构资料'], stale: false }));
  nodes.push(...projects.map(p => ({ id: p.id, repositoryId: null, kind: 'project', label: p.name, path: '', symbol: '', evidenceLevel: 'fixture' as const, sources: ['虚构项目归属'], stale: false })));
  const relations: Relation[] = [...snapshot.relations];
  const link = (fromId: string, toId: string, kind: string) => relations.push({ id: 'fixture-' + fromId + '-' + toId, fromId, toId, kind, threshold: 'none', source: 'UI 虚构关系；不代表实际分析', evidenceLevel: 'fixture', active: true, revision: 1 });
  for (const task of selected) { if (task.plan.projectId) link(task.plan.goalId ?? task.plan.projectId, task.id, 'contains'); }
  if (projects.some(p => p.id === 'fixture-project')) {
    nodes.push({ id: 'fixture-file', repositoryId: 'fixture-repository', kind: 'file', label: 'interpolation.ts', path: 'src/interpolation.ts', symbol: '', evidenceLevel: 'fixture', sources: [{ path: 'src/interpolation.ts', lineStart: 12, sha256: 'fixture-not-a-real-hash' }], stale: false }, { id: 'fixture-symbol', repositoryId: 'fixture-repository', kind: 'symbol', label: 'interpolate', path: 'src/interpolation.ts', symbol: 'interpolate', evidenceLevel: 'fixture', sources: ['虚构声明定位'], stale: true });
    link('fixture-task-113', 'fixture-file', 'related_to'); link('fixture-file', 'fixture-symbol', 'contains');
  }
  const visible = nodes.filter(n => input.layer === 'code' ? ['file','symbol'].includes(n.kind) || n.id === input.taskId : input.layer === 'execution' ? !['file','symbol'].includes(n.kind) : true);
  const ids = new Set(visible.map(n => n.id));
  return { graphRevision: 3, nodes: visible, relations: relations.filter(r => ids.has(r.fromId) && ids.has(r.toId)), totalNodes: visible.length, offset: 0, hasMore: false, coverage: ['UI 虚构业务图和代码图'], unknowns: ['UI 虚构图谱，不代表实际仓库已分析。'] };
}

function previewCodeGraph(): GraphView {
  const records = [
    ['ui-projects','项目页','component','app/src/projects-panels.tsx'],['ui-news','资讯阅读','component','app/src/news-reader-panels.tsx'],['ui-agent','Agent 页','component','app/src/pi-agent-panel.tsx'],['ui-tasks','任务面板','component','app/src/task-panel-panels.tsx'],
    ['api','桌面接口','interface','app/src/desktop-api.ts'],
    ['projects','项目服务','service','app/src-tauri/src/projects.rs'],['news','资讯管线','service','app/src-tauri/src/news-pipeline.rs'],['pi-service','Pi 进程管理','service','app/src-tauri/src/pi-manager.rs'],['tasks','任务存储','service','app/src-tauri/src/task-panel-store.rs'],['herdr-service','Herdr 适配器','service','app/src-tauri/src/herdr-adapter.rs'],
    ['db','SQLite','storage','db/fixture.sqlite3'],['pi','Pi RPC','external','虚构进程'],['rss','RSS / Atom','external','虚构来源'],['herdr','Herdr','external','虚构服务'],
  ];
  const nodes: GraphNode[] = records.map(([id,label,kind,path]) => ({ id:'fixture-code-'+id, label, kind, path, symbol:'', repositoryId:'fixture-repository', evidenceLevel:'fixture', stale:id==='tasks', sources:[{description:'UI 虚构结构，仅用于关系图展示，不代表仓库分析结论',path}] }));
  const links = [['ui-projects','api'],['ui-news','api'],['ui-agent','api'],['ui-tasks','api'],['api','projects'],['api','news'],['api','pi-service'],['api','tasks'],['api','herdr-service'],['projects','db'],['news','db'],['news','rss'],['pi-service','pi'],['tasks','db'],['herdr-service','herdr']];
  const relations: Relation[] = links.map(([from,to],i) => ({ id:'fixture-code-edge-'+i, fromId:'fixture-code-'+from, toId:'fixture-code-'+to, kind:'related_to', threshold:'none', source:'UI 虚构关系', evidenceLevel:'fixture', active:true, revision:1 }));
  return {graphRevision:3,nodes,relations,totalNodes:nodes.length,offset:0,hasMore:false,coverage:['UI 虚构代码结构'],unknowns:['UI 虚构图谱，不代表实际仓库已分析。']};
}
