import { useOperationNotice } from './components/ui/operation-toast.tsx';
import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { parseWorkspace, workspaceError } from './workspace-contract.ts';
import type { Workspace } from './workspace-contract.ts';

// Kept in App, never in a routed panel: navigating/theme changes do not discard drafts or pending IPC.
export function useWorkspace() {
  const connected = isTauri();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [errorScope, setErrorScope] = useState<string | null>(null);
  const [notice, setNotice] = useOperationNotice('');
  const [rootDraft, setRootDraft] = useState('');
  const [rootChangePath, setRootChangePath] = useState('');
  const [rootChangeMode, setRootChangeMode] = useState<'migrate' | 'switch'>('migrate');
  const [rootChangeScheduled, setRootChangeScheduled] = useState(false);
  const rootTouched = useRef(false);
  const started = useRef(false);

  function acceptWorkspace(next: Workspace) {
    setWorkspace(next); setLoadError('');
    if (!rootTouched.current) setRootDraft(next.defaultRoot);
    return next;
  }
  async function readWorkspace() { return acceptWorkspace(parseWorkspace(await invoke<unknown>('storage_workspace'))); }
  async function refresh() {
    if (!connected || busyRef.current) return;
    busyRef.current = true; setLoading(true); setNotice('');
    try { await readWorkspace(); setError(''); }
    catch (e) { setLoadError(workspaceError(e)); }
    finally { setLoading(false); busyRef.current = false; }
  }
  useEffect(() => {
    if (!started.current) { started.current = true; void refresh(); }
  });

  async function action(name: string, work: () => Promise<void>) {
    if (!connected || busyRef.current) return;
    busyRef.current = true; setBusy(name); setNotice('');
    // Keep an existing error visible while retrying instead of collapsing it.
    try { await work(); setError(''); }
    catch (e) { setNotice(''); setError(workspaceError(e)); setErrorScope(name); }
    finally { setBusy(''); busyRef.current = false; }
  }
  function changeRoot(value: string) { rootTouched.current = true; setRootDraft(value); }
  const pickRoot = () => action('pick-root', async () => {
    const chosen = await invoke<unknown>('pick_data_root');
    if (chosen === null) { setNotice('已取消选择，原输入保持不变。'); return; }
    if (typeof chosen !== 'string' || !chosen) throw new Error('系统未返回有效目录。');
    changeRoot(chosen);
  });
  const selectRoot = () => action('select-root', async () => {
    if (!rootDraft.trim()) throw new Error('请选择或填写专用数据目录的完整路径。');
    const next = parseWorkspace(await invoke<unknown>('select_data_root', { path: rootDraft.trim() }));
    if (!next.root) throw new Error('数据目录未保存，请重新读取后核对。');
    acceptWorkspace(next); setNotice('数据目录已选定，记录将保存在这里。');
  });
  const openRoot = () => action('open-root', async () => {
    await invoke('open_data_root'); setNotice('已请求 Windows 打开当前数据目录。');
  });
  const pickRootChange = () => action('pick-root-change', async () => {
    const chosen = await invoke<unknown>('pick_data_root');
    if (chosen === null) return;
    if (typeof chosen !== 'string' || !chosen) throw new Error('系统未返回有效目录。');
    setRootChangePath(chosen);
  });
  async function scheduleRootChange() {
    let saved = false;
    await action('change-root', async () => {
      if (!rootChangePath.trim()) throw new Error('请选择目标数据目录。');
      await invoke('schedule_data_root_change', { path: rootChangePath.trim(), mode: rootChangeMode });
      setRootChangeScheduled(true); saved = true;
      setNotice('已安排更改，请正常退出并重新打开；旧目录会保留。');
    });
    return saved;
  }
  const cancelRootChange = () => action('change-root', async () => {
    await invoke('cancel_data_root_change'); setRootChangeScheduled(false);
    setNotice('已取消目录更改，继续使用当前目录。');
  });
  return { connected, workspace, loading, busy, loadError, errorScope, error, notice, rootDraft, changeRoot,
    rootChangePath, setRootChangePath, rootChangeMode, setRootChangeMode, rootChangeScheduled, pickRootChange, scheduleRootChange, cancelRootChange,
    refresh, pickRoot, selectRoot, openRoot };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
