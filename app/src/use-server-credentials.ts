import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { localDate, millisecondsToNextDay, workspaceError } from './workspace-contract.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { demoCredentials, demoServers } from './server-credentials-demo.ts';
import { daysUntil, newCredential, newServer, relativeDate } from './server-credentials-contract.ts';
import type { CredentialRecord, ManagerTab, ServerRecord } from './server-credentials-contract.ts';

export interface RenewalRecord { id: string; serverId: string; name: string; previous: string; next: string; date: string }
export interface ManagerSnapshot { revision: number; servers: ServerRecord[]; credentials: CredentialRecord[]; renewals: RenewalRecord[]; readReminders: Record<string, string> }
interface PendingSave { input: { root: string; requestId: string; snapshot: ManagerSnapshot }; complete: () => void; generation: number; session: number }
export type ManagerList = ManagerTab | 'renewals';
export interface ManagerPagination { page: number; pageSize: number }
const initialPagination = (): Record<ManagerList, ManagerPagination> => ({ servers: { page: 1, pageSize: 20 }, credentials: { page: 1, pageSize: 20 }, reminders: { page: 1, pageSize: 20 }, renewals: { page: 1, pageSize: 20 } });
const emptySnapshot = (): ManagerSnapshot => ({ revision: 0, servers: [], credentials: [], renewals: [], readReminders: {} });

