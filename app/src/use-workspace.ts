import { notifyOperation, useOperationNotice } from './components/ui/operation-toast.tsx';
import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { localDate, millisecondsToNextDay, parseTodo, parseWorkspace, sameInput, validateTodo, workspaceError } from './workspace-contract.ts';
import type { Todo, TodoFilter, TodoInput, Workspace } from './workspace-contract.ts';

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
  const rootTouched = useRef(false);
  const [draft, setDraft] = useState({ title: '', dueDate: '', projectId: '' });
  const draftRef = useRef(draft);
  const [pendingCreate, setPendingCreate] = useState<TodoInput | null>(null);
  const requestRef = useRef<TodoInput | null>(null);
  const [filter, setFilter] = useState<TodoFilter>('incomplete');
  const [today, setToday] = useState(localDate);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = new Date(); setToday(localDate(now));
      clearTimeout(timer); timer = setTimeout(update, millisecondsToNextDay(now));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') update(); };
    update(); window.addEventListener('focus', update); document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  const [undo, setUndo] = useState<{ todo: Todo; completed: boolean } | null>(null);
  const started = useRef(false);

  function acceptWorkspace(next: Workspace) {
    setWorkspace(next); setLoadError('');
    // A failed operation on another row must not consume a still-valid undo.
    // Re-reading can invalidate it only when its saved identity/state changed.
    setUndo(current => {
      if (!current) return null;
      const row = next.todos.find(todo => todo.id === current.todo.id);
      if (!row || row.revision !== current.todo.revision || row.completed !== current.todo.completed
        || !sameInput(row, current.todo) || row.createdAt !== current.todo.createdAt) return null;
      return { ...current, todo: row };
    });
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
  function changeDraft(field: 'title' | 'dueDate' | 'projectId', value: string) {
    if (busyRef.current || requestRef.current) return;
    draftRef.current = { ...draftRef.current, [field]: value }; setDraft(draftRef.current);
  }
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
  function acceptTodo(todo: Todo) {
    setWorkspace(previous => previous && ({ ...previous, todos: [...previous.todos.filter(t => t.id !== todo.id), todo] }));
  }
  function clearRequest() {
    requestRef.current = null; setPendingCreate(null);
    draftRef.current = { title: '', dueDate: '', projectId: '' }; setDraft(draftRef.current);
  }
  const saveTodo = () => action('save-todo', async () => {
    const problem = validateTodo(draftRef.current.title, draftRef.current.dueDate);
    if (problem) throw new Error(problem);
    const input = requestRef.current ?? { id: crypto.randomUUID(), title: draftRef.current.title.trim(), dueDate: draftRef.current.dueDate || null, projectId: draftRef.current.projectId || null };
    requestRef.current = input;
    try {
      const saved = parseTodo(await invoke<unknown>('create_todo', { input }));
      if (!sameInput(saved, input)) throw new Error('保存响应不对应本次输入，请重新读取并核对。');
      acceptTodo(saved); clearRequest(); setNotice('待办已保存。');
    } catch (e) {
      // Only uncertain results show reconciliation UI; the in-flight request is
      // already guarded by busyRef and retains its ID across route changes.
      setPendingCreate(input); throw e;
    }
  });
  // An uncertain save keeps the immutable request. Reconcile against Rust before allowing edits/new IDs.
  const reconcileCreate = () => action('reconcile', async () => {
    const input = requestRef.current;
    if (!input) return;
    const next = await readWorkspace();
    const saved = next.todos.find(t => t.id === input.id);
    if (saved) {
      if (!sameInput(saved, input)) throw new Error('相同编号已有不同记录，请保留输入并核对，不会覆盖。');
      clearRequest(); setNotice('已确认这条待办保存成功，没有重复创建。');
    } else { requestRef.current = null; setPendingCreate(null); setNotice('已确认未保存，可以修改输入后重试。'); }
  });
  const changeCompletion = (todo: Todo, completed: boolean, consumingUndo = false) => action(`todo:${todo.id}`, async () => {
    try {
      const saved = parseTodo(await invoke<unknown>('complete_todo', { id: todo.id, revision: todo.revision, completed }));
      if (!sameInput(saved, todo) || saved.createdAt !== todo.createdAt || saved.completed !== completed || saved.revision !== todo.revision + 1) throw new Error('待办操作响应不匹配，请重新读取核对。');
      acceptTodo(saved); setUndo(consumingUndo ? null : { todo: saved, completed: todo.completed });
      setNotice(consumingUndo ? '已撤销最近一次状态修改。' : completed ? '已完成待办，可撤销。' : '已恢复为未完成。');
      if (!consumingUndo) notifyOperation(completed ? '待办已完成' : '待办已恢复为未完成', { tone: 'success', action: { label: '撤销', run: () => changeCompletion(saved, todo.completed, true) } });
    } catch (e) {
      try { await readWorkspace(); } catch (readError) { setLoadError(workspaceError(readError)); }
      throw e;
    }
  });
  return { connected, workspace, loading, busy, loadError, errorScope, error, notice, rootDraft, changeRoot, draft, changeDraft,
    pendingCreate, filter, setFilter, today, undo, refresh, pickRoot, selectRoot, openRoot, saveTodo, reconcileCreate, changeCompletion };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
