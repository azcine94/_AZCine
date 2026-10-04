import { Button } from './components/ui/button.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ProjectBlock } from './projects-contract.ts';
import { useAnchoredPopover } from './use-anchored-popover.ts';

const choices = [
  { kind: 'text', name: '添加文字', description: '说明、参考链接与工作笔记', path: 'M4 5h16M12 5v14M8 19h8' },
  { kind: 'list', name: '添加表格 list', description: '按行记录，可指定交付汇总', path: 'M3 4h18v16H3ZM3 10h18M10 4v16' },
  { kind: 'checklist', name: '添加项目清单', description: '在左侧分组记录，逐项检查', path: 'm3 6 2 2 3-3m3 2h10m-18 8 2 2 3-3m3 2h10' },
] as const;

export function ProjectAddMenu({ disabled, onAdd, primary = false, onOpen }: {
  disabled: boolean;
  onAdd(kind: ProjectBlock['kind']): boolean;
  primary?: boolean;
  onOpen?(): void;
}) {
  const menuId = `${useId()}-add-content`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const focusOnOpen = useRef(false);
  const { triggerRef, panelRef } = useAnchoredPopover(open && !disabled, () => setOpen(false), 288, primary ? 'end' : 'start');
  const expanded = open && !disabled;
  function close(restoreFocus = false) {
    focusOnOpen.current = false; setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }
  function focusItem(index: number) {
    setActive(index);
    panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[index]?.focus({ preventScroll: true });
  }
  function openAt(index: number) {
    if (disabled) return;
    if (expanded) { focusItem(index); return; }
    onOpen?.(); setActive(index); focusOnOpen.current = true; setOpen(true);
  }
  useLayoutEffect(() => {
    if (disabled) { if (open) close(); return; }
    if (expanded && focusOnOpen.current) { focusOnOpen.current = false; focusItem(active); }
  }, [disabled, expanded]);
  useEffect(() => {
    if (!expanded) return;
    const doc = rootRef.current?.ownerDocument;
    if (!doc) return;
    const outside = (event: Event) => { if (rootRef.current && !event.composedPath().includes(rootRef.current)) close(); };
    doc.addEventListener('pointerdown', outside, true); doc.addEventListener('click', outside, true);
    return () => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('click', outside, true); };
  }, [expanded]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = event.key === 'ArrowDown' ? (index + 1) % choices.length : event.key === 'ArrowUp' ? (index + choices.length - 1) % choices.length : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation(); focusItem(next);
  }
  return <div ref={rootRef} className="project-add-menu" data-project-commit onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={event => {
    if (expanded && event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(true); }
  }}>
    <Button variant={primary ? 'app-pill' : 'app-document'} className={primary ? 'on' : undefined} ref={triggerRef} type="button" aria-disabled={disabled} aria-haspopup="menu" aria-expanded={expanded} aria-controls={menuId} onClick={() => {
      if (disabled) return;
      if (expanded) close(true); else openAt(0);
    }} onKeyDown={event => {
      if (disabled || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); openAt(event.key === 'ArrowUp' || event.key === 'End' ? choices.length - 1 : 0);
      }
    }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>
      {primary ? '添加内容' : '添加文档内容'}
    </Button>
    <div ref={panelRef} id={menuId} className="project-add-menu__panel" popover="manual" role="menu" aria-label="添加文档内容">
      {expanded && choices.map((choice, index) => <Button variant="app-control" key={choice.kind} type="button" role="menuitem" className="project-add-menu__item" tabIndex={active === index ? 0 : -1} onFocus={() => setActive(index)} onKeyDown={event => navigate(event, index)} onClick={() => {
        if (disabled) return;
        close(true); onAdd(choice.kind);
      }}>
        <span className="project-add-menu__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={choice.path} /></svg></span>
        <span><strong>{choice.name}</strong><span className="project-add-menu__description">{choice.description}</span></span>
      </Button>)}
    </div>
  </div>;
}
