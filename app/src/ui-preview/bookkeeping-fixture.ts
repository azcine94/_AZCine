import { useOperationNotice } from '../components/ui/operation-toast.tsx';
import { useState } from 'react';
import { checkMutationReceipt, draftContent, draftProblem, emptyExpense, expenseDraft } from '../bookkeeping-contract.ts';
import type { Expense, ExpenseConfirmation, ExpenseDraft, ExpenseMutation, Receipt, ExchangeRate } from '../bookkeeping-contract.ts';
import type { BookkeepingController, PendingExpense } from '../use-bookkeeping.ts';

export const bookkeepingExampleId = '00000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function samples(): Expense[] {
  return [
    { purpose: '出差打车', amountFen: 5800, status: 'pending' as const },
    { purpose: '购买素材', amountFen: 12800, status: 'submitted' as const },
    { purpose: '午餐', amountFen: 3600, status: 'unclaimed' as const },
    { purpose: '工作配件', amountFen: 29800, status: 'pending' as const },
    { purpose: '打印资料', amountFen: 16000, status: 'paid' as const },
  ].map((row, i) => ({ ...row, id: id(i + 1), date: `2026-10-0${6 - i}`, note: '', receipts: row.status === 'unclaimed' ? [] : [{ id: id(20 + i), name: '示例票据.pdf', mediaType: 'application/pdf', size: 1024 }], revision: 1, deleted: false, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', exchange: null }));
}
// Explicitly in-memory: these actions never invoke file, database, model or desktop APIs.
export function usePreviewBookkeeping(state: string): BookkeepingController {
  const initial = samples();
  const fxState = state.startsWith('bookkeeping-fx');
  if (fxState) { initial[0].amountFen = 49700; initial[0].exchange = { originalMinor: 7000, quote: { currency: 'USD', rate: '7.1', requestedDate: initial[0].date, rateDate: '2026-10-05', source: 'frankfurter-ecb' } }; }
  const conflict = state === 'conflict' || state === 'conflict-details';
  if (state === 'long') { initial[0].purpose = '用于查看非常长的开销用途与文字换行。'.repeat(8); initial[0].note = '这是一段很长的备注，仅用于界面总览。'.repeat(30); }
  if (conflict) { initial[0].revision = 2; initial[0].purpose = '当前记录：打车用途已修改'; }
  if (state === 'undo') initial[0].deleted = true;
  const [formErrors, setFormErrors] = useState<Record<string,string>>(state === 'bookkeeping-validation' ? {new: '请填写用途，最多 200 字。'} : {});
  const [expenses, setExpenses] = useState(state === 'empty' ? [] : initial);
  const initialDraft = expenseDraft(initial[0]);
  if (fxState && state !== 'bookkeeping-fx') initialDraft.rate = null;
  if (conflict) { initialDraft.expectedRevision = 1; initialDraft.purpose = '保留的编辑草稿'; }
  const newDraft = { ...emptyExpense('2026-10-06'), id: id(80) };
  if (fxState) { newDraft.currency = 'USD'; newDraft.amount = '70.00'; newDraft.purpose = '外币购买素材（虚构汇率示例）'; if (state === 'bookkeeping-fx') newDraft.rate = { currency: 'USD', rate: '7.1', requestedDate: newDraft.date, rateDate: '2026-10-05', source: 'frankfurter-ecb' }; }
  if (['dirty', 'pending', 'bookkeeping-saving'].includes(state)) { newDraft.purpose = '未保存的打车记录（示例）'; newDraft.amount = '58.00'; newDraft.status = 'pending'; }
  const [drafts, setDrafts] = useState<Record<string, ExpenseDraft>>({ new: newDraft, [initial[0].id]: initialDraft });
  const [selected, select] = useState(['bookkeeping-selected', 'bookkeeping-confirm'].includes(state) ? [initial[0].id, initial[3].id] : []);
  const [confirmation, confirm] = useState<ExpenseConfirmation | null>(state === 'bookkeeping-confirm' ? { kind: 'status', status: 'submitted', targets: [initial[0], initial[3]].map(row => ({ id: row.id, revision: row.revision })) } : state === 'bookkeeping-delete' ? { kind: 'delete', target: { id: initial[0].id, revision: initial[0].revision }, purpose: initial[0].purpose, deleted: true } : null);
  const [month, setMonthState] = useState('2026-10'), [filter, setFilterState] = useState(''), [query, setQueryState] = useState(state === 'filtered' ? '没有符合的示例' : '');
  const [notice, setNotice] = useOperationNotice(state === 'bookkeeping-save-feedback' ? '开销已保存。（虚构示例）' : ''), [error, setError] = useState('');
  const [busy, setBusy] = useState(state === 'bookkeeping-saving' ? 'save' : '');
  const [undo, setUndo] = useState<Expense | null>(state === 'undo' ? initial[0] : null);
  const [pending, setPending] = useState<PendingExpense | null>(state === 'pending' ? { key: 'new', input: { kind: 'save', requestId: id(90), expectedRevision: null, content: draftContent(newDraft) } } : null);
  const [loading, setLoading] = useState(state === 'loading' || state === 'bookkeeping-refresh'), [loaded, setLoaded] = useState(state !== 'loading');
  const [loadError, setLoadError] = useState(state === 'error' ? '示例：读取失败，已有记录和输入保留。' : '');
  const [rates, setRates] = useState<BookkeepingController['rates']>(Object.fromEntries(['new', initial[0].id].map(key => [key, { loading: state === 'bookkeeping-fx-loading', error: state === 'bookkeeping-fx-error' ? '示例：汇率读取失败，原币金额和输入保留，可重试。' : '' }])));
  function change(key: string, patch: Partial<ExpenseDraft>) { setFormErrors(before => ({...before,[key]:''})); setDrafts(before => ({ ...before, [key]: { ...before[key], ...patch, ...((patch.currency !== undefined && patch.currency !== before[key].currency) || (patch.date !== undefined && patch.date !== before[key].date) ? { rate: null } : {}) } })); }
  function begin(key: string) { const row = expenses.find(row => row.id === key); if (row && !drafts[key]) setDrafts(before => ({ ...before, [key]: expenseDraft(row) })); }
  function apply(input: ExpenseMutation, imported?: Receipt[]): Expense[] {
    let result: Expense[];
    if (input.kind === 'save') {
      const previous = expenses.find(row => row.id === input.content.id);
      if ((previous?.revision ?? null) !== input.expectedRevision) throw Error('示例：记录版本冲突，草稿保留。');
      const draft = Object.values(drafts).find(d => d.id === input.content.id)!;
      result = [{ ...input.content, receipts: imported ?? draft.receipts, revision: (input.expectedRevision ?? 0) + 1, deleted: false, createdAt: previous?.createdAt ?? '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T01:00:00.000Z' }];
    } else {
      const targets = input.kind === 'status' ? input.targets : [input.target];
      result = targets.map(target => {
        const row = expenses.find(row => row.id === target.id && row.revision === target.revision); if (!row) throw Error('示例：版本冲突，整批未应用。');
        return { ...row, revision: row.revision + 1, ...(input.kind === 'status' ? { status: input.status } : { deleted: input.deleted }) };
      });
    }
    checkMutationReceipt(input, result);
    setExpenses(before => [...before.filter(row => !result.some(next => next.id === row.id)), ...result]);
    return result;
  }
  return { formErrors, expenses, drafts, loading, loaded, loadError, busy, error, notice, pending, undo, month, filter, query, selected, confirmation, rates,
    fetchRate: async key => { const draft = drafts[key]; if (!draft || draft.currency === 'CNY' || ['bookkeeping-fx-loading', 'bookkeeping-fx-error'].includes(state)) return; const rate: ExchangeRate = { currency: draft.currency, rate: '7.1', requestedDate: draft.date, rateDate: draft.date, source: 'frankfurter-ecb' }; change(key, { rate }); setRates(before => ({ ...before, [key]: { loading: false, error: '' } })); setNotice('虚构汇率示例，仅在内存中换算，不访问网络。'); },
    setMonth: value => { setMonthState(value); select([]); }, setFilter: value => { setFilterState(value); select([]); }, setQuery: value => { setQueryState(value); select([]); }, select, confirm, begin, change,
    refresh: async () => { setLoading(true); await new Promise<void>(resolve => window.setTimeout(resolve, state === 'bookkeeping-refresh-fast' ? 80 : 450)); setLoading(false); setLoaded(true); setLoadError(''); setNotice('示例记录已重新读取，仅在内存中展示。'); },
    addFiles: (key, files) => { const draft = drafts[key]; if (draft.files.length + draft.receipts.length + files.length > 5) { setFormErrors(before => ({...before,[key]:'每笔最多 5 份票据。'})); return; } change(key, { files: [...draft.files, ...files.map(file => ({ id: crypto.randomUUID(), file }))] }); },
    removeReceipt: (key, rid) => change(key, { receipts: drafts[key].receipts.filter(r => r.id !== rid), files: drafts[key].files.filter(r => r.id !== rid) }),
    save: async (key, continueAdding = false, onSaved) => {
      if (busy) return false;
      const draft = drafts[key]; const problem = draftProblem(draft); if (problem) { setFormErrors(before=>({...before,[key]:problem})); return false; }
      if (pending) { setFormErrors(before => ({...before,[key]:'请先核对示例原操作结果。'})); return false; }
      const receipts = [...draft.receipts, ...draft.files.map(f => ({ id: f.id, name: f.file.name, mediaType: /\.pdf$/i.test(f.file.name) ? 'application/pdf' : 'image/png', size: Math.max(1, f.file.size) }))];
      setBusy('save'); setError(''); setFormErrors(before => ({...before,[key]:''}));
      try {
        if (state === 'bookkeeping-save-feedback') await new Promise<void>(resolve => window.setTimeout(resolve, 450));
        const input: ExpenseMutation = { kind: 'save', requestId: crypto.randomUUID(), expectedRevision: draft.expectedRevision, content: draftContent(draft, receipts) };
        const saved = apply(input, receipts)[0];
        setDrafts(before => ({ ...before, [key]: key === 'new' ? { ...emptyExpense(draft.date), status: draft.status === 'unclaimed' ? 'unclaimed' : 'pending' } : expenseDraft(saved) })); setError(''); setNotice('示例开销已在内存中保存。');
        if (!continueAdding) onSaved?.();
        return !continueAdding;
      } catch (e) { setFormErrors(before => ({...before,[key]:e instanceof Error ? e.message : '示例保存失败'})); setNotice(''); return false; }
      finally { setBusy(''); }
    },
    rebase: key => { const row = expenses.find(r => r.id === drafts[key]?.id); if (row) { change(key, { expectedRevision: row.revision }); setNotice('示例草稿保留，采用当前记录版本，尚未保存。'); } },
    applyConfirmation: async () => {
      if (!confirmation) return;
      try { const input: ExpenseMutation = confirmation.kind === 'status' ? { ...confirmation, requestId: crypto.randomUUID() } : { kind: 'delete', requestId: crypto.randomUUID(), target: confirmation.target, deleted: confirmation.deleted }; const rows = apply(input); if (input.kind === 'delete') setUndo(rows[0]); confirm(null); select([]); setError(''); setNotice('示例操作已在内存中应用。'); } catch (e) { setError(e instanceof Error ? e.message : '示例操作失败'); }
    },
    reconcile: async () => { setPending(null); setNotice('示例：已确认原操作未保存，草稿保留。'); },
    exportRows: async () => { setNotice('UI 总览仅展示导出反馈，不保存实际文件。'); },
    openReceipt: async () => { setNotice('UI 总览中的票据是虚构示例，不调用系统查看程序。'); },
    restore: async () => { if (undo) { apply({ kind: 'delete', requestId: crypto.randomUUID(), target: { id: undo.id, revision: undo.revision }, deleted: false }); setUndo(null); setNotice('示例开销已恢复。'); } },
  };
}
