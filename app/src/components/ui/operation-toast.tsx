import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Dispatch, SetStateAction } from 'react';
import { Check, Info, X } from 'lucide-react';
import { Button } from './button.tsx';

type ToastOptions = { tone?: 'info' | 'success' | 'error'; action?: { label: string; run: () => void | Promise<unknown> } };
type Message = ToastOptions & { id: number; text: string };
let current: Message | null = null;
let serial = 0, timer: ReturnType<typeof setTimeout> | undefined;
let expiresAt = 0, remaining = 0;
let hovering = false, focusing = false;
const listeners = new Set<() => void>();
const announce = () => listeners.forEach(listener => listener());
function stopTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
function dismiss(id: number) { if (current?.id !== id) return; stopTimer(); current = null; hovering = false; focusing = false; announce(); }
function resume() {
  if (!current || timer !== undefined || hovering || focusing) return;
  const id = current.id; expiresAt = Date.now() + remaining;
  timer = setTimeout(() => dismiss(id), remaining);
}
function pause() { if (timer !== undefined) { remaining = Math.max(0, expiresAt - Date.now()); stopTimer(); } }
/** One transient outcome at a time; repeated actions restart its lifetime. */
export function notifyOperation(text: string, options: ToastOptions = {}) {
  if (!text.trim()) return;
  stopTimer(); current = { id: ++serial, text, ...options };
  remaining = options.action ? 6000 : 4000;
  resume(); announce();
}
/** Retain receipt state for existing controller logic; display outcomes centrally. */
type NoticeValue<T> = null extends T ? string | null : string;
export function useOperationNotice<T extends string | null>(initial: T): [NoticeValue<T>, Dispatch<SetStateAction<NoticeValue<T>>>] {
  const [value, setValue] = useState<NoticeValue<T>>(initial as NoticeValue<T>), latest = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<NoticeValue<T>>>>(input => {
    const next = typeof input === 'function' ? input(latest.current) : input;
    latest.current = next; setValue(next);
    if (next) notifyOperation(next);
  }, []);
  return [value, update];
}
export function useOperationNotices<T extends Record<string, string>>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial), latest = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<T>>>(input => {
    const next = typeof input === 'function' ? input(latest.current) : input;
    for (const [key, text] of Object.entries(next)) if (text && text !== latest.current[key]) notifyOperation(text);
    latest.current = next; setValue(next);
  }, []);
  return [value, update];
}
export function OperationToast() {
  const message = useSyncExternalStore(useCallback((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []), () => current, () => null);
  return createPortal(<div className="ui-operation-toast-region" data-slot="operation-toast" aria-live="polite" aria-atomic="true">
    {message && <div className="ui-operation-toast" data-tone={message.tone ?? 'info'} onMouseEnter={() => { hovering = true; pause(); }} onMouseLeave={() => { hovering = false; resume(); }} onFocusCapture={() => { focusing = true; pause(); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { focusing = false; resume(); } }}>
      {message.tone === 'success' ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}
      <span className="ui-operation-toast-text" title={message.text}>{message.text}</span>
      {message.action && <Button variant="ghost" size="sm" onClick={() => { const action = message.action; dismiss(message.id); void Promise.resolve().then(() => action?.run()).catch(() => notifyOperation('操作未完成，请回到对应记录核对。', { tone: 'error' })); }}>{message.action.label}</Button>}
      <Button variant="ghost" size="icon-sm" aria-label="关闭操作提示" onClick={() => dismiss(message.id)}><X aria-hidden="true" /></Button>
    </div>}
  </div>, document.body);
}
