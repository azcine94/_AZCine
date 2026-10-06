import { EmptyState } from './components/ui/empty-state.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { NewsRangeControl } from './news-range-control.tsx';
import {NewsResetControl,NewsHistoryControl} from './news-reset-control.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { useEffect, useState } from 'react';
import type { NewsController } from './use-news.ts';
import type { EditorialController } from './use-news-editorial.ts';
import type { NewsProcessingController } from './use-news-processing.ts';
import type { NewsMaterial } from './news-contract.ts';
import type { ProcessingProgress } from './news-processing-client.ts';
import { processingPhases } from './news-processing-client.ts';
import { formatNewsTime, publicationLabel } from './news-contract.ts';
import { editorialStatusLabels } from './news-editorial-contract.ts';
import {NewsReceiptPanel} from './news-reader-panels.tsx';
import {LoadingStatus} from './components/ui/loading-status.tsx';

function Inputs({ items, news }: { items: NewsMaterial[]; news: NewsController }) {
  return <ol className="processing-inputs">{items.map(item => <li key={item.id}>
    <strong>{item.title}</strong><p className="meta">{item.sourceName} · 原发布时间：{publicationLabel(item)}</p>
    <p>{item.summary || '订阅未提供摘要，仅有标题和链接。'}{item.summaryTruncated && '（摘要节选）'}</p>
    <UILink variant="text" className="foundation-link processing-url" href={item.url} target="_blank" rel="noopener noreferrer" onClick={event => { if (news.connected) { event.preventDefault(); void news.openOriginal(item.url); } }}>{item.url}</UILink>
    <p className="meta processing-url">资料 ID：{item.id}</p>
  </li>)}</ol>;
}

function Progress({ value, active, news }: { value: ProcessingProgress; active: boolean; news: NewsController }) {
  const [at, setAt] = useState(Date.now());
  useEffect(() => { setAt(Date.now()); if (!active) return; const timer = window.setInterval(() => setAt(Date.now()), 1000); return () => window.clearInterval(timer); }, [active, value.runId]);
  const elapsed = Math.max(0, Math.floor(((active ? at : Date.parse(value.updatedAt)) - Date.parse(value.startedAt)) / 1000));
  const recentSteps = value.steps.slice(-3);
  return <section id="news-processing-progress" className="processing-live" aria-label="处理过程">
    <div className="processing-phase" data-active={active} data-phase={value.phase}>
      <span className="processing-phase-dot" aria-hidden="true" /><div><h3 aria-live="polite">{value.phase === 'failed' && value.completed > 0 && value.completed === value.total ? '报道已保存，部分步骤未完成' : processingPhases[value.phase] ?? value.phase}</h3><p className="meta">{active ? '当前任务' : '最近一次任务'} · 最后更新 {formatNewsTime(value.updatedAt)}</p></div>
    </div>
    <progress max={Math.max(1, value.total)} value={value.completed} aria-label="已保存资料进度" />
    <dl className="processing-metrics">
      <div><dt>已保存资料</dt><dd>{value.completed}<span> / {value.total}</span></dd></div>
      <div><dt>当前批次</dt><dd>{value.batch}<span> / {value.batches}</span></dd></div>
      <div><dt>本次耗时</dt><dd>{elapsed}<span> 秒</span></dd></div>
      <div><dt>收到模型文本</dt><dd>{value.receivedChars}<span> 字符</span></dd></div>
    </dl>
    <div className="processing-model-line"><span>使用模型</span><strong>{value.model ? `${value.model.provider} / ${value.model.id}` : '尚未取得可用模型'}</strong><span>每批 {value.batchSize} 条</span></div>
    {value.error && <Feedback as="p" tone="error" className="form-error" role="alert">{value.error}</Feedback>}
    {value.phase === 'waitingModel' && <p className="meta">请求已被 Pi 接受，等待模型回答；当前调用最多等待180秒。</p>}
    {value.phase === 'thinking' && <p className="meta">模型已开始推理，尚未收到完整回答。</p>}
    {value.phase === 'connecting' && <p className="meta">正在准备资讯专用 Pi，尚未向模型提交资料。</p>}
    {recentSteps.length > 0 && <div className="processing-recent"><h4>最近进展</h4><ol className="processing-recent-steps">{recentSteps.map((step, index) => <li key={`${index}-${step.at}`}><span className="processing-step-dot" aria-hidden="true" /><span>{processingPhases[step.phase] ?? step.phase}</span><time dateTime={step.at}>{formatNewsTime(step.at)}</time></li>)}</ol></div>}
    <div className="processing-evidence">
      <Disclosure className="disclosure"><summary>本批实际输入 · {value.input.length} 条</summary><Inputs news={news} items={value.input} /></Disclosure>
      <Disclosure className="disclosure"><summary>模型原始返回 · {value.receivedChars} 字符</summary>
        {value.response ? <pre className="processing-code">{value.response}</pre> : <p className="subtle">尚未收到回答文本。</p>}
        {value.receivedChars > 20000 && <p className="meta">页面展示前20000字符；完整返回读取成功后留存在任务记录中。</p>}
      </Disclosure>
    </div>
    <Disclosure className="disclosure processing-technical"><summary>完整阶段与进程记录</summary><p className="meta">本任务登记的 Pi PID：{value.pid ?? '未取得'}。历史PID不代表进程仍在运行。</p><ol className="processing-steps">{value.steps.map((step, index) => <li key={`${index}-${step.at}`}><time>{formatNewsTime(step.at)}</time><span>{processingPhases[step.phase] ?? step.phase}</span></li>)}</ol></Disclosure>
  </section>;
}

