import { RecordContextMenu } from './components/ui/record-context-menu.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { Button } from './components/ui/button.tsx';
import { FormDialog, useCreationDialog } from './components/ui/form-dialog.tsx';
import { Input } from './components/ui/input.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { filterTodos } from './workspace-contract.ts';
import { displayPath } from './lib/display-path.ts';
import type { TodoFilter } from './workspace-contract.ts';
import type { WorkspaceController } from './use-workspace.ts';
import type { ProjectDocument } from './projects-contract.ts';
import { DateInput } from './date-input.tsx';
import { useEffect, useRef, useState } from 'react';
import type { Idea } from './ideas-contract.ts';

function WorkspaceFeedback({ model, todo = false }: { model: WorkspaceController; todo?: boolean }) {
  return <div className="workspace-feedback" aria-live="polite">
    {model.error && (todo ? ['save-todo', 'reconcile'].includes(model.errorScope ?? '') : !['save-todo', 'reconcile'].includes(model.errorScope ?? '')) && <Feedback as="p" tone="error" className="form-error" role="alert">{model.error}</Feedback>}
    
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
      <p id="data-root-help" className="meta">{model.workspace?.defaultRoot ? '默认使用系统文档目录，可改为其他专用目录。' : '系统文档目录暂不可用，请选择一个可用的专用目录。'}可选择空目录或完整下载的已有 AZCine 数据目录；已有数据不会被覆盖或合并。之后可在设置中更改。</p>
      <div className="form-actions"><Button variant="app-pill" type="button" className="pill" disabled={!!model.busy || model.loading} onClick={() => void model.pickRoot()}>选择目录</Button><Button variant="app-pill" className="pill on" disabled={!!model.busy || model.loading}>{model.busy === 'select-root' ? '正在保存…' : '使用此目录'}</Button></div>
    </form><WorkspaceFeedback model={model} />
  </section>;
}
export function DataSettings({ model }: { model: WorkspaceController }) {
  const change = useCreationDialog();
  const disabled = !!model.busy || model.loading;
  async function save() {
    const session = change.session.current;
    if (await model.scheduleRootChange()) change.finish(session);
  }
  if (!model.workspace?.root || model.loadError) return <WorkspaceGate model={model} />;
  return <section className="foundation-section data-panel data-directory-settings">
    <header className="settings-page-header"><h2>数据目录</h2><p className="subtle">查看或更改当前使用的数据位置。</p></header>
    <div className="data-directory-current">
      <div className="data-directory-label"><h3>当前目录</h3><p className="meta">待办、项目、资讯与附件等业务资料保存在这里。</p></div>
      <p className="path-text data-directory-path" data-current-root>{displayPath(model.workspace.root)}</p>
      <div className="form-actions">
        <Button variant="app-pill" className="pill" disabled={disabled} onClick={() => void model.openRoot()}>打开目录</Button>
        <Button variant="app-pill" className="pill" disabled={disabled || model.rootChangeScheduled} onClick={() => change.setOpen(true)}>更改数据目录</Button>
        <Button variant="app-pill" className="pill" disabled={disabled} onClick={() => void model.refresh()}>重新读取</Button>
      </div>
    </div>
    {model.rootChangeScheduled && <Feedback as="div" tone="info"><p>已安排更改到：{displayPath(model.rootChangePath)}。请正常退出并重新打开，旧目录会保留。</p><Button variant="app-pill" disabled={disabled} onClick={() => void model.cancelRootChange()}>取消更改</Button></Feedback>}
    {model.workspace.rootChangeNotice && <Feedback as="p" tone="info">{model.workspace.rootChangeNotice}</Feedback>}
    <aside className="data-directory-help" aria-label="换机与同步说明"><h3>换机与同步</h3><p className="meta">先退出旧电脑上的应用，待 OneDrive 同步完成。在新电脑完整下载数据目录，再选择该目录。</p><p className="meta">不要在两台电脑同时编辑同一份数据。</p></aside>
    <FormDialog open={change.open} onOpenChange={open => { if (!model.busy) change.setOpen(open); }} title="更改数据目录" description="下次启动时生效。原目录始终保留，两份数据不会合并。">
      <form className="entry-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor="root-change-mode">更改方式</label>
        <NativeSelect id="root-change-mode" value={model.rootChangeMode} disabled={disabled} onChange={event => model.setRootChangeMode(event.target.value as 'migrate' | 'switch')}>
          <option value="migrate">迁移当前数据到新空目录</option><option value="switch">切换到已有 AZCine 数据目录</option>
        </NativeSelect>
        <p className="meta">{model.rootChangeMode === 'migrate' ? '复制当前业务记录、附件和数据根内的 Pi 资料，校验完成后使用新目录；目标必须为空。' : '使用目标目录原有的记录和 Pi 资料；当前记录留在原目录，不复制或合并。'}</p>
        <label htmlFor="root-change-path">目标目录</label><Input id="root-change-path" value={model.rootChangePath} disabled={disabled} onChange={event => model.setRootChangePath(event.target.value)} autoComplete="off" spellCheck={false} />
        <p className="meta">本次关闭前请保存其他页面的编辑、结束正在运行的任务。数据根内的 Pi 认证也会随迁移复制，请仅选择本人管理的目录。</p>
        <div className="form-actions"><Button type="button" variant="app-pill" disabled={disabled} onClick={() => void model.pickRootChange()}>选择目录</Button><Button type="submit" variant="app-primary" disabled={disabled}>{model.busy === 'change-root' ? '正在保存…' : '保存，下次启动生效'}</Button></div>
        <WorkspaceFeedback model={model} />
      </form>
    </FormDialog>
    {!change.open && <WorkspaceFeedback model={model} />}
  </section>;
}
const filters: { id: TodoFilter; title: string }[] = [{ id: 'incomplete', title: '未完成' }, { id: 'today', title: '今天' }, { id: 'completed', title: '已完成' }];
export function TodoPanel({ model, projects, projectsLoading = false, projectsError = '', ideas = [], targetId = null }: {
  model: WorkspaceController; projects: ProjectDocument[]; projectsLoading?: boolean; projectsError?: string; ideas?: Idea[]; targetId?: string | null;
}) {
  const creation = useCreationDialog();
  const submitted = useRef<number | null>(null);
  const [deleteTodo,setDeleteTodo]=useState<import('./workspace-contract.ts').Todo|null>(null);
  const deleteOrigin=useRef<HTMLElement|null>(null);
  useEffect(() => {
    if (submitted.current === null || model.busy) return;
    if (!model.error && !model.pendingCreate && !model.draft.title && model.notice === '待办已保存。') creation.finish(submitted.current);
    submitted.current = null;
  }, [model.busy, model.draft, model.notice, model.error, model.pendingCreate]);
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
  const state = creation.open ? '' : model.loading ? '正在读取待办…' : model.busy === 'save-todo' ? '正在保存…' : model.busy ? '正在更新…' : '日期和项目可不填';
  return <div className="todo-panel" data-working={!!model.busy || model.loading} onClickCapture={event => {
    if (event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) { event.preventDefault(); event.stopPropagation(); }
  }} onKeyDownCapture={event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <div className="form-actions"><Button data-create="todo" onClick={() => creation.setOpen(true)}>新增待办</Button></div>
    <FormDialog open={creation.open} onOpenChange={creation.setOpen} title="新增待办" description="记下一件要做的事，日期和项目可选。关闭保留未提交输入。">
    <form className="entry-form todo-create-form" aria-label="新增待办" onSubmit={event => { event.preventDefault(); if (!disabled) { submitted.current = creation.session.current; void model.saveTodo(); } }} noValidate>
      <label htmlFor="todo-title">待办标题</label><Input id="todo-title" value={model.draft.title} readOnly={draftLocked} aria-disabled={draftLocked} onChange={event => model.changeDraft('title', event.target.value)} placeholder="记下一件要做的事…" aria-required="true" />
      <div className="todo-composer-options"><DateInput id="todo-date" label="待办日期" value={model.draft.dueDate} readOnly={draftLocked} selectionDisabled={draftLocked} onChange={value => { if (!draftLocked) model.changeDraft('dueDate', value); }} />
      <label className="todo-project-select"><span className="visually-hidden">公司项目（可选）</span><NativeSelect variant="inline" id="todo-project" aria-disabled={projectLocked} aria-busy={projectsLoading} aria-describedby="todo-project-hint" value={model.draft.projectId} onChange={event => { if (!projectLocked) model.changeDraft('projectId', event.target.value); }}><option value="">不关联项目</option>{projectsLoading ? <option disabled>正在读取项目…</option> : projectsError ? <option disabled>项目未能读取，请到项目页重试</option> : projects.length === 0 ? <option disabled>暂无公司项目</option> : null}{model.draft.projectId && !projects.some(project => project.id === model.draft.projectId) && <option value={model.draft.projectId} disabled>原关联项目（名称待读取）</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</NativeSelect><span id="todo-project-hint" className="visually-hidden">{projectHint}</span></label></div>
      <WorkspaceFeedback model={model} todo />
      {model.pendingCreate && <Feedback tone="pending"><p>保存结果尚未确认，原输入与请求已保留。</p><Button type="button" variant="outline" disabled={disabled} onClick={() => void model.reconcileCreate()}>核对保存结果</Button></Feedback>}
      <div className="ui-form-dialog-actions"><Button type="button" variant="ghost" onClick={() => creation.setOpen(false)}>关闭，保留草稿</Button><Button disabled={disabled}>{model.pendingCreate ? '重试保存（同一请求）' : '保存待办'}</Button></div>
    </form>
    </FormDialog>
    <div className="todo-feedback" aria-live="polite" aria-busy={!!model.busy || model.loading}><p role="status" className="meta">{state}</p>{!creation.open && !['save-todo', 'reconcile'].includes(model.errorScope ?? '') && model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.error}</Feedback>}{model.loadError && model.loadError !== model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback>}</div>
    {!creation.open && model.pendingCreate && <Feedback as="div" tone="pending" className="pending-note"><p>保存结果尚未确认，原输入与请求已保留；重试不重复建项。</p><Button variant="app-pill" type="button" className="pill" aria-disabled={disabled} onClick={() => void model.reconcileCreate()}>重新核对保存结果</Button></Feedback>}
    <div className="form-actions todo-filters" aria-label="待办筛选">{filters.map(filter => <Button variant="app-pill" key={filter.id} className={`pill${model.filter === filter.id ? ' on' : ''}`} aria-pressed={model.filter === filter.id} onClick={() => model.setFilter(filter.id)}>{filter.title}</Button>)}</div>
    {todos.length === 0 ? <EmptyState as="p" className="todo-empty">{model.filter === 'completed' ? '还没有已完成的待办。' : model.filter === 'today' ? '今天没有到期待办，未设日期的事项仍在“未完成”。' : '暂无待办，先记下一件事。'}</EmptyState> : <ul className="todo-list">{todos.map(todo => <RecordContextMenu key={todo.id} copyText={[todo.title,todo.dueDate].filter(Boolean).join('\n')} actions={[{label:todo.completed?'恢复为未完成':'标记已完成',disabled,run:()=>{void model.changeCompletion(todo,!todo.completed);}},{label:'删除待办',destructive:true,disabled,run:origin=>{deleteOrigin.current=origin;setDeleteTodo(todo);}}]}><li data-todo-id={todo.id} data-targeted={targetId === todo.id} tabIndex={targetId === todo.id ? -1 : undefined}>
      <div className="todo-row"><Button variant="app-control" className="todo-toggle" aria-pressed={todo.completed} aria-label={`${todo.completed ? '恢复' : '完成'}待办：${todo.title}`} aria-disabled={disabled} onClick={() => void model.changeCompletion(todo, !todo.completed)}><span className="todo-check" aria-hidden="true">{todo.completed ? '✓' : ''}</span><span className={todo.completed ? 'todo-done' : ''}>{todo.title}</span></Button><span className="meta todo-date">{todo.dueDate ?? '未设日期'}</span></div>{todo.projectId && <UILink variant="text" className="foundation-link todo-project" href={`#projects/${todo.projectId}`}>{projects.find(project => project.id === todo.projectId)?.name ?? '打开关联公司项目'}</UILink>}
      {ideas.find(idea => idea.todoId === todo.id) && <UILink variant="plain" className="todo-source" href={`#ideas/${ideas.find(idea => idea.todoId === todo.id)!.id}`}>查看来源灵感</UILink>}
    </li></RecordContextMenu>)}</ul>}
    <FormDialog open={!!deleteTodo} onOpenChange={open=>{if(!open&&!model.busy)setDeleteTodo(null);}} returnFocus={deleteOrigin.current} title="删除待办" description={`确认删除“${deleteTodo?.title??''}”？原记录与来源关联保留，可以撤销。`}>
      {model.error&&<Feedback tone="error">{model.error}</Feedback>}<div className="ui-form-dialog-actions"><Button variant="outline" disabled={!!model.busy} onClick={()=>setDeleteTodo(null)}>取消</Button><Button variant="destructive" disabled={disabled||!deleteTodo} onClick={async()=>{if(deleteTodo&&await model.changeDeletion(deleteTodo,true))setDeleteTodo(null);}}>删除待办</Button></div>
    </FormDialog>
    {model.deletedTodo&&<div className="form-actions"><span className="meta">已删除：{model.deletedTodo.title}</span><Button variant="app-text" disabled={disabled} onClick={()=>{if(model.deletedTodo)void model.changeDeletion(model.deletedTodo,false);}}>撤销删除</Button></div>}
    <div className="form-actions todo-footer"><span className="meta">保存在本机</span><Button variant="app-text" className="text-action" aria-disabled={!!model.busy || model.loading} onClick={() => void model.refresh()}>重新读取待办</Button></div>
  </div>;
}
