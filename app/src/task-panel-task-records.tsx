import { FileText } from 'lucide-react';
import { Disclosure } from './components/ui/disclosure.tsx';
import { StatusBadge } from './components/ui/status-badge.tsx';
import { executionLabels, levelLabels } from './task-panel-contract.ts';
import type { Execution, PanelSnapshot, TaskEvidence, TaskView } from './task-panel-contract.ts';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const field = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const basename = (value: string) => value.replaceAll('\\', '/').split('/').pop() || value;
const dateLabel = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间未记录' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const newest = (a: TaskEvidence, b: TaskEvidence) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || b.createdAt.localeCompare(a.createdAt);
const checkName = (item: TaskEvidence) => { const detail = object(item.detail); return field(detail.command) || field(detail.name) || field(detail.description); };
const checkIdentity = (item: TaskEvidence) => { const d = object(item.detail); return field(d.checkId) || field(d.check_id) || field(d.id) || checkName(item); };
const originalPath = (item: TaskEvidence) => field(object(item.detail).originalPath) || item.path;

function recordTitle(item: TaskEvidence) {
  if (item.kind === 'check') return checkName(item) || '未注明名称的检查';
  if (item.kind === 'artifact') return basename(originalPath(item)) || '未注明名称的交付文件';
  if (item.kind === 'file_check') return '交付文件核对';
  if (item.kind === 'receipt') return '任务交付回执';
  return basename(originalPath(item)) || (({ acceptance: '验收记录', memory: '任务记忆' } as Record<string, string>)[item.kind] ?? '其他记录');
}

function recordSource(item: TaskEvidence) {
  return item.level === 'claim' ? 'Agent 回报' : item.level === 'user_confirmed' ? '本人已核对' : levelLabels[item.level];
}

function recordResult(item: TaskEvidence) {
  if (object(object(item.detail).validity).current === false) return '旧记录 · 需重新核对';
  if (item.kind === 'check' && item.level === 'claim' && item.status === 'passed') return '声称通过';
  return ({ passed: '通过', failed: '失败', not_run: '未运行', located: '文件已保存', mismatch: '文件不匹配', matched: '回执已接收', needs_review: '待核对', quarantined: '归属待核对', accepted: '已接受', rejected: '已退回' } as Record<string, string>)[item.status] || '结果待确认';
}

