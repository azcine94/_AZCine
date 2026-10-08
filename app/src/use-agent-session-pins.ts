import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { notifyOperation } from './components/ui/operation-toast.tsx';

const changedEvent = 'azcine:agent-session-pins-changed';
const temporaryPins = new Map<string,string>();
const empty = '[]';
function readPins(key:string|null) {
  if (!key) return empty;
  if (temporaryPins.has(key)) return temporaryPins.get(key)!;
  try { return localStorage.getItem(key) ?? empty; } catch { return empty; }
}
function parsePins(value:string):string[] {
  try {
    const pins:unknown = JSON.parse(value);
    return Array.isArray(pins) ? [...new Set(pins.filter((pin):pin is string => typeof pin === 'string' && !!pin))] : [];
  } catch { return []; }
}

/** UI preference only; native Pi session files and business records stay untouched. */
export function useAgentSessionPins(root:string|null) {
  const key = root ? `azcine.agent-session-pins:${root}` : null;
  const subscribe = useCallback((notify:()=>void) => {
    const changed = (event:Event) => { if ((event as CustomEvent<string>).detail === key) notify(); };
    const stored = (event:StorageEvent) => {
      if (key && (event.key === key || event.key === null)) { temporaryPins.delete(key); notify(); }
    };
    window.addEventListener(changedEvent, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(changedEvent, changed); window.removeEventListener('storage', stored); };
  }, [key]);
  const snapshot = useCallback(() => readPins(key), [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => empty);
  const sessionPins = useMemo(() => parsePins(raw), [raw]);
  const update = useCallback((change:(before:string[])=>string[]) => {
    if (!key) return;
    const before = readPins(key), next = JSON.stringify(change(parsePins(before)));
    if (next === before) return;
    try { localStorage.setItem(key, next); temporaryPins.delete(key); }
    catch {
      temporaryPins.set(key, next);
      notifyOperation('置顶顺序暂存于当前窗口，未能保存；关闭后可能丢失。', {tone:'error'});
    }
    window.dispatchEvent(new CustomEvent<string>(changedEvent, {detail:key}));
  }, [key]);
  const setSessionPinned = useCallback((sessionId:string, pinned:boolean) => {
    if (!sessionId) return;
    update(before => pinned ? before.includes(sessionId) ? before : [...before, sessionId] : before.filter(id => id !== sessionId));
  }, [update]);
  const forgetSessionPins = useCallback((sessionIds:string[]) => {
    if (sessionIds.length) update(before => before.filter(id => !sessionIds.includes(id)));
  }, [update]);
  return {sessionPins, setSessionPinned, forgetSessionPins};
}
