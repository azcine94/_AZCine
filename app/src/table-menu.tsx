import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAnchoredPopover } from './use-anchored-popover.ts';

export interface TableMenuAction { name: string; disabled?: boolean; run(): boolean | void }
export function TableMenu({ label, children, disabled, actions, extra }: {
  label: string; children?: ReactNode; disabled: boolean; actions: TableMenuAction[]; extra?: ReactNode;
}) {
  const instance = useId(), root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef } = useAnchoredPopover(open && !disabled, () => setOpen(false), 224, 'end');
  function close(restore = false) { setOpen(false); if (restore) triggerRef.current?.focus({ preventScroll: true }); }
  useLayoutEffect(() => {
    if (disabled) { if (open) close(); return; }
    if (open) panelRef.current?.querySelector<HTMLElement>('input, [role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [open, disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (root.current && !event.composedPath().includes(root.current)) close(); };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('click', outside, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('click', outside, true); };
  }, [open]);
  return <div ref={root} className="table-menu" data-project-commit onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!open || event.target instanceof HTMLInputElement) return;
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (current + 1) % buttons.length; break;
      case 'ArrowUp': next = (current - 1 + buttons.length) % buttons.length; break;
      case 'Home': next = 0; break;
      case 'End': next = buttons.length - 1; break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); buttons[next]?.focus();
  }}>
    <button ref={triggerRef} type="button" className="table-menu__trigger" aria-label={label} aria-disabled={disabled} aria-haspopup="menu" aria-expanded={open && !disabled} aria-controls={instance} onClick={() => { if (!disabled) setOpen(!open); }}>{children ?? '⋯'}</button>
    <div ref={panelRef} id={instance} className="table-menu__panel" role="menu" aria-label={label} popover="manual" data-project-commit>{open && !disabled && <>{extra}{actions.map(action => <button key={action.name} type="button" role="menuitem" disabled={action.disabled} onClick={() => { close(true); action.run(); }}>{action.name}</button>)}</>}</div>
  </div>;
}
