import { useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { Expand } from 'lucide-react';
import { Button } from './button.tsx';
import { Textarea } from './textarea.tsx';
import { FormDialog } from './form-dialog.tsx';

/** Controlled document draft: opening/closing the editor never replaces the value. */
export function ExpandableTextCell({ value, label, disabled, onChange, onBlur, onCommit }: {
  value: string; label: string; disabled: boolean;
  onChange: (value: string) => void; onBlur: (event: FocusEvent<HTMLElement>) => void;
  onCommit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    let width = -1;
    const measure = () => {
      if (width === element.clientWidth) return;
      width = element.clientWidth;
      element.style.height = '0px';
      element.style.height = `${Math.min(92, Math.max(36, element.scrollHeight))}px`;
    };
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);
  function close(next: boolean) { setOpen(next); if (!next) onCommit(); }
  return <div className="ui-expandable-cell">
    <Textarea ref={input} variant="inline" className="ui-expandable-cell-input" rows={1}
      aria-label={label} value={value} disabled={disabled} spellCheck={false}
      onChange={event => onChange(event.target.value)} onBlur={onBlur}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); setOpen(true); }
        if (event.key === 'Enter' && event.shiftKey || ['ArrowUp', 'ArrowDown'].includes(event.key) && value.includes('\n')) event.stopPropagation();
      }} />
    <Button variant="ghost" size="icon-xs" type="button" data-project-commit
      aria-label={`${label}，展开编辑`} title="展开编辑（F2）" disabled={disabled} onClick={() => setOpen(true)}><Expand /></Button>
    <FormDialog open={open} onOpenChange={close} title="编辑单元格" description="输入同步到项目草稿，关闭保留输入；保存失败时可继续修改。" returnFocus={input.current}
      footer={<div className="form-actions justify-end"><Button type="button" onClick={() => close(false)}>完成编辑</Button></div>}>
      <label className="ui-expandable-cell-editor">{label}<Textarea variant="app" rows={12} aria-label={`${label}，完整内容`} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /></label>
    </FormDialog>
  </div>;
}
