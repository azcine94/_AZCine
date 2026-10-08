import { localDate, validDate } from './workspace-contract.ts';

export const expenseStatuses = { unclaimed: '不报销', pending: '待提交', submitted: '已提交', paid: '已到账' } as const;
export type ExpenseStatus = keyof typeof expenseStatuses;
export const expenseCurrencies = { CNY: '人民币', USD: '美元', EUR: '欧元', HKD: '港币', JPY: '日元', GBP: '英镑', AUD: '澳元', CAD: '加元', SGD: '新加坡元' } as const;
export type ExpenseCurrency = keyof typeof expenseCurrencies;
export interface ExchangeRate { currency: Exclude<ExpenseCurrency, 'CNY'>; rate: string; requestedDate: string; rateDate: string; source: 'frankfurter-ecb' }
export interface ExpenseExchange { originalMinor: number; quote: ExchangeRate }
export interface Receipt { id: string; name: string; mediaType: string; size: number }
export interface Expense {
  id: string; date: string; purpose: string; amountFen: number; note: string; status: ExpenseStatus;
  receipts: Receipt[]; revision: number; deleted: boolean; createdAt: string; updatedAt: string;
  exchange: ExpenseExchange | null;
}
export interface ExpenseContent { id: string; date: string; purpose: string; amountFen: number; note: string; status: ExpenseStatus; receiptIds: string[]; exchange: ExpenseExchange | null }
export interface ExpenseTarget { id: string; revision: number }
export type ExpenseMutation =
  | { kind: 'save'; requestId: string; expectedRevision: number | null; content: ExpenseContent }
  | { kind: 'status'; requestId: string; targets: ExpenseTarget[]; status: ExpenseStatus }
  | { kind: 'delete'; requestId: string; target: ExpenseTarget; deleted: boolean };
