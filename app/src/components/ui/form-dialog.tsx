import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog.tsx';

/** Shared creation form: bounded height, scrolling body and native dialog focus handling. */
export function FormDialog({ open, onOpenChange, title, description, wide = false, children, returnFocus, footer, className = '' }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string;
  description: string; wide?: boolean; children: ReactNode;
  returnFocus?: HTMLElement | null;
  footer?: ReactNode; className?: string;
}) {
  const previousOpen = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const visibleChildren = useRef(children);
  const visibleFooter = useRef(footer);
  if (open) { visibleChildren.current = children; visibleFooter.current = footer; }
  if (open && !previousOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousOpen.current = open;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent layout="form" className={`ui-form-dialog${wide ? ' ui-form-dialog--wide' : ''} ${className}`} onCloseAutoFocus={event => { const target = returnFocus ?? opener.current; if (target?.isConnected) { event.preventDefault(); target.focus({ preventScroll: true }); } }}>
      <DialogHeader className="ui-form-dialog-header"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="ui-form-dialog-body">{visibleChildren.current}</div>
      {visibleFooter.current != null && <div className="ui-form-dialog-footer">{visibleFooter.current}</div>}
    </DialogContent>
  </Dialog>;
}

// A delayed save may close only the dialog session that submitted it.
export function useCreationDialog(initialOpen = false) {
  const [open, updateOpen] = useState(initialOpen);
  const session = useRef(0);
  useEffect(() => () => { ++session.current; }, []);
  function setOpen(value: boolean) { ++session.current; updateOpen(value); }
  function finish(expected: number) { if (session.current === expected) setOpen(false); }
  return { open, setOpen, finish, session };
}
