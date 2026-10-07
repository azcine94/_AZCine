import { useEffect, useRef, useState } from 'react';
import { isTauri } from './desktop-api.ts';
import { taskPanelClient } from './task-panel-client.ts';
import { taskError } from './task-panel-contract.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import type { AgentAccess, Binding, ContextPackage, Execution, HerdrCapabilities, HerdrConfig, HerdrSession, ImportPreview, RecoveryPreview, ResultReview, TaskView } from './task-panel-contract.ts';

export function useTaskPanelWorkflow(root: string | null, refresh: () => Promise<void>) {
  const client = taskPanelClient(root);
  const [action, setAction] = useState(''), [error, setError] = useState('');
  const [cancelTaskId, setCancelTaskId] = useState('');
  const [config, setConfig] = useState<HerdrConfig>({ executable: '', session: '' });
  const [capabilities, setCapabilities] = useState<HerdrCapabilities | null>(null), [sessions, setSessions] = useState<HerdrSession[]>([]);
  const [accesses, setAccesses] = useState<AgentAccess[]>([]), [accessResult, setAccessResult] = useState<AgentAccess | null>(null);
  const [accessDrafts, setAccessDrafts] = useState<Record<string, { directory: string; approved: boolean }>>({});
  const [context, setContext] = useState<ContextPackage | null>(null), [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchTaskId, setDispatchTaskId] = useState('');
  const [creationResult, setCreationResult] = useState<{state:string;workspaceId:string|null;paneId:string|null;binding:Binding|null;reason:string}|null>(null);
  const [dispatchDraft, setDispatchDraft] = useState({ paneId: '', exchangeDirectory: '', kind: 'codex', paneName: '', mode: 'new', allowedActions: ['read_scoped_files', 'edit_task_files', 'write_delivery_artifacts'], approved: false });
  const [importOpen, setImportOpen] = useState(false), [imports, setImports] = useState<ImportPreview[]>([]), [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importDraft, setImportDraft] = useState({ repositoryId: '', factsPath: '', source: '', relationIds: [] as string[], approved: false });
  const [goalOpen, setGoalOpen] = useState(false), [goalDraft, setGoalDraft] = useState({ title: '', goal: '', requirements: '', decisions: '', designs: '', planJson: '', source: '本人目标与选定规划材料', parentRepositoryId: '', newDirectory: '', initializeGit: false, installDependencies: false, approved: false, projectId: '' });
  const [deliveryOpen, setDeliveryOpen] = useState(false), [deliveryTaskId, setDeliveryTaskId] = useState('');
  const [deliveryDraft, setDeliveryDraft] = useState({ executionId: '', path: '', reason: '', approved: false, acknowledgeUnverified: false, command: '', exitCode: '', logPath: '', coverage: '.', checkStatus: 'not_run' });
  const [resultReview, setResultReview] = useState<ResultReview | null>(null), [recovery, setRecovery] = useState<RecoveryPreview | null>(null), [recoveryOpen, setRecoveryOpen] = useState(false);
  const [analysisDraft, setAnalysisDraft] = useState({ repositoryId: '', skillPath: '', exchangeDirectory: '', focus: '', incremental: false, approved: false });
  const lock = useRef(false), identity = useRef({ root, generation: 0 }), alive = useRef(true), requests = useRef(new Map<string, string>());
  if (identity.current.root !== root) identity.current = { root, generation: identity.current.generation + 1 };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function perform<T>(label: string, fn: () => Promise<T>, changed = false): Promise<T | null> {
    if (lock.current) return null;
    if (!root || !isTauri()) { setError('请在桌面应用中选择任务仓库后操作；界面示例不会读写真实记录。'); return null; }
    const generation = identity.current.generation; lock.current = true; setAction(label); setError('');
    try { const value = await fn(); if (!alive.current || generation !== identity.current.generation) return null; if (changed) { await refresh(); if (!alive.current || generation !== identity.current.generation) return null; const pending = typeof value === 'object' && value && ('state' in value && ['uncertain','sending','awaiting_receipt','disconnected'].includes(String(value.state)) || 'status' in value && ['needs_review','quarantined'].includes(String(value.status))); notifyOperation(pending ? `${label}的记录已保存，结果待核对` : `${label}的记录已更新`, { tone: 'info' }); } return value; }
    catch (e) { if (alive.current && generation === identity.current.generation) { if (changed) await refresh(); if (alive.current && generation === identity.current.generation) setError(taskError(e)); } return null; }
    finally { lock.current = false; if (alive.current && generation === identity.current.generation) setAction(''); }
  }
  async function input<T>(name: string, label: string, payload: Record<string, unknown>, changed = true): Promise<T | null> {
    const key = JSON.stringify({ root, name, payload }), requestId = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, requestId);
    const result = await perform(label, () => client.input<T>(name, { ...payload, requestId }), changed);
    if (result !== null && name !== 'create_execution' && !(typeof result === 'object' && result && 'state' in result && result.state === 'uncertain')) requests.current.delete(key); return result;
  }
  useEffect(() => {
    let active = true;
    setCancelTaskId('');
    setDispatchOpen(false); setDeliveryOpen(false); setRecoveryOpen(false); setImportOpen(false); setGoalOpen(false); setAction(''); setError(''); setConfig({ executable: '', session: '' }); setDispatchDraft(d => ({ ...d, approved: false, paneId: '' }));
    setContext(null); setSessions([]); setImports([]); setImportPreview(null); setResultReview(null); setRecovery(null); setCapabilities(null);
    setAccesses([]); setAccessResult(null); setAccessDrafts(drafts => Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [id, { ...draft, approved: false }])));
    if (root && isTauri()) void client.herdrConfig().then(c => { if (active) setConfig(c); }).catch(() => {});
    return () => { active = false; };
  }, [root]);
  async function status() { const c = await perform('核对 Herdr 能力', client.herdrStatus); if (c) setCapabilities(c); }
  async function saveConfig() { const c = await perform('保存 Herdr 入口', () => client.saveHerdrConfig(config), true); if (c) { setSessions([]); setCapabilities(null); } }
  async function loadSessions() { const s = await perform('读取会话元数据', client.sessions); if (s) setSessions(s); }
  async function loadImports() { const rows = await perform('读取导入草案', client.imports); if (rows) setImports(rows); }
  async function buildContext(task: TaskView) { const c = await input<ContextPackage>('context', '生成上下文预览', { taskId: task.id, expectedRevision: task.revision }, false); if (c) setContext(c); return c; }
  function openDispatch(task: TaskView) { if (dispatchTaskId !== task.id) setCreationResult(null); setError(''); setDispatchTaskId(task.id); setDispatchOpen(true); if (context?.taskId !== task.id || context.taskRevision !== task.revision) setContext(null); setDispatchDraft(d => ({ ...d, kind: task.pendingCreation?.kind ?? d.kind, paneName: task.pendingCreation?.paneName || task.title, allowedActions: task.recommendedActions?.length ? task.recommendedActions : d.allowedActions, approved: false })); }
  async function launch(task: TaskView, kind: string, paneName: string, allowedActions = task.recommendedActions?.length ? task.recommendedActions : ['read_scoped_files', 'edit_task_files', 'write_delivery_artifacts']) {
    if (['failed','superseded','cancelled'].includes(task.executionState || '')) { for (const key of requests.current.keys()) { const prior = JSON.parse(key); if (prior.root === root && prior.name === 'launch' && prior.payload.taskId === task.id) requests.current.delete(key); } }
    const run = await input<Execution>('launch', task.pendingCreation ? '核对原窗格并重试交接' : '开始任务交接', { taskId: task.id, expectedRevision: task.revision, kind, paneName: paneName.trim() || task.title.slice(0, 64), allowedActions, approved: true });
    if (run) { setDispatchOpen(false); setError(['failed','uncertain','disconnected'].includes(run.state) ? run.reason : ''); }
    return run;
  }
  async function previewImport() { const p = await input<ImportPreview>('import_preview', '核对三件产物', { repositoryId: importDraft.repositoryId, factsPath: importDraft.factsPath, source: importDraft.source || '本人选择的分析包' }, false); if (p) { setImportPreview(p); setImportDraft(d => ({ ...d, relationIds: p.facts.relations.map(r => r.id), approved: false })); } }
  async function reviewResult() { const p = await input<ResultReview>('result', '接收并核对回执', { executionId: deliveryDraft.executionId, path: deliveryDraft.path }); if (p) setResultReview(p); }
  async function showRecovery(executionId: string) { const p = await perform('读取恢复依据', () => client.recovery(executionId)); if (p) { setRecovery(p); setRecoveryOpen(true); } }
  async function loadAccesses() { const rows = await perform('读取本任务接入记录', client.accesses); if (rows) setAccesses(rows); }
  return { launch, action, error, setError, cancelTaskId, setCancelTaskId, input, perform, config, setConfig, capabilities, status, saveConfig, sessions, loadSessions, accesses, loadAccesses, accessResult, setAccessResult, accessDrafts, setAccessDrafts, context, setContext, buildContext, dispatchOpen, setDispatchOpen, dispatchTaskId, creationResult, setCreationResult, dispatchDraft, setDispatchDraft, openDispatch,
    importOpen, setImportOpen, imports, loadImports, importPreview, setImportPreview, importDraft, setImportDraft, previewImport, goalOpen, setGoalOpen, goalDraft, setGoalDraft,
    deliveryOpen, setDeliveryOpen, deliveryTaskId, setDeliveryTaskId, deliveryDraft, setDeliveryDraft, resultReview, setResultReview, reviewResult, recovery, recoveryOpen, setRecoveryOpen, showRecovery, analysisDraft, setAnalysisDraft };
}
