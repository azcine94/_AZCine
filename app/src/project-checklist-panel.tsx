import { RecordContextMenu } from './components/ui/record-context-menu.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { useLayoutEffect, useRef } from 'react';
import type { ChangeEventHandler, FocusEvent, FocusEventHandler, ReactNode } from 'react';
import type { ChecklistBlock } from './projects-contract.ts';
import { TableMenu } from './table-menu.tsx';

interface ProjectChecklistPanelProps {
  id: string;
  groups: ChecklistBlock[];
  hidden: boolean;
  disabled: boolean;
  locked: boolean;
  editingDisabled: boolean;
  focusBlockId?: string;
  undo: ReactNode;
  addGroup(): boolean;
  update(blockId: string, change: (block: ChecklistBlock) => ChecklistBlock, save?: boolean): boolean;
  remove(blockId: string, itemId?: string): boolean;
  move(blockId: string, offset: number): void;
  blurSave(event: FocusEvent<HTMLElement>): void;
}

function ChecklistIcon({ name }: { name: 'checklist' | 'plus' | 'delete' }) {
  const paths = {
    checklist: 'm3 6 2 2 3-3m3 2h10m-18 8 2 2 3-3m3 2h10',
    plus: 'M12 5v14M5 12h14',
    delete: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function ChecklistText({ value, ...props }: {
  id: string; value: string; disabled: boolean; 'aria-label': string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onBlur: FocusEventHandler<HTMLTextAreaElement>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      element.style.height = 'auto';
      element.style.height = `${Math.min(200, element.scrollHeight)}px`;
    };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) { width = element.clientWidth; fit(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return <Textarea variant="inline" {...props} ref={ref} className="project-checklist-text" rows={1} value={value} placeholder="填写检查事项…" />;
}

export function ProjectChecklistPanel({ id, groups, hidden, disabled, locked, editingDisabled, focusBlockId, undo, addGroup, update, remove, move, blurSave }: ProjectChecklistPanelProps) {
  const root = useRef<HTMLElement>(null);
  const addGroupRef = useRef<HTMLButtonElement>(null);
  const nextFocus = useRef<{ blockId?: string; itemId?: string; addItem?: boolean } | null>(null);
  const focusedBlock = useRef<string | undefined>(undefined);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const done = groups.reduce((sum, group) => sum + group.items.filter(item => item.checked).length, 0);

  useLayoutEffect(() => {
    if (hidden) return;
    const requested = nextFocus.current ?? (focusBlockId && focusBlockId !== focusedBlock.current ? { blockId: focusBlockId } : null);
    if (!requested) return;
    const group = root.current?.querySelector<HTMLElement>(`[data-block-id="${requested.blockId}"]`);
    const target = requested.itemId ? group?.querySelector<HTMLElement>(`[data-checklist-item-id="${requested.itemId}"] textarea`)
      : requested.addItem ? group?.querySelector<HTMLElement>('[data-checklist-add]')
      : requested.blockId ? group?.querySelector<HTMLElement>('.project-checklist-title') : addGroupRef.current;
    if (!target) return;
    nextFocus.current = null; focusedBlock.current = focusBlockId;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [groups, hidden, focusBlockId]);

  function addItem(group: ChecklistBlock) {
    const itemId = crypto.randomUUID();
    if (update(group.id, current => ({ ...current, items: [...current.items, { id: itemId, text: '', checked: false }] }), true)) nextFocus.current = { blockId: group.id, itemId };
  }
  function removeItem(group: ChecklistBlock, itemId: string) {
    const index = group.items.findIndex(item => item.id === itemId);
    if (!remove(group.id, itemId)) return;
    const neighbour = group.items[index + 1] ?? group.items[index - 1];
    nextFocus.current = neighbour ? { blockId: group.id, itemId: neighbour.id } : { blockId: group.id, addItem: true };
  }
  function removeGroup(groupId: string) {
    const index = groups.findIndex(group => group.id === groupId);
    if (remove(groupId)) nextFocus.current = { blockId: groups[index + 1]?.id ?? groups[index - 1]?.id };
  }

  return <aside ref={root} id={id} className="project-checklists" aria-label="项目清单" hidden={hidden}>
    <header className="project-checklists-heading">
      <span className="project-checklists-icon"><ChecklistIcon name="checklist" /></span>
      <div><h2>项目清单</h2><p>{total ? `${total - done} 项待检查 · ${done} 项完成` : '分组记录，逐项确认'}</p></div>
      <Button variant="app-control" ref={addGroupRef} type="button" className="project-checklist-icon-button" data-project-commit aria-label="新增项目清单" title="新增清单分组" disabled={locked} aria-disabled={disabled} onClick={addGroup}><ChecklistIcon name="plus" /></Button>
    </header>
    <div className="project-checklists-scroll" role="region" aria-label="项目清单分组" tabIndex={0}>
      {!groups.length ? <div className="project-checklists-empty"><span><ChecklistIcon name="checklist" /></span><h3>把检查事项留在这里</h3><p>资料确认、版本检查、交付准备，按你的习惯分组。</p><Button variant="app-pill" type="button" className="pill" data-project-commit disabled={locked} aria-disabled={disabled} onClick={addGroup}>＋ 新建第一份清单</Button></div> : groups.map((group, index) => {
        const completed = group.items.filter(item => item.checked).length;
        return <RecordContextMenu key={group.id} copyText={group.title+'\n'+group.items.map(item=>(item.checked?'☑ ':'☐ ')+item.text).join('\n')} actions={[{label:'添加事项',disabled,run:()=>addItem(group)},{label:'删除清单',destructive:true,disabled,run:()=>removeGroup(group.id)}]}><section className="project-checklist-group" data-block-id={group.id} data-complete={group.items.length > 0 && completed === group.items.length} aria-label={`项目清单：${group.title}`}>
          <header className="project-checklist-group-heading">
            <label className="visually-hidden" htmlFor={`block-${group.id}`}>清单分组名称</label>
            <Input variant="inline" id={`block-${group.id}`} className="project-checklist-title" value={group.title} placeholder="清单分组名称" disabled={editingDisabled} onChange={event => update(group.id, current => ({ ...current, title: event.target.value }))} onBlur={blurSave} />
            <span className="project-checklist-count" aria-label={`${completed} 项完成，共 ${group.items.length} 项`}>{completed}/{group.items.length}</span>
            <TableMenu label={`清单操作：${group.title}`} disabled={disabled} actions={[
              { name: '上移清单', disabled: index === 0, run: () => move(group.id, -1) },
              { name: '下移清单', disabled: index === groups.length - 1, run: () => move(group.id, 1) },
              { name: '删除清单', run: () => removeGroup(group.id) },
            ]} />
          </header>
          <progress className="project-checklist-progress" value={completed} max={Math.max(1, group.items.length)} aria-label={`${group.title}完成进度`} />
          <ul className="project-checklist-items">{group.items.map(item => <RecordContextMenu key={item.id} copyText={item.text} actions={[{label:item.checked?'标记未完成':'标记已完成',disabled,run:()=>{update(group.id,current=>({...current,items:current.items.map(entry=>entry.id===item.id?{...entry,checked:!item.checked}:entry)}),true);}},{label:'删除事项',destructive:true,disabled,run:()=>removeItem(group,item.id)}]}><li data-checklist-item-id={item.id} data-complete={item.checked}>
            <label className="project-checklist-check"><Input variant="inline" type="checkbox" data-project-commit checked={item.checked} disabled={locked} aria-disabled={disabled} aria-label={`勾选：${item.text || '未填写事项'}`} onChange={event => update(group.id, current => ({ ...current, items: current.items.map(entry => entry.id === item.id ? { ...entry, checked: event.target.checked } : entry) }), true)} /><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg></span></label>
            <ChecklistText id={`checklist-item-${item.id}`} aria-label={`${group.title}，检查事项`} value={item.text} disabled={editingDisabled} onChange={event => update(group.id, current => ({ ...current, items: current.items.map(entry => entry.id === item.id ? { ...entry, text: event.target.value } : entry) }))} onBlur={blurSave} />
            <Button variant="app-control" type="button" className="project-checklist-icon-button project-checklist-delete" data-project-commit aria-label={`删除事项：${item.text || '未填写事项'}`} title="删除此事项" disabled={locked} aria-disabled={disabled} onClick={() => removeItem(group, item.id)}><ChecklistIcon name="delete" /></Button>
          </li></RecordContextMenu>)}</ul>
          {!group.items.length && <p className="project-checklist-empty">还没有事项，从下面添加一项开始。</p>}
          <Button variant="app-control" type="button" className="project-checklist-add" data-project-commit data-checklist-add disabled={locked} aria-disabled={disabled} onClick={() => addItem(group)}><ChecklistIcon name="plus" />添加事项</Button>
        </section></RecordContextMenu>;
      })}
      {groups.length > 0 && <Button variant="app-control" type="button" className="project-checklist-add-group" data-project-commit disabled={locked} aria-disabled={disabled} onClick={addGroup}><ChecklistIcon name="plus" />添加清单分组</Button>}
    </div>
    <footer className="project-checklists-footer">{undo ?? <p>项目检查事项 · 不影响镜头交付</p>}</footer>
  </aside>;
}