function RecordItem({ item, task }: { item: TaskEvidence; task: TaskView }) {
  const detail = object(item.detail), raw = object(detail.raw);
  const reason = field(detail.reason) || field(raw.reason) || (item.kind === 'receipt' ? field(raw.resume_summary) : '');
  const exitCode = detail.exitCode ?? detail.exit_code;
  const coverage = Array.isArray(detail.coverage) ? detail.coverage.filter((value): value is string => typeof value === 'string') : [];
  const errors = Array.isArray(detail.errors) ? detail.errors.filter((value): value is string => typeof value === 'string') : [];
  const remaining = Array.isArray(raw.remaining_items) ? raw.remaining_items : [];
  const changedFiles = Array.isArray(detail.actualChangedFiles) ? detail.actualChangedFiles.filter((value): value is string => typeof value === 'string') : [];
  const validity = object(detail.validity), stale = validity.current === false || item.taskRevision !== task.revision;
  const tone = stale ? 'warning' : ['failed', 'mismatch'].includes(item.status) ? 'error' : ['needs_review', 'quarantined'].includes(item.status) || item.level === 'claim' && item.status === 'passed' ? 'warning' : item.kind === 'check' && item.status === 'passed' && ['observed', 'user_confirmed'].includes(item.level) ? 'success' : 'neutral';
  return <div className="tp-task-record">
    <div className="tp-task-record-head"><FileText size={14} aria-hidden="true" /><strong title={recordTitle(item)}>{recordTitle(item)}</strong><StatusBadge tone={tone}>{recordResult(item)}</StatusBadge></div>
    <p className="tp-meta">{recordSource(item)} · {dateLabel(item.createdAt)}{item.taskRevision !== task.revision && ` · 旧修订 r${item.taskRevision}`}</p>
    {stale && <p className="tp-meta">{field(validity.reason) || '属于旧任务修订，不用于当前版本验收。'} · 原结果：{item.status === 'passed' ? '通过' : item.status === 'failed' ? '失败' : '详见原记录'}</p>}
    {reason && <p className="tp-task-record-description" title={reason}>{reason}</p>}
    <Disclosure><summary>查看详情{errors.length > 0 ? ` · ${errors.length} 项待核对` : remaining.length > 0 ? ` · ${remaining.length} 项待补做` : ''}</summary><div className="tp-task-record-details">
      {item.kind === 'artifact' && <p>原文件：<span className="tp-mono">{originalPath(item) || '未记录'}</span><br />内容尚需核对。</p>}
      {item.path && <p>保存位置：<span className="tp-mono">{item.path}</span></p>}
      {typeof exitCode === 'number' && <p>退出码：{exitCode}</p>}
      {coverage.length > 0 && <p>检查范围：{coverage.join('、')}</p>}
      {item.kind === 'file_check' && <p>实际改动：{changedFiles.length ? changedFiles.join('、') : '未记录文件改动'}</p>}
      {errors.length > 0 && <ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
      {remaining.length > 0 && <ul>{remaining.map((value, index) => <li key={index}>{field(value) || field(object(value).description) || field(object(value).reason) || field(object(value).title) || '未提供文字说明，详见原始记录'}</li>)}</ul>}
      <Disclosure><summary>原始记录</summary><pre className="tp-source">{JSON.stringify(item, null, 2)}</pre></Disclosure>
    </div></Disclosure>
  </div>;
}

function RecordList({ items, task }: { items: TaskEvidence[]; task: TaskView }) {
  return <div className="tp-task-record-list">{items.map(item => <RecordItem key={item.id} item={item} task={task} />)}</div>;
}

function RunSummary({ run, snapshot }: { run: Execution; snapshot: PanelSnapshot | null }) {
  const binding = snapshot?.bindings.find(item => item.id === run.bindingId && item.generation === run.bindingGeneration);
  return <div className="tp-task-run-summary"><p>第 {run.attempt} 次执行 · {executionLabels[run.state] || '状态待确认'}</p><p className="tp-meta">{dateLabel(run.createdAt)} · r{run.taskRevision}{binding && ` · ${binding.kind} · ${binding.paneId}`}</p><Disclosure><summary>执行原始记录</summary><pre className="tp-source">{JSON.stringify(run, null, 2)}</pre></Disclosure></div>;
}

export function TaskRecords({ task, snapshot }: { task: TaskView; snapshot: PanelSnapshot | null }) {
  const runs = (snapshot?.executions.filter(run => run.taskId === task.id) ?? []).sort((a, b) => b.attempt - a.attempt || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const currentRun = runs.find(run => run.taskRevision === task.revision && run.state !== 'superseded');
  const all = (snapshot?.evidence.filter(item => item.taskId === task.id) ?? []).sort(newest);
  const current: TaskEvidence[] = [], seen = new Set<string>();
  for (const item of all.filter(item => currentRun && item.executionId === currentRun.id && item.taskRevision === task.revision)) {
    // Only named records have a reliable identity; unnamed checks stay individually inspectable.
    const identity = item.kind === 'check' ? checkIdentity(item) : item.kind === 'artifact' ? originalPath(item) : item.kind;
    const key = identity ? JSON.stringify([item.kind, identity, item.level]) : item.id;
    if (!seen.has(key)) { seen.add(key); current.push(item); }
  }
  const ids = new Set(current.map(item => item.id)), history = all.filter(item => !ids.has(item.id));
  const checks = current.filter(item => item.kind === 'check' && checkName(item));
  const unnamedChecks = current.filter(item => item.kind === 'check' && !checkName(item));
  const delivery = current.filter(item => ['artifact', 'file_check', 'receipt'].includes(item.kind));
  const other = current.filter(item => !['check', 'artifact', 'file_check', 'receipt'].includes(item.kind));
  const oldRuns = runs.filter(run => run.id !== currentRun?.id);
  const historicalGroups = runs.filter(run => run.id !== currentRun?.id || history.some(item => item.executionId === run.id));
  const orphaned = history.filter(item => !runs.some(run => run.id === item.executionId));
  return <section id="tp-task-records" className="tp-task-records" aria-label="执行、检查与交付记录">
    <h3>执行与交付</h3>
    {currentRun ? <RunSummary run={currentRun} snapshot={snapshot} /> : <p className="tp-meta">当前任务修订尚无执行记录。</p>}
    {currentRun && <>
      <div><h4>技术检查</h4><RecordList items={checks} task={task} />{!checks.length && <p className="tp-meta">{unnamedChecks.length ? '回执未提供具体检查名称。' : '尚无技术检查记录。'}</p>}
        {unnamedChecks.length > 0 && <Disclosure><summary>未注明名称的检查 · {unnamedChecks.length} 条</summary><RecordList items={unnamedChecks} task={task} /></Disclosure>}
      </div>
      <div><h4>交付文件与回执</h4><RecordList items={delivery} task={task} />{!delivery.length && <p className="tp-meta">尚无交付文件或回执。</p>}</div>
      {other.length > 0 && <Disclosure><summary>其他记录 · {other.length} 条</summary><RecordList items={other} task={task} /></Disclosure>}
    </>}
    {(oldRuns.length > 0 || history.length > 0) && <Disclosure key={`${task.id}-history`}><summary>历史执行与记录 · {oldRuns.length} 次执行 / {history.length} 条记录</summary><div className="tp-task-record-history">
      {historicalGroups.map(run => <div key={run.id}>{run.id === currentRun?.id ? <h4>本次执行的较早记录</h4> : <RunSummary run={run} snapshot={snapshot} />}<RecordList items={history.filter(item => item.executionId === run.id)} task={task} /></div>)}
      {orphaned.length > 0 && <div><h4>未关联到已加载执行的记录</h4><RecordList items={orphaned} task={task} /></div>}
    </div></Disclosure>}
  </section>;
}
