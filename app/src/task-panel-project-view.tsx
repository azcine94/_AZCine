import { useEffect } from 'react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { Label } from './components/ui/label.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import { Card } from './components/ui/card.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs.tsx';
import type { TaskPanelController } from './use-task-panel.ts';
import type { AgentAccess, ContextPackage, Memory, TaskView } from './task-panel-contract.ts';
import { taskNumber } from './task-panel-contract.ts';

export function ProjectDialog({ model }: { model: TaskPanelController }) {
  const d = model.projectDraft;
  return <FormDialog open={model.projectOpen} onOpenChange={model.closeProject} title={d.expectedRevision ? '项目归属与工作区' : '新建项目'} description="每个项目分别保存目标、任务和记忆，可关联多个独立工作区。" wide>
    <form className="tp-form" onSubmit={e => { e.preventDefault(); void model.saveProject(); }}>
      <Label className="grid items-start font-normal leading-5">项目名称<Input variant="app" required maxLength={200} value={d.name} onChange={e => model.setProjectDraft(v => ({ ...v, name: e.target.value }))} /></Label>
      <Label className="grid items-start font-normal leading-5">项目说明<Textarea variant="app" rows={3} maxLength={10000} value={d.summary} onChange={e => model.setProjectDraft(v => ({ ...v, summary: e.target.value }))} /></Label>
      <section><h3>工作区</h3>{model.snapshot?.repositories.filter(r => !model.snapshot?.projects.some(p => p.id !== d.id && p.repositoryIds.includes(r.id))).map(r => <Label className="tp-check" key={r.id}><Checkbox checked={d.repositoryIds.includes(r.id)} disabled={model.snapshot?.projects.find(p => p.id === d.id)?.repositoryIds.includes(r.id)} onCheckedChange={checked => model.setProjectDraft(v => ({ ...v, repositoryIds: checked === true ? [...v.repositoryIds, r.id] : v.repositoryIds.filter(id => id !== r.id) }))} />{r.label}</Label>)}<p className="tp-meta">已有归属和历史记录保留。接手仓库时可以将新目录登记到此项目。</p></section>
      {model.actionError && <Feedback tone="error">{model.actionError}</Feedback>}
      <footer className="tp-form-footer"><Button type="button" variant="outline" onClick={() => model.closeProject(false)}>关闭</Button><Button disabled={!!model.action}>{model.action || '保存项目'}</Button></footer>
    </form>
  </FormDialog>;
}

