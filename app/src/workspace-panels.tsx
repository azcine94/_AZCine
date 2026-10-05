import { EmptyState } from './components/ui/empty-state.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { filterTodos } from './workspace-contract.ts';
import type { TodoFilter } from './workspace-contract.ts';
import type { WorkspaceController } from './use-workspace.ts';
import type { ProjectDocument } from './projects-contract.ts';
import { DateInput } from './date-input.tsx';
import { useEffect } from 'react';
import type { Idea } from './ideas-contract.ts';

function WorkspaceFeedback({ model }: { model: WorkspaceController }) {
  return <div className="workspace-feedback" aria-live="polite">
    {model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.error}</Feedback>}
    {model.notice && <p role="status">{model.notice}</p>}
  </div>;
}
export function WorkspaceGate({ model }: { model: WorkspaceController }) {
  if (!model.connected) return <section className="data-panel"><h2>需要桌面连接</h2><p>当前为网页预览，不能保存记录。请从项目根运行 npm run dev。</p></section>;
  if (model.loading && !model.workspace) return <p role="status">正在读取数据目录…</p>;
  if (model.loadError) return <section className="data-panel"><h2>数据目录未能打开</h2><Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback><Button variant="app-pill" className="pill" disabled={model.loading || !!model.busy} onClick={() => void model.refresh()}>重新读取</Button><p className="meta">不会自动改用空数据库。</p></section>;
  return <section className="data-panel" data-storage-setup>
    <h2>把记录保存在本机</h2><p className="subtle">待办、项目、附件与 Pi 资料都放在这个目录。</p>
    <form className="entry-form" onSubmit={e => { e.preventDefault(); void model.selectRoot(); }}>
      <label htmlFor="data-root">数据目录</label><Input variant="inline" id="data-root" value={model.rootDraft} disabled={!!model.busy} onChange={e => model.changeRoot(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="data-root-help" />
      <p id="data-root-help" className="meta">{model.workspace?.defaultRoot ? '默认使用系统文档目录，可改为其他专用目录。' : '系统文档目录暂不可用，请选择一个可用的专用目录。'}已有数据不会被覆盖或合并。</p>
      <div className="form-actions"><Button variant="app-pill" type="button" className="pill" disabled={!!model.busy || model.loading} onClick={() => void model.pickRoot()}>选择目录</Button><Button variant="app-pill" className="pill on" disabled={!!model.busy || model.loading}>{model.busy === 'select-root' ? '正在保存…' : '使用此目录'}</Button></div>
    </form><WorkspaceFeedback model={model} />
  </section>;
}
export function DataSettings({ model }: { model: WorkspaceController }) {
  if (!model.workspace?.root || model.loadError) return <WorkspaceGate model={model} />;
  return <section className="foundation-section data-panel"><h2>数据目录</h2><p className="subtle">查看当前使用的数据位置。</p><div className="settings-row"><div><h3>当前目录</h3><p className="meta">待办、项目与资讯等业务记录保存在这里。</p></div><p className="path-text" data-current-root>{model.workspace.root}</p></div><div className="form-actions"><Button variant="app-pill" className="pill" disabled={!!model.busy || model.loading} onClick={() => void model.openRoot()}>打开目录</Button><Button variant="app-pill" className="pill" disabled={!!model.busy || model.loading} onClick={() => void model.refresh()}>重新读取</Button></div><p className="meta">目录迁移与完整备份尚未接入，不会直接改用新空库或删除旧目录。</p><WorkspaceFeedback model={model} /></section>;
}
const filters: { id: TodoFilter; title: string }[] = [{ id: 'incomplete', title: '未完成' }, { id: 'today', title: '今天' }, { id: 'completed', title: '已完成' }];
export function TodoPanel({ model, projects, projectsLoading = false, projectsError = '', ideas = [], targetId = null }: {
  model: WorkspaceController; projects: ProjectDocument[]; projectsLoading?: boolean; projectsError?: string; ideas?: Idea[]; targetId?: string | null;
}) {
  const disabled = !!model.busy || model.loading || !!model.loadError;
  const draftLocked = disabled || !!model.pendingCreate;
  const projectLocked = draftLocked || projectsLoading || !!projectsError;
  const projectHint = projectsLoading ? '正在读取公司项目，可以先不关联。' : projectsError ? `公司项目未能读取：${projectsError}` : projects.length ? '公司项目可选，不关联也能保存。' : '暂无公司项目，可以先不关联。';
  const todos = filterTodos(model.workspace?.todos ?? [], model.filter, model.today);
  useEffect(() => {
    if (!targetId) return;
    const row = document.querySelector<HTMLElement>(`[data-todo-id="${targetId}"]`);
    row?.scrollIntoView({ block: 'center' }); row?.focus({ preventScroll: true });
  }, [targetId, model.filter, model.workspace?.todos]);
  const state = model.loading ? '正在读取待办…' : model.busy === 'save-todo' ? '正在保存…' : model.busy ? '正在更新…' : model.notice || '日期和项目可不填';
  return <div className="todo-panel" data-working={!!model.busy || model.loading} onClickCapture={event => {
    if (event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) { event.preventDefault(); event.stopPropagation(); }
  }} onKeyDownCapture={event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <form className="entry-form todo-composer" aria-label="新增待办" onSubmit={event => { event.preventDefault(); if (!disabled) void model.saveTodo(); }} noValidate>
      <label className="visually-hidden" htmlFor="todo-title">待办标题</label><Input variant="inline" id="todo-title" value={model.draft.title} readOnly={draftLocked} aria-disabled={draftLocked} onChange={event => model.changeDraft('title', event.target.value)} placeholder="记下一件要做的事…" aria-required="true" />
      <div className="todo-composer-options"><DateInput id="todo-date" label="待办日期" value={model.draft.dueDate} readOnly={draftLocked} selectionDisabled={draftLocked} onChange={value => { if (!draftLocked) model.changeDraft('dueDate', value); }} />
      <label className="todo-project-select"><span className="visually-hidden">公司项目（可选）</span><NativeSelect variant="inline" id="todo-project" aria-disabled={projectLocked} aria-busy={projectsLoading} aria-describedby="todo-project-hint" value={model.draft.projectId} onChange={event => { if (!projectLocked) model.changeDraft('projectId', event.target.value); }}><option value="">不关联项目</option>{projectsLoading ? <option disabled>正在读取项目…</option> : projectsError ? <option disabled>项目未能读取，请到项目页重试</option> : projects.length === 0 ? <option disabled>暂无公司项目</option> : null}{model.draft.projectId && !projects.some(project => project.id === model.draft.projectId) && <option value={model.draft.projectId} disabled>原关联项目（名称待读取）</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</NativeSelect><span id="todo-project-hint" className="visually-hidden">{projectHint}</span></label></div>
      <Button variant="app-pill" className="pill on todo-save" aria-disabled={disabled}>{model.pendingCreate ? '重试保存（同一请求）' : '保存待办'}</Button>
    </form>
    <div className="todo-feedback" aria-live="polite" aria-busy={!!model.busy || model.loading}><p role="status" className="meta">{state}</p>{model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.error}</Feedback>}{model.loadError && model.loadError !== model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback>}</div>
    {model.pendingCreate && <Feedback as="div" tone="pending" className="pending-note"><p>保存结果尚未确认，原输入与请求已保留；重试不重复建项。</p><Button variant="app-pill" type="button" className="pill" aria-disabled={disabled} onClick={() => void model.reconcileCreate()}>重新核对保存结果</Button></Feedback>}
    <div className="form-actions todo-filters" aria-label="待办筛选">{filters.map(filter => <Button variant="app-pill" key={filter.id} className={`pill${model.filter === filter.id ? ' on' : ''}`} aria-pressed={model.filter === filter.id} onClick={() => model.setFilter(filter.id)}>{filter.title}</Button>)}</div>
    {todos.length === 0 ? <EmptyState as="p" className="todo-empty">{model.filter === 'completed' ? '还没有已完成的待办。' : model.filter === 'today' ? '今天没有到期待办，未设日期的事项仍在“未完成”。' : '暂无待办，先记下一件事。'}</EmptyState> : <ul className="todo-list">{todos.map(todo => <li key={todo.id} data-todo-id={todo.id} data-targeted={targetId === todo.id} tabIndex={targetId === todo.id ? -1 : undefined}>
      <div className="todo-row"><Button variant="app-control" className="todo-toggle" aria-pressed={todo.completed} aria-label={`${todo.completed ? '恢复' : '完成'}待办：${todo.title}`} aria-disabled={disabled} onClick={() => void model.changeCompletion(todo, !todo.completed)}><span className="todo-check" aria-hidden="true">{todo.completed ? '✓' : ''}</span><span className={todo.completed ? 'todo-done' : ''}>{todo.title}</span></Button><span className="meta todo-date">{todo.dueDate ?? '未设日期'}</span></div>{todo.projectId && <UILink variant="text" className="foundation-link todo-project" href={`#projects/${todo.projectId}`}>{projects.find(project => project.id === todo.projectId)?.name ?? '打开关联公司项目'}</UILink>}
      {ideas.find(idea => idea.todoId === todo.id) && <UILink variant="plain" className="todo-source" href={`#ideas/${ideas.find(idea => idea.todoId === todo.id)!.id}`}>查看来源灵感</UILink>}
    </li>)}</ul>}
    <div className="form-actions todo-footer"><span className="meta">{model.undo ? '最近一次状态修改' : '保存在本机'}</span><div className="todo-undo-slot">{model.undo && <Button variant="app-text" className="text-action" aria-disabled={disabled} onClick={() => { if (model.undo) void model.changeCompletion(model.undo.todo, model.undo.completed, true); }}>撤销</Button>}</div><Button variant="app-text" className="text-action" aria-disabled={!!model.busy || model.loading} onClick={() => void model.refresh()}>重新读取待办</Button></div>
  </div>;
}
