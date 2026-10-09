import { RecordContextMenu } from './components/ui/record-context-menu.tsx';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, MoreHorizontal, Paperclip, Plus, RefreshCw } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { Label } from './components/ui/label.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import { NativeSelect, NativeSelectOption } from './components/ui/native-select.tsx';
import { MonthInput } from './components/ui/month-input.tsx';
import { FormDialog, useCreationDialog } from './components/ui/form-dialog.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { LoadingStatus, LoadingPlaceholder } from './components/ui/loading-status.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './components/ui/dialog.tsx';
import { DateInput } from './date-input.tsx';
import { expenseStatuses, expenseCurrencies, expenseTotals, draftIssue, filteredExpenses, money, amountText, convertedFen } from './bookkeeping-contract.ts';
import type { Expense, ExpenseDraft, ExpenseStatus, ExpenseCurrency } from './bookkeeping-contract.ts';
import type { BookkeepingController } from './use-bookkeeping.ts';

const target = (row: Expense) => ({ id: row.id, revision: row.revision });
function FeedbackArea({ model, showLoading = true, showErrors = true }: { model: BookkeepingController; showLoading?: boolean; showErrors?: boolean }) {
  const disabled = !!model.busy || model.loading;
  return <div className="bookkeeping-feedback">
    {showLoading && <LoadingStatus active={model.loading} delayMs={model.loaded ? 300 : 0}>{model.loaded ? '正在刷新，已有记录与草稿保留…' : '正在读取开销…'}</LoadingStatus>}
    {showErrors && model.loadError && <Feedback tone="error" role="alert">{model.loadError} <Button variant="link" disabled={disabled} onClick={() => void model.refresh()}>重新读取</Button></Feedback>}
    {showErrors && model.error && <Feedback tone="error" role="alert">{model.error}</Feedback>}
    {showErrors && model.pending && !model.busy && <Feedback tone="pending" role="status">原操作结果尚未确认，输入与选择已保留。<Button variant="outline" disabled={disabled} onClick={() => void model.reconcile()}>核对原操作结果</Button></Feedback>}

  </div>;
}
function StatusBadge({ status }: { status: ExpenseStatus }) {
  return <Badge variant="secondary">{status === 'paid' && <Check size={12} aria-hidden="true" />}{expenseStatuses[status]}</Badge>;
}
function ReceiptMenu({ row, model }: { row: Expense; model: BookkeepingController }) {
  if (!row.receipts.length) return <span className="subtle">—</span>;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" disabled={!!model.busy} aria-label={`查看${row.purpose}的${row.receipts.length}份票据`}><Paperclip size={16} />{row.receipts.length} 份</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">{row.receipts.map(receipt => <DropdownMenuItem key={receipt.id} onSelect={() => void model.openReceipt(row.id, receipt)}>{receipt.name}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>;
}
function RowMenu({ row, model, onEdit }: { row: Expense; model: BookkeepingController; onEdit: (id: string, opener?: HTMLElement) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openingEditor = useRef(false);
  const mark = (status: ExpenseStatus) => model.confirm({ kind: 'status', status, targets: [target(row)] });
  return <DropdownMenu><DropdownMenuTrigger asChild><Button ref={trigger} variant="ghost" size="icon" disabled={!!model.busy || !!model.pending || model.loading} aria-label={`${row.purpose}：更多操作`}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (openingEditor.current) { event.preventDefault(); openingEditor.current = false; } }}>
      <DropdownMenuItem onSelect={() => { openingEditor.current = true; onEdit(row.id, trigger.current ?? undefined); }}>编辑开销</DropdownMenuItem>
      {row.status === 'pending' && <DropdownMenuItem onSelect={() => mark('submitted')}>标记已提交</DropdownMenuItem>}
      {row.status === 'submitted' && <DropdownMenuItem onSelect={() => mark('paid')}>标记已到账</DropdownMenuItem>}
      {(row.status === 'submitted' || row.status === 'paid') && <DropdownMenuItem onSelect={() => mark('pending')}>退回待提交</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => model.confirm({ kind: 'delete', target: target(row), purpose: row.purpose, deleted: true })}>移除这笔开销</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
function Confirmation({ model }: { model: BookkeepingController }) {
  const value = model.confirmation;
  const rows = value?.kind === 'status' ? value.targets.map(t => model.expenses.find(r => r.id === t.id)).filter((r): r is Expense => !!r) : [];
  const changed = value?.kind === 'status' && value.targets.some(t => !model.expenses.some(r => r.id === t.id && r.revision === t.revision && !r.deleted));
  const title = value?.kind === 'delete' ? '移除开销' : value?.kind === 'status' ? value.status === 'pending' ? '退回待提交' : `标记${expenseStatuses[value.status]}` : '确认操作';
  return <Dialog open={!!value} onOpenChange={open => { if (!open && !model.busy) model.confirm(null); }}><DialogContent showCloseButton={!model.busy} onEscapeKeyDown={e => { if (model.busy) e.preventDefault(); }} onInteractOutside={e => { if (model.busy) e.preventDefault(); }}>
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>
      {value?.kind === 'delete' ? `移除“${value.purpose}”后，它不再计入合计；原记录和票据保留，可以撤销。`
        : `共 ${rows.length} 笔，合计 ${money(expenseTotals(rows).expense)}。${value?.kind === 'status' && value.status === 'paid' ? '请确认这几笔报销已经整笔到账。' : value?.kind === 'status' && value.status === 'pending' ? '将重新进入待提交，后续可修改或再次提交。' : '请确认已在实际报销流程中提交这些记录。'}`}
    </DialogDescription></DialogHeader>
    {changed && <Feedback tone="error">记录已变化，请取消后重新选择。</Feedback>}
    {model.pending && <Feedback tone="pending">操作结果尚未确认，请在页面核对原操作，避免重复执行。</Feedback>}
    {model.error && <Feedback tone="error" role="alert">{model.error}</Feedback>}
    <DialogFooter><Button variant="outline" disabled={!!model.busy} onClick={() => model.confirm(null)}>取消</Button><Button variant={value?.kind === 'delete' ? 'destructive' : 'default'} disabled={!!model.busy || !!model.pending || !!changed} onClick={() => void model.applyConfirmation()} loading={!!(model.busy === 'status')} loadingText="正在保存…">确认</Button></DialogFooter>
  </DialogContent></Dialog>;
}
export function BookkeepingPanel({ model, create = false, editId = null }: { model: BookkeepingController; create?: boolean; editId?: string | null }) {
  const creation = useCreationDialog(create || !!editId);
  const editorOpener = useRef<HTMLElement | null>(null);
  const [draftKey, setDraftKey] = useState(editId ?? 'new');
  useEffect(() => {
    if (create || editId) { setDraftKey(editId ?? 'new'); creation.setOpen(true); }
  }, [create, editId]);
  function openEditor(id: string, opener?: HTMLElement) { editorOpener.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); model.begin(id); setDraftKey(id); creation.setOpen(true); }
  function closeCreation(open: boolean) {
    creation.setOpen(open);
    if (!open && location.hash.startsWith('#bookkeeping/')) location.hash = '#bookkeeping';
  }
  const rows = filteredExpenses(model.expenses, model.month, model.filter, model.query);
  const total = expenseTotals(rows), chosen = rows.filter(row => model.selected.includes(row.id));
  const disabled = !!model.busy || model.loading;
  const blocked = disabled || !!model.pending || !model.loaded || !!model.loadError;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [model.month, model.filter, model.query]);
  const maxPage = Math.max(0, Math.ceil(rows.length / 50) - 1), currentPage = Math.min(page, maxPage);
  const visible = rows.slice(currentPage * 50, (currentPage + 1) * 50);
  const selectedOnPage = visible.filter(row => model.selected.includes(row.id)).length;
  const allPending = chosen.length > 0 && chosen.every(row => row.status === 'pending');
  const allSubmitted = chosen.length > 0 && chosen.every(row => row.status === 'submitted');
  function selectPage(checked: boolean) {
    model.select(checked ? [...new Set([...model.selected, ...visible.map(row => row.id)])] : model.selected.filter(id => !visible.some(row => row.id === id)));
  }
  return <section className="bookkeeping" aria-label="记账">
    <div className="bookkeeping-heading"><p className="subtle">记下开销，查看合计，跟踪报销。</p><div className="bookkeeping-actions">
      <Button variant="ghost" size="icon" aria-label="刷新记账" disabled={disabled} onClick={() => void model.refresh()}><RefreshCw size={16} /></Button>
      <Button variant="outline" disabled={disabled || !rows.length || !!model.loadError} onClick={() => void model.exportRows(rows)}><Download size={16} />导出明细</Button>
      <Button data-create="bookkeeping" onClick={() => openEditor('new')}><Plus size={16} />记一笔</Button>
    </div></div>
    <div className="bookkeeping-summary">
      <div><span>开销合计</span><strong>{model.loaded ? money(total.expense) : '—'}</strong><small>{model.loaded ? `共 ${rows.length} 笔 · 按当前筛选统计` : '等待读取'}</small></div>
      <div><span>待报销</span><strong>{model.loaded ? money(total.waiting) : '—'}</strong><small>待提交 {money(total.pending)} · 已提交 {money(total.submitted)}</small></div>
      <div><span>已到账</span><strong>{model.loaded ? money(total.paid) : '—'}</strong><small>只统计已整笔到账的报销</small></div>
    </div>
    <div className="bookkeeping-filters">
      <div><Label htmlFor="expense-month">月份</Label><MonthInput id="expense-month" value={model.month} onChange={model.setMonth} /></div>
      <div><Label htmlFor="expense-status">报销状态</Label><NativeSelect id="expense-status" value={model.filter} onChange={e => model.setFilter(e.target.value)}><NativeSelectOption value="">全部状态</NativeSelectOption>{Object.entries(expenseStatuses).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div>
      <div className="bookkeeping-search"><Label htmlFor="expense-query">搜索</Label><Input id="expense-query" type="search" placeholder="搜索用途、备注" value={model.query} onChange={e => model.setQuery(e.target.value)} /></div>
      <Button variant="ghost" onClick={() => { model.setMonth(''); model.setFilter(''); model.setQuery(''); }}>查看全部</Button>
    </div>
    <FeedbackArea model={model} showLoading={!creation.open && !model.confirmation} showErrors={!creation.open && !model.confirmation} />
    {model.loaded && !rows.length ? <EmptyState><h2>{model.expenses.some(row => !row.deleted) ? '没有符合筛选的开销' : '记下第一笔开销'}</h2><p>{model.expenses.some(row => !row.deleted) ? '调整月份、报销状态或搜索内容。' : '填写金额和用途，需要报销时勾选即可。'}</p><Button onClick={() => openEditor('new')}>记一笔</Button></EmptyState>
      : rows.length > 0 && <div className="bookkeeping-table-panel">
        <Table className="bookkeeping-table"><TableHeader><TableRow>
          <TableHead className="bookkeeping-check"><Checkbox aria-label="选择本页全部开销" checked={selectedOnPage === visible.length ? true : selectedOnPage > 0 ? 'indeterminate' : false} disabled={blocked} onCheckedChange={value => selectPage(value === true)} /></TableHead>
          <TableHead>日期</TableHead><TableHead>用途</TableHead><TableHead className="bookkeeping-amount">金额</TableHead><TableHead>报销状态</TableHead><TableHead>票据</TableHead><TableHead><span className="sr-only">操作</span></TableHead>
        </TableRow></TableHeader><TableBody>{visible.map(row => <RecordContextMenu key={row.id} copyText={[row.date,row.purpose,money(row.amountFen),expenseStatuses[row.status],row.note].filter(Boolean).join('\t')} actions={[{label:'编辑开销',disabled:blocked,run:origin=>openEditor(row.id,origin??undefined)},{label:'删除开销',destructive:true,disabled:blocked,run:()=>model.confirm({kind:'delete',target:target(row),purpose:row.purpose,deleted:true})}]}><TableRow data-state={model.selected.includes(row.id) ? 'selected' : undefined}>
          <TableCell><Checkbox aria-label={`选择${row.purpose}`} checked={model.selected.includes(row.id)} disabled={blocked} onCheckedChange={value => model.select(value === true ? [...new Set([...model.selected, row.id])] : model.selected.filter(id => id !== row.id))} /></TableCell>
          <TableCell><time dateTime={row.date}>{row.date}</time></TableCell><TableCell className="bookkeeping-purpose"><Button variant="link" className="h-auto justify-start whitespace-normal p-0 text-left" data-edit="bookkeeping" onClick={event => openEditor(row.id, event.currentTarget)}>{row.purpose}</Button>{row.note && <p className="subtle" title={row.note}>{row.note}</p>}</TableCell>
          <TableCell className="bookkeeping-amount">{money(row.amountFen)}{row.exchange && <small className="bookkeeping-original" title={`1 ${row.exchange.quote.currency} = ${row.exchange.quote.rate} CNY · 汇率日期 ${row.exchange.quote.rateDate}`}>{amountText(row.exchange.originalMinor)} {row.exchange.quote.currency}</small>}</TableCell><TableCell><StatusBadge status={row.status} /></TableCell><TableCell><ReceiptMenu row={row} model={model} /></TableCell><TableCell><RowMenu row={row} model={model} onEdit={openEditor} /></TableCell>
        </TableRow></RecordContextMenu>)}</TableBody></Table>
        {chosen.length > 0 && <div className="bookkeeping-selection"><span>已选 {chosen.length} 笔　合计 <strong>{money(expenseTotals(chosen).expense)}</strong></span><div className="bookkeeping-actions">
          <Button variant="outline" disabled={blocked} onClick={() => void model.exportRows(chosen)}><Download size={16} />导出所选明细</Button>
          {allPending && <Button disabled={blocked || chosen.length > 200} onClick={() => model.confirm({ kind: 'status', status: 'submitted', targets: chosen.map(target) })}>标记已提交</Button>}
          {allSubmitted && <Button disabled={blocked || chosen.length > 200} onClick={() => model.confirm({ kind: 'status', status: 'paid', targets: chosen.map(target) })}>标记已到账</Button>}
          <Button variant="ghost" disabled={disabled} onClick={() => model.select([])}>取消选择</Button>
        </div>{!allPending && !allSubmitted && <p className="subtle">请选择同为待提交或同为已提交的记录，批量更新报销状态。</p>}{chosen.length > 200 && <p className="subtle">每次最多更新 200 笔报销记录，请减少选择。</p>}</div>}
        <div className="bookkeeping-pagination"><span>共 {rows.length} 笔 · 第 {currentPage + 1} / {maxPage + 1} 页</span><div className="bookkeeping-actions"><Button variant="ghost" size="icon" aria-label="上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button><Button variant="ghost" size="icon" aria-label="下一页" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div></div>
      </div>}
    <FormDialog open={creation.open} onOpenChange={closeCreation} title={draftKey === 'new' ? '记一笔' : '编辑开销'} description={draftKey === 'new' ? '填写开销，保存后按人民币计入总数。关闭保留未提交输入。' : '保存后更新这笔开销。关闭保留未提交改动。'} wide returnFocus={editorOpener.current}>
      <BookkeepingEditor key={draftKey} model={model} draftKey={draftKey} embedded onClose={() => closeCreation(false)} onSaved={() => closeCreation(false)} session={creation.session} />
    </FormDialog>
    <Confirmation model={model} />
  </section>;
}
export function BookkeepingEditor({ model, draftKey, embedded = false, onClose, onSaved, session }: { model: BookkeepingController; draftKey: string; embedded?: boolean; onClose?: () => void; onSaved?: () => void; session?: { current: number } }) {
  useEffect(() => { model.begin(draftKey); }, [draftKey, model.loaded]);
  const draft = model.drafts[draftKey];
  const formal = model.expenses.find(row => row.id === draft?.id);
  const busy = !!model.busy || model.loading;
  const conflict = !!draft && draft.expectedRevision !== null && !!formal && formal.revision !== draft.expectedRevision;
  const gone = !!draft && draft.expectedRevision !== null && model.loaded && (!formal || formal.deleted);
  const lockedFields = draft?.status === 'submitted' || draft?.status === 'paid';
  const rateState = model.rates[draftKey];
  const formError = model.formErrors[draftKey] ?? '';
  const candidate = formError && draft ? draftIssue(draft) : null;
  const issue = candidate?.message === formError ? candidate : null;
  const fieldError = (field: string) => issue?.field === field ? <Feedback id={`expense-${field}-error`} tone="error" role="alert">{issue.message}</Feedback> : null;
  const converted = draft ? convertedFen(draft.amount, draft.rate) : null;
  useEffect(() => {
    if (draft && draft.currency !== 'CNY' && !draft.rate && !model.busy && !model.loading && !model.pending) void model.fetchRate(draftKey);
  }, [draftKey, draft?.currency, draft?.date, model.loaded, model.busy, model.loading, !!model.pending]);
  const change = (patch: Partial<ExpenseDraft>) => model.change(draftKey, patch);
  async function save(continueAdding = false) {
    const startedOn = location.hash;
    const startedSession = session?.current;
    await model.save(draftKey, continueAdding, () => {
      if (location.hash !== startedOn) return;
      if (embedded) { if (session?.current === startedSession) onSaved?.(); }
      else location.hash = '#bookkeeping';
    });
  }
  return <section className={`bookkeeping bookkeeping-editor${embedded ? ' bookkeeping-editor--dialog' : ''}`}>
    {!embedded && <div className="bookkeeping-heading"><Button variant="ghost" asChild><UILink href="#bookkeeping"><ChevronLeft size={16} />返回记账</UILink></Button><span className="subtle">切页保留输入，点击保存后入账</span></div>}
    <FeedbackArea model={model} showLoading={!embedded || model.loading} showErrors={!model.confirmation} />
    {formError && !issue && <Feedback tone="error" role="alert">{formError}</Feedback>}
    {!draft ? model.loadError ? <EmptyState><h2>未能读取这笔开销</h2><p>重新读取后再继续编辑。</p></EmptyState> : model.loaded && !model.loading ? <EmptyState><h2>没有找到这笔开销</h2><p>请返回记账列表重新选择。</p></EmptyState> : <LoadingPlaceholder label="正在读取开销…"/> : <form className="bookkeeping-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      {!embedded && <h2>{draft.expectedRevision === null ? '记一笔' : '编辑开销'}</h2>}
      {conflict && <Feedback tone="pending">正式记录已变化，编辑草稿保留。当前记录：{formal?.purpose}，{money(formal?.amountFen ?? 0)}，{formal && expenseStatuses[formal.status]}。<Button type="button" variant="outline" disabled={busy || !!model.pending} onClick={() => model.rebase(draftKey)}>保留草稿，采用当前版本</Button></Feedback>}
      {gone && <Feedback tone="error">这笔开销已移除或不存在，草稿保留，请返回列表核对。</Feedback>}
      <div className="bookkeeping-form-grid"><div><Label htmlFor="expense-amount">金额{draft.currency === 'CNY' ? '（元）' : '（原币）'}</Label><div className="bookkeeping-money-input"><Label className="sr-only" htmlFor="expense-currency">币种</Label><NativeSelect id="expense-currency" value={draft.currency} disabled={lockedFields} onChange={e => change({ currency: e.target.value as ExpenseCurrency })}>{Object.entries(expenseCurrencies).map(([currency, label]) => <NativeSelectOption key={currency} value={currency}>{label} {currency}</NativeSelectOption>)}</NativeSelect><Input id="expense-amount" aria-invalid={issue?.field === 'amount'} aria-describedby={issue?.field === 'amount' ? 'expense-amount-error' : undefined} autoFocus inputMode="decimal" placeholder="0.00" autoComplete="off" maxLength={11} value={draft.amount} readOnly={lockedFields} onChange={e => change({ amount: e.target.value })} /></div>{fieldError('amount')}</div>
        <div><Label htmlFor="expense-date">日期</Label><DateInput id="expense-date" invalid={issue?.field === 'date'} describedBy={issue?.field === 'date' ? 'expense-date-error' : undefined} label="开销日期" value={draft.date} readOnly={lockedFields} selectionDisabled={lockedFields} onChange={date => change({ date })} />{fieldError('date')}</div></div>
      {fieldError('rate')}
      {draft.currency !== 'CNY' && <div className="bookkeeping-exchange">
        <div className="bookkeeping-exchange-result" aria-live="polite"><span>折合人民币</span><strong>{converted === null ? '—' : money(converted)}</strong>{!lockedFields && <Button type="button" variant="ghost" size="sm" disabled={!!rateState?.loading || busy || !!model.pending} onClick={() => void model.fetchRate(draftKey)} loading={!!rateState?.loading} loadingText="读取汇率…"><RefreshCw size={14} />{draft.rate ? '更新汇率' : '获取汇率'}</Button>}</div>
        {draft.rate && <><p className="subtle">1 {expenseCurrencies[draft.currency]} = {draft.rate.rate} 元 · 汇率日期：{draft.rate.rateDate}</p><p className="subtle">来源：Frankfurter / ECB 参考汇率；入账后保留本次换算。{draft.rate.rateDate !== draft.date && '所选日期尚无新报价，采用之前最近公布的汇率。'}</p></>}
        <LoadingStatus active={!!rateState?.loading || (!draft.rate && !rateState?.error)} delayMs={rateState?.loading ? 250 : 0}>{rateState?.loading ? `正在获取 ${draft.date} 的汇率，原金额保留…` : '获取所选币种与日期的汇率后，即可按人民币入账。'}</LoadingStatus>
        {rateState?.error && <Feedback tone="error" role="alert">{rateState.error}</Feedback>}

      </div>}
      <div><Label htmlFor="expense-purpose">用途</Label><Input id="expense-purpose" aria-invalid={issue?.field === 'purpose'} aria-describedby={issue?.field === 'purpose' ? 'expense-purpose-error' : undefined} placeholder="例如：打车、购买素材" maxLength={200} value={draft.purpose} readOnly={lockedFields} onChange={e => change({ purpose: e.target.value })} />{fieldError('purpose')}</div>
      <div className="bookkeeping-reimbursement"><Checkbox id="expense-reimbursable" checked={draft.status !== 'unclaimed'} disabled={lockedFields} onCheckedChange={value => change({ status: value === true ? 'pending' : 'unclaimed' })} /><Label htmlFor="expense-reimbursable">这笔需要报销</Label><StatusBadge status={draft.status} /></div>
      {lockedFields && <Feedback>已提交或已到账的金额、币种、汇率、日期与用途保持原值，备注和票据仍可编辑。{formal && <Button type="button" variant="link" disabled={busy || !!model.pending || conflict || gone} onClick={() => model.confirm({ kind: 'status', status: 'pending', targets: [target(formal)] })}>退回待提交后修改</Button>}</Feedback>}
      <div><Label htmlFor="expense-note">备注（可选）</Label><Textarea id="expense-note" aria-invalid={issue?.field === 'note'} aria-describedby={issue?.field === 'note' ? 'expense-note-error' : undefined} rows={3} maxLength={5000} value={draft.note} onChange={e => change({ note: e.target.value })} />{fieldError('note')}</div>
      <div><Label htmlFor="expense-receipts">票据（可选）</Label><Input id="expense-receipts" aria-invalid={issue?.field === 'receipts'} aria-describedby={issue?.field === 'receipts' ? 'expense-receipts-error' : undefined} type="file" fileName={draft.files.map(item => item.file.name).join('、')} multiple accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" disabled={busy || !!model.pending || draft.files.length + draft.receipts.length >= 5} onChange={e => { model.addFiles(draftKey, Array.from(e.target.files ?? [])); e.target.value = ''; }} /><p className="subtle">图片或 PDF，每份不超过 5 MB，每笔最多 5 份。保存为副本，原文件保持原样。</p>
        {fieldError('receipts')}<ul className="bookkeeping-receipts">{draft.receipts.map(receipt => <li key={receipt.id}><Button type="button" variant="link" disabled={busy} onClick={() => void model.openReceipt(draft.id, receipt)}><Paperclip size={16} />{receipt.name}</Button><Button type="button" variant="ghost" size="sm" disabled={busy || !!model.pending} onClick={() => model.removeReceipt(draftKey, receipt.id)}>移除附件</Button></li>)}{draft.files.map(({ id, file }) => <li key={id}><span><Paperclip size={16} />{file.name} <small className="subtle">待保存</small></span><Button type="button" variant="ghost" size="sm" disabled={busy || !!model.pending} onClick={() => model.removeReceipt(draftKey, id)}>移除附件</Button></li>)}</ul>
      </div>
      <div className="bookkeeping-form-actions"><Button type="submit" className="bookkeeping-save" disabled={busy || !!rateState?.loading || !!model.pending || conflict || gone || !model.loaded || !!model.loadError} loading={!!(model.busy === 'save')} loadingText="正在保存…">保存</Button>{draftKey === 'new' && <Button type="button" variant="outline" disabled={busy || !!rateState?.loading || !!model.pending || conflict || gone || !model.loaded || !!model.loadError} onClick={() => void save(true)}>保存并继续</Button>}{embedded ? <Button type="button" variant="ghost" onClick={onClose}>关闭，保留草稿</Button> : <Button type="button" variant="ghost" asChild><UILink href="#bookkeeping">返回，保留草稿</UILink></Button>}</div>
    </form>}
    {!embedded && <Confirmation model={model} />}
  </section>;
}
