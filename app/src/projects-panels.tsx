import { EmptyState } from './components/ui/empty-state.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEventHandler, FocusEvent, FocusEventHandler } from 'react';
import type { ChecklistBlock, ProjectContent, ProjectBlock, ProjectDocument } from './projects-contract.ts';
import { deriveDeliveries } from './projects-contract.ts';
import type { ProjectsController } from './use-projects.ts';
import { ListEditor } from './project-list-editor.tsx';
import { ProjectChecklistPanel } from './project-checklist-panel.tsx';
import type { ProjectStageLabelActions } from './project-stage-picker.tsx';
import { ProjectAddMenu } from './project-add-menu.tsx';
import { removeEntity, restoreEntity } from './project-operations.ts';

const id = () => crypto.randomUUID();
export function projectLink(projectId: string, blockId?: string, rowId?: string) {
  return `#projects/${projectId}${blockId && rowId ? `/${blockId}/${rowId}` : ''}`;
}
function status(model: ProjectsController, projectId: string, includeNotice = true) {
  return <div className="workspace-feedback" aria-live="polite">
    {model.errors[projectId] && <Feedback as="p" tone="error" className="form-error" role="alert">{model.errors[projectId]}</Feedback>}
    {includeNotice && model.notices[projectId] && <p role="status">{model.notices[projectId]}</p>}
  </div>;
}
function DocumentIcon({ name }: { name: 'folder' | 'arrow' | 'plus' | 'up' | 'down' | 'terminal' }) {
  const paths = { folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z', arrow: 'M4 12h16m-6-6 6 6-6 6', plus: 'M12 4v16M4 12h16', up: 'M12 20V4m-6 6 6-6 6 6', down: 'M12 4v16m-6-6 6 6 6-6', terminal: 'm5 7 5 5-5 5m8 0h6' };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function FeatureDate({ value }: { value: string }) {
  return <time className="project-date" dateTime={value} aria-label={value}><span className="project-date-year">{value.slice(0, 4)} 年</span><span>{value.slice(5).replace('-', '/')}</span></time>;
}
export function DeliveryList({ projects, compact = false }: { projects: ProjectDocument[]; compact?: boolean }) {
  const deliveries = deriveDeliveries(projects);
  const [allDates, setAllDates] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  if (!deliveries.length) return <p className="project-empty">暂无待交镜头。只统计你指定的 list，已交完不计入。</p>;
  const link = (item: typeof deliveries[number], grouped = false) => <UILink variant="plain" key={`${item.projectId}/${item.rowId}`} href={projectLink(item.projectId, item.blockId, item.rowId)} className={`delivery-link${grouped ? ' summary-record' : ''}`} title={`${item.projectName} · ${item.blockTitle} · ${item.dueDate || '日期待补'} · ${item.stageName || '阶段待补'}`} onClick={event => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && window.location.hash === event.currentTarget.hash) {
      event.preventDefault(); window.dispatchEvent(new CustomEvent('azcine-project-locate', { detail: { projectId: item.projectId, blockId: item.blockId, rowId: item.rowId } }));
    }
  }}>{grouped ? <><strong>{item.shot || '镜头待补'}</strong><span className="visually-hidden"> · {item.dueDate || '日期待补'} · {item.stageName || '阶段待补'} · {item.blockTitle}</span></> : <><span className="delivery-date">{item.dueDate || '日期待补'}</span><span><strong>{item.shot || '镜头待补'}</strong><span className="subtle"> · {item.stageName || '阶段待补'}</span><span className="meta delivery-source">{item.projectName} · {item.blockTitle}</span></span></>}</UILink>;
  if (compact) return <><ul className="delivery-items">{deliveries.slice(0, 6).map(item => <li key={`${item.projectId}/${item.rowId}`}>{link(item)}</li>)}</ul>{deliveries.length > 6 && <p className="meta">还有 {deliveries.length - 6} 项，可到项目文档查看。</p>}</>;
  const groups = new Map<string, typeof deliveries>();
  for (const item of deliveries) { const rows = groups.get(item.dueDate) ?? []; rows.push(item); groups.set(item.dueDate, rows); }
  const shownDates = [...groups].slice(0, allDates ? undefined : 3);
  return <>{shownDates.map(([date, rows]) => {
    const stages = new Map<string, typeof deliveries>();
    for (const item of expandedDates[date] ? rows : rows.slice(0, 20)) { const entries = stages.get(item.stageId) ?? []; entries.push(item); stages.set(item.stageId, entries); }
    return <section className="delivery-group" key={date} aria-label={`${date || '日期待补'}交付`}>
      {rows.length > 20 && <Button variant="app-text" className="text-action" data-summary-toggle={date || 'missing'} aria-expanded={!!expandedDates[date]} onClick={() => setExpandedDates(previous => ({ ...previous, [date]: !previous[date] }))}>{expandedDates[date] ? '收起此日期的镜头' : `展开 ${date || '日期待补'} 的其余 ${rows.length - 20} 个镜头`}</Button>}
      {[...stages].map(([stageId, entries]) => <div className="summary-line" key={stageId}><time className="delivery-date" dateTime={date || undefined}>{date || '日期待补'}</time><span className="doc-stage">{entries[0].stageName || '阶段待补'}</span><div className="summary-records">{entries.map(item => link(item, true))}</div></div>)}
    </section>;
  })}{groups.size > 3 && <Button variant="app-text" className="text-action" aria-expanded={allDates} onClick={() => setAllDates(!allDates)}>{allDates ? '收起更多日期' : `展开其余 ${groups.size - 3} 个日期分组`}</Button>}</>;
}
export function ProjectsOverview({ model, create = false }: { model: ProjectsController; create?: boolean }) {
  const visible = model.projects.filter(project => project.name.toLocaleLowerCase().includes(model.query.trim().toLocaleLowerCase()));
  const creationFeedback = <>{status(model, 'create')}{model.newId && <Feedback as="div" tone="pending" className="pending-note"><p>创建结果尚未确认，名称已保留，不会重复创建。</p>{status(model, model.newId)}<Button variant="app-pill" className="pill" disabled={!!model.busy} onClick={() => { if (model.newId) void model.reconcile(model.newId); }}>核对创建结果</Button></Feedback>}</>;
  if (create) return <div className="project-content project-create-page"><UILink variant="document" className="doc-button" href="#projects">← 全部项目</UILink><section className="project-create"><h2>新建公司项目文档</h2><p className="subtle">从一份空文档开始，内容由你决定。</p><form className="entry-form" noValidate onSubmit={event => { event.preventDefault(); const from = window.location.hash; void model.create().then(projectId => { if (projectId && window.location.hash === from) window.location.hash = projectLink(projectId); }); }}>
    <label htmlFor="new-project-name">项目名称</label><Input variant="inline" id="new-project-name" value={model.newName} aria-required="true" autoComplete="off" placeholder="填写公司项目名称" disabled={!!model.busy || !!model.newId || model.loading || !!model.loadError} onChange={event => model.changeNewName(event.target.value)} />
    <div className="project-create-footer"><span className="meta">公司项目 · 不预设标签或清单</span><Button variant="app-pill" className="pill on" disabled={!!model.busy || model.loading || !!model.loadError}>{model.busy === 'create' ? '正在保存…' : model.newId ? '重试创建（同一请求）' : '新建公司项目'}</Button></div>
  </form>{creationFeedback}{model.loadError && <Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback>}</section></div>;
  return <div className="project-content project-index"><div className="project-index-toolbar"><p className="subtle">文档与交付，按项目组织</p><label className="project-search"><span className="visually-hidden">搜索公司项目</span><Input variant="app" className="input" id="project-search" type="search" placeholder="搜索公司项目" value={model.query} onChange={event => model.changeQuery(event.target.value)} /></label><UILink variant="pill" className="pill on" href="#projects/new"><DocumentIcon name="plus" />新建公司项目</UILink></div>
    {creationFeedback}{model.loadError && <Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback>}
    <section className="project-company-module" aria-labelledby="company-projects-title"><header className="project-module-heading"><h2 id="company-projects-title">公司项目</h2><span className="meta">自由文档 · 清单 · 交付</span></header>
      {model.loading && !model.projects.length && <p className="project-empty" role="status">正在读取公司项目…</p>}{!visible.length ? <div className="project-empty-panel"><h3>{model.query.trim() ? '没有找到公司项目' : '还没有公司项目'}</h3><p>{model.query.trim() ? '换个名称试试，或者清除搜索。' : '从一份文档开始，按你的需要组织清单和交付。'}</p>{model.query.trim() ? <Button variant="app-document" className="doc-button" onClick={() => model.changeQuery('')}>清除搜索</Button> : <UILink variant="pill" className="pill on" href="#projects/new">新建第一份文档</UILink>}</div> : <div className="project-grid">{visible.map(project => {
        const deliveries = deriveDeliveries([project]); const next = deliveries.find(item => item.dueDate); const sameDate = next ? deliveries.filter(item => item.dueDate === next.dueDate) : deliveries; const missing = deliveries.filter(item => item.missing.length).length;
        const description = project.blocks.length ? project.blocks.slice(0, 3).map(block => block.title).join(' · ') : '按你的需要组织项目文档';
        const stages = next ? [...new Set(sameDate.map(item => item.stageName || '阶段待补'))].join(' / ') : '';
        const detail = `${deliveries.length ? `${sameDate.length} 项待交` : '由参与汇总的清单整理'}${stages ? ` · ${stages}` : ''}${missing ? ` · ${missing} 行信息待补` : ''}`;
        return <UILink variant="plain" className="project-card" href={projectLink(project.id)} key={project.id} data-project-id={project.id} data-delivery-state={next ? 'scheduled' : deliveries.length ? 'incomplete' : 'empty'}>
          <div className="project-card-identity"><div className="project-card-top"><span><span className="project-card-icon"><DocumentIcon name="folder" /></span>公司项目</span><span className="project-card-count">{project.blocks.length} 个内容块</span></div><h2 title={project.name}>{project.name}</h2><p title={description}>{description}</p></div>
          <div className="project-card-bottom"><div className="project-card-summary"><span className="project-card-status"><span aria-hidden="true" />{next ? '最近交付' : '交付安排'}</span>{next ? <time className="project-card-value" dateTime={next.dueDate}>{next.dueDate}</time> : <span className="project-card-value">{deliveries.length ? '日期待补' : '暂无交付安排'}</span>}<span className="project-card-detail" title={detail}>{detail}</span></div><span className="project-card-open"><span className="visually-hidden">打开文档</span><DocumentIcon name="arrow" /></span></div>
        </UILink>;
      })}</div>}
    </section><section className="project-personal-module" aria-labelledby="personal-projects-title"><header className="project-module-heading"><h2 id="personal-projects-title">个人项目</h2><span className="meta">待定</span></header><div className="personal-project-placeholder"><span className="personal-project-icon"><DocumentIcon name="terminal" /></span><div><h3>给自己的项目，留一个位置</h3><p>这个模块暂不设计内部功能。</p></div><span className="meta personal-project-state">待定</span></div></section>
    <Button variant="app-document" className="doc-button project-reload" disabled={!!model.busy || model.loading} onClick={() => void model.refresh()}>重新读取项目</Button>
  </div>;
}
function DocumentBody({ value, ...props }: { value: string; id: string; disabled: boolean; 'aria-label': string; onChange: ChangeEventHandler<HTMLTextAreaElement>; onBlur: FocusEventHandler<HTMLTextAreaElement> }) {
  const element = useRef<HTMLTextAreaElement>(null);
  const fit = () => { if (element.current) { element.current.style.height = 'auto'; element.current.style.height = `${element.current.scrollHeight}px`; } };
  useLayoutEffect(fit, [value]);
  useEffect(() => { const node = element.current; if (!node) return; let width = node.clientWidth; const observer = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; fit(); } }); observer.observe(node); return () => observer.disconnect(); }, []);
  return <Textarea variant="inline" {...props} ref={element} rows={2} className="textarea doc-text" value={value} placeholder="开始写下内容…" />;
}
function newBlock(kind: ProjectBlock['kind']): ProjectBlock {
  if (kind === 'text') return { id: id(), kind, title: '文字', body: '' };
  if (kind === 'checklist') return { id: id(), kind, title: '新的项目清单', items: [] };
  return { id: id(), kind, title: '新的 list', included: false, columns: [{ id: id(), name: '内容', kind: 'text' }], rows: [] };
}
export function ProjectEditor({ model, projectId, targetRow }: { model: ProjectsController; projectId: string; targetRow?: { blockId: string; rowId: string } }) {
  const official = model.projects.find(doc => doc.id === projectId);
  const draft = model.drafts[projectId];
  const doc = draft?.content;
  const saving = model.busy === projectId;
  const disabled = !!model.busy || !!model.pending[projectId] || model.loading || !!model.loadError;
  const locked = disabled && !saving;
  // Text may keep changing during this project's in-flight save. The controller
  // retains it over the response and queues the next blur, avoiding lost input
  // when moving directly from one field to another. Structure stays locked.
  const editingDisabled = model.loading || !!model.loadError || (!!model.busy && model.busy !== projectId) || (!!model.pending[projectId] && model.busy !== projectId);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [hideChecklists, setHideChecklists] = useState(() => window.matchMedia('(max-width:1100px)').matches);
  const [checklistFocus, setChecklistFocus] = useState<string>();
  const [locateAgain, setLocateAgain] = useState(0);
  useEffect(() => {
    const locate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.projectId === projectId && detail.blockId === targetRow?.blockId && detail.rowId === targetRow?.rowId) setLocateAgain(value => value + 1);
    };
    window.addEventListener('azcine-project-locate', locate);
    return () => window.removeEventListener('azcine-project-locate', locate);
  }, [projectId, targetRow?.blockId, targetRow?.rowId]);
  // Auxiliary inputs are kept in the App-level controller too, not only this routed view.
  useEffect(() => {
    if (!targetRow || !doc) return;
    const row = document.getElementById(`row-${targetRow.blockId}-${targetRow.rowId}`);
    if (row) {
      row.focus({ preventScroll: true });
      const area = row.closest<HTMLElement>('.project-document-scroll');
      if (area) {
        const rect = row.getBoundingClientRect(), viewport = area.getBoundingClientRect();
        area.scrollBy({ top: rect.top - viewport.top - (area.clientHeight - rect.height) / 2 });
      }
    }
  }, [projectId, targetRow?.blockId, targetRow?.rowId, !!doc, locateAgain]);
  function change(update: (content: ProjectContent) => ProjectContent, save = false) {
    const changed = model.change(projectId, update, save);
    if (changed && save) void model.save(projectId);
    return changed;
  }
  function blockChange(blockId: string, update: (block: ProjectBlock) => ProjectBlock, save = false) {
    return change(content => ({ ...content, blocks: content.blocks.map(block => block.id === blockId ? update(block) : block) }), save);
  }
  function blurSave(event: FocusEvent<HTMLElement>) {
    // Explicit action contracts: commit controls save the combined draft after
    // their click/change; preserve controls deliberately read/discard without
    // writing. Pagination commits on click even though it changes no content.
    const next = event.relatedTarget;
    if (next instanceof Element && next.closest('[data-project-document]')) {
      const actionControl = next instanceof HTMLButtonElement || next instanceof HTMLInputElement && next.type === 'checkbox' || next.getAttribute('role') === 'separator';
      if (next.closest('.project-stage-picker, .table-menu, .date-input__calendar') || actionControl && next.closest('[data-project-commit], [data-project-preserve]')) return;
    }
    if (draft?.dirty && !editingDisabled) void model.save(projectId);
  }
  function add(kind: ProjectBlock['kind']) {
    const block = newBlock(kind);
    const added = change(content => ({ ...content, blocks: [...content.blocks, block] }), true);
    if (added && kind === 'checklist') { setHideChecklists(false); setChecklistFocus(block.id); }
    return added;
  }
  function move(blockId: string, offset: number) {
    change(content => {
      const blocks = [...content.blocks], index = blocks.findIndex(block => block.id === blockId);
      if (index < 0) return content;
      const siblings = blocks.filter(block => (block.kind === 'checklist') === (blocks[index].kind === 'checklist'));
      const neighbour = siblings[siblings.findIndex(block => block.id === blockId) + offset];
      if (!neighbour) return content;
      const target = blocks.findIndex(block => block.id === neighbour.id);
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return { ...content, blocks };
    }, true);
  }
  function remove(blockId: string, type: 'block' | 'row' | 'column' | 'checklist-item', entityId?: string) {
    let deletion: ReturnType<typeof removeEntity> | undefined;
    if (model.change(projectId, content => { deletion = removeEntity(content, type, blockId, entityId); return deletion.content; }, true) && deletion) {
      model.putUndo(projectId, deletion.undo); void model.save(projectId); return true;
    }
    return false;
  }
  function undo() {
    if (draft?.undoApplied) { void model.save(projectId); return; }
    if (model.change(projectId, content => restoreEntity(content, model.undos[projectId]), true)) void model.save(projectId, true);
  }
  const [labelError, setLabelError] = useState('');
  if (model.loading && !doc) return <p role="status">正在读取项目文档…</p>;
  if (!doc || !draft) return <div className="project-content"><UILink variant="pill" className="pill" href="#projects">返回项目</UILink><h2>项目未能打开</h2><p role="alert">{model.loadError || '未找到这个项目，未创建空文档。'}</p><Button variant="app-pill" className="pill" disabled={!!model.busy || model.loading} onClick={() => void model.refresh()}>重新读取</Button></div>;
  const checklists = doc.blocks.filter((block): block is ChecklistBlock => block.kind === 'checklist');
  const documentBlocks = doc.blocks.filter((block): block is Exclude<ProjectBlock, ChecklistBlock> => block.kind !== 'checklist');
  const recentUndo = model.undos[projectId];
  const checklistUndo = recentUndo?.kind === 'checklist-item' || recentUndo?.kind === 'block' && recentUndo.block.kind === 'checklist';
  const undoEntry = recentUndo ? <div className="undo-row form-actions"><span className="meta">最近删除的内容已保留</span><Button variant="app-pill" className="pill" data-project-commit disabled={locked} aria-disabled={disabled} onClick={undo}>{draft.undoApplied ? '保存恢复的内容' : '撤销删除'}</Button></div> : null;
  const summary = official ? deriveDeliveries([official]) : [];
  const next = summary.find(item => item.dueDate);
  const sameDate = summary.filter(item => item.dueDate === next?.dueDate);
  const missingCount = summary.filter(item => item.missing.length > 0).length;
  const stale = official && draft.baseline !== official.revision;
  const stageLabels = doc.labels;
  const labelActions: Omit<ProjectStageLabelActions, 'create'> & { create(name: string, rowId: string, columnId: string, blockId: string): boolean } = {
    draftName: labelId => model.labelDrafts[labelId ? `${projectId}/${labelId}` : projectId] ?? (labelId ? doc.labels.find(label => label.id === labelId)?.name ?? '' : ''),
    changeDraftName: (value, labelId) => { model.changeLabelDraft(projectId, value, labelId); setLabelError(''); },
    error: labelError || model.errors[projectId] || '',
    create: (value, rowId, columnId, blockId) => {
      const name = value.trim();
      if (!validLabelName(name)) return false;
      if (doc.labels.length >= 100) { setLabelError('每个项目最多保存 100 个阶段标签。'); return false; }
      const labelId = id();
      const added = model.change(projectId, content => ({ ...content, labels: [...content.labels, { id: labelId, name }], blocks: content.blocks.map(block => block.id === blockId && block.kind === 'list' ? { ...block, rows: block.rows.map(row => row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: labelId } } : row) } : block) }), true);
      if (added) { model.changeLabelDraft(projectId, ''); void model.save(projectId); }
      return added;
    },
    rename: (labelId, value) => {
      const name = value.trim();
      if (!validLabelName(name, labelId)) return false;
      return change(content => ({ ...content, labels: content.labels.map(label => label.id === labelId ? { ...label, name } : label) }), true);
    },
    remove: labelId => {
      const referenced = doc.blocks.some(block => block.kind === 'list' && block.columns.filter(column => column.kind === 'stage').some(column => block.rows.some(row => row.cells[column.id] === labelId)));
      if (referenced) { setLabelError('此标签仍被镜头引用，请先切换引用后再删除。'); return false; }
      setLabelError('');
      return change(content => ({ ...content, labels: content.labels.filter(label => label.id !== labelId) }), true);
    },
  };
  function validLabelName(name: string, labelId?: string) {
    if (!name || [...name].length > 80 || stageLabels.some(label => label.id !== labelId && label.name.trim() === name)) { setLabelError('请填写 1–80 字且不重复的标签名称。'); return false; }
    setLabelError(''); return true;
  }
  const notice = model.notices[projectId];
  const saveState = saving ? '正在保存…' : model.pending[projectId] ? '保存结果待核对' : draft.dirty ? '有未保存编辑，摘要仍使用已保存记录' : `已保存 · 修订 ${official?.revision ?? 0}${notice && notice !== '项目已保存。' ? ` · ${notice}` : ''}`;
  return <div className="project-content project-document" data-project-document={projectId} data-saving={saving} onClickCapture={event => {
    // Temporary locks use aria-disabled so fast IPC cannot drop focus or fade
    // every control. Capture plus the controller guard still blocks mutation.
    if (event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) { event.preventDefault(); event.stopPropagation(); }
  }} onKeyDownCapture={event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) { event.preventDefault(); event.stopPropagation(); }
  }} onBlurCapture={event => {
    // Deferring a text blur must survive focus-only keyboard navigation too:
    // leaving an unactivated commit control flushes the draft, or transfers
    // responsibility to the next explicit commit/preserve control. No timer
    // runs before a direct pointer click can apply its combined change.
    const target = event.target;
    const commitControl = (target instanceof HTMLButtonElement || target instanceof HTMLInputElement && target.type === 'checkbox' || target.getAttribute('role') === 'separator') && target.closest('[data-project-commit]');
    const picker = target.closest('.project-stage-picker, .date-input, .table-menu');
    const leavingPicker = picker && !(event.relatedTarget instanceof Element && picker.contains(event.relatedTarget));
    if (commitControl || leavingPicker) blurSave(event);
  }}>
    <header className="project-document-header">
      <div className="document-breadcrumb"><UILink variant="document" className="doc-button" href="#projects">← 全部项目</UILink><p className="meta document-save-state" role="status" aria-busy={saving}>{saveState}</p></div>
      <div className="document-top"><label className="visually-hidden" htmlFor="project-name">项目名称</label><Input variant="inline" className="input project-name" id="project-name" value={doc.name} disabled={editingDisabled} onChange={event => change(content => ({ ...content, name: event.target.value }))} onBlur={blurSave} /><div className="document-heading-actions"><Button variant="app-document" type="button" className="doc-button project-checklists-toggle" aria-expanded={!hideChecklists} aria-controls="project-checklists-panel" onClick={() => setHideChecklists(!hideChecklists)}>{hideChecklists ? '展开项目清单' : '收起项目清单'}<span className="project-checklists-toggle-count">{checklists.length}</span></Button><Button variant="app-document" className="doc-button" data-project-commit disabled={locked || !draft.dirty} aria-disabled={disabled || !draft.dirty} onClick={() => void model.save(projectId)}>保存文档</Button><ProjectAddMenu primary disabled={disabled} onAdd={add} /></div></div>
    </header>
    <div className="project-document-layout" data-checklists-hidden={hideChecklists}>
      <ProjectChecklistPanel id="project-checklists-panel" groups={checklists} hidden={hideChecklists} disabled={disabled} locked={locked} editingDisabled={editingDisabled} focusBlockId={checklistFocus} addGroup={() => add('checklist')} update={(blockId, update, save) => blockChange(blockId, block => block.kind === 'checklist' ? update(block) : block, save)} remove={(blockId, itemId) => remove(blockId, itemId ? 'checklist-item' : 'block', itemId)} move={move} blurSave={blurSave} undo={checklistUndo ? undoEntry : null} />
      <div className="project-document-scroll" role="region" aria-label="项目文档正文" tabIndex={0}>
    {status(model, projectId, false)}{model.loadError && <Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback>}
    {model.pending[projectId] && !model.busy && <Feedback as="div" tone="pending" className="pending-note"><p>输入和原请求已保留。重试不重复创建，核对后再继续修改。</p><div className="form-actions"><Button variant="app-pill" className="pill" onClick={() => void model.save(projectId)}>重试保存（同一请求）</Button><Button variant="app-pill" className="pill" onClick={() => void model.reconcile(projectId)}>核对保存结果</Button></div></Feedback>}
    {stale && <Feedback as="section" tone="conflict" className="project-conflict" aria-label="项目修订冲突"><h2>正式记录已变化</h2><p>草稿仍保留在原修订 {draft.baseline}。先核对当前正式修订 {official.revision}。下面采用新基线后仍需点击保存；保存会以当前整份草稿替换正式文档，不自动合并。</p><Disclosure><summary>查看当前正式记录</summary><pre>{JSON.stringify(official, null, 2)}</pre></Disclosure><Button variant="app-pill" className="pill" data-project-preserve disabled={locked} aria-disabled={disabled} onClick={() => model.rebase(projectId)}>已核对，将草稿改用当前修订</Button></Feedback>}
    <section className="delivery-summary" aria-label="交付摘要"><div className="summary-feature"><p className="summary-eyebrow">最近待交</p>{next ? <FeatureDate value={next.dueDate} /> : <p className="project-date summary-no-date">{summary.length ? '日期待补' : '暂无待交'}</p>}<p>{next ? `${sameDate.length} 项交付 · ${[...new Set(sameDate.map(item => item.stageName || '阶段待补'))].join(' / ')}` : '只统计指定 list 中未交完的行'}</p><span className="meta">由参与汇总的清单整理</span></div><div className="summary-items"><header className="summary-heading"><h2>交付摘要</h2><span className="meta">{summary.length} 项待交 · 点镜头定位原行</span></header><DeliveryList projects={official ? [official] : []} />{missingCount > 0 && <p className="meta summary-missing">{missingCount} 行信息待补；未填日期、镜头或阶段仍明确保留。</p>}</div></section>
    {documentBlocks.length === 0 && <EmptyState as="div" className="project-document-empty"><h2>从一张表或一段文字开始</h2><p>右侧整理镜头、交期和说明，检查事项留在左侧项目清单。</p><ProjectAddMenu disabled={disabled} onAdd={add} /></EmptyState>}
    {documentBlocks.map((block, index) => <section className={`doc-block${block.kind === 'list' ? ' doc-block--list' : ' doc-block--text'}`} key={block.id} data-block-id={block.id}>
      <div className="block-heading"><label className="visually-hidden" htmlFor={`block-${block.id}`}>内容块标题</label><Input variant="inline" className="input block-title" id={`block-${block.id}`} value={block.title} disabled={editingDisabled} onChange={event => blockChange(block.id, item => ({ ...item, title: event.target.value }))} onBlur={blurSave} /><div className="form-actions block-actions" data-project-commit><Button variant="app-document" className="doc-button block-move" disabled={locked || index === 0} aria-disabled={disabled || index === 0} aria-label={`上移：${block.title}`} onClick={() => move(block.id, -1)}><DocumentIcon name="up" /></Button><Button variant="app-document" className="doc-button block-move" disabled={locked || index === documentBlocks.length - 1} aria-disabled={disabled || index === documentBlocks.length - 1} aria-label={`下移：${block.title}`} onClick={() => move(block.id, 1)}><DocumentIcon name="down" /></Button><Button variant="app-document" className="doc-button" disabled={locked} aria-disabled={disabled} onClick={() => remove(block.id, 'block')}>移除块</Button></div></div>
      {block.kind === 'text' ? <DocumentBody id={`body-${block.id}`} aria-label={`${block.title}正文`} value={block.body} disabled={editingDisabled} onChange={event => blockChange(block.id, item => item.kind === 'text' ? { ...item, body: event.target.value } : item)} onBlur={blurSave} /> : <ListEditor key={`${block.id}:${targetRow?.blockId === block.id ? targetRow.rowId : ''}:${locateAgain}`} commit={() => void model.save(projectId)} block={block} targetRowId={targetRow?.blockId === block.id ? targetRow.rowId : undefined} labels={doc.labels} labelActions={{ ...labelActions, create: (name, rowId, columnId) => labelActions.create(name, rowId, columnId, block.id) }} disabled={disabled} locked={locked} editingDisabled={editingDisabled} update={(update, save) => blockChange(block.id, item => item.kind === 'list' ? update(item) : item, save)} blurSave={blurSave} remove={(type, entityId) => remove(block.id, type, entityId)} />}
    </section>)}
    <div className="document-add-bottom"><ProjectAddMenu disabled={disabled} onAdd={add} /></div>
    {(!checklistUndo || hideChecklists) && undoEntry}
    <div className="form-actions"><Button variant="app-text" className="text-action" data-project-preserve disabled={!!model.busy || model.loading} onClick={() => void model.refresh()}>读取正式记录（保留草稿）</Button>{draft.dirty && <Button variant="app-text" className="text-action" data-project-preserve disabled={locked} aria-disabled={disabled} onClick={() => setConfirmDiscard(true)}>放弃此项目未保存编辑</Button>}</div>
    {confirmDiscard && <Feedback as="div" tone="pending" className="pending-note" role="alert"><p>仅丢弃此项目尚未保存的编辑，采用当前正式记录；其他项目草稿不变。</p><div className="form-actions"><Button variant="app-pill" className="pill" data-project-preserve disabled={locked} aria-disabled={disabled} onClick={() => { model.replaceWithOfficial(projectId); setConfirmDiscard(false); }}>确认放弃未保存编辑</Button><Button variant="app-pill" className="pill" onClick={() => setConfirmDiscard(false)}>保留编辑</Button></div></Feedback>}
    <p className="meta">资料导入在 S05 接入；这里不提供假解析。</p>
      </div>
    </div>
  </div>;
}
