import { Sparkles, RefreshCw } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { Label } from './components/ui/label.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip.tsx';
import type { TaskPanelController } from './use-task-panel.ts';
import type { TaskDraft } from './task-panel-contract.ts';
import { liveExecution } from './task-panel-contract.ts';
import { TaskRevisionGate } from './task-panel-feedback.tsx';

export function TaskCreateDialog({ model }: { model: TaskPanelController }) {
  const d = model.draft, refine = model.refinement, update = model.updateDraft;
  const editing = d.expectedRevision !== null;
  const task = model.snapshot?.tasks.find(task => task.id === d.id);
  const revisionBlocked = !!model.snapshot?.executions.some(run => run.taskId === d.id && liveExecution(run.state));
  const partial = editing && !!d.newBranch?.trim() && (!!d.worktreePending || !!task?.reasonCodes.includes('worktree_pending'));
  const hasExecutionHistory=!!model.snapshot?.executions.some(run=>run.taskId===d.id);
  const project = model.snapshot?.projects.find(item => item.id === d.projectId);
  const repository = model.snapshot?.repositories.find(item => item.id === d.repositoryId);
  const prepared = editing || !!(d.title || d.goal || d.manualTask), questions = editing ? [] : d.refinementQuestions ?? [];
  const stale = !editing && !d.manualTask && !!d.refinedRequest && (d.refinedRequest !== d.rawRequest?.trim() || d.refinedRepositoryId !== d.repositoryId);
  const saving = !!model.action || !!model.workflow.action;
  const fieldClass = 'grid min-w-0 items-start gap-2 font-normal leading-5';
  const contextName = project?.name === repository?.label ? project?.name : [project?.name, repository?.label].filter(Boolean).join(' / ');
  const changeContext = (patch: Partial<TaskDraft>) => update({ ...patch, ...(d.refinedRequest ? { refinedRepositoryId: undefined } : {}) });
  const canSave = !revisionBlocked && !saving && !refine.busy && !stale && !questions.length && !!d.title.trim() && !!d.goal.trim() && !!d.scope.trim() && !!d.criteria.trim() && (!d.autoStart || !!repository);
  const formError = model.actionError || model.workflow.error || model.draftStorageError;
  const footer = <div className="tp-create-footer-wrap">{formError && <Feedback tone="error" role="alert">{formError}</Feedback>}<div className="tp-create-footer"><span className="tp-meta">{model.draftStorageError ? '草案尚未落盘' : model.draftSaving ? '正在保存草案…' : '草案保存在当前仓库'}</span>{partial && <Button type="button" variant="ghost" disabled={!canSave} onClick={() => void model.saveTask(false,false)}>仅保留任务</Button>}<Button type="button" variant="outline" onClick={() => model.closeEditor(false)}>关闭</Button><Button type="submit" form="tp-create-task" disabled={!canSave}>{model.action || model.workflow.action || (partial ? '保存并重试分支' : editing ? d.autoStart ? '保存并接续' : '保存新要求' : d.autoStart ? '创建并开始' : '创建任务')}</Button></div></div>;
  const requestEditor = <section className="tp-request-section" aria-label="需求与细化模型">
    <Textarea id="tp-task-request" aria-label="你的需求" variant="app" autoFocus={!prepared} rows={4} maxLength={10000} value={d.rawRequest ?? ''} disabled={saving} onChange={event => update({ rawRequest: event.target.value })} placeholder="例如：任务详情太乱了，先展示这次要做什么，把技术信息默认收起来。" />
    <div className="tp-refine-toolbar"><Label className="shrink-0 whitespace-nowrap font-normal leading-5" htmlFor="tp-refine-model">细化模型</Label><NativeSelect id="tp-refine-model" variant="app" value={d.refinementModel ?? ''} disabled={refine.busy || refine.loadingModels || saving} onChange={event => refine.chooseModel(event.target.value)}><option value="">{refine.loadingModels ? '读取模型…' : '选择已配置模型'}</option>{refine.models.map(item => <option key={item.key} value={item.key}>{item.name} · {item.provider}</option>)}</NativeSelect>
      <Button type="button" variant="ghost" size="icon-sm" disabled={refine.busy || refine.loadingModels || saving} onClick={() => void refine.refreshModels()} aria-label="刷新细化模型列表" title="刷新已配置模型"><RefreshCw /></Button>
      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" disabled={refine.busy || saving || !d.rawRequest?.trim() || !refine.models.some(item => item.key === d.refinementModel)} onClick={() => void refine.refine()} aria-label={prepared ? '重新细化任务' : '让 Agent 细化任务'}><Sparkles /></Button></TooltipTrigger><TooltipContent>{prepared ? '结合当前草案重新细化' : '让 Agent 细化需求'}</TooltipContent></Tooltip></TooltipProvider>
    </div>
    {refine.loadingModels && <p className="tp-meta" role="status">正在读取模型列表…</p>}{refine.modelError && <Feedback tone="error">{refine.modelError}</Feedback>}
  </section>;
  return <FormDialog open={model.editorOpen} onOpenChange={model.closeEditor} title={partial ? '恢复分支创建' : editing ? '修改任务要求' : '新建任务'} description={partial ? '任务已保存。可以修改后继续建分支，或仅保留任务。' : editing ? '核对新的目标、范围和完成条件，再保存并交接。' : '描述需求，选择模型细化，核对后创建任务。'} className="tp-create-dialog" footer={footer}>
    <form id="tp-create-task" className="tp-form tp-create-form" onSubmit={event => { event.preventDefault(); if (canSave) void model.saveTask(!!d.autoStart); }}>
      <Disclosure key={`${d.id}-context`} className="tp-create-context"><summary>项目 / 工作区：{contextName || '未选择'} <span className="tp-meta">更换</span></summary><div className="tp-form tp-create-options">
        <Label className={fieldClass}>所属项目<NativeSelect variant="app" value={d.projectId} disabled={refine.busy || saving || !!task?.executionWorkspace} onChange={event => {
          const projectId = event.target.value, repo = model.snapshot?.repositories.find(item => model.snapshot?.projects.find(p => p.id === projectId)?.repositoryIds.includes(item.id));
          changeContext({ projectId, repositoryId: repo?.id ?? '', goalId: '', phase: '', autoStart: repo ? d.autoStart : false });
        }}><option value="">未归属项目</option>{model.snapshot?.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></Label>
        <Label className={fieldClass}>仓库或工作区<NativeSelect variant="app" value={d.repositoryId} disabled={refine.busy || saving || !!task?.executionWorkspace} onChange={event => {
          const repositoryId = event.target.value, projectId = model.snapshot?.projects.find(item => item.repositoryIds.includes(repositoryId))?.id ?? d.projectId;
          changeContext({ repositoryId, projectId, autoStart: repositoryId ? d.autoStart : false, ...(projectId !== d.projectId ? { goalId: '', phase: '' } : {}) });
        }}><option value="">不涉及代码的任务</option>{model.snapshot?.repositories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></Label>
      </div></Disclosure>
      <TaskRevisionGate model={model}/>
      <div className="tp-create-heading">{prepared ? <h3>{editing ? `任务要求 · 编辑基线 r${d.expectedRevision}` : d.manualTask ? '填写任务' : '核对任务草案'}</h3> : <Label className="font-medium leading-5" htmlFor="tp-task-request">你想做什么？</Label>}{!editing && <Button type="button" variant="ghost" size="sm" disabled={refine.busy || saving} onClick={() => update({ manualTask: !d.manualTask, refinementQuestions: [] })}>{d.manualTask ? '用 Agent 辅助' : prepared ? '手动编辑' : '手动填写'}</Button>}</div>
      {!editing && !d.manualTask && (prepared ? <Disclosure key={`${d.id}-request`} open={stale || !!questions.length || refine.busy || undefined}><summary>调整原始需求 / 重新细化</summary><div className="tp-create-options">{requestEditor}</div></Disclosure> : requestEditor)}
      {refine.busy && <div className="tp-row" role="status"><span>{refine.phase}…</span><Button type="button" variant="ghost" size="sm" disabled={refine.phase === '正在取消'} onClick={refine.cancel}>取消细化</Button></div>}{refine.error && <Feedback tone="error" role="alert">{refine.error}</Feedback>}
      {!!questions.length && <section className="tp-refine-questions"><h3>Agent 需要你补充</h3><ol className="tp-criteria">{questions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}</ol><Label className={fieldClass}>你的回答<Textarea variant="app" rows={3} maxLength={5000} disabled={saving || refine.busy} value={d.refinementAnswer ?? ''} onChange={event => update({ refinementAnswer: event.target.value })} placeholder="可以一次回答上面的问题" /></Label><Button className="justify-self-start" type="button" variant="outline" size="sm" disabled={refine.busy || saving || !d.refinementAnswer?.trim()} onClick={() => void refine.refine()}>补充后继续细化</Button></section>}
      {prepared && <section className="tp-refine-preview" aria-label="任务草案">
        <Label className={fieldClass}>任务名称<Input variant="app" autoFocus={editing || !!d.manualTask} maxLength={500} value={d.title} disabled={saving} onChange={event => update({ title: event.target.value })} placeholder="一句话说明这次任务" /></Label><Label className={fieldClass}>任务说明 · 完整 Prompt<Textarea variant="app" rows={6} maxLength={editing ? 20000 : 8000} value={d.goal} disabled={saving} onChange={event => update({ goal: event.target.value })} placeholder="要解决什么、具体怎么改、哪些地方不能改" /></Label>
        <div className="tp-grid2"><Label className={fieldClass}>操作范围<Textarea variant="app" rows={3} value={d.scope} disabled={saving} onChange={event => update({ scope: event.target.value })} placeholder="每行一个仓库相对路径" /></Label><Label className={fieldClass}>完成条件<Textarea variant="app" rows={3} value={d.criteria} disabled={saving} onChange={event => update({ criteria: event.target.value })} placeholder="每行一条可核对的结果" /></Label></div>
        {stale && <Feedback tone="conflict">需求或任务上下文已变化，请重新细化，核对后再创建。</Feedback>}
      </section>}
      <Disclosure key={`${d.id}-execution`} className="tp-create-execution"><summary>执行设置 <span className="tp-meta">{d.agentKind === 'openpi' ? 'OpenPI' : 'Codex'}{d.newBranch?.trim() ? ' · 独立分支' : ''}</span></summary><div className="tp-form tp-create-options">
        <Label className={fieldClass}>执行工具<NativeSelect variant="app" value={d.agentKind || 'codex'} disabled={saving} onChange={event => update({ agentKind: event.target.value })}><option value="codex">Codex（codex）</option><option value="openpi">OpenPI（opi）</option></NativeSelect></Label>
        <div className="tp-grid2"><Label className={fieldClass}>关联目标<NativeSelect variant="app" value={d.goalId} disabled={!d.projectId || saving || refine.busy} onChange={event => changeContext({ goalId: event.target.value })}><option value="">独立任务</option>{model.snapshot?.tasks.filter(item => item.objectKind === 'goal' && item.plan.projectId === d.projectId).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</NativeSelect></Label><Label className={fieldClass}>阶段<Input variant="app" maxLength={100} value={d.phase} disabled={!d.projectId || saving || refine.busy} onChange={event => changeContext({ phase: event.target.value })} placeholder="可选" /></Label></div>
        {!task?.executionWorkspace && !hasExecutionHistory && <Label className={fieldClass}>新建任务分支<Input variant="app" value={d.newBranch ?? ''} disabled={saving || partial} onChange={event => update({ newBranch: event.target.value })} placeholder="可选，例如 fix/task-detail" /><span className="tp-meta">{partial ? '重试先核对上次创建位置；要换分支，请先仅保留任务。' : '留空使用当前工作区；填写后从 HEAD 创建独立 Worktree。'}</span></Label>}{task?.executionWorkspace && <p className="tp-meta">原任务分支：{task.executionWorkspace.branch}</p>}{hasExecutionHistory && !task?.executionWorkspace && <p className="tp-meta">接续使用原执行目录。需要另建分支时创建新任务。</p>}<Label className={fieldClass}>Herdr 窗格名称<Input variant="app" maxLength={100} value={d.paneName ?? ''} disabled={saving} onChange={event => update({ paneName: event.target.value })} placeholder="默认使用任务名称" /></Label>
      </div></Disclosure>
      <Label className="tp-check flex items-center gap-2 font-normal leading-5"><Checkbox checked={!!d.autoStart} disabled={saving || !repository} onCheckedChange={value => update({ autoStart: value === true })} />{editing ? '保存后重新交接，优先接续原会话' : '创建后立即开始执行'}</Label>{d.autoStart && <p className="tp-meta">{editing ? '接续使用新修订和代码快照，执行权限沿用本任务已核对范围。' : '确认开始允许读取、修改任务范围内文件并保存交付。'}测试、安装、提交等需另行授权。</p>}
    </form>
  </FormDialog>;
}
