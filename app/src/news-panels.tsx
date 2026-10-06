import { EmptyState } from './components/ui/empty-state.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { StatusBadge } from './components/ui/status-badge.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Button } from './components/ui/button.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Input } from './components/ui/input.tsx';
import { FormDialog, useCreationDialog } from './components/ui/form-dialog.tsx';
import { useEffect, useRef } from 'react';
import { domainLabels, equalConfig, formatNewsTime, identityLabels, publicationLabel, statusLabels, usageLabels } from './news-contract.ts';
import type { CollectionRun, Domain, FeedEntry, NewsMaterial, NewsSource } from './news-contract.ts';
import type { NewsController } from './use-news.ts';
import { NewsRangeControl } from './news-range-control.tsx';
import {NewsResetControl} from './news-reset-control.tsx';
import {LoadingStatus} from './components/ui/loading-status.tsx';

function NewsFeedback({ model, loadingStatus = true }: { model: NewsController; loadingStatus?: boolean }) {
  return <div className="news-feedback" aria-live="polite">
    {model.loadError && <Feedback as="p" tone="error" className="form-error" role="alert">{model.loadError}</Feedback>}
    {model.error && <Feedback as="p" tone="error" className="form-error" role="alert">{model.error}</Feedback>}
    
    {loadingStatus && <LoadingStatus active={model.loading}>正在读取信源与采集记录，原列表保持可见…</LoadingStatus>}
    {model.collecting && <p className="meta" role="status">正在采集，切页不影响本轮任务；本轮使用开始时的配置版本。<Button variant="app-text" className="text-action" onClick={() => void model.cancelCapture()}>取消采集（保留已取得输入）</Button></p>}
  </div>;
}
function OriginalLink({ url, model, children = '打开原文 ↗' }: { url: string; model: NewsController; children?: string }) {
  return <UILink variant="text" className="foundation-link" href={url} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (model.connected) { event.preventDefault(); void model.openOriginal(url); }
  }}>{children}</UILink>;
}
function EntryBody({ entry, model }: { entry: FeedEntry | NewsMaterial; model: NewsController }) {
  return <>
    <h3 className="news-entry-title"><OriginalLink url={entry.url} model={model} children={entry.title} /></h3>
    <p className="news-publication meta">原发布时间：{publicationLabel(entry)}</p>
    {entry.summary ? <p className="news-summary">{entry.summary}{entry.summaryTruncated && <span className="meta">（订阅摘要节选）</span>}</p> : <p className="meta">信源未提供摘要，仅保留标题和原文链接。</p>}
    <div className="news-entry-footer"><span className="meta">仅订阅摘要 / 原文链接，不保存全文</span><OriginalLink url={entry.url} model={model} /></div>
  </>;
}
function RunResult({ run, model }: { run: CollectionRun; model: NewsController }) {
  const active = ['queued', 'fetching', 'parsing', 'saving'].includes(run.status);
  return <li className="news-run">
    <div className="news-run-main"><strong>{run.sourceName}</strong><StatusBadge className={`news-status${run.error ? ' bad-t' : ''}`}>{statusLabels[run.status]}</StatusBadge>
      <span className="meta">配置 v{run.sourceRevision} · {formatNewsTime(run.attemptedAt)}</span></div>
    {!active && <p className="meta">取得 {run.fetched} 条 · 新增 {run.added} 条 · 无效条目 {run.skipped} 条{run.finishedAt && ` · 结束 ${formatNewsTime(run.finishedAt)}`}</p>}
    {run.warning && <p className="warn-t s">{run.warning}</p>}
    {run.error && <Feedback as="p" tone="error" className="form-error s">{run.error}</Feedback>}
    {run.retryStage && <Button variant="app-text" className="text-action" disabled={model.collecting || !model.connected} onClick={() => void model.collect(null, run)}>
      {run.retryStage === 'fetch' ? '重试抓取' : run.retryStage === 'parse' ? '重试解析（使用保留响应）' : '重试保存（不重新抓取）'}
    </Button>}
    {run.status === 'interrupted' && !run.retryStage && <UILink variant="text" className="foundation-link" href="#settings/news">返回信源重新采集</UILink>}
  </li>;
}
export function NewsFeed({ model }: { model: NewsController }) {
  const failed = model.snapshot.runs.filter(run => ['fetchFailed', 'parseFailed', 'saveFailed', 'interrupted'].includes(run.status));
  return <section className="news-page">
    <div className="news-toolbar"><div><h2 className="title">采集资料</h2><p className="subtle">按下方范围查看原始采集资料；清空待处理后原始资料仍留存，已整理报道在资讯阅读页。</p></div>
      <div className="form-actions"><UILink variant="pill" className="pill" href="#settings/news">管理信源</UILink><UILink variant="pill" className="pill" href="#settings/news/processing">筛选 / 整理 / 清空待处理</UILink>
        <Button variant="app-pill" className="pill on" onClick={() => void model.collect()} disabled={!model.connected || model.collecting || !model.snapshot.sources.some(source => source.config.enabled)}>{model.collecting ? '正在采集…' : '手动采集'}</Button></div>
    </div>
    <NewsRangeControl collection value={model.collectionRange} onChange={model.setCollectionRange} disabled={model.collecting}/>
    <NewsResetControl model={model} disabled={model.collecting}/>
    <NewsFeedback model={model} loadingStatus={false}/>
    <div className="news-filter"><label htmlFor="news-source-filter">来源</label><NativeSelect variant="app" id="news-source-filter" className="select" value={model.filter} onChange={event => model.changeFilter(event.target.value)}>
      <option value="">全部信源</option>{model.snapshot.sources.map(source => <option key={source.config.id} value={source.config.id}>{source.config.name}{source.config.enabled ? '' : '（暂停）'}</option>)}
    </NativeSelect><span className="meta">{model.materials.total} 条已保存资料</span><Button variant="app-text" className="text-action" onClick={() => void model.refresh()} disabled={!model.connected || model.loading}>重新读取</Button></div>
    {model.materialError && <Feedback as="p" tone="error" className="form-error" role="alert">{model.materialError}</Feedback>}
    <LoadingStatus active={model.materialsLoading}>正在读取资料，原列表保持可见…</LoadingStatus>
    {!model.materials.items.length ? <EmptyState as="div" className="foundation-empty" aria-busy={model.materialsLoading}><h3>{model.materialsLoading ? '正在读取采集资料…' : model.filter ? '这个来源还没有保存资料' : '还没有采集资料'}</h3><p>手动采集已启用的信源后，真实标题、时间、摘要和出处会显示在这里。无模型不会生成假导读。</p>{model.filter && <Button variant="app-text" className="text-action" onClick={() => model.changeFilter('')}>查看全部来源</Button>}</EmptyState> : <>
      <ol className="news-materials">{model.materials.items.map(entry => <li key={entry.id} className="news-material">
        <div className="news-time-rail"><time dateTime={entry.discoveredAt}>{formatNewsTime(entry.discoveredAt)}</time><span>发现时间</span></div>
        <article className="news-entry"><header className="news-entry-source"><span>{entry.sourceName}</span><StatusBadge className="news-status">订阅原始资料</StatusBadge></header><EntryBody entry={entry} model={model} /></article>
      </li>)}</ol>
      <div className="news-pager"><Button variant="app-pill" className="pill" onClick={() => void model.readMaterials(model.filter, model.materials.page - 1)} disabled={model.materials.page === 0 || model.materialsLoading}>上一页</Button>
        <span className="meta">第 {model.materials.page + 1} / {Math.max(1, Math.ceil(model.materials.total / model.materials.pageSize))} 页 · 每页 {model.materials.pageSize} 条</span>
        <Button variant="app-pill" className="pill" onClick={() => void model.readMaterials(model.filter, model.materials.page + 1)} disabled={(model.materials.page + 1) * model.materials.pageSize >= model.materials.total || model.materialsLoading}>下一页</Button></div>
    </>}
    {failed.length > 0 && <Disclosure className="disclosure news-run-disclosure"><summary>最近采集中的失败 / 中断（{failed.length}）</summary><ul className="news-runs">{failed.map(run => <RunResult key={run.id} run={run} model={model} />)}</ul></Disclosure>}
    <p className="meta news-boundary">采集使用已保存的直连或手动 HTTP 代理配置，不自动读取系统代理。<UILink variant="text" className="foundation-link" href="#settings/news/automation">设置采集网络 →</UILink> 整理结果在资讯阅读入口查看；公开RSS不等于全文使用许可。</p>
  </section>;
}
export function NewsSettingsEntry() {
  return <section className="foundation-section news-settings-entry"><h2>资讯管理</h2><p className="subtle">管理公开 RSS / Atom 信源、预览订阅内容，以及查看手动采集结果。暂停保留历史资料。</p>
    <div className="check-actions"><UILink variant="pill" className="pill" href="#settings/news">管理信源与采集记录</UILink><span className="meta">领域规则、AI模型选择与自动运行配置在资讯管理中。</span></div></section>;
}
function SourceRow({ source, model }: { source: NewsSource; model: NewsController }) {
  const id = source.config.id;
  return <tr>
    <td data-label="信源"><UILink variant="text" className="news-source-name foundation-link" href={`#settings/news/sources/${id}`}>{source.config.name}</UILink><p className="meta">{source.feedKind ? source.feedKind.toUpperCase() : 'RSS / Atom（待解析）'} · 配置 v{source.revision}</p><p className="news-url meta">{source.config.feedUrl}</p></td>
    <td data-label="覆盖与用途"><p>{source.config.domains.length ? source.config.domains.map(domain => domainLabels[domain]).join('、') : '覆盖领域未设'}</p><p className="meta">{identityLabels[source.config.identity]} · {usageLabels[source.config.usage]}</p><p className="meta">采集频率 {source.config.intervalMinutes} 分钟</p></td>
    <td data-label="采集状态"><p>{source.lastStatus ? statusLabels[source.lastStatus] : '尚未采集'}</p><p className="meta">最近尝试：{formatNewsTime(source.lastAttemptAt)}</p><p className="meta">最近成功：{formatNewsTime(source.lastSuccessAt)}</p>{source.lastError && <Feedback as="p" tone="error" className="form-error s">{source.lastError}</Feedback>}</td>
    <td data-label="操作"><div className="news-source-actions"><StatusBadge className="news-status">{source.config.enabled ? '已启用' : '已暂停'}</StatusBadge>
      <Button variant="app-pill" className="pill" disabled={!model.connected || model.busy.includes(`save:${id}`) || !!model.pending[id]} onClick={() => void model.toggle(source)}>{source.config.enabled ? '暂停' : '启用'}</Button>
      <UILink variant="pill" className="pill" href={`#settings/news/sources/${id}`}>编辑 / 预览</UILink>
      <Button variant="app-text" className="text-action" disabled={!model.connected || model.collecting || !source.config.enabled} onClick={() => void model.collect(id)}>采集此源</Button>
      {model.drafts[id]?.dirty && <span className="meta">有未保存草稿</span>}{model.pending[id] && <UILink variant="text" className="foundation-link" href={`#settings/news/sources/${id}`}>核对上次保存</UILink>}
    </div>{model.errors[id] && <Feedback as="p" tone="error" className="form-error s" role="alert">{model.errors[id]}</Feedback>}</td>
  </tr>;
}
export function NewsSourceManager({ model, create = false }: { model: NewsController; create?: boolean }) {
  const creation = useCreationDialog(create);
  const submitted = useRef<{ session: number; id: string } | null>(null);
  function closeCreation(open: boolean) {
    creation.setOpen(open);
    if (!open && location.hash === '#settings/news/sources/new') location.hash = '#settings/news';
  }
  useEffect(() => { if (create) { model.startNew(); creation.setOpen(true); } }, [create]);
  useEffect(() => {
    const attempt = submitted.current;
    if (!attempt || model.busy.includes(`save:${attempt.id}`)) return;
    const draft = model.drafts[attempt.id];
    if (!model.errors[attempt.id] && !model.pending[attempt.id] && draft?.baseline !== null && draft && !draft.dirty && creation.session.current === attempt.session) closeCreation(false);
    submitted.current = null;
  }, [model.busy, model.drafts, model.errors, model.pending]);
  return <section className="news-page">
    <div className="news-toolbar"><div><UILink variant="text" className="foundation-link" href="#settings">← 返回设置</UILink><h2 className="title">信源管理</h2><p className="subtle">首批18个预置信源。保存的配置下次采集生效，暂停不删除历史。</p></div><div className="form-actions"><UILink variant="pill" className="pill" href="#settings/news/materials">查看采集资料</UILink><UILink variant="pill" className="pill" href="#settings/news/rules">领域与筛选</UILink><Button variant="app-pill" className="pill" data-create="source" onClick={() => { model.startNew(); creation.setOpen(true); }}>新增信源</Button>
      <Button variant="app-pill" className="pill on" onClick={() => void model.collect()} disabled={!model.connected || model.collecting || !model.snapshot.sources.some(source => source.config.enabled)}>{model.collecting ? '正在采集…' : '采集已启用信源'}</Button></div></div>
    <NewsRangeControl collection value={model.collectionRange} onChange={model.setCollectionRange} disabled={model.collecting}/>
    {!creation.open && <NewsFeedback model={model} />}
    <div className="news-management-summary"><span className="meta">{model.snapshot.sources.length} 个来源 · {model.snapshot.sources.filter(source => source.config.enabled).length} 个已启用</span><Button variant="app-text" className="text-action" disabled={!model.connected || model.loading} onClick={() => void model.refresh()}>重新读取</Button></div>
    <table className="table news-source-table"><caption className="news-table-caption">公开 RSS / Atom 信源</caption><thead><tr><th scope="col">信源</th><th scope="col">覆盖与用途</th><th scope="col">采集状态</th><th scope="col">启停与操作</th></tr></thead><tbody>{model.snapshot.sources.map(source => <SourceRow key={source.config.id} source={source} model={model} />)}</tbody></table>
    {!model.snapshot.sources.length && !model.loading && <EmptyState as="div" className="foundation-empty"><h3>信源尚未读取</h3><p>请选择本机数据目录并重新读取；不会用网页演示数据替代正式配置。</p></EmptyState>}
    <p className="meta news-boundary">身份是来源声明，不代表独立事实核验。覆盖领域不据来源名称猜测。自动采集需在运行规则中开启，默认暂停。</p>
    <section className="news-run-section"><h2 className="title">最近采集记录</h2><p className="meta">显示最近100条来源级记录。抓取、解析、保存失败分别处理；没有新增不等于失败。</p>
      {model.snapshot.runs.length ? <ul className="news-runs">{model.snapshot.runs.map(run => <RunResult key={run.id} run={run} model={model} />)}</ul> : <EmptyState as="div" className="foundation-empty"><h3>还没有采集记录</h3><p>预览不入资料库；执行手动采集后，这里才有正式记录。</p></EmptyState>}
    </section>
    <FormDialog open={creation.open} onOpenChange={closeCreation} title="新增信源" description="添加公开 RSS / Atom 订阅。新来源默认暂停，关闭保留草稿。" wide>
      <NewsSourceEditor model={model} sourceId="new" embedded onClose={() => closeCreation(false)} onSave={id => { submitted.current = { session: creation.session.current, id }; void model.saveSource(id); }} />
    </FormDialog>
  </section>;
}
export function NewsSourceEditor({ model, sourceId, embedded = false, onClose, onSave }: { model: NewsController; sourceId: string; embedded?: boolean; onClose?: () => void; onSave?: (id: string) => void }) {
  useEffect(() => {
    if (sourceId === 'new' && (!model.newId || !embedded && model.drafts[model.newId]?.baseline !== null)) model.startNew();
  }, [sourceId, model.newId, model.drafts, model.startNew, embedded]);
  const id = sourceId === 'new' ? model.newId : sourceId;
  const draft = id ? model.drafts[id] : null;
  if (!id || !draft) return <section className="news-page"><UILink variant="text" className="foundation-link" href="#settings/news">← 返回信源管理</UILink><EmptyState as="div" className="foundation-empty"><h2>{model.loading || sourceId === 'new' ? '正在读取信源…' : '没有找到这个信源'}</h2><p>{model.loadError || '请返回管理页重新读取，现有草稿不会被清空。'}</p></EmptyState></section>;
  const config = draft.config; const saved = model.snapshot.sources.find(source => source.config.id === id);
  const saving = model.busy.includes(`save:${id}`); const previewing = model.busy.includes(`preview:${id}`);
  const preview = model.previews[id]; const stalePreview = preview && (preview.config.feedUrl !== config.feedUrl.trim() || !equalConfig(preview.config, config));
  const conflict = saved && saved.revision !== draft.baseline;
  const changeDomain = (domain: Domain, enabled: boolean) => model.changeDraft(id, { domains: enabled ? [...config.domains, domain] : config.domains.filter(value => value !== domain) });
  return <section className="news-page news-source-editor">
    {!embedded && <div className="news-toolbar"><div><UILink variant="text" className="foundation-link" href="#settings/news">← 返回信源管理（保留草稿）</UILink><h2 className="title">{draft.baseline === null ? '新增信源' : config.name || '编辑信源'}</h2><p className="meta">{draft.baseline === null ? '新来源默认暂停，保存后再启用。' : `当前草稿基于配置 v${draft.baseline} · ${draft.dirty ? '有未保存改动' : '已保存'}`}</p></div><UILink variant="pill" className="pill" href="#settings/news/materials">查看采集资料</UILink><UILink variant="pill" className="pill" href="#settings/news/rules">领域与筛选</UILink></div>}
    {model.errors[id] && <Feedback as="p" tone="error" className="form-error" role="alert">{model.errors[id]}</Feedback>}
    {model.pending[id] && <Feedback as="div" tone="pending" className="pending-note"><p>上次保存结果尚未核对。草稿仍可编辑，但重试使用原请求；新改动不会覆盖原请求。</p><div className="form-actions"><Button variant="app-pill" className="pill" disabled={saving} onClick={() => void model.reconcile(id)}>核对保存结果</Button><Button variant="app-pill" className="pill" disabled={saving} onClick={() => void model.saveSource(id)}>重试原请求</Button></div></Feedback>}
    {conflict && !model.pending[id] && <Feedback as="div" tone="pending" className="pending-note"><p>正式配置已变为 v{saved.revision}，草稿保留。请对照后再保存，不会直接覆盖。</p><p className="meta">正式配置：{saved.config.name} · {saved.config.feedUrl} · {saved.config.enabled ? '启用' : '暂停'} · {identityLabels[saved.config.identity]} · {usageLabels[saved.config.usage]} · {saved.config.intervalMinutes} 分钟</p><Button variant="app-pill" className="pill" disabled={saving} onClick={() => model.useLatest(id)}>保留草稿，以最新版本重新核对</Button></Feedback>}
    <form className="entry-form news-source-form" onSubmit={event => { event.preventDefault(); if (onSave) onSave(id); else void model.saveSource(id); }}>
      <label htmlFor="source-name">名称</label><Input variant="app" id="source-name" className="input" value={config.name} onChange={event => model.changeDraft(id, { name: event.target.value })} maxLength={400} autoComplete="off" required />
      <label htmlFor="source-url">公开订阅地址</label><Input variant="app" id="source-url" className="input" type="url" value={config.feedUrl} onChange={event => model.changeDraft(id, { feedUrl: event.target.value })} placeholder="https://example.org/feed.xml" maxLength={4096} autoComplete="off" spellCheck={false} required /><p className="meta">仅公开 RSS / Atom，不支持登录、付费鉴权、网页抓取、JSON或本机/内网地址。使用已保存的采集网络配置，不读取浏览器Cookie或宿主认证。<UILink variant="text" className="foundation-link" href="#settings/news/automation">配置 HTTP 代理 →</UILink></p>
      <label htmlFor="source-identity">来源身份</label><NativeSelect variant="app" id="source-identity" className="select" value={config.identity} onChange={event => model.changeDraft(id, { identity: event.target.value as NewsSource['config']['identity'] })}>{Object.entries(identityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect>
      <fieldset className="news-domain-fields"><legend>覆盖领域（可多选，也可未设）</legend>{(Object.keys(domainLabels) as Domain[]).map(domain => <label className="choice" key={domain}><Input variant="inline" type="checkbox" checked={config.domains.includes(domain)} onChange={event => changeDomain(domain, event.target.checked)} />{domainLabels[domain]}</label>)}</fieldset>
      <label htmlFor="source-usage">参与用途</label><NativeSelect variant="app" id="source-usage" className="select" value={config.usage} onChange={event => model.changeDraft(id, { usage: event.target.value as NewsSource['config']['usage'] })}>{Object.entries(usageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect>
      {draft.baseline !== null ? <label className="choice news-enabled"><Input variant="inline" type="checkbox" checked={config.enabled} onChange={event => model.changeDraft(id, { enabled: event.target.checked })} />启用此来源（暂停保留历史）</label> : <p className="meta">首次保存为暂停，不立即采集；仅预览不会保存资料。</p>}
      <Disclosure className="disclosure"><summary>高级：采集频率</summary><label htmlFor="source-interval">间隔分钟</label><Input variant="app" id="source-interval" className="input" type="number" min={15} max={10080} step={1} value={config.intervalMinutes || ''} onChange={event => model.changeDraft(id, { intervalMinutes: Number(event.target.value) })} /><p className="meta">自动采集开启后按此频率执行；未开启时仅手动采集。</p></Disclosure>
      <div className="form-actions news-editor-actions"><Button variant="app-pill" className="pill on" type="submit" disabled={!model.connected || saving || !!model.pending[id] || !!conflict}>{saving ? '正在保存…' : '保存配置'}</Button><Button variant="app-pill" className="pill" type="button" disabled={!model.connected || previewing} onClick={() => void model.preview(id)}>{previewing ? '正在预览…' : '预览订阅（不入库）'}</Button>{embedded ? <Button type="button" variant="ghost" onClick={onClose}>关闭，保留草稿</Button> : <UILink variant="text" className="foundation-link" href="#settings/news">返回并保留草稿</UILink>}</div>
    </form>
    {preview && <section className="news-preview"><h2 className="title">订阅预览</h2><p className="meta">{preview.result.kind.toUpperCase()} · 取得 {preview.result.total} 条 · 显示前 {preview.result.entries.length} 条 · {formatNewsTime(preview.result.fetchedAt)} · 未入库</p>{stalePreview && <p className="warn-t s">表单已有新改动，这份预览对应上次请求，不代表当前草稿。</p>}{preview.result.warning && <p className="warn-t s">{preview.result.warning}</p>}
      {preview.result.entries.length ? <ol className="news-preview-list">{preview.result.entries.map((entry, index) => <li key={`${entry.url}:${index}`} className="news-entry"><EntryBody entry={entry} model={model} /></li>)}</ol> : <EmptyState as="div" className="foundation-empty"><h3>订阅解析正常，但目前没有条目</h3><p>预览未保存资料，不代表来源已采集或AI已处理。</p></EmptyState>}
    </section>}
    <NewsFeedback model={model} />
  </section>;
}