export function TaskPlanFields({ model }: { model: TaskPanelController }) {
  const d = model.draft;
  return <><Label className="grid items-start font-normal leading-5">所属项目<NativeSelect variant="app" value={d.projectId} onChange={e => model.updateDraft({ projectId: e.target.value, goalId: '', phase: '', repositoryId: '' })}><option value="">尚未归属项目</option>{model.snapshot?.projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</NativeSelect></Label>
    <div className="tp-grid2"><Label className="grid items-start font-normal leading-5">关联目标<NativeSelect variant="app" value={d.goalId} disabled={!d.projectId} onChange={e => model.updateDraft({ goalId: e.target.value, phase: '' })}><option value="">独立任务</option>{model.snapshot?.tasks.filter(t => t.objectKind === 'goal' && t.plan.projectId === d.projectId && t.id !== d.id).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</NativeSelect></Label>
    <Label className="grid items-start font-normal leading-5">阶段<Input variant="app" maxLength={100} value={d.phase} disabled={!d.projectId} onChange={e => model.updateDraft({ phase: e.target.value })} placeholder="例如：数据接入" /></Label></div></>;
}

export function TaskAgentAccess({ model, task }: { model: TaskPanelController; task: TaskView }) {
  const w = model.workflow, d = w.accessDrafts[task.id] ?? { directory: '', approved: false };
  const update = (patch: Partial<typeof d>) => w.setAccessDrafts(v => ({ ...v, [task.id]: { ...(v[task.id] ?? { directory: '', approved: false }), ...patch } }));
  useEffect(() => { update({ approved: false }); void w.loadAccesses(); }, [task.id, task.revision]);
  const rows = w.accesses.filter(a => a.taskId === task.id);
  const result = rows.find(a => a.active && a.command) ?? (w.accessResult?.taskId === task.id && rows.some(a => a.id === w.accessResult?.id && a.active) ? w.accessResult : null);
  return <details className="tp-disclosure"><summary>让当前 Agent 查询项目与回填</summary><div className="tp-form">
    <p className="tp-meta">Agent 可查询本项目进展、有效决定和代码关系，读取本任务范围原件，提交候选与回执。你继续在 Herdr 中工作。</p>
    <p className="tp-meta">接入文件自动保存在当前仓库 .azcine/task-panel/tasks 下。自动派发时已一并交给 Agent。</p>
    <Label className="tp-check"><Checkbox checked={d.approved} onCheckedChange={v => update({ approved: v === true })} />允许此任务查询所属项目、读取任务范围源码和提交候选；执行动作仍按原授权</Label>
    <Button variant="outline" disabled={!!w.action || !task.plan.projectId || !d.approved} onClick={async () => {
      const access = await w.input<AgentAccess>('agent_access', '开放本任务接入', { taskId: task.id, expectedRevision: task.revision, directory: '', approved: d.approved });
      if (access) { w.setAccessResult(access); update({ approved: false }); await w.loadAccesses(); }
    }}>生成本任务接入命令</Button>
    {!task.plan.projectId && <p className="tp-meta">先在任务中选择所属项目。</p>}
    {result && <section className="tp-next"><p>{result.reason}</p><pre className="tp-source">{result.command}</pre><Button size="sm" variant="outline" onClick={() => void w.perform('复制本任务查询命令', async () => { await navigator.clipboard.writeText(result.command); return true; }, true)}>复制给原 Herdr 会话</Button>
      <details className="tp-disclosure"><summary>可查询和回填的内容</summary><p className="tp-meta">frontier 查看项目进度；task 查看本任务；context 保存上下文快照；graph 查询两图；source 按对象 ID 回读原件；propose_memory 提交候选；submit_result 提交已绑定执行的回执。</p><p className="tp-meta">将命令末尾 frontier 换成 help 可查看参数示例。输入放在 JSON 文件，通过 --input 指定。context、propose_memory、submit_result 使用固定 --request-id；超时后保留同一 ID 核对。接入文件只交给本任务，不加入 Git 或分享产物。</p></details></section>}
    {rows.map(a => <div className="tp-memory-item" key={a.id}><p>{a.active ? '接入有效' : '接入已失效'} · r{a.taskRevision}</p><p className="tp-meta">{a.reason}</p>{a.active && <Button size="sm" variant="ghost" disabled={!!w.action} onClick={async () => { const result = await w.input('agent_revoke', '撤销本任务接入', { id: a.id }); if (result) await w.loadAccesses(); }}>撤销接入</Button>}</div>)}
  </div></details>;
}

export function ContextSummary({ context }: { context: ContextPackage }) {
  return <div className="tp-form"><p className="tp-meta">{context.project?.name ?? '尚未归属项目'}{context.plan?.phase && ` / ${context.plan.phase}`}</p>
    <section><h4>当前目标与完成条件</h4><p>{context.goal}</p><ul className="tp-plain-list">{context.acceptanceCriteria.map((s, i) => <li key={i}>{s}</li>)}</ul></section>
    <section><h4>有效决定与约束 · {context.decisions.length}</h4>{context.decisions.map(m => <div className="tp-memory-item" key={m.id}><p>{m.body}</p><span className="tp-meta">{m.source} · 已采纳{m.originLevel === 'claim' && '，原始来源仍为 Agent 声明'}</span></div>)}</section>
    <section><h4>最近进展与暂停点</h4><p>{context.resumeSummary || '尚无本人保存的接续摘要。'}</p>{context.references?.map(m => <div className="tp-memory-item" key={m.id}><Badge variant="outline">{m.originLevel === 'claim' ? 'Agent 参考 · 未核实' : '已登记参考'}</Badge><p>{m.body}</p><span className="tp-meta">{m.source}</span></div>)}</section>
    <details className="tp-disclosure"><summary>相关代码与版本 · {context.relatedFiles.length}</summary>{context.relatedFiles.map(n => <p className="tp-mono tp-meta" key={n.id}>{n.path}{n.symbol && ` · ${n.symbol}`}{n.stale && ' · 索引已过期'}</p>)}</details>
    <p className="tp-meta">前置 {context.dependencies.length} · 当前修订证据 {context.evidence?.length ?? 0} · 影响候选 {context.impactCandidates.length}{!!context.omittedItems && ` · 预算内省略 ${context.omittedItems} 项补充资料，可按 ID 查询`}</p>
  </div>;
}

const blankMemory = () => ({ body: '', source: '', kind: 'decision', supersedes: '' });
const kindNames: Record<string,string> = { decision: '决定', requirement: '需求', goal: '目标', memory: '参考材料', pause: '接续摘要' };
export function ProjectMemory({ model }: { model: TaskPanelController }) {
  const filter = model.memoryFilter, setFilter = model.setMemoryFilter;
  const tasks = model.snapshot?.tasks.filter(t => !model.projectFilter || t.plan.projectId === model.projectFilter) ?? [];
  const target = tasks.find(t => t.id === model.memoryTarget);
  const projectId = target?.plan.projectId ?? model.projectFilter;
  const owner = target ? `task:${target.id}` : `project:${projectId}`;
  const draft = model.memoryDrafts[owner] ?? blankMemory();
  const update = (patch: Partial<typeof draft>) => model.setMemoryDrafts(before => ({ ...before, [owner]: { ...(before[owner] ?? blankMemory()), ...patch } }));
  const memories = model.snapshot?.memories.filter(m => !model.projectFilter || m.projectId === model.projectFilter || tasks.some(t => t.id === m.taskId)) ?? [];
  const visible = memories.filter(m => filter === 'active' ? m.status === 'active' : filter === 'pending' ? m.status === 'draft' && m.category !== 'reference' : filter === 'reference' ? m.status === 'draft' && m.category === 'reference' : ['superseded','cancelled'].includes(m.status));
  const projectName = (m: Memory) => model.snapshot?.projects.find(p => p.id === m.projectId)?.name ?? '未归属项目';
  return <div className="tp-memory"><Card className="tp-memory-panel"><h2>项目记忆</h2>
    <Tabs value={filter} onValueChange={setFilter}><TabsList className="tp-memory-tabs" aria-label="项目记忆分类"><TabsTrigger value="active">当前有效</TabsTrigger><TabsTrigger value="pending">待你决定</TabsTrigger><TabsTrigger value="reference">Agent 参考</TabsTrigger><TabsTrigger value="history">历史</TabsTrigger></TabsList></Tabs>
    <p className="tp-meta">执行事实保存在任务证据和时间线。参考摘要注明来源，重要决定核对后生效。</p>
    {visible.map(m => {
      const editing = model.memoryEdits[m.id]; const older = memories.find(old => old.id === m.supersedes);
      const beginEdit = () => model.setMemoryEdits(v => ({ ...v, [m.id]: { body: m.body, source: m.source, kind: m.kind } }));
      return <article className="tp-memory-item" key={m.id}><div className="tp-row"><Badge variant="outline">{kindNames[m.kind] ?? m.kind}</Badge><span className="tp-meta">{projectName(m)} · {m.taskId ? model.snapshot?.tasks.find(t => t.id === m.taskId)?.title : '项目范围'}</span></div>
        {editing ? <div className="tp-form"><Label className="grid items-start font-normal leading-5">修订正文<Textarea variant="app" rows={4} value={editing.body} onChange={e => model.setMemoryEdits(v => ({ ...v, [m.id]: { ...editing, body: e.target.value } }))} /></Label><Label className="grid items-start font-normal leading-5">出处<Input variant="app" value={editing.source} onChange={e => model.setMemoryEdits(v => ({ ...v, [m.id]: { ...editing, source: e.target.value } }))} /></Label><Button size="sm" variant="outline" disabled={!!model.action} onClick={async () => { const result = await model.mutate({ type: 'update_memory_draft', id: m.id, ...editing }, m.revision, '保存核对后的草案'); if (result) model.setMemoryEdits(v => { if (JSON.stringify(v[m.id]) !== JSON.stringify(editing)) return v; const next = { ...v }; delete next[m.id]; return next; }); }}>保存草案修订</Button></div> : <p>{m.body}</p>}
        {older && <details className="tp-disclosure"><summary>将替代的旧内容</summary><p>{older.body}</p><p className="tp-meta">{older.source}</p></details>}
        <p className="tp-meta">{m.source} · {m.originLevel === 'claim' ? 'Agent 来源，采纳不代表已客观验证' : '本人登记'}{m.stale && ' · 任务或来源版本已变化，请重新核对参考范围'}</p>
        <details className="tp-disclosure"><summary>来源与版本</summary><pre className="tp-source">{JSON.stringify({ id: m.id, taskRevision: m.baseTaskRevision, sources: m.sourceRefs }, null, 2)}</pre></details>
        {m.status === 'draft' && <div className="tp-acts"><Button size="sm" disabled={!!model.action || m.stale || !!editing} onClick={() => void model.mutate({ type: 'apply_memory', id: m.id }, m.revision, '采纳已核对记忆')}>核对后采纳</Button><Button size="sm" variant="outline" disabled={!!editing} onClick={beginEdit}>修改后再采纳</Button><Button size="sm" variant="ghost" disabled={!!model.action} onClick={() => void model.mutate({ type: 'cancel_memory', id: m.id }, m.revision, '保留为历史')}>暂不采用</Button></div>}
        {m.status === 'active' && <Button size="sm" variant="ghost" onClick={() => { if (m.taskId) model.setMemoryTarget(m.taskId); else { if (m.projectId) model.setProjectFilter(m.projectId); model.setMemoryTarget(''); } const key = m.taskId ? `task:${m.taskId}` : `project:${m.projectId}`; model.setMemoryDrafts(v => ({ ...v, [key]: { ...(v[key] ?? blankMemory()), kind: m.kind, supersedes: m.id } })); }}>提出替代内容</Button>}
      </article>;
    })}{!visible.length && <p className="tp-meta">此范围暂无对应记录。</p>}
  </Card><Card className="tp-memory-panel"><h2>保存材料或决定草案</h2><form className="tp-form" onSubmit={async e => {
    e.preventDefault(); if (!projectId && !target) return; const submitted = { ...draft };
    const result = await model.mutate({ type: 'memory_draft', id: crypto.randomUUID(), taskId: target?.id ?? null, repositoryId: null, projectId: target ? null : projectId || null, kind: submitted.kind, body: submitted.body, source: submitted.source, supersedes: submitted.supersedes || null }, target?.revision ?? null, '保存记忆草案');
    if (result) model.setMemoryDrafts(v => JSON.stringify(v[owner]) === JSON.stringify(submitted) ? { ...v, [owner]: blankMemory() } : v);
  }}>
    <Label className="grid items-start font-normal leading-5">适用范围<NativeSelect variant="app" value={model.memoryTarget} onChange={e => model.setMemoryTarget(e.target.value)}><option value="">当前所选项目的长期记录</option>{tasks.map(t => <option value={t.id} key={t.id}>{taskNumber(t)} · {t.title}</option>)}</NativeSelect></Label>
    {!target && !projectId && <p className="tp-meta">请在顶部选择一个项目，或选择具体任务。</p>}
    <Label className="grid items-start font-normal leading-5">内容类型<NativeSelect variant="app" value={draft.kind} onChange={e => update({ kind: e.target.value })}>{Object.entries(kindNames).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</NativeSelect></Label>
    <Label className="grid items-start font-normal leading-5">正文<Textarea variant="app" rows={5} required maxLength={20000} value={draft.body} onChange={e => update({ body: e.target.value })} /></Label>
    <Label className="grid items-start font-normal leading-5">出处<Input variant="app" required maxLength={2000} value={draft.source} onChange={e => update({ source: e.target.value })} placeholder="选定聊天片段、文件或本人决定日期" /></Label>
    {draft.supersedes && <p className="tp-meta">保存为替代草案，采纳后旧记录进入历史。<Button type="button" variant="ghost" size="sm" onClick={() => update({ supersedes: '' })}>取消替代</Button></p>}
    <Button disabled={!!model.action || !projectId && !target}>保存待核对草案</Button>
  </form></Card></div>;
}
