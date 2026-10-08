import { useRef, useState } from 'react';
import type { FocusEvent } from 'react';

/** Native text input keeps clipboard/IME support; the table owns the selection outline. */
export function SpreadsheetTextCell({ value, label, disabled, onChange, onBlur, onCommit }: {
  value: string; label: string; disabled: boolean;
  onChange(value: string): void;
  onBlur(event: FocusEvent<HTMLElement>): void;
  onCommit(): void;
}) {
  const [editing, setEditing] = useState(false);
  const original = useRef(value);
  const composing = useRef(false);
  function begin() {
    if (!editing) { original.current = value; setEditing(true); }
  }
  return <textarea className="ui-spreadsheet-cell" data-cell-control data-editing={editing}
    aria-label={label} aria-description="单击选中，直接输入替换内容；双击或 F2 编辑，Alt+Enter 换行，Escape 取消本次编辑。"
    rows={1} value={value} disabled={disabled} spellCheck={false}
    onFocus={event => { original.current = value; event.currentTarget.select(); }}
    onMouseDown={event => {
      if (!editing && event.button === 0 && event.detail < 2) {
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.select();
      }
    }}
    onDoubleClick={begin}
    onBeforeInput={begin}
    onCompositionStart={() => { composing.current = true; begin(); }}
    onCompositionEnd={() => { composing.current = false; }}
    onChange={event => { begin(); onChange(event.target.value); }}
    onBlur={event => { composing.current = false; setEditing(false); onBlur(event); }}
    onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
        event.stopPropagation(); return;
      }
      if (event.key === 'F2') {
        event.preventDefault(); event.stopPropagation(); begin();
        event.currentTarget.setSelectionRange(value.length, value.length); return;
      }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (editing) onChange(original.current);
        setEditing(false);
        const input = event.currentTarget;
        requestAnimationFrame(() => { if (document.activeElement === input) input.select(); });
        return;
      }
      if (event.key === 'Enter' && event.altKey) {
        event.preventDefault(); event.stopPropagation(); begin();
        const input = event.currentTarget, at = input.selectionStart;
        const next = value.slice(0, at) + '\n' + value.slice(input.selectionEnd);
        onChange(next);
        requestAnimationFrame(() => { if (document.activeElement === input) input.setSelectionRange(at + 1, at + 1); });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (editing) onCommit();
        setEditing(false); event.currentTarget.select(); return;
      }
      if (event.key.startsWith('Arrow')) {
        if (editing) event.stopPropagation();
        return;
      }
      if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault(); event.stopPropagation();
        original.current = value; setEditing(event.key === 'Backspace'); onChange('');
      }
    }} />;
}
