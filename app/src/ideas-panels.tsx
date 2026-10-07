import { RecordContextMenu } from './components/ui/record-context-menu.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Button } from './components/ui/button.tsx';
import { FormDialog, useCreationDialog } from './components/ui/form-dialog.tsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Idea, IdeaDraft } from './ideas-contract.ts';
import { filterIdeas, ideaTitle, sameIdeaContent, contentFor } from './ideas-contract.ts';
import type { IdeasController } from './use-ideas.ts';
import type { ProjectDocument } from './projects-contract.ts';
import type { WorkspaceController } from './use-workspace.ts';

function Mark({ kind = 'bulb' }: { kind?: 'bulb' | 'plus' | 'search' | 'arrow' | 'edit' | 'trash' | 'folder' | 'tag' }) {
  const paths: Record<string, ReactNode> = {
    bulb: <><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z"/><path d="M12 8v4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>, edit: <><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-4-4L5 15l-1 5Z"/></>,
    trash: <path d="M4 7h16M9 3h6l1 4M6 7l1 13h10l1-13M10 11v5m4-5v5"/>,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>,
    tag: <><path d="m3 3 8 0 10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
interface FormProps { model: IdeasController; draft: IdeaDraft; draftKey: string; projects: ProjectDocument[]; projectsLoading: boolean; projectsError: string; onSave?: () => void; onClose?: () => void }
function IdeaForm({ model, draft, draftKey, projects, projectsLoading, projectsError, onSave, onClose }: FormProps) {
  const isNew = draftKey === 'new', prefix = `idea-${draftKey}`, waiting = model.busy === `save:${draftKey}`;
  const input = (field: 'title' | 'body' | 'tags' | 'projectId', value: string) => model.changeDraft(draftKey, field, value);
  return <form className={`idea-form ${isNew ? 'idea-composer' : 'idea-editor'}`} aria-label={isNew ? '收集新灵感' : '编辑灵感'} noValidate
    onSubmit={event => { event.preventDefault(); if (onSave) onSave(); else void model.save(draftKey); }} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (onSave) onSave(); else void model.save(draftKey); }
    }}>
    <div className="idea-writing">
      {model.error && [`save:${draftKey}`, `reconcile:${draftKey}`].includes(model.errorScope ?? '') && <Feedback tone="error" role="alert">{model.error}</Feedback>}
    <label className="visually-hidden" htmlFor={`${prefix}-title`}>灵感标题（可选）</label>
      <Input variant="inline" id={`${prefix}-title`} className="idea-title-input" value={draft.title} onChange={e => input('title', e.target.value)} placeholder="灵感标题（可选）" autoComplete="off"/>
      <label className="visually-hidden" htmlFor={`${prefix}-body`}>灵感内容</label>
      <Textarea variant="inline" id={`${prefix}-body`} className="idea-body-input" value={draft.body} onChange={e => input('body', e.target.value)} placeholder="想到什么，就先记下来…" aria-required="true" rows={isNew ? 3 : 5}/>
    </div>
    <div className="idea-form-options">
      <label className="idea-field"><span><Mark kind="tag"/>标签<span className="meta">可选，用逗号分隔</span></span><Input variant="inline" id={`${prefix}-tags`} value={draft.tags} onChange={e => input('tags', e.target.value)} placeholder="如：画面，灯光" autoComplete="off" list="idea-tag-suggestions"/></label>
      <label className="idea-field"><span><Mark kind="folder"/>关联公司<span className="meta">可选</span></span><NativeSelect variant="inline" id={`${prefix}-project`} value={draft.projectId} disabled={projectsLoading || !!projectsError} onChange={e => input('projectId', e.target.value)}>
        <option value="">不关联公司</option>{draft.projectId && !projects.some(p => p.id === draft.projectId) && <option value={draft.projectId}>原关联公司（名称待读取）</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </NativeSelect>{(projectsError || projectsLoading) && <span className="meta">{projectsLoading ? '正在读取公司…' : '公司读取失败，请到项目页重试；仍可保留原关联保存。'}</span>}</label>
    </div>
    <footer className="idea-form-footer"><span className="meta">{waiting ? '正在保存，后续输入会保留' : `${[...draft.body].length.toLocaleString()} / 20,000 字 · Ctrl + Enter 保存`}</span><div>
      {!isNew && <Button variant="app-idea" type="button" className="idea-action" onClick={() => model.closeEdit(draftKey)}>收起编辑</Button>}
      {onClose && <Button variant="ghost" type="button" onClick={onClose}>关闭，保留草稿</Button>}
      <Button variant="app-pill" className="pill on" disabled={!!model.busy || model.loading}>{waiting ? '正在保存…' : model.pending[draftKey] ? '重试原保存' : isNew ? '收集灵感' : '保存修改'}<Mark kind="arrow"/></Button>
    </div></footer>
    {model.pending[draftKey] && <div className="idea-pending"><p>保存结果尚未确认，原请求和输入已保留。</p><Button variant="app-idea" type="button" className="idea-action" disabled={!!model.busy || model.loading} onClick={() => void model.reconcile(draftKey)}>核对保存结果</Button></div>}
  </form>;
}
function Card({ idea, model, projects, projectsLoading, projectsError, workspace, targeted }: { idea: Idea; model: IdeasController; projects: ProjectDocument[]; projectsLoading: boolean; projectsError: string; workspace: WorkspaceController; targeted: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const project = projects.find(p => p.id === idea.projectId);
  const dirty = !!model.drafts[idea.id] && !sameIdeaContent(contentFor(idea.id, model.drafts[idea.id]), idea);
  const blocked = !!model.busy || model.loading;
  const pendingKey = Object.entries(model.pending).find(([,request]) => request.content.id === idea.id)?.[0];
  const edited = !!model.editing[idea.id] && !idea.deleted;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;
    const measure = () => setClipped(body.scrollHeight > body.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [idea.body, edited, expanded]);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (targeted) { ref.current?.scrollIntoView({ block: 'center' }); ref.current?.focus({ preventScroll: true }); } }, [targeted]);
  return <RecordContextMenu copyText={ideaTitle(idea)+'\n'+idea.body} actions={[...(!idea.deleted?[{label:'编辑灵感',disabled:blocked||!!pendingKey,run:()=>model.edit(idea)}]:[]),{label:idea.deleted?'恢复灵感':'删除灵感',destructive:!idea.deleted,disabled:blocked||!!pendingKey,run:()=>{void model.remove(idea,!idea.deleted);}}]}><article ref={ref} className={`idea-card${edited ? ' idea-card--editing' : ''}${targeted ? ' idea-card--target' : ''}`} data-idea-id={idea.id} tabIndex={targeted ? -1 : undefined} aria-label={ideaTitle(idea)}>
    <div className="idea-card-top"><span className="idea-card-mark"><Mark/></span><time dateTime={idea.updatedAt} title={new Date(idea.updatedAt).toLocaleString('zh-CN')} className="meta">{new Date(idea.updatedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}</time></div>
    {edited ? <>{model.drafts[idea.id].expectedRevision !== idea.revision && <Feedback as="div" tone="conflict" className="idea-version-conflict"><p>已保存的记录有变化，编辑草稿已保留。</p><Disclosure><summary>查看当前已保存版本</summary><h3>{ideaTitle(idea)}</h3><p>{idea.body}</p><p>标签：{idea.tags.join('，') || '无'} · 公司：{project?.name ?? '未关联'}</p></Disclosure><Button variant="app-idea" className="idea-action" disabled={blocked || !!pendingKey} onClick={() => model.continueOnCurrent(idea)}>保留草稿，在当前版本上继续编辑</Button></Feedback>}<IdeaForm model={model} draft={model.drafts[idea.id]} draftKey={idea.id} projects={projects} projectsLoading={projectsLoading} projectsError={projectsError}/></> : <>
      <h3>{ideaTitle(idea)}</h3><p ref={bodyRef} className={`idea-card-body${expanded ? ' is-expanded' : ''}`} tabIndex={expanded ? 0 : undefined} role={expanded ? 'region' : undefined} aria-label={expanded ? '灵感全文' : undefined}>{idea.body}</p>
      {(clipped || expanded) && <Button variant="app-idea" className="idea-action idea-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起内容' : '展开全文'}</Button>}
      <div className="idea-card-tags">{idea.tags.map(t => <Button variant="app-control" key={t} className="idea-tag" title={t} onClick={() => model.setTag(t)} aria-label={`筛选标签：${t}`}>#{t}</Button>)}{!idea.tags.length && <span className="meta">未分类</span>}</div>
      {idea.projectId && <UILink variant="plain" className="idea-project" href={`#projects/${idea.projectId}`}><Mark kind="folder"/>{project?.name ?? '打开关联公司'}</UILink>}
      {dirty && !idea.deleted && <span className="idea-draft-state">有未提交的编辑草稿</span>}
      {pendingKey && <div className="idea-pending"><span>保存结果待确认</span><Button variant="app-idea" className="idea-action" disabled={blocked} onClick={() => void model.reconcile(pendingKey)}>核对保存结果</Button></div>}
      <footer className="idea-card-actions">{idea.deleted ? <><span className="meta">已移除 · 原记录保留</span><Button variant="app-idea" className="idea-action" disabled={blocked} onClick={() => void model.remove(idea, false)}>恢复灵感</Button></> : <>
        <Button variant="app-idea" className="idea-action" disabled={!!pendingKey} onClick={() => model.edit(idea)}><Mark kind="edit"/>编辑</Button>
        {idea.todoId ? <UILink variant="idea" className="idea-action idea-todo-link" href={`#today/${idea.todoId}`}>打开待办<Mark kind="arrow"/></UILink> : <Button variant="app-idea" className="idea-action" disabled={blocked || !!pendingKey} onClick={() => void model.convert(idea, workspace.refresh)}>转待办<Mark kind="arrow"/></Button>}
        <Button variant="app-idea" className="idea-action idea-remove" disabled={blocked || !!pendingKey} aria-label={`移除灵感：${ideaTitle(idea)}`} onClick={() => void model.remove(idea,true)}><Mark kind="trash"/></Button>
      </>}</footer>
    </>}
  </article></RecordContextMenu>;
}
export function IdeasPanel({ model, projects, projectsLoading, projectsError, workspace, targetId }: { model: IdeasController; projects: ProjectDocument[]; projectsLoading: boolean; projectsError: string; workspace: WorkspaceController; targetId: string | null }) {
  const creation = useCreationDialog();
  const submitted = useRef<number | null>(null);
  useEffect(() => {
    if (submitted.current === null || model.busy) return;
    if (!model.error && !model.pending.new && !model.drafts.new.body && model.notice === '灵感已保存。') creation.finish(submitted.current);
    submitted.current = null;
  }, [model.busy, model.error, model.pending, model.notice, model.drafts]);
  const target = model.ideas.find(i => i.id === targetId);
  const visible = targetId ? target ? [target] : [] : filterIdeas(model.ideas,model.query,model.tag,model.projectId,model.deleted);
  const active = model.ideas.filter(i => !i.deleted), removed = model.ideas.filter(i => i.deleted);
  const tags = [...new Set(model.ideas.filter(i => i.deleted === model.deleted).flatMap(i => i.tags))].sort((a,b) => a.localeCompare(b,'zh-CN'));
  const dirtyCount = Object.entries(model.drafts).filter(([key,d]) => key !== 'new' && active.some(i => i.id === key && !sameIdeaContent(i,contentFor(key,d)))).length;
  return <div className="ideas-page">
    <div className="ideas-intro"><div><h2>记录一个想法</h2><p>画面、流程、链接，都可以先留在这里。</p></div><span className="ideas-total"><span className="ideas-total-mark"><Mark/></span><span>已收集 <strong>{active.length.toLocaleString()}</strong> 张灵感</span></span><Button data-create="idea" onClick={() => creation.setOpen(true)}>记下新灵感</Button></div>
    <FormDialog open={creation.open} onOpenChange={creation.setOpen} title="新灵感" description="先留下想法，标题、标签和关联项目可选。关闭保留未提交输入。" wide>
{model.loadError && <Feedback tone="error" role="alert">{model.loadError}</Feedback>}
      <IdeaForm model={model} draft={model.drafts.new} draftKey="new" projects={projects} projectsLoading={projectsLoading} projectsError={projectsError} onSave={() => { if (!model.busy && !model.loading) { submitted.current = creation.session.current; void model.save('new'); } }} onClose={() => creation.setOpen(false)} />
    </FormDialog>
    <datalist id="idea-tag-suggestions">{[...new Set(['流程','项目','画面','工具',...tags])].map(t => <option key={t} value={t}/>)}</datalist>
    <div className="ideas-feedback" aria-live="polite"><span role="status">{creation.open ? '' : model.loading ? '正在读取灵感…' : model.busy ? '正在处理…' : ''}</span>{!model.errorScope?.startsWith('save:') && !model.errorScope?.startsWith('reconcile:') && model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.error}</Feedback>}{!creation.open && model.loadError && <Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback>}</div>
    <section className="ideas-collection" aria-labelledby="ideas-collection-title"><header className="ideas-collection-heading"><div><h2 id="ideas-collection-title">{targetId ? '来源灵感' : model.deleted ? '已移除的灵感' : '我的灵感'}</h2><span className="meta">{targetId ? '原卡与关联完整保留' : `${visible.length} 张${dirtyCount ? ` · ${dirtyCount} 张有编辑草稿` : ''}`}</span></div><div className="ideas-collection-actions">{targetId && <UILink variant="idea" className="idea-action" href="#ideas">返回全部灵感</UILink>}<Button variant="app-idea" className="idea-action" disabled={!!model.busy || model.loading} onClick={() => void model.refresh()}>重新读取</Button><Button variant="app-idea" className="idea-action" aria-pressed={model.deleted} onClick={() => { model.setDeleted(!model.deleted); model.setTag(''); if (targetId) window.location.hash = 'ideas'; }}><Mark kind="trash"/>{model.deleted ? '查看灵感' : `已移除${removed.length ? ` (${removed.length})` : ''}`}</Button></div></header>
    {!targetId && <><div className="ideas-tools"><label className="ideas-search"><Mark kind="search"/><span className="visually-hidden">搜索灵感</span><Input variant="inline" value={model.query} onChange={e => model.setQuery(e.target.value)} placeholder="搜索标题、内容或标签"/></label><label className="ideas-company-filter"><span className="visually-hidden">按公司筛选灵感</span><NativeSelect variant="inline" value={model.projectId} onChange={e => model.setProjectId(e.target.value)}><option value="">全部公司</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></label></div><div className="ideas-tags" aria-label="按标签筛选"><Button variant="app-idea-filter" className="idea-filter" aria-pressed={!model.tag} onClick={() => model.setTag('')}>全部<span>{model.ideas.filter(i => i.deleted === model.deleted).length}</span></Button>{tags.map(t => <Button variant="app-control" key={t} className="idea-filter" title={t} aria-pressed={model.tag === t} onClick={() => model.setTag(t)}><span className="idea-filter-label">{t}</span><span>{model.ideas.filter(i => i.deleted === model.deleted && i.tags.includes(t)).length}</span></Button>)}{model.tag && !tags.includes(model.tag) && <Button variant="app-idea-filter" className="idea-filter" aria-pressed onClick={() => model.setTag('')}>{model.tag} · 清除</Button>}</div></>}
    <div className="idea-grid">{visible.map(idea => <Card key={idea.id} idea={idea} model={model} projects={projects} projectsLoading={projectsLoading} projectsError={projectsError} workspace={workspace} targeted={targetId === idea.id}/>)}
    {!visible.length && <div className="ideas-empty"><span className="ideas-empty-mark"><Mark/></span><h3>{model.loading ? '正在打开你的灵感收集箱' : model.loadError ? '灵感暂时未能读取' : targetId ? '没有找到这张来源灵感' : model.query || model.tag || model.projectId ? '没有找到匹配的灵感' : model.deleted ? '没有已移除的灵感' : '第一个想法，从这里开始'}</h3><p>{model.loadError ? '原记录保留，重新读取后继续。' : targetId ? '请核对来源，或返回全部灵感查看。' : model.query || model.tag || model.projectId ? '换个关键词，或者清除筛选再看看。' : model.deleted ? '移除的卡片会保留在这里，随时可以恢复。' : '记下一束光、一段流程，或一个尚未成形的念头。'}</p>{(model.query || model.tag || model.projectId) && <Button variant="app-pill" className="pill" disabled={model.loading} onClick={model.clearFilters}>清除筛选</Button>}{!model.deleted && !model.query && !model.tag && !model.projectId && !targetId && !model.loadError && <Button variant="app-pill" className="pill" disabled={model.loading} onClick={() => creation.setOpen(true)}>记下第一个灵感<Mark kind="plus"/></Button>}</div>}
    </div></section>
  </div>;
}