export function useServerCredentials(root: string | null, preview?: string) {
  const isPreview = preview !== undefined;
  const scenario = preview ?? '';
  const scope = useRef(root); scope.current = root;
  const generation = useRef(0), locked = useRef(false), session = useRef(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isPreview || preview === 'manager-loading');
  const [loadedRoot, setLoadedRoot] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(preview === 'manager-load-error' ? '本地记录读取失败，请重新读取。' : '');
  const [pending, setPending] = useState(preview === 'manager-save-pending');
  const request = useRef<PendingSave | null>(null);
  const saved = useRef<ManagerSnapshot>(emptySnapshot());
  const [today, setToday] = useState(localDate);
  const [servers, setServers] = useState(() => {
    if (!isPreview || preview === 'empty' || preview === 'manager-credentials-empty') return [];
    const rows = demoServers(localDate());
    if (preview === 'manager-servers-many' || preview === 'manager-reminders-many') return Array.from({ length: 57 }, (_, index) => ({ ...rows[index % rows.length], id: `server-example-${index}`, name: `${rows[index % rows.length].name} · 示例 ${index + 1}`, ...(preview === 'manager-reminders-many' ? { expires: relativeDate(localDate(), index % 34 - 3) } : {}) }));
    if (preview === 'manager-invalid-date') rows[0].expires = '2026-02-30';
    if (preview === 'manager-notice-warning') rows.forEach(row => { if (row.expires < localDate()) row.expires = relativeDate(localDate(), 14); });
    if (preview === 'manager-notice-clear') rows.forEach(row => { row.expires = relativeDate(localDate(), 95); });
    if (preview === 'long') rows[0] = { ...rows[0], name: '个人影视项目高精度材质与长镜头渲染专用服务器 · 第一工作节点', purpose: '用于多个个人项目的素材缓存、临时渲染输出与跨地域文件中转，长说明需要自然换行。' };
    return rows;
  });
  const [credentials, setCredentials] = useState(() => {
    if (!isPreview || preview === 'empty' || preview === 'manager-credentials-empty') return [];
    const rows = demoCredentials();
    if (preview === 'manager-credentials-many') return [...rows, ...Array.from({ length: 53 }, (_, index) => ({ ...rows[index % rows.length], id: `credential-example-${index}`, name: `${rows[index % rows.length].name} · 示例 ${index + 1}` }))];
    if (preview === 'long') rows[0] = { ...rows[0], name: '影视工作室长期使用的云服务控制台与素材管理账号', username: 'long-demonstration-account-name@example.com', notes: '长文本演示。用于核对凭证名称、账号和备注换行，不包含真实登录资料。' };
    return rows;
  });
  const [dismissedReminders, setDismissedReminders] = useState<Record<string, string>>(() => preview === 'manager-reminders-dismissed' ? Object.fromEntries(servers.filter(row => { const days = daysUntil(row.expires, today); return days !== null && days <= 30; }).map(row => [row.id, row.expires])) : {});
  const [tab, setTab] = useState<ManagerTab>(scenario.startsWith('manager-credentials') || preview === 'manager-key-create' || preview === 'manager-delete-credential' ? 'credentials' : scenario.startsWith('manager-reminders') || preview === 'manager-renewals-many' ? 'reminders' : 'servers');
  const [query, updateQuery] = useState('');
  const [filter, updateFilter] = useState('all');
  const [pagination, setPagination] = useState(initialPagination);
  function setPage(list: ManagerList, page: number) { setPagination(all => ({ ...all, [list]: { ...all[list], page } })); }
  function setPageSize(list: ManagerList, pageSize: number) { setPagination(all => ({ ...all, [list]: { page: 1, pageSize } })); }
  function resetSearchPages() { setPagination(all => ({ ...all, servers: { ...all.servers, page: 1 }, credentials: { ...all.credentials, page: 1 } })); }
  function setQuery(value: string) { updateQuery(value); resetSearchPages(); }
  function setFilter(value: string) { updateFilter(value); resetSearchPages(); }
  const [serverDrafts, setServerDrafts] = useState<Record<string, ServerRecord>>((): Record<string, ServerRecord> => preview === 'manager-server-create' || preview === 'manager-validation' || preview === 'manager-save-pending' ? { new: { ...newServer(), name: '新的演示服务器', expires: preview === 'manager-validation' ? '2026-02-30' : '' } } : {});
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, CredentialRecord>>((): Record<string, CredentialRecord> => preview === 'manager-key-create' ? { new: { ...newCredential(), kind: 'ssh' } } : {});
  const [renewalDrafts, setRenewalDrafts] = useState<Record<string, string>>({});
  const [dialog, updateDialog] = useState<{ kind: 'server' | 'credential' | 'renew' | 'delete-server' | 'delete-credential'; id: string } | null>(() => preview === 'manager-server-create' || preview === 'manager-validation' || preview === 'manager-save-pending' ? { kind: 'server', id: 'new' } : preview === 'manager-key-create' ? { kind: 'credential', id: 'new' } : preview === 'manager-renew' ? { kind: 'renew', id: 'render-node' } : preview === 'manager-delete-server' ? { kind: 'delete-server', id: 'render-node' } : preview === 'manager-delete-credential' ? { kind: 'delete-credential', id: 'render-key' } : null);
  function setDialog(value: typeof dialog) { ++session.current; setError(''); updateDialog(value); }
  const [error, setError] = useState(preview === 'manager-validation' ? '请填写有效日期，格式为 YYYY-MM-DD。' : '');
  const [renewals, setRenewals] = useState<RenewalRecord[]>(() => preview === 'manager-renewals-many' ? Array.from({ length: 57 }, (_, index) => ({ id: `renewal-example-${index}`, serverId: index % 2 ? 'render-node' : 'removed-server', name: `渲染节点 · 续费示例 ${index + 1}`, previous: relativeDate(localDate(), -30), next: relativeDate(localDate(), 335), date: localDate() })) : []);
  function apply(snapshot: ManagerSnapshot) {
    saved.current = snapshot;
    setServers(snapshot.servers); setCredentials(snapshot.credentials);
    setRenewals(snapshot.renewals); setDismissedReminders(snapshot.readReminders);
  }
  async function refresh() {
    if (isPreview) { setLoadError(''); setLoading(false); return; }
    if (!root || locked.current || request.current) return;
    const epoch = generation.current;
    locked.current = true; setLoading(true);
    try {
      if (!isTauri()) throw Error('请在桌面应用中打开服务器和凭证。');
      const snapshot = await invoke<ManagerSnapshot>('server_credentials_load', { root });
      if (scope.current !== root || epoch !== generation.current) return;
      apply(snapshot); setLoadedRoot(root); setLoadError('');
    } catch (e) { if (scope.current === root && epoch === generation.current) setLoadError(workspaceError(e)); }
    finally { if (epoch === generation.current) { locked.current = false; setLoading(false); } }
  }
  useEffect(() => {
    ++generation.current; ++session.current;
    if (isPreview) return;
    locked.current = false; request.current = null; setBusy(false); setPending(false);
    setLoadedRoot(null); setLoadError(''); setError(''); apply(emptySnapshot());
    setServerDrafts({}); setCredentialDrafts({}); setRenewalDrafts({}); setPagination(initialPagination()); updateDialog(null);
    void refresh();
    return () => { ++generation.current; };
    // Scope changes invalidate all late IPC replies; switching pages keeps this controller mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, isPreview]);
  function reportSaveError(message: string, expected: number) {
    if (session.current === expected) setError(message);
    else notifyOperation(message, { tone: 'error' });
  }
  function finishSave(job: PendingSave, snapshot: ManagerSnapshot) {
    apply(snapshot); request.current = null; setPending(false); setLoadError('');
    job.complete();
  }
  async function reconcile() {
    if (isPreview) { setPending(false); return; }
    const job = request.current;
    if (!job || locked.current || job.input.root !== root) return;
    locked.current = true; setBusy(true);
    try {
      const snapshot = await invoke<ManagerSnapshot | null>('server_credentials_receipt', { root, requestId: job.input.requestId });
      if (scope.current !== root || job.generation !== generation.current) return;
      if (snapshot) finishSave(job, snapshot);
      else { request.current = null; setPending(false); reportSaveError('上次保存未写入，草稿保留，可以再次保存。', job.session); }
    } catch { if (job.generation === generation.current) reportSaveError('仍无法核对保存结果，草稿保留，请稍后再核对。', job.session); }
    finally { if (job.generation === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function persist(change: Partial<Omit<ManagerSnapshot, 'revision'>>, complete: () => void) {
    if (locked.current || request.current) return;
    if (isPreview) {
      apply({ revision: saved.current.revision + 1, servers, credentials, renewals, readReminders: dismissedReminders, ...change });
      complete(); return;
    }
    if (!root || loadedRoot !== root || loadError || loading) { setError('请先重新读取服务器和凭证，再保存。'); return; }
    const job: PendingSave = { input: { root, requestId: crypto.randomUUID(), snapshot: { ...saved.current, ...change } }, complete, generation: generation.current, session: session.current };
    request.current = job; locked.current = true; setBusy(true); setError('');
    try {
      const snapshot = await invoke<ManagerSnapshot>('server_credentials_save', { input: job.input });
      if (scope.current === root && job.generation === generation.current) finishSave(job, snapshot);
    } catch (e) {
      if (scope.current !== root || job.generation !== generation.current) return;
      // A failed IPC response may follow a committed transaction. Check before enabling another save.
      try {
        const snapshot = await invoke<ManagerSnapshot | null>('server_credentials_receipt', { root, requestId: job.input.requestId });
        if (scope.current !== root || job.generation !== generation.current) return;
        if (snapshot) finishSave(job, snapshot);
        else {
          request.current = null;
          const message = workspaceError(e); reportSaveError(message, job.session);
          if (e && typeof e === 'object' && 'code' in e && e.code === 'manager_conflict') setLoadError(message);
        }
      } catch { if (job.generation === generation.current) { setPending(true); reportSaveError('保存结果尚未确认，草稿保留。请先核对保存结果。', job.session); } }
    } finally { if (job.generation === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function importFile(draftId: string, key: 'publicFile' | 'privateFile', file: File) {
    const before = credentialDrafts[draftId];
    if (!before || locked.current || request.current) return;
    const idKey = key === 'publicFile' ? 'publicFileId' : 'privateFileId';
    const epoch = generation.current, expected = session.current;
    if (isPreview) { setCredentialDrafts(all => ({ ...all, [draftId]: { ...all[draftId], [key]: file.name, [idKey]: '' } })); return; }
    if (!root || loadedRoot !== root || loadError) { setError('请先读取本地记录后再选择文件。'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      if (!file.size || file.size > 1024 * 1024) throw Error('每份密钥文件大小需在 1 字节至 1 MB 之间。');
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      if (scope.current !== root || epoch !== generation.current) return;
      const stored = await invoke<{ id: string; name: string }>('server_credentials_add_file', { input: { root, id: crypto.randomUUID(), name: file.name, bytes } });
      if (scope.current !== root || epoch !== generation.current) return;
      setCredentialDrafts(all => all[draftId] === before ? { ...all, [draftId]: { ...before, [key]: stored.name, [idKey]: stored.id } } : all);
    } catch (e) { if (epoch === generation.current) reportSaveError(workspaceError(e), expected); }
    finally { if (epoch === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function openFolder(id: string) {
    if (isPreview || !root || !id) return;
    const epoch = generation.current;
    try { await invoke('server_credentials_open_folder', { root, id }); }
    catch (e) { if (epoch === generation.current) notifyOperation(workspaceError(e), { tone: 'error' }); }
  }
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => { setToday(localDate()); clearTimeout(timer); timer = setTimeout(update, millisecondsToNextDay(new Date())); };
    update(); window.addEventListener('focus', update);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); };
  }, []);
  function editServer(row?: ServerRecord) {
    const id = row?.id ?? 'new';
    setServerDrafts(all => ({ ...all, [id]: all[id] ?? { ...(row ?? newServer()) } }));
    setError(''); setDialog({ kind: 'server', id });
  }
  function editCredential(row?: CredentialRecord) {
    const id = row?.id ?? 'new';
    setCredentialDrafts(all => ({ ...all, [id]: all[id] ?? { ...(row ?? newCredential()) } }));
    setError(''); setDialog({ kind: 'credential', id });
  }
  function renew(row: ServerRecord) { setError(''); setDialog({ kind: 'renew', id: row.id }); }
  async function removeRecord(kind: 'delete-server' | 'delete-credential', id: string, complete: () => void) {
    if (kind === 'delete-server') {
      if (!servers.some(row => row.id === id)) { setError('服务器记录已不存在，请返回列表。'); return; }
      const readReminders = { ...dismissedReminders }; delete readReminders[id];
      await persist({ servers: servers.filter(row => row.id !== id), readReminders }, () => {
        setServerDrafts(all => { const next = { ...all }; delete next[id]; return next; });
        setRenewalDrafts(all => { const next = { ...all }; delete next[id]; return next; });
        complete();
      });
    } else {
      if (!credentials.some(row => row.id === id)) { setError('凭证记录已不存在，请返回列表。'); return; }
      await persist({ credentials: credentials.filter(row => row.id !== id), servers: servers.map(row => row.credentialId === id ? { ...row, credentialId: '' } : row) }, () => {
        setCredentialDrafts(all => { const next = { ...all }; delete next[id]; return next; });
        // Retained editor drafts must not restore the removed credential association on a later save.
        setServerDrafts(all => Object.fromEntries(Object.entries(all).map(([key, row]) => [key, row.credentialId === id ? { ...row, credentialId: '' } : row])));
        complete();
      });
    }
  }
  const serverIndex = useMemo(() => {
    const byId = new Map<string, ServerRecord>();
    const byCredential = new Map<string, ServerRecord[]>();
    for (const row of servers) {
      byId.set(row.id, row);
      if (row.credentialId) {
        const linked = byCredential.get(row.credentialId);
        if (linked) linked.push(row); else byCredential.set(row.credentialId, [row]);
      }
    }
    return { byId, byCredential };
  }, [servers]);
  const dueServers = useMemo(() => servers.filter(row => { const days = daysUntil(row.expires, today); return days !== null && days <= 30; }).sort((a, b) => a.expires.localeCompare(b.expires)), [servers, today]);
  const overdue = dueServers.filter(row => row.expires < today).length;
  const reminders = dueServers;
  const unreadReminders = reminders.filter(row => dismissedReminders[row.id] !== row.expires);
  const unreadReminderCount = isPreview || loadedRoot === root ? unreadReminders.length : 0;
  const reminderOverdue = unreadReminders.filter(row => row.expires < today).length;
  const reminderTone = reminderOverdue > 0 ? 'error' as const : 'warning' as const;
  const reminderLabel = `${unreadReminderCount} 条未读续费提醒${reminderOverdue > 0 ? `，其中 ${reminderOverdue} 台已过期` : ''}`;
  async function clearReminders() {
    // Acknowledge the navigation dot only; keep all due records visible in the reminder list.
    const cleared = Object.fromEntries(unreadReminders.map(row => [row.id, row.expires]));
    await persist({ readReminders: { ...dismissedReminders, ...cleared } }, () => notifyOperation('提醒点已清除，到期提醒仍保留。'));
  }
  return { isPreview, busy, loading, loaded: isPreview ? !loading && (preview !== 'manager-load-error' || !loadError) : !!root && loadedRoot === root, loadError, pending, refresh, reconcile, persist, importFile, openFolder, removeRecord, session, today, servers, credentials, tab, setTab, query, setQuery, filter, setFilter, serverDrafts, setServerDrafts, credentialDrafts, setCredentialDrafts, renewalDrafts, setRenewalDrafts, dialog, setDialog, error, setError, renewals, editServer, editCredential, renew, reminders, overdue, reminderTone, reminderLabel, dueServers, clearReminders, unreadReminderCount, pagination, setPage, setPageSize, serverIndex };
}
export type ServerCredentialsModel = ReturnType<typeof useServerCredentials>;
