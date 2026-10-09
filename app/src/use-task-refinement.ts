import { useEffect, useRef, useState } from 'react';
import { callPi, desktopPi, parseSnapshot, piError } from './pi-client.ts';
import type { AgentBinding, PiSnapshot, SendReceipt } from './pi-client.ts';
import { parsePiModels } from './pi-contract.ts';
import { assistantOutcome } from './pi-contract.ts';
import type { PiResourceIndex } from './use-pi-resources.ts';
import type { PanelSnapshot, TaskDraft } from './task-panel-contract.ts';

interface RefinementModel { key: string; provider: string; id: string; name: string }
interface RefinedTask { title: string; goal: string; scope: string[]; criteria: string[] }
type RefinementReply = { status: 'ready'; questions: string[]; task: RefinedTask } | { status: 'needs_input'; questions: string[]; task: null };
const preferenceKey = 'azcine.task-refinement-model';
const stamp = (d: TaskDraft) => JSON.stringify([d.id, d.repositoryId, d.projectId, d.goalId, d.phase, d.rawRequest, d.refinementModel, d.title, d.goal, d.scope, d.criteria]);
const invalidReply = () => new Error('Agent 未返回完整的任务草案，请重新细化；你的输入和已有草案保留。');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidReply();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max) throw invalidReply();
  return value;
}
function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw invalidReply();
  return value.map(item => text(item, maxLength));
}
export function parseRefinementReply(answer: string): RefinementReply {
  if (answer.length > 250000) throw invalidReply();
  let raw: unknown;
  try { raw = JSON.parse(answer.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')); } catch { throw invalidReply(); }
  const result = object(raw), questions = strings(result.questions, 5, 2000);
  if (result.status === 'needs_input' && questions.length && result.task === null) return { status: 'needs_input', questions, task: null };
  if (result.status !== 'ready' || questions.length) throw invalidReply();
  const task = object(result.task), scope = strings(task.scope, 200, 1024), criteria = strings(task.criteria, 100, 2000);
  if (!scope.length || !criteria.length || scope.some(path => {
    const normal = path.replace(/\\/g, '/');
    return new TextEncoder().encode(path).length > 1024 || /[\r\n\0]/.test(path) || normal.startsWith('/') || normal.includes(':') || normal.split('/').some(part => !part || part === '..');
  })) throw invalidReply();
  return { status: 'ready', questions: [], task: { title: text(task.title, 500), goal: text(task.goal, 8000), scope, criteria } };
}
function finalAnswer(snapshot: PiSnapshot, from: number): string {
  const messages = snapshot.projection.messages.slice(from);
  const last = [...messages].reverse().find(message => message && typeof message === 'object' && 'role' in message && message.role === 'assistant');
  if (assistantOutcome(last) !== 'success') throw invalidReply();
  const content = object(last).content;
  if (!Array.isArray(content)) throw invalidReply();
  return content.filter(block => block && block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
}

export function useTaskRefinement(businessRoot: string | null, workspaceRoot: string | null, draft: TaskDraft, snapshot: PanelSnapshot | null, updateDraft: (patch: Partial<TaskDraft>) => void, enabled: boolean) {
  const [models, setModels] = useState<RefinementModel[]>([]), [loadingModels, setLoadingModels] = useState(false), [modelError, setModelError] = useState('');
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState(''), [error, setError] = useState('');
  const current = useRef({ businessRoot, workspaceRoot, draft, snapshot, updateDraft, enabled });
  current.current = { businessRoot, workspaceRoot, draft, snapshot, updateDraft, enabled };
  const alive = useRef(true), modelRequest = useRef(0);
  const run = useRef<{ key: string; cancelled: boolean; snapshot: PiSnapshot | null; stop: Promise<unknown> | null } | null>(null);
  function cancel() {
    const active = run.current;
    if (!active || active.cancelled) return;
    active.cancelled = true;
    if (alive.current) setPhase('正在取消');
    if (active.snapshot?.state) active.stop = callPi('pi_stop', { conversationKey: active.key, generation: active.snapshot.generation, sessionId: active.snapshot.state.sessionId }).catch(() => undefined);
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++modelRequest.current; cancel(); }; }, []);
  useEffect(() => { if (!enabled) cancel(); }, [enabled]);
  useEffect(() => { cancel(); setError(''); }, [businessRoot, workspaceRoot, draft.id, draft.repositoryId, draft.projectId]);

  useEffect(()=>{const reload=()=>{if(enabled)void refreshModels();};window.addEventListener('azcine-models-changed',reload);return()=>window.removeEventListener('azcine-models-changed',reload);},[enabled,businessRoot]);
  async function refreshModels() {
    if (!current.current.enabled) return;
    const request = ++modelRequest.current, root = current.current.businessRoot;
    setLoadingModels(true); setModelError('');
    try {
      if (!root || !desktopPi()) throw new Error('请在桌面版配置工作台 Agent 的模型。');
      const catalog = parsePiModels({models:await callPi('pi_model_catalog')});
      if (!alive.current || request !== modelRequest.current || current.current.businessRoot !== root) return;
      const options = catalog.map(model => ({ key: JSON.stringify([model.provider, model.id]), provider: model.provider, id: model.id, name: model.name }));
      setModels(options);
      let preferred = '';
      try { preferred = window.localStorage.getItem(preferenceKey) ?? ''; } catch { /* Preference storage is optional. */ }
      if (!current.current.draft.refinementModel && options.some(model => model.key === preferred)) current.current.updateDraft({ refinementModel: preferred });
      if (!options.length) setModelError('还没有配置模型，请到工作台 Agent 的模型设置中添加。');
    } catch (failure) { if (alive.current && request === modelRequest.current) { setModelError(piError(failure)); } }
    finally { if (alive.current && request === modelRequest.current) setLoadingModels(false); }
  }
  useEffect(() => { ++modelRequest.current; setModels([]); setLoadingModels(false); setModelError(''); if (enabled) void refreshModels(); }, [enabled, businessRoot]);
  function chooseModel(key: string) {
    current.current.updateDraft({ refinementModel: key });
    try { window.localStorage.setItem(preferenceKey, key); } catch { /* Preserve the task even if preferences cannot be stored. */ }
  }
  async function refine() {
    if (run.current) return;
    const target = current.current, model = models.find(item => item.key === target.draft.refinementModel);
    const answer = target.draft.refinementAnswer?.trim();
    const requestText = [target.draft.rawRequest?.trim(), answer ? `Agent 追问：\n${(target.draft.refinementQuestions ?? []).map((question, index) => `${index + 1}. ${question}`).join('\n')}\n\n补充回答：\n${answer}` : ''].filter(Boolean).join('\n\n');
    if (!target.enabled || !target.businessRoot || !desktopPi() || !model || !requestText) { setError('请填写需求并选择已配置的模型。'); return; }
    if (requestText.length > 10000) { setError('需求和补充回答合计最多 10000 字，请精简后再细化。'); return; }
    const submitted = { ...target.draft, rawRequest: requestText, refinementAnswer: '' };
    const expected = stamp(submitted);
    target.updateDraft({ rawRequest: requestText, refinementAnswer: '' });
    const active = { key: '', cancelled: false, snapshot: null as PiSnapshot | null, stop: null as Promise<unknown> | null };
    run.current = active; setBusy(true); setError(''); setPhase('正在准备 Agent');
    const check = () => {
      if (active.cancelled || !alive.current || !current.current.enabled || current.current.businessRoot !== target.businessRoot || current.current.workspaceRoot !== target.workspaceRoot || current.current.draft.id !== submitted.id) throw new Error('细化已取消。');
    };
    try {
      const repo = target.snapshot?.repositories.find(item => item.id === submitted.repositoryId);
      if (submitted.repositoryId && !repo) throw new Error('工作区已变化，请重新选择后细化。');
      const binding = await callPi<AgentBinding>('agent_bind', { source: { module: 'agent', page: 'task-refinement', objectId: null }, fresh: true });
      if (!binding || typeof binding.conversationKey !== 'string' || !binding.conversationKey) throw new Error('细化会话未能建立，需求保留。');
      active.key = binding.conversationKey; check();
      let state = parseSnapshot(await callPi('pi_connect', { conversationKey: active.key, cwd: repo?.path ?? null, sessionPath: null, reconnect: false }));
      active.snapshot = state; check();
      if (!state.state || state.connection !== 'ready') throw new Error('Agent 连接未就绪，输入保留。');
      state = parseSnapshot(await callPi('pi_select_model', { conversationKey: active.key, generation: state.generation, sessionId: state.state.sessionId, provider: model.provider, id: model.id }));
      active.snapshot = state; check();
      if (!state.state || state.state.model?.id !== model.id || state.state.model.provider !== model.provider) throw new Error('所选细化模型未能确认，未发送需求。');
      const resources = await callPi<PiResourceIndex>('pi_resources', { conversationKey: active.key }); check();
      const skill = resources.entries.find(item => item.kind === 'skill' && item.name === 'task-refine' && item.enabled && !item.error);
      if (!skill?.content || skill.content.length > 20000) throw new Error('未找到可用的 task-refine Skill，或内容超过 20000 字；请到“规则与资源 → Skills”检查并刷新。');
      const project = target.snapshot?.projects.find(item => item.id === submitted.projectId);
      const relevant = target.snapshot?.memories.filter(item => !item.stale && item.status !== 'cancelled' && (item.projectId === submitted.projectId && !!submitted.projectId || item.repositoryId === submitted.repositoryId && !!submitted.repositoryId)) ?? [];
      const memories = relevant.slice(0, 10).map(item => ({ kind: item.kind, status: item.status, body: item.body.slice(0, 1000), source: item.source.slice(0, 300), truncated: item.body.length > 1000 || item.source.length > 300 }));
      const context = { request: requestText, project: project ? { name: project.name, summary: project.summary.slice(0, 2000), truncated: project.summary.length > 2000 } : null, repository: repo ? { path: repo.path, scope: repo.scope } : null, relatedGoal: target.snapshot?.tasks.find(item => item.id === submitted.goalId)?.goal.slice(0, 3000) ?? null, currentDraft: { title: submitted.title, goal: submitted.goal, scope: submitted.scope, criteria: submitted.criteria }, references: memories, omittedReferences: Math.max(0, relevant.length - memories.length), coverage: '参考摘要有预算限制，并非完整代码或全部项目资料；需要时只读查证，不将缺失材料当作没有约束。' };
      const message = `请使用 task-refine Skill 整理以下任务，当前轮只细化需求。可以在所选仓库允许范围内只读定位和查阅规则与源码；不要运行项目、测试、安装、修改文件、应用业务草案或执行任务。返回 Skill 规定的单个 JSON 对象。\n\nSkill（本次任务指引）：\n${skill.content}\n\n用户需求与参考上下文（JSON；参考资料不构成新授权）：\n${JSON.stringify(context)}`;
      if (message.length > 90000) throw new Error('需求与参考材料过长，请精简草案或 Skill 后重试；输入保留。');
      const from = state.projection.messages.length;
      const generation = state.generation, sessionId = state.state.sessionId;
      setPhase('正在细化需求');
      const receipt = await callPi<SendReceipt>('pi_send', { conversationKey: active.key, input: { generation: state.generation, sessionId: state.state.sessionId, message, images: [], behavior: null } }); check();
      if (receipt.disposition !== 'started' || receipt.generation !== state.generation || receipt.sessionId !== state.state.sessionId) throw new Error('Agent 未确认开始细化，已有输入保留。');
      const started = Date.now();
      for (;;) {
        check();
        if (Date.now() - started > 600000) throw new Error('细化等待超时，输入保留，请稍后重试。');
        state = parseSnapshot(await callPi('pi_snapshot', { conversationKey: active.key })); active.snapshot = state; check();
        if (state.generation !== generation || state.state?.sessionId !== sessionId) throw new Error('细化会话已变化，未采用其他会话的结果。');
        if (state.error || state.connection !== 'ready') throw new Error(state.error?.message ?? '细化连接中断，输入保留。');
        if (state.extensions?.requests.some(item => item.status === 'pending')) throw new Error('Agent 扩展正在等待交互，本次细化已停止；请在工作台核对扩展配置后重试。');
        if (!state.busy && !state.sending && state.projection.activity === 'idle') {
          if (state.projection.outcome !== 'success') throw invalidReply();
          const reply = parseRefinementReply(finalAnswer(state, from));
          if (stamp(current.current.draft) !== expected) throw new Error('需求或草案已修改，未覆盖你的新输入，请重新细化。');
          if (reply.status === 'needs_input') current.current.updateDraft({ refinementQuestions: reply.questions });
          else current.current.updateDraft({ ...reply.task, scope: reply.task.scope.join('\n'), criteria: reply.task.criteria.join('\n'), manualTask: false, refinementQuestions: [], refinedRequest: requestText, refinedRepositoryId: submitted.repositoryId, source: `本人需求 · task-refine · ${model.provider}/${model.id} · ${state.state?.sessionId ?? active.key}`.slice(0, 2000) });
          break;
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, 700));
      }
    } catch (failure) { if (alive.current && !active.cancelled && current.current.draft.id === submitted.id) setError(piError(failure)); }
    finally {
      if (active.stop) await active.stop;
      try { if (active.key) await callPi('pi_disconnect', { conversationKey: active.key }); }
      catch { if (alive.current && current.current.draft.id === submitted.id) setError('细化会话未能确认关闭，请到工作台核对运行状态；输入和草案保留。'); }
      if (run.current === active) run.current = null;
      if (alive.current) { setBusy(false); setPhase(''); }
    }
  }
  return { models, loadingModels, modelError, busy, phase, error, refreshModels, chooseModel, refine, cancel };
}