export function NewsProcessingPanel({ model, news, processing }: { model: EditorialController; news: NewsController; processing: NewsProcessingController }) {
  const [retry, setRetry] = useState<string | null>(null);
  const [runLimit, setRunLimit] = useState(4);
  const [eventLimit, setEventLimit] = useState(6);
  const [tool, setTool] = useState<'daily' | 'analysis' | 'skill' | null>(null);
  const locked = !model.connected || !!model.busy || model.active || processing.clearing || news.collecting || news.reset.busy;
  const total = processing.pending.total;
  const selected = processing.selected;
  const detail = processing.detail;
  const runs = model.snapshot?.runs ?? [];
  const selectedRun = runs.find(run => run.id === processing.detailTarget?.id);
  const retryRun = runs.find(run => run.id === retry);
  const current = runs.find(run => ['running', 'saving'].includes(run.status));
  const trace = processing.progress;
  const visibleTrace = trace && (!current || trace.runId === current.id) ? trace : null;
  const selectedDone = !!selected && processing.scopeReady && !processing.rangeSnapshot?.ids.includes(selected.id);
  const events = (model.snapshot?.events ?? []).filter(event => event.draft.title.toLowerCase().includes(processing.eventQuery.toLowerCase()));
  const shownDetail = detail && processing.detailTarget && detail.runId === processing.detailTarget.id && (detail.batch === processing.detailTarget.batch || processing.detailLoading) ? detail : null;
  async function start(kind: 'organize' | 'daily') {
    if(kind==='organize'&&(!processing.scopeReady||!processing.rangeSnapshot))return;
    await model.organize(kind, undefined, { ...(kind==='organize'&&processing.rangeSnapshot?{filter:processing.rangeSnapshot.scope,expectedIds:processing.rangeSnapshot.ids}:{}),scope: kind === 'daily' ? 'all' : processing.scope, materialId: kind === 'daily' || processing.scope === 'all' ? null : selected?.id ?? null, batchSize: 1 });
    await processing.refresh(processing.pending.page);
    await processing.readProgress();
  }
  return <section className="settings-page news-processing">
    <header className="processing-page-header">
      <div><h2>处理与记录</h2><p className="subtle">选好资料，开始整理；过程与结果保留在这里。</p></div>
      <nav className="processing-page-links" aria-label="资讯管理"><UILink variant="plain" href="#settings/news/materials">采集资料</UILink><UILink variant="plain" href="#settings/news/ai">处理规则</UILink><UILink variant="plain" href="#news">查看资讯 ↗</UILink></nav>
    </header>
    <div className="news-feedback" aria-live="polite">
      {model.loadError && <Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback>}{model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.error}</Feedback>}
      <LoadingStatus active={model.loading}>正在读取，已有内容保留…</LoadingStatus>
      {news.error && <Feedback as="p" tone="error" className="form-error" role="alert">{news.error}</Feedback>}{processing.error && <Feedback as="p" tone="error" className="form-error" role="alert">{processing.error}</Feedback>}
    </div>

    <div className="processing-workbench">
      <section className="processing-picker" aria-labelledby="processing-select-title">
        <header className="processing-section-heading"><h3 id="processing-select-title">待处理资料 <span className="processing-count">{total}</span></h3><Button variant="app-text" className="text-action" disabled={!model.connected || processing.clearing || !!processing.clearRequest} aria-disabled={processing.loading} aria-busy={processing.loading} onClick={() => { if (!processing.loading) void processing.refresh(processing.pending.page); }}>刷新</Button></header>
        <div className="processing-scope-switch" role="group" aria-label="处理范围">
          <Button variant="app-scope" disabled={locked||!!processing.clearRequest} aria-pressed={processing.scope === 'single'} onClick={() => processing.setScope('single')}>选一条</Button>
          <Button variant="app-scope" disabled={locked||!!processing.clearRequest} aria-pressed={processing.scope === 'all'} onClick={() => processing.setScope('all')}>当前筛选全部</Button>
        </div>
        <NewsRangeControl value={processing.range} onChange={processing.setRange} disabled={locked||!!processing.clearRequest}/>
        <>
          <div className="processing-filters"><label>搜索<Input variant="app" className="input" value={processing.query} disabled={locked||!!processing.clearRequest} onChange={event => processing.setQuery(event.target.value)} maxLength={200} placeholder="标题或摘要关键词" /></label><label>信源<NativeSelect variant="app" className="select" value={processing.source} disabled={locked||!!processing.clearRequest} onChange={event => processing.setSource(event.target.value)}><option value="">全部信源</option>{news.snapshot.sources.map(source => <option key={source.config.id} value={source.config.id}>{source.config.name}</option>)}</NativeSelect></label></div>
          <ul className="processing-candidates">{processing.pending.items.map(item => <li key={item.id}><label className={`processing-candidate${processing.scope==='single'&&selected?.id === item.id ? ' selected' : ''}`}>{processing.scope==='single'&&<Input variant="inline" type="radio" name="processing-material" disabled={locked||!!processing.clearRequest} checked={selected?.id === item.id} onChange={() => processing.select(item)} />}<span className="processing-candidate-body"><strong title={item.title}>{item.title}</strong><span className="processing-candidate-meta"><span>{item.sourceName}</span><time dateTime={item.discoveredAt}>{formatNewsTime(item.discoveredAt)}</time></span></span></label></li>)}</ul>
          {!processing.pending.items.length && <EmptyState as="p" className="processing-empty subtle" aria-busy={processing.loading}>{processing.loading && !processing.dailyCount ? '正在读取待处理资料…' : '没有符合筛选的待处理资料。'}</EmptyState>}
          <div className="processing-picker-pagination"><span className="meta">每页 {processing.pending.pageSize} 条</span><div className="news-pager"><Button variant="app-pill" className="pill" disabled={processing.loading || processing.pending.page === 0} onClick={() => void processing.refresh(processing.pending.page - 1)}>上一页</Button><span className="meta">{processing.pending.page + 1} / {Math.max(1, Math.ceil(processing.pending.total / processing.pending.pageSize))}</span><Button variant="app-pill" className="pill" disabled={processing.loading || (processing.pending.page + 1) * processing.pending.pageSize >= processing.pending.total} onClick={() => void processing.refresh(processing.pending.page + 1)}>下一页</Button></div></div>
        </>
        <div className="processing-queue-actions"><Button variant="app-text" className="text-action" disabled={locked||processing.loading||!processing.scopeReady||!total||!!processing.clearRequest} onClick={processing.prepareClear}>清空当前范围待处理</Button><span className="meta">仅移出队列，资料与报道保留</span></div>
        {processing.clearRequest&&<section className="processing-clear-confirm" aria-label="确认清空待处理"><strong>清出已选范围的 {processing.clearRequest.ids.length} 条待处理资料？</strong><p className="meta">原始资料、去重记录和已整理报道保留；下次重复采集不会重新加入。此处清空不会调用模型。</p><div className="form-actions"><Button variant="app-pill" className="pill on" disabled={locked} onClick={()=>void processing.confirmClear()}>{processing.clearing?'正在清空…':'确认清空'}</Button><Button variant="app-pill" className="pill" disabled={processing.clearing} onClick={processing.cancelClear}>取消</Button></div></section>}
        
        <footer className="processing-picker-footer">
          <div className="processing-chosen"><span className="meta">{processing.scope === 'single' ? selectedDone ? '上次选择已处理，请选择新资料' : selected ? '本次选择 · 1 条' : '请选择一条资料' : `本次范围 · 当前筛选 ${total} 条`}</span>{processing.scope === 'single' && selected && <strong title={selected.title}>{selected.title}</strong>}{processing.scope === 'single' && selected && <Disclosure className="disclosure"><summary>查看原始资料</summary><Inputs news={news} items={[selected]} /></Disclosure>}</div>
          <Button variant="app-pill" className="pill on processing-start" disabled={locked || !processing.scopeReady || processing.loading || !!processing.clearRequest || (processing.scope === 'single' ? !selected || selectedDone : !total || model.loading)} onClick={() => void start('organize')}>{model.active ? '任务进行中' : processing.scope === 'single' ? selectedDone ? '已处理' : '开始整理' : `整理当前范围 ${total} 条`}</Button>
        </footer>
      </section>

      <section className="processing-monitor" aria-labelledby="processing-execution-title">
        <header className="processing-section-heading"><h3 id="processing-execution-title">{model.active ? '当前处理' : '处理状态'}</h3>{model.active && <Button variant="app-text" className="text-action" disabled={!model.connected} onClick={() => void model.cancel()}>取消任务</Button>}</header>
        {visibleTrace ? <Progress news={news} value={visibleTrace} active={model.active && visibleTrace.runId === current?.id} /> : <EmptyState as="div" className="processing-monitor-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg><h4>{model.active ? '任务正在运行' : '等待开始'}</h4><p className="subtle">{model.active ? '尚无可读取的阶段记录，保存数量以任务记录为准。' : '选择资料后点击开始，实际阶段与模型返回会显示在这里。'}</p></EmptyState>}
        {visibleTrace && <div className="processing-monitor-footer"><Button variant="app-text" className="text-action" onClick={() => { setRetry(null); void processing.inspect(visibleTrace.runId, Math.max(0, visibleTrace.batch - 1)); }}>查看本批记录 →</Button><UILink variant="plain" href="#news">阅读已整理资讯 ↗</UILink></div>}
      </section>
    </div>

    <NewsReceiptPanel runId={processing.detailTarget?.id??current?.id??null} active={model.active}/><section className="processing-history" aria-labelledby="processing-history-title">
      <header className="processing-section-heading"><h3 id="processing-history-title">处理记录</h3><span className="meta">输入、规则与返回按批保留</span><NewsHistoryControl model={news} disabled={locked} total={runs.filter(run=>!['running','saving'].includes(run.status)).length}/></header>
      <ul className="processing-records">{runs.slice(0, runLimit).map(run => <li className={`processing-record${processing.detailTarget?.id === run.id ? ' selected' : ''}`} key={run.id}>
        <Button variant="app-control" className="processing-record-open" aria-controls="news-processing-detail" aria-pressed={processing.detailTarget?.id === run.id} onClick={() => { setRetry(null); void processing.inspect(run.id); }}>
          <span className="processing-record-top"><strong>{run.kind === 'daily' ? '日报' : run.kind === 'analysis' ? '事件分析' : '资讯整理'}</strong><span className="processing-record-status" data-status={run.status}>{editorialStatusLabels[run.status]}</span></span><time className="meta" dateTime={run.startedAt}>{formatNewsTime(run.startedAt)}</time><span className="processing-record-bottom"><span>已保存 {run.processed} / {run.total}</span><span className="meta">详情 →</span></span>
        </Button>
        <div className="processing-record-actions"><Button variant="app-text" data-history-delete disabled={locked||!!news.reset.request||['running','saving'].includes(run.status)} onClick={()=>void news.reset.prepare(`history:${run.id}`)}>删除记录</Button>
        {['failed', 'awaitingModel', 'cancelled', 'interrupted'].includes(run.status) && <Button variant="app-text" className="text-action processing-record-retry" disabled={locked} onClick={() => { setRetry(run.id); void processing.inspect(run.id); }}>重试原任务…</Button>}</div>
      </li>)}</ul>
      {!runs.length && <p className="subtle">还没有处理记录。</p>}
      <div className="processing-history-footer">{runs.length > runLimit && <Button variant="app-text" className="text-action" onClick={() => setRunLimit(runLimit + 4)}>再显示 4 条记录</Button>}{processing.detailTarget && <Button variant="app-text" className="text-action" onClick={() => { document.getElementById('news-processing-detail')?.focus(); document.getElementById('news-processing-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>查看下方已展开的任务详情 ↓</Button>}</div>
    </section>

    {processing.detailTarget && <section id="news-processing-detail" tabIndex={-1} className="processing-card processing-detail" aria-labelledby="processing-detail-title">
      <header className="processing-heading"><div><h3 id="processing-detail-title">任务详情 · {selectedRun?.kind === 'daily' ? '日报' : selectedRun?.kind === 'analysis' ? '事件分析' : '资讯整理'}</h3><p className="meta processing-url">{processing.detailTarget.id}</p></div><UILink variant="action" className="text-action" href="#news">查看资讯 →</UILink></header>
      {selectedRun?.error && <Feedback as="p" tone="error" className="form-error" role="alert">{selectedRun.error}</Feedback>}
      <LoadingStatus active={processing.detailLoading}>正在读取这批记录…</LoadingStatus>
      {processing.detailError && <Feedback as="p" tone="error" className="form-error" role="alert">{processing.detailError}</Feedback>}
      {shownDetail && <>
        <div className="news-pager"><Button variant="app-pill" className="pill" disabled={processing.detailLoading || shownDetail.batch === 0} onClick={() => void processing.inspect(shownDetail.runId, shownDetail.batch - 1)}>上一批</Button><span className="meta">第 {shownDetail.batch + 1} / {Math.max(1, shownDetail.batches)} 批</span><Button variant="app-pill" className="pill" disabled={processing.detailLoading || shownDetail.batch + 1 >= shownDetail.batches} onClick={() => void processing.inspect(shownDetail.runId, shownDetail.batch + 1)}>下一批</Button><Button variant="app-text" className="text-action" disabled={processing.detailLoading} onClick={() => void processing.inspect(shownDetail.runId, shownDetail.batch)}>刷新本批</Button></div>
        <div className="processing-detail-grid">
          <section className="processing-detail-pane"><h4>输入与规则</h4><Inputs news={news} items={shownDetail.input} />{!shownDetail.input.length && <p className="subtle">这批没有留存的资料输入。</p>}
            <Disclosure className="disclosure"><summary>本任务规则 · v{shownDetail.configRevision}</summary><pre className="processing-code">{JSON.stringify(shownDetail.rules, null, 2)}</pre></Disclosure>
            {shownDetail.outputs.filter(output => output.name.includes('-prompt-')).map(output => <Disclosure className="disclosure" key={output.name}><summary>提交给模型的任务内容 · {output.name}</summary><pre className="processing-code">{output.text}</pre>{output.truncated && <p className="meta">超过20000字符，页面仅展示节选；完整记录保留。</p>}</Disclosure>)}
          </section>
          <section className="processing-detail-pane"><h4>模型返回与校验结果</h4><p className="meta">每批最多展示20份留存文本，单份最多20000字符；完整文件保留。</p>
            {shownDetail.outputs.filter(output => !output.name.includes('-prompt-')).map(output => <Disclosure className="disclosure" key={output.name}><summary>{output.name.includes('-review') ? '复判返回' : '模型返回'} · {output.name}</summary><pre className="processing-code">{output.text}</pre>{output.truncated && <p className="meta">超过20000字符，页面仅展示节选；完整记录保留。</p>}</Disclosure>)}
            {!shownDetail.outputs.some(output => !output.name.includes('-prompt-')) && <p className="subtle">这批没有已留存的原始返回。旧版任务仅留存通过校验的结果。</p>}
            <Disclosure className="disclosure"><summary>结构化结果与校验阶段</summary>{shownDetail.result ? <pre className="processing-code">{JSON.stringify(shownDetail.result, null, 2)}</pre> : <p className="subtle">尚未留存结构化结果。</p>}</Disclosure>
            {shownDetail.progress && <Disclosure className="disclosure"><summary>最后留存的阶段记录</summary><p className="meta">{formatNewsTime(shownDetail.progress.updatedAt)} · {processingPhases[shownDetail.progress.phase] ?? shownDetail.progress.phase}</p>{shownDetail.progress.response && <><p className="meta">最后留存的回答（可能未完成）</p><pre className="processing-code">{shownDetail.progress.response}</pre></>}<ol className="processing-steps">{shownDetail.progress.steps.map((step, index) => <li key={index}><time>{formatNewsTime(step.at)}</time><span>{processingPhases[step.phase] ?? step.phase}</span></li>)}</ol></Disclosure>}
          </section>
        </div>
      </>}
      {retryRun && retryRun.id === processing.detailTarget.id && <div className="processing-retry"><p>原任务共 {retryRun.total} 条，已保存 {retryRun.processed} 条。{retryRun.total > 1 && '只想试一条时，请在上方单条处理里选择资料。'}已保存结果优先复用，未完成的模型调用可能产生费用。</p><Button variant="app-pill" className="pill on" disabled={locked} onClick={() => { setRetry(null); void model.organize(retryRun.kind, retryRun.id); }}>重试原范围未完成部分</Button></div>}
    </section>}

    <NewsResetControl model={news} disabled={locked}/>
    <section className="processing-tools" aria-labelledby="processing-tools-title">
      <header className="processing-section-heading"><h3 id="processing-tools-title">其他处理</h3><div className="processing-tool-options" role="group" aria-label="其他处理方式">{([['daily', '生成日报'], ['analysis', '事件分析'], ['skill', 'AIHOT 处理规则']] as const).map(([name, label]) => <Button variant="app-control" key={name} aria-pressed={tool === name} aria-expanded={tool === name} aria-controls={tool === name ? 'processing-tool-content' : undefined} onClick={() => setTool(tool === name ? null : name)}>{label}<span aria-hidden="true">{tool === name ? ' −' : ' ＋'}</span></Button>)}</div></header>
      {tool && <div id="processing-tool-content" className="processing-tool-content">
        {tool === 'daily' && <><div><h4>生成日报</h4><p className="subtle">直接使用截止北京时间08:00前已完成的结果，按原版规则生成前一天08:00到当天08:00的固定刊期。本操作不调用模型。</p></div><div className="processing-daily-actions"><Button variant="app-pill" className="pill" disabled={locked} onClick={() => void start('daily')}>用已完成结果生成日报</Button></div></>}
        {tool === 'analysis' && <div className="processing-event-picker"><label className="processing-event-search">搜索已整理事件<Input variant="app" className="input" value={processing.eventQuery} maxLength={200} onChange={event => { processing.setEventQuery(event.target.value); setEventLimit(6); }} placeholder="事件标题关键词" /></label><ul className="processing-events">{events.slice(0, eventLimit).map(event => <li key={event.id}><UILink variant="plain" href={`#news/events/${event.id}`}>{event.draft.title}</UILink><Button variant="app-pill" className="pill" disabled={locked} onClick={() => void model.analyze(event.id, event.revision)}>{event.analysis ? '重新分析' : '分析此事件'}</Button></li>)}</ul>{events.length > eventLimit && <Button variant="app-text" className="text-action" onClick={() => setEventLimit(eventLimit + 6)}>再显示 6 个事件</Button>}{!events.length && <p className="subtle">没有符合条件的已整理事件。</p>}</div>}
        {tool === 'skill' && <><div><h4>AIHOT 原版规则</h4><p className="subtle">固定代码链路调用 Markdown 提示词，递归展开规则片段。预筛 → 两次独立评分 → 结构 → 理解或摘要 → 事件关系与增量 → 概览。没有由模型临时选择 Skill。</p><p className="meta">T1 60分 · T1.5 65分 · T2 76分；平均分超过50的未精选条目也走内容理解。失败不自动再次付费。</p></div><div className="processing-page-links"><UILink variant="plain" href="#settings/news/ai">步骤模型与请求额度 →</UILink><UILink variant="plain" href="#settings/news/domains">分类与信源等级 →</UILink></div></>}
      </div>}
    </section>
  </section>;
}
