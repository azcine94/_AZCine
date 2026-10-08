import { notifyOperation, useOperationNotice } from './components/ui/operation-toast.tsx';
import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { workspaceError, localDate, validDate } from './workspace-contract.ts';
import { checkMutationReceipt, draftContent, draftFingerprint, draftProblem, emptyExpense, expenseDraft, parseExpenses, parseReceipt, parseExchangeRate } from './bookkeeping-contract.ts';
import type { Expense, ExpenseConfirmation, ExpenseDraft, ExpenseMutation, Receipt } from './bookkeeping-contract.ts';

export interface PendingExpense { input: ExpenseMutation; key?: string; fingerprint?: string; continueAdding?: boolean }
export interface BookkeepingController {
  expenses: Expense[]; drafts: Record<string, ExpenseDraft>; loading: boolean; loaded: boolean; busy: string;
  formErrors: Record<string, string>; error: string; loadError: string; notice: string; pending: PendingExpense | null; undo: Expense | null;
  month: string; filter: string; query: string; selected: string[]; confirmation: ExpenseConfirmation | null;
  rates: Record<string, { loading: boolean; error: string }>; fetchRate(key: string): Promise<void>;
  setMonth(value: string): void; setFilter(value: string): void; setQuery(value: string): void; select(ids: string[]): void;
  refresh(): Promise<void>; begin(key: string): void; change(key: string, patch: Partial<ExpenseDraft>): void;
  addFiles(key: string, files: File[]): void; removeReceipt(key: string, id: string): void;
  save(key: string, continueAdding?: boolean, onSaved?: () => void): Promise<boolean>; rebase(key: string): void;
  confirm(value: ExpenseConfirmation | null): void; applyConfirmation(): Promise<void>; reconcile(): Promise<void>;
  exportRows(rows: Expense[]): Promise<void>; openReceipt(expenseId: string, receipt: Receipt): Promise<void>; restore(): Promise<void>;
}
export function useBookkeeping(root: string | null): BookkeepingController {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const rowsRef = useRef(expenses);
  const [drafts, setDrafts] = useState<Record<string, ExpenseDraft>>(() => ({ new: emptyExpense() }));
  const draftRef = useRef(drafts);
  const [loading, setLoading] = useState(false), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [notice, setNotice] = useOperationNotice('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingExpense | null>(null);
  const pendingRef = useRef<PendingExpense | null>(null);
  const [undo, setUndo] = useState<Expense | null>(null);
  const [month, updateMonth] = useState(() => localDate().slice(0, 7));
  const [filter, updateFilter] = useState(''), [query, updateQuery] = useState('');
  const [selected, select] = useState<string[]>([]);
  const [confirmation, confirm] = useState<ExpenseConfirmation | null>(null);
  const [rates, setRates] = useState<BookkeepingController['rates']>({});
  const rateEpoch = useRef<Record<string, number>>({});
  const activeRates = useRef<Record<string, number>>({});
  const generation = useRef(0), locked = useRef(false);
  function put(key: string, draft: ExpenseDraft) { draftRef.current = { ...draftRef.current, [key]: draft }; setDrafts(draftRef.current); }
  function replace(rows: Expense[]) { rowsRef.current = rows; setExpenses(rows); }
  function retain(value: PendingExpense | null) { pendingRef.current = value; setPending(value); }
  function begin(key: string) {
    if (draftRef.current[key]) return;
    const row = rowsRef.current.find(row => row.id === key && !row.deleted);
    if (row) put(key, expenseDraft(row));
  }
  function change(key: string, patch: Partial<ExpenseDraft>) {
    const draft = draftRef.current[key]; if (!draft) return;
    const invalidate = (patch.currency !== undefined && patch.currency !== draft.currency) || (patch.date !== undefined && patch.date !== draft.date);
    if (invalidate) {
      rateEpoch.current[key] = (rateEpoch.current[key] ?? 0) + 1; delete activeRates.current[key];
      setRates(before => ({ ...before, [key]: { loading: false, error: '' } }));
    }
    put(key, { ...draft, ...patch, ...(invalidate ? { rate: null } : {}) });
    setFormErrors(before => ({ ...before, [key]: '' }));
  }
  async function fetchRate(key: string) {
    const draft = draftRef.current[key];
    if (!root || !isTauri() || !draft || draft.currency === 'CNY' || draft.status === 'submitted' || draft.status === 'paid' || pendingRef.current || locked.current) return;
    if (!validDate(draft.date) || draft.date > localDate()) { setRates(before => ({ ...before, [key]: { loading: false, error: '请选择非未来的有效开销日期，再获取汇率。' } })); return; }
    if (activeRates.current[key] !== undefined) return;
    const epoch = (rateEpoch.current[key] ?? 0) + 1; rateEpoch.current[key] = epoch; activeRates.current[key] = epoch;
    const token = generation.current;
    const current = () => token === generation.current && rateEpoch.current[key] === epoch && draftRef.current[key]?.id === draft.id;
    setRates(before => ({ ...before, [key]: { loading: true, error: '' } }));
    try {
      const rate = parseExchangeRate(await invoke('bookkeeping_exchange_rate', { currency: draft.currency, date: draft.date }));
      if (!current()) return;
      if (rate.currency !== draft.currency || rate.requestedDate !== draft.date) throw Error('汇率回执与所选币种或日期不符，未采用。');
      // Preserve the latest typed amount and all other draft fields.
      put(key, { ...draftRef.current[key], rate });
      setRates(before => ({ ...before, [key]: { loading: false, error: '' } }));
    } catch (e) { if (current()) setRates(before => ({ ...before, [key]: { loading: false, error: workspaceError(e) } })); }
    finally { if (activeRates.current[key] === epoch) delete activeRates.current[key]; }
  }
  async function refresh() {
    if (!root || !isTauri() || locked.current) return;
    const token = generation.current;
    locked.current = true; setLoading(true);
    try { const rows = parseExpenses(await invoke('bookkeeping_list')); if (token === generation.current) { replace(rows); setLoaded(true); setLoadError(''); } }
    catch (e) { if (token === generation.current) setLoadError(workspaceError(e)); }
    finally { if (token === generation.current) { locked.current = false; setLoading(false); } }
  }
  useEffect(() => {
    generation.current++; locked.current = false; replace([]); setLoaded(false); setLoading(false); setBusy('');
    setRates({}); activeRates.current = {}; rateEpoch.current = {};
    setFormErrors({}); setError(''); setLoadError(''); setNotice(''); retain(null); setUndo(null); select([]); confirm(null);
    draftRef.current = { new: emptyExpense() }; setDrafts(draftRef.current);
    void refresh();
    return () => { generation.current++; };
  }, [root]);
  async function action(name: string, work: (isCurrent: () => boolean) => Promise<boolean>, formKey?: string): Promise<boolean> {
    if (!root || !isTauri() || locked.current) return false;
    const token = generation.current;
    const current = () => token === generation.current;
    locked.current = true; setBusy(name); setError('');
    if (formKey) setFormErrors(before => ({ ...before, [formKey]: '' }));
    if (name !== 'save') setNotice('');
    try { return await work(current); }
    catch (e) { if (current()) { if (formKey) setFormErrors(before => ({ ...before, [formKey]: workspaceError(e) })); else setError(workspaceError(e)); setNotice(''); } return false; }
    finally { if (current()) { locked.current = false; setBusy(''); } }
  }
  function finalize(operation: PendingExpense, result: Expense[], latest: Expense[]): boolean {
    const before = new Map(rowsRef.current.map(row => [row.id, row]));
    replace(latest); setLoaded(true); setLoadError('');
    const input = operation.input;
    if (input.kind === 'save') {
      if (!operation.key) throw Error('保存草稿关联丢失，请保留输入并核对原操作。');
      const saved = result[0], formal = latest.find(row => row.id === saved.id);
      const draft = draftRef.current[operation.key];
      const currentFormal = formal && formal.revision === saved.revision && !formal.deleted;
      const unchanged = draft && draftFingerprint(draft) === operation.fingerprint;
      if (draft) {
        if (unchanged && currentFormal) put(operation.key, operation.key === 'new' ? { ...emptyExpense(saved.date), status: saved.status === 'unclaimed' ? 'unclaimed' : 'pending' } : expenseDraft(saved));
        else {
          const importedIds = new Set(input.content.receiptIds);
          const remaining = draft.files.filter(file => !importedIds.has(file.id));
          // Confirm only the submitted version. Typing and newly attached files survive.
          const kept = new Map(draft.receipts.map(r => [r.id, r]));
          for (const receipt of saved.receipts) if (draft.files.some(f => f.id === receipt.id)) kept.set(receipt.id, receipt);
          put(operation.key, { ...draft, expectedRevision: saved.revision, receipts: [...kept.values()], files: remaining });
        }
      }
      setNotice(currentFormal ? '开销已保存。' : '原保存已确认；记录之后有变化，草稿保留，请核对当前记录。');
      return !!unchanged && !!currentFormal && !operation.continueAdding;
    }
    if (input.kind === 'delete') setUndo(input.deleted ? result[0] : null);
    for (const row of result) {
      const formal = latest.find(item => item.id === row.id);
      const original = before.get(row.id);
      for (const [key, draft] of Object.entries(draftRef.current)) {
        if (draft.id !== row.id || formal?.revision !== row.revision || draft.expectedRevision !== row.revision - 1) continue;
        // Advance our own revision, preserving all typed fields and any status
        // edit made after the original record was loaded.
        const status = input.kind === 'status' && draft.status === original?.status ? row.status : draft.status;
        put(key, { ...draft, expectedRevision: row.revision, status });
      }
    }
    select([]); confirm(null);
    setNotice(input.kind === 'status' ? '报销状态已更新。' : input.deleted ? '开销已移除，可以撤销。' : '开销已恢复。');
    if (input.kind === 'delete' && input.deleted && latest.some(row => row.id === result[0].id && row.deleted && row.revision === result[0].revision)) notifyOperation('开销已移除', { tone: 'success', action: { label: '撤销', run: () => restoreExpense(result[0]) } });
    return false;
  }
  async function commit(operation: PendingExpense, current: () => boolean, onSaved?: () => void): Promise<boolean> {
    retain(operation);
    const result = parseExpenses(await invoke('bookkeeping_mutate', { input: operation.input }));
    checkMutationReceipt(operation.input, result);
    if (!current()) return false;
    const latest = parseExpenses(await invoke('bookkeeping_list'));
    if (!current()) return false;
    const close = finalize(operation, result, latest); retain(null);
    // Close in the same update as accepting the receipt, before yielding back
    // through the save promise. The resetting form must not paint first.
    if (close) onSaved?.();
    return close;
  }
  function addFiles(key: string, files: File[]) {
    const draft = draftRef.current[key]; if (!draft) return;
    if (draft.receipts.length + draft.files.length + files.length > 5) { setFormErrors(before => ({ ...before, [key]: '每笔最多 5 份票据。' })); return; }
    if (files.some(file => file.size < 1 || file.size > 5 * 1024 * 1024 || !/\.(png|jpe?g|webp|pdf)$/i.test(file.name))) { setFormErrors(before => ({ ...before, [key]: '票据支持 PNG、JPEG、WebP、PDF，每份不超过 5 MB。' })); return; }
    change(key, { files: [...draft.files, ...files.map(file => ({ id: crypto.randomUUID(), file }))] }); setFormErrors(before => ({ ...before, [key]: '' }));
  }
  function removeReceipt(key: string, id: string) {
    const draft = draftRef.current[key]; if (draft) change(key, { files: draft.files.filter(file => file.id !== id), receipts: draft.receipts.filter(receipt => receipt.id !== id) });
  }
  const save = (key: string, continueAdding = false, onSaved?: () => void) => action('save', async current => {
    if (pendingRef.current) throw Error('原操作结果尚未确认，请先核对，避免重复记账。');
    if (activeRates.current[key] !== undefined) throw Error('汇率正在读取，请等待换算完成后保存。');
    const draft = draftRef.current[key]; if (!draft) return false;
    const problem = draftProblem(draft); if (problem) throw Error(problem);
    const fingerprint = draftFingerprint(draft);
    const receipts = [...draft.receipts];
    for (const attachment of draft.files) {
      const bytes = Array.from(new Uint8Array(await attachment.file.arrayBuffer()));
      if (!current()) return false;
      const media = /\.pdf$/i.test(attachment.file.name) ? 'application/pdf' : /\.png$/i.test(attachment.file.name) ? 'image/png' : /\.webp$/i.test(attachment.file.name) ? 'image/webp' : 'image/jpeg';
      const receipt = parseReceipt(await invoke('bookkeeping_add_receipt', { input: { id: attachment.id, expenseId: draft.id, name: attachment.file.name, mediaType: media, bytes } }));
      if (receipt.id !== attachment.id || receipt.name !== attachment.file.name || receipt.size !== attachment.file.size) throw Error('票据保存回执不一致，原件与草稿保留。');
      receipts.push(receipt);
    }
    if (!current()) return false;
    const input: ExpenseMutation = { kind: 'save', requestId: crypto.randomUUID(), expectedRevision: draft.expectedRevision, content: draftContent(draft, receipts) };
    return commit({ input, key, fingerprint, continueAdding }, current, onSaved);
  }, key);
  async function reconcile() {
    await action('reconcile', async current => {
      const operation = pendingRef.current; if (!operation) return false;
      const raw = await invoke('bookkeeping_request', { requestId: operation.input.requestId });
      const result = raw === null ? null : parseExpenses(raw);
      if (result) checkMutationReceipt(operation.input, result);
      const latest = parseExpenses(await invoke('bookkeeping_list')); if (!current()) return false;
      if (result) finalize(operation, result, latest);
      else { replace(latest); setLoaded(true); setLoadError(''); setNotice('已确认原操作未保存，输入与选择保留；请核对后重新操作。'); }
      retain(null); return false;
    });
  }
  async function applyConfirmation() {
    const chosen = confirmation; if (!chosen) return;
    await action('status', async current => {
      if (pendingRef.current) throw Error('请先核对原操作结果。');
      const input: ExpenseMutation = chosen.kind === 'status' ? { ...chosen, requestId: crypto.randomUUID() } : { kind: 'delete', requestId: crypto.randomUUID(), target: chosen.target, deleted: chosen.deleted };
      return commit({ input }, current);
    });
  }
  async function restoreExpense(row: Expense) {
    const target = { id: row.id, revision: row.revision };
    await action('restore', async current => {
      if (pendingRef.current) throw Error('请先核对原操作结果。');
      return commit({ input: { kind: 'delete', requestId: crypto.randomUUID(), target, deleted: false } }, current);
    });
  }
  async function restore() { if (undo) await restoreExpense(undo); }
  function rebase(key: string) {
    if (pendingRef.current) { setError('请先核对原操作结果。'); return; }
    const draft = draftRef.current[key], formal = rowsRef.current.find(row => row.id === draft?.id && !row.deleted);
    if (!draft || !formal) return;
    put(key, { ...draft, expectedRevision: formal.revision }); setError(''); setNotice('已采用当前版本作为基线，草稿保留，尚未保存。');
  }
  async function exportRows(rows: Expense[]) {
    await action('export', async current => {
      if (!rows.length) throw Error('没有可导出的开销。');
      const result: unknown = await invoke('bookkeeping_export', { targets: rows.map(row => ({ id: row.id, revision: row.revision })) });
      if (result !== null && typeof result !== 'string') throw Error('导出回执无效，请核对目标文件。');
      if (current()) setNotice(result === null ? '已取消导出，开销记录保留。' : '明细已导出为 CSV，可使用 Excel 打开；报销状态保持原值。');
      return false;
    });
  }
  async function openReceipt(expenseId: string, receipt: Receipt) {
    await action('receipt', async current => { await invoke('bookkeeping_open_receipt', { expenseId, id: receipt.id }); if (current()) setNotice('已请求系统打开票据。'); return false; });
  }
  return { formErrors, expenses, drafts, loading, loaded, busy, error, loadError, notice, pending, undo, month, filter, query, selected, confirmation, rates, fetchRate,
    setMonth: value => { updateMonth(value); select([]); }, setFilter: value => { updateFilter(value); select([]); }, setQuery: value => { updateQuery(value); select([]); },
    select, refresh, begin, change, addFiles, removeReceipt, save, rebase, confirm, applyConfirmation, reconcile, exportRows, openReceipt, restore };
}