export interface ReceiptFile { id: string; file: File }
export interface ExpenseDraft {
  id: string; expectedRevision: number | null; date: string; purpose: string; amount: string; note: string;
  status: ExpenseStatus; receipts: Receipt[]; files: ReceiptFile[];
  currency: ExpenseCurrency; rate: ExchangeRate | null;
}
export type ExpenseConfirmation = { kind: 'status'; targets: ExpenseTarget[]; status: ExpenseStatus } | { kind: 'delete'; target: ExpenseTarget; purpose: string; deleted: boolean };
const maxAmount = 9_999_999_999;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const status = (value: unknown): value is ExpenseStatus => typeof value === 'string' && Object.hasOwn(expenseStatuses, value);
export function parseExchangeRate(value: unknown): ExchangeRate {
  if (!object(value) || typeof value.currency !== 'string' || value.currency === 'CNY' || !Object.hasOwn(expenseCurrencies, value.currency)
    || typeof value.rate !== 'string' || !/^\d{1,6}(?:\.\d{1,12})?$/.test(value.rate) || /^0+(?:\.0+)?$/.test(value.rate)
    || typeof value.requestedDate !== 'string' || !validDate(value.requestedDate) || typeof value.rateDate !== 'string' || !validDate(value.rateDate)
    || value.rateDate > value.requestedDate || value.source !== 'frankfurter-ecb') throw Error('汇率回执无效，请重新获取；原金额保留。');
  return { currency: value.currency as ExchangeRate['currency'], rate: value.rate, requestedDate: value.requestedDate, rateDate: value.rateDate, source: value.source };
}
export function convertedFen(amount: string, rate: ExchangeRate | null): number | null {
  const original = amountFen(amount);
  if (original === null || !rate || !/^\d{1,6}(?:\.\d{1,12})?$/.test(rate.rate)) return null;
  const [whole, fraction = ''] = rate.rate.split('.');
  const scale = 10n ** BigInt(fraction.length), numerator = BigInt(whole + fraction);
  const result = (BigInt(original) * numerator + scale / 2n) / scale;
  return result > 0n && result <= BigInt(maxAmount) ? Number(result) : null;
}
export function parseReceipt(value: unknown): Receipt {
  if (!object(value) || !uuid(value.id) || typeof value.name !== 'string' || !value.name.trim() || typeof value.mediaType !== 'string'
    || !['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(value.mediaType) || !integer(value.size) || value.size < 1 || value.size > 5 * 1024 * 1024) throw Error('票据回执无效，未报告保存成功。');
  return { id: value.id, name: value.name, mediaType: value.mediaType, size: value.size };
}
export function parseExpense(value: unknown): Expense {
  if (!object(value) || !uuid(value.id) || typeof value.date !== 'string' || !validDate(value.date) || typeof value.purpose !== 'string' || !value.purpose.trim()
    || typeof value.note !== 'string' || !integer(value.amountFen) || value.amountFen < 1 || value.amountFen > maxAmount || !status(value.status)
    || !Array.isArray(value.receipts) || value.receipts.length > 5 || !integer(value.revision) || value.revision < 1 || typeof value.deleted !== 'boolean'
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') throw Error('开销记录格式不完整，未使用空内容替代，请重新读取核对。');
  const receipts = value.receipts.map(parseReceipt);
  if (new Set(receipts.map(r => r.id)).size !== receipts.length) throw Error('票据回执有重复编号，请核对。');
  let exchange: ExpenseExchange | null = null;
  if (value.exchange !== undefined && value.exchange !== null) {
    if (!object(value.exchange) || !integer(value.exchange.originalMinor) || value.exchange.originalMinor < 1 || value.exchange.originalMinor > maxAmount) throw Error('原币金额记录无效，请核对。');
    exchange = { originalMinor: value.exchange.originalMinor, quote: parseExchangeRate(value.exchange.quote) };
    if (exchange.quote.requestedDate !== value.date || convertedFen(amountText(exchange.originalMinor), exchange.quote) !== value.amountFen) throw Error('汇率折算记录与人民币金额不一致，请核对。');
  }
  return { id: value.id, date: value.date, purpose: value.purpose, amountFen: value.amountFen, note: value.note, status: value.status, receipts, revision: value.revision, deleted: value.deleted, createdAt: value.createdAt, updatedAt: value.updatedAt, exchange };
}
export function parseExpenses(value: unknown): Expense[] {
  if (!Array.isArray(value)) throw Error('开销列表读取失败，已有内容保留。');
  const rows = value.map(parseExpense);
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('开销列表有重复记录，请重新读取。');
  return rows;
}
// Decimal digits become integer fen directly: no floating-point multiplication.
export function amountFen(value: string): number | null {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return amount > 0 && amount <= maxAmount ? amount : null;
}
export function amountText(fen: number): string { return `${Math.floor(fen / 100)}.${String(fen % 100).padStart(2, '0')}`; }
export function money(fen: number): string {
  const [whole, fraction] = amountText(fen).split('.');
  return `¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
export function emptyExpense(date = localDate()): ExpenseDraft {
  return { id: crypto.randomUUID(), expectedRevision: null, date, purpose: '', amount: '', note: '', status: 'unclaimed', receipts: [], files: [], currency: 'CNY', rate: null };
}
export function expenseDraft(expense: Expense): ExpenseDraft {
  return { id: expense.id, expectedRevision: expense.revision, date: expense.date, purpose: expense.purpose, amount: amountText(expense.exchange?.originalMinor ?? expense.amountFen), note: expense.note, status: expense.status, receipts: expense.receipts, files: [], currency: expense.exchange?.quote.currency ?? 'CNY', rate: expense.exchange?.quote ?? null };
}
export function draftIssue(draft: ExpenseDraft): { field: 'date' | 'purpose' | 'amount' | 'rate' | 'note' | 'receipts'; message: string } | null {
  if (!validDate(draft.date)) return {field:'date',message:'请填写有效日期。'};
  if (!draft.purpose.trim() || [...draft.purpose].length > 200) return {field:'purpose',message:'请填写用途，最多 200 字。'};
  if (amountFen(draft.amount) === null) return {field:'amount',message:'请填写大于零的金额，最多两位小数，最高 99,999,999.99 元。'};
  if (draft.currency !== 'CNY') {
    if (!draft.rate || draft.rate.currency !== draft.currency || draft.rate.requestedDate !== draft.date) return {field:'rate',message:'请先获取所选币种与开销日期的汇率，再保存。'};
    if (convertedFen(draft.amount, draft.rate) === null) return {field:'amount',message:'折算人民币金额需在 0.01 至 99,999,999.99 元之间。'};
  }
  if ([...draft.note].length > 5000) return {field:'note',message:'备注最多 5000 字。'};
  if (draft.receipts.length + draft.files.length > 5) return {field:'receipts',message:'每笔开销最多 5 份票据。'};
  return null;
}
export function draftProblem(draft: ExpenseDraft): string { return draftIssue(draft)?.message ?? ''; }
export function draftContent(draft: ExpenseDraft, receipts = draft.receipts): ExpenseContent {
  const original = amountFen(draft.amount);
  const amount = draft.currency === 'CNY' ? original : convertedFen(draft.amount, draft.rate);
  if (amount === null) throw Error('金额无效，输入保留。');
  if (draft.currency !== 'CNY' && (!draft.rate || draft.rate.currency !== draft.currency || draft.rate.requestedDate !== draft.date || original === null)) throw Error('汇率与当前币种或日期不匹配，输入保留。');
  return { id: draft.id, date: draft.date, purpose: draft.purpose.trim(), amountFen: amount, note: draft.note, status: draft.status, receiptIds: receipts.map(r => r.id), exchange: draft.currency === 'CNY' ? null : { originalMinor: original!, quote: draft.rate! } };
}
export function draftFingerprint(draft: ExpenseDraft): string { return JSON.stringify({ ...draft, files: draft.files.map(f => ({ id: f.id, name: f.file.name, size: f.file.size, lastModified: f.file.lastModified })) }); }
export function sameContent(row: Expense, content: ExpenseContent): boolean {
  return row.id === content.id && row.date === content.date && row.purpose === content.purpose && row.amountFen === content.amountFen && row.note === content.note && row.status === content.status
    && JSON.stringify(row.exchange ?? null) === JSON.stringify(content.exchange ?? null)
    && JSON.stringify(row.receipts.map(r => r.id)) === JSON.stringify(content.receiptIds);
}
export function checkMutationReceipt(input: ExpenseMutation, rows: Expense[]): void {
  const targets = input.kind === 'save' ? [{ id: input.content.id, revision: input.expectedRevision ?? 0 }] : input.kind === 'status' ? input.targets : [input.target];
  if (rows.length !== targets.length || targets.some(t => !rows.some(r => r.id === t.id && r.revision === t.revision + 1))) throw Error('操作回执与所选记录不一致，请核对原操作结果。');
  if (input.kind === 'save' && (!sameContent(rows[0], input.content) || rows[0].deleted)) throw Error('保存回执与输入不一致，草稿保留。');
  if (input.kind === 'status' && rows.some(r => r.status !== input.status || r.deleted)) throw Error('报销状态回执不一致，请核对。');
  if (input.kind === 'delete' && rows[0].deleted !== input.deleted) throw Error('移除回执不一致，请核对。');
}
export function filteredExpenses(rows: Expense[], month: string, filter: string, query: string): Expense[] {
  const term = query.trim().toLocaleLowerCase();
  return rows.filter(row => !row.deleted && (!month || row.date.startsWith(`${month}-`)) && (!filter || row.status === filter)
    && (!term || `${row.purpose}\n${row.note}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
export function expenseTotals(rows: Expense[]) {
  let expense = 0, waiting = 0, paid = 0, pending = 0, submitted = 0;
  for (const row of rows) {
    if (row.deleted) continue;
    expense += row.amountFen;
    if (row.status === 'pending') pending += row.amountFen;
    if (row.status === 'submitted') submitted += row.amountFen;
    if (row.status === 'paid') paid += row.amountFen;
  }
  waiting = pending + submitted;
  return { expense, waiting, paid, pending, submitted };
}
