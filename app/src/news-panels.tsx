import { useEffect } from 'react';
import { domainLabels, equalConfig, formatNewsTime, identityLabels, publicationLabel, statusLabels, usageLabels } from './news-contract.ts';
import type { CollectionRun, Domain, FeedEntry, NewsMaterial, NewsSource } from './news-contract.ts';
import type { NewsController } from './use-news.ts';

function NewsFeedback({ model }: { model: NewsController }) {
  return <div className="news-feedback" aria-live="polite">
    {model.loadError && <p className="form-error" role="alert">{model.loadError}</p>}
    {model.error && <p className="form-error" role="alert">{model.error}</p>}
    {model.notice && <p className="subtle" role="status">{model.notice}</p>}
    {model.loading && <p className="meta" role="status">正在读取信源与采集记录，原列表保持可见…</p>}
    {model.collecting && <p className="meta" role="status">正在采集，切页不影响本轮任务；本轮使用开始时的配置版本。<button className="text-action" onClick={() => void model.cancelCapture()}>取消采集（保留已取得输入）</button></p>}
  </div>;
}
function OriginalLink({ url, model, children = '打开原文 ↗' }: { url: string; model: NewsController; children?: string }) {
  return <a className="foundation-link" href={url} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (model.connected) { event.preventDefault(); void model.openOriginal(url); }
  }}>{children}</a>;
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
    <div className="news-run-main"><strong>{run.sourceName}</strong><span className={`news-status${run.error ? ' bad-t' : ''}`}>{statusLabels[run.status]}</span>
      <span className="meta">配置 v{run.sourceRevision} · {formatNewsTime(run.attemptedAt)}</span></div>
    {!active && <p className="meta">取得 {run.fetched} 条 · 新增 {run.added} 条 · 无效条目 {run.skipped} 条{run.finishedAt && ` · 结束 ${formatNewsTime(run.finishedAt)}`}</p>}
    {run.warning && <p className="warn-t s">{run.warning}</p>}
    {run.error && <p className="form-error s">{run.error}</p>}
    {run.retryStage && <button className="text-action" disabled={model.collecting || !model.connected} onClick={() => void model.collect(null, run)}>
      {run.retryStage === 'fetch' ? '重试抓取' : run.retryStage === 'parse' ? '重试解析（使用保留响应）' : '重试保存（不重新抓取）'}
    </button>}
    {run.status === 'interrupted' && !run.retryStage && <a className="foundation-link" href="#settings/news">返回信源重新采集</a>}
  </li>;
}
export function NewsFeed({ model }: { model: NewsController }) {
  const failed = model.snapshot.runs.filter(run => ['fetchFailed', 'parseFailed', 'saveFailed', 'interrupted'].includes(run.status));
  return <section className="news-page">
    <div className="news-toolbar"><div><h2 className="title">采集资料</h2><p className="subtle">保存订阅中的原始标题、时间与摘要；整理结果在资讯阅读页查看。</p></div>
      <div className="form-actions"><a className="pill" href="#settings/news">管理信源</a>
        <button className="pill on" onClick={() => void model.collect()} disabled={!model.connected || model.collecting || !model.snapshot.sources.some(source => source.config.enabled)}>{model.collecting ? '正在采集…' : '手动采集'}</button></div>
    </div>
    <NewsFeedback model={model} />
    <div className="news-filter"><label htmlFor="news-source-filter">来源</label><select id="news-source-filter" className="select" value={model.filter} onChange={event => model.changeFilter(event.target.value)}>
      <option value="">全部信源</option>{model.snapshot.sources.map(source => <option key={source.config.id} value={source.config.id}>{source.config.name}{source.config.enabled ? '' : '（暂停）'}</option>)}
    </select><span className="meta">{model.materials.total} 条已保存资料</span><button className="text-action" onClick={() => void model.refresh()} disabled={!model.connected || model.loading}>重新读取</button></div>
    {model.materialError && <p className="form-error" role="alert">{model.materialError}</p>}
    {model.materialsLoading && <p className="meta" role="status">正在读取资料，原列表保持可见…</p>}
    {!model.materials.items.length ? <div className="foundation-empty"><h3>{model.filter ? '这个来源还没有保存资料' : '还没有采集资料'}</h3><p>手动采集已启用的信源后，真实标题、时间、摘要和出处会显示在这里。无模型不会生成假导读。</p>{model.filter && <button className="text-action" onClick={() => model.changeFilter('')}>查看全部来源</button>}</div> : <>
      <ol className="news-materials">{model.materials.items.map(entry => <li key={entry.id} className="news-material">
        <div className="news-time-rail"><time dateTime={entry.discoveredAt}>{formatNewsTime(entry.discoveredAt)}</time><span>发现时间</span></div>
        <article className="news-entry"><header className="news-entry-source"><span>{entry.sourceName}</span><span className="news-status">订阅原始资料</span></header><EntryBody entry={entry} model={model} /></article>
      </li>)}</ol>
      <div className="news-pager"><button className="pill" onClick={() => void model.readMaterials(model.filter, model.materials.page - 1)} disabled={model.materials.page === 0 || model.materialsLoading}>上一页</button>
        <span className="meta">第 {model.materials.page + 1} / {Math.max(1, Math.ceil(model.materials.total / model.materials.pageSize))} 页 · 每页 {model.materials.pageSize} 条</span>
        <button className="pill" onClick={() => void model.readMaterials(model.filter, model.materials.page + 1)} disabled={(model.materials.page + 1) * model.materials.pageSize >= model.materials.total || model.materialsLoading}>下一页</button></div>
    </>}
    {failed.length > 0 && <details className="disclosure news-run-disclosure"><summary>最近采集中的失败 / 中断（{failed.length}）</summary><ul className="news-runs">{failed.map(run => <RunResult key={run.id} run={run} model={model} />)}</ul></details>}
    <p className="meta news-boundary">采集使用直连，不读取系统代理。整理结果在资讯阅读入口查看；公开RSS不等于全文使用许可。</p>
  </section>;
}
export function NewsSettingsEntry() {
  return <section className="foundation-section news-settings-entry"><h2>资讯管理</h2><p className="subtle">管理公开 RSS / Atom 信源、预览订阅内容，以及查看手动采集结果。暂停保留历史资料。</p>
    <div className="check-actions"><a className="pill" href="#settings/news">管理信源与采集记录</a><span className="meta">领域规则、AI模型选择与自动运行配置在资讯管理中。</span></div></section>;
}
function SourceRow({ source, model }: { source: NewsSource; model: NewsController }) {
  const id = source.config.id;
  return <tr>
    <td data-label="信源"><a className="news-source-name foundation-link" href={`#settings/news/sources/${id}`}>{source.config.name}</a><p className="meta">{source.feedKind ? source.feedKind.toUpperCase() : 'RSS / Atom（待解析）'} · 配置 v{source.revision}</p><p className="news-url meta">{source.config.feedUrl}</p></td>
    <td data-label="覆盖与用途"><p>{source.config.domains.length ? source.config.domains.map(domain => domainLabels[domain]).join('、') : '覆盖领域未设'}</p><p className="meta">{identityLabels[source.config.identity]} · {usageLabels[source.config.usage]}</p><p className="meta">采集频率 {source.config.intervalMinutes} 分钟</p></td>
    <td data-label="采集状态"><p>{source.lastStatus ? statusLabels[source.lastStatus] : '尚未采集'}</p><p className="meta">最近尝试：{formatNewsTime(source.lastAttemptAt)}</p><p className="meta">最近成功：{formatNewsTime(source.lastSuccessAt)}</p>{source.lastError && <p className="form-error s">{source.lastError}</p>}</td>
    <td data-label="操作"><div className="news-source-actions"><span className="news-status">{source.config.enabled ? '已启用' : '已暂停'}</span>
      <button className="pill" disabled={!model.connected || model.busy.includes(`save:${id}`) || !!model.pending[id]} onClick={() => void model.toggle(source)}>{source.config.enabled ? '暂停' : '启用'}</button>
      <a className="pill" href={`#settings/news/sources/${id}`}>编辑 / 预览</a>
      <button className="text-action" disabled={!model.connected || model.collecting || !source.config.enabled} onClick={() => void model.collect(id)}>采集此源</button>
      {model.drafts[id]?.dirty && <span className="meta">有未保存草稿</span>}{model.pending[id] && <a className="foundation-link" href={`#settings/news/sources/${id}`}>核对上次保存</a>}
    </div>{model.errors[id] && <p className="form-error s" role="alert">{model.errors[id]}</p>}{model.notices[id] && <p className="meta" role="status">{model.notices[id]}</p>}</td>
  </tr>;
}
export function NewsSourceManager({ model }: { model: NewsController }) {
  return <section className="news-page">
    <div className="news-toolbar"><div><a className="foundation-link" href="#settings">← 返回设置</a><h2 className="title">信源管理</h2><p className="subtle">首批18个预置信源。保存的配置下次采集生效，暂停不删除历史。</p></div><div className="form-actions"><a className="pill" href="#news/materials">查看采集资料</a><a className="pill" href="#settings/news/rules">领域 / AI / 运行设置</a><a className="pill" href="#settings/news/sources/new" onClick={() => model.startNew()}>新增信源</a>
      <button className="pill on" onClick={() => void model.collect()} disabled={!model.connected || model.collecting || !model.snapshot.sources.some(source => source.config.enabled)}>{model.collecting ? '正在采集…' : '采集已启用信源'}</button></div></div>
    <NewsFeedback model={model} />
    <div className="news-management-summary"><span className="meta">{model.snapshot.sources.length} 个来源 · {model.snapshot.sources.filter(source => source.config.enabled).length} 个已启用</span><button className="text-action" disabled={!model.connected || model.loading} onClick={() => void model.refresh()}>重新读取</button></div>
    <table className="table news-source-table"><caption className="news-table-caption">公开 RSS / Atom 信源</caption><thead><tr><th scope="col">信源</th><th scope="col">覆盖与用途</th><th scope="col">采集状态</th><th scope="col">启停与操作</th></tr></thead><tbody>{model.snapshot.sources.map(source => <SourceRow key={source.config.id} source={source} model={model} />)}</tbody></table>
    {!model.snapshot.sources.length && !model.loading && <div className="foundation-empty"><h3>信源尚未读取</h3><p>请选择本机数据目录并重新读取；不会用网页演示数据替代正式配置。</p></div>}
    <p className="meta news-boundary">身份是来源声明，不代表独立事实核验。覆盖领域不据来源名称猜测。自动采集需在运行规则中开启，默认暂停。</p>
    <section className="news-run-section"><h2 className="title">最近采集记录</h2><p className="meta">显示最近100条来源级记录。抓取、解析、保存失败分别处理；没有新增不等于失败。</p>
      {model.snapshot.runs.length ? <ul className="news-runs">{model.snapshot.runs.map(run => <RunResult key={run.id} run={run} model={model} />)}</ul> : <div className="foundation-empty"><h3>还没有采集记录</h3><p>预览不入资料库；执行手动采集后，这里才有正式记录。</p></div>}
    </section>
  </section>;
}
export function NewsSourceEditor({ model, sourceId }: { model: NewsController; sourceId: string }) {
  useEffect(() => {
    if (sourceId === 'new' && (!model.newId || model.drafts[model.newId]?.baseline !== null)) model.startNew();
  }, [sourceId, model.newId, model.drafts, model.startNew]);
  const id = sourceId === 'new' ? model.newId : sourceId;
  const draft = id ? model.drafts[id] : null;
  if (!id || !draft) return <section className="news-page"><a className="foundation-link" href="#settings/news">← 返回信源管理</a><div className="foundation-empty"><h2>{model.loading || sourceId === 'new' ? '正在读取信源…' : '没有找到这个信源'}</h2><p>{model.loadError || '请返回管理页重新读取，现有草稿不会被清空。'}</p></div></section>;
  const config = draft.config; const saved = model.snapshot.sources.find(source => source.config.id === id);
  const saving = model.busy.includes(`save:${id}`); const previewing = model.busy.includes(`preview:${id}`);
  const preview = model.previews[id]; const stalePreview = preview && (preview.config.feedUrl !== config.feedUrl.trim() || !equalConfig(preview.config, config));
  const conflict = saved && saved.revision !== draft.baseline;
  const changeDomain = (domain: Domain, enabled: boolean) => model.changeDraft(id, { domains: enabled ? [...config.domains, domain] : config.domains.filter(value => value !== domain) });
  return <section className="news-page news-source-editor">
    <div className="news-toolbar"><div><a className="foundation-link" href="#settings/news">← 返回信源管理（保留草稿）</a><h2 className="title">{draft.baseline === null ? '新增信源' : config.name || '编辑信源'}</h2><p className="meta">{draft.baseline === null ? '新来源默认暂停，保存后再启用。' : `当前草稿基于配置 v${draft.baseline} · ${draft.dirty ? '有未保存改动' : '已保存'}`}</p></div><a className="pill" href="#news/materials">查看采集资料</a><a className="pill" href="#settings/news/rules">领域 / AI / 运行设置</a></div>
    {model.errors[id] && <p className="form-error" role="alert">{model.errors[id]}</p>}{model.notices[id] && <p className="subtle news-editor-notice" role="status">{model.notices[id]}</p>}
    {model.pending[id] && <div className="pending-note"><p>上次保存结果尚未核对。草稿仍可编辑，但重试使用原请求；新改动不会覆盖原请求。</p><div className="form-actions"><button className="pill" disabled={saving} onClick={() => void model.reconcile(id)}>核对保存结果</button><button className="pill" disabled={saving} onClick={() => void model.saveSource(id)}>重试原请求</button></div></div>}
    {conflict && !model.pending[id] && <div className="pending-note"><p>正式配置已变为 v{saved.revision}，草稿保留。请对照后再保存，不会直接覆盖。</p><p className="meta">正式配置：{saved.config.name} · {saved.config.feedUrl} · {saved.config.enabled ? '启用' : '暂停'} · {identityLabels[saved.config.identity]} · {usageLabels[saved.config.usage]} · {saved.config.intervalMinutes} 分钟</p><button className="pill" disabled={saving} onClick={() => model.useLatest(id)}>保留草稿，以最新版本重新核对</button></div>}
    <form className="entry-form news-source-form" onSubmit={event => { event.preventDefault(); void model.saveSource(id); }}>
      <label htmlFor="source-name">名称</label><input id="source-name" className="input" value={config.name} onChange={event => model.changeDraft(id, { name: event.target.value })} maxLength={400} autoComplete="off" required />
      <label htmlFor="source-url">公开订阅地址</label><input id="source-url" className="input" type="url" value={config.feedUrl} onChange={event => model.changeDraft(id, { feedUrl: event.target.value })} placeholder="https://example.org/feed.xml" maxLength={4096} autoComplete="off" spellCheck={false} required /><p className="meta">仅公开 RSS / Atom，不支持登录、付费鉴权、网页抓取、JSON或本机/内网地址。当前仅直连，不读取系统代理、浏览器Cookie或宿主认证。</p>
      <label htmlFor="source-identity">来源身份</label><select id="source-identity" className="select" value={config.identity} onChange={event => model.changeDraft(id, { identity: event.target.value as NewsSource['config']['identity'] })}>{Object.entries(identityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <fieldset className="news-domain-fields"><legend>覆盖领域（可多选，也可未设）</legend>{(Object.keys(domainLabels) as Domain[]).map(domain => <label className="choice" key={domain}><input type="checkbox" checked={config.domains.includes(domain)} onChange={event => changeDomain(domain, event.target.checked)} />{domainLabels[domain]}</label>)}</fieldset>
      <label htmlFor="source-usage">参与用途</label><select id="source-usage" className="select" value={config.usage} onChange={event => model.changeDraft(id, { usage: event.target.value as NewsSource['config']['usage'] })}>{Object.entries(usageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {draft.baseline !== null ? <label className="choice news-enabled"><input type="checkbox" checked={config.enabled} onChange={event => model.changeDraft(id, { enabled: event.target.checked })} />启用此来源（暂停保留历史）</label> : <p className="meta">首次保存为暂停，不立即采集；仅预览不会保存资料。</p>}
      <details className="disclosure"><summary>高级：采集频率</summary><label htmlFor="source-interval">间隔分钟</label><input id="source-interval" className="input" type="number" min={15} max={10080} step={1} value={config.intervalMinutes || ''} onChange={event => model.changeDraft(id, { intervalMinutes: Number(event.target.value) })} /><p className="meta">自动采集开启后按此频率执行；未开启时仅手动采集。</p></details>
      <div className="form-actions news-editor-actions"><button className="pill on" type="submit" disabled={!model.connected || saving || !!model.pending[id] || !!conflict}>{saving ? '正在保存…' : '保存配置'}</button><button className="pill" type="button" disabled={!model.connected || previewing} onClick={() => void model.preview(id)}>{previewing ? '正在预览…' : '预览订阅（不入库）'}</button><a className="foundation-link" href="#settings/news">返回并保留草稿</a></div>
    </form>
    {preview && <section className="news-preview"><h2 className="title">订阅预览</h2><p className="meta">{preview.result.kind.toUpperCase()} · 取得 {preview.result.total} 条 · 显示前 {preview.result.entries.length} 条 · {formatNewsTime(preview.result.fetchedAt)} · 未入库</p>{stalePreview && <p className="warn-t s">表单已有新改动，这份预览对应上次请求，不代表当前草稿。</p>}{preview.result.warning && <p className="warn-t s">{preview.result.warning}</p>}
      {preview.result.entries.length ? <ol className="news-preview-list">{preview.result.entries.map((entry, index) => <li key={`${entry.url}:${index}`} className="news-entry"><EntryBody entry={entry} model={model} /></li>)}</ol> : <div className="foundation-empty"><h3>订阅解析正常，但目前没有条目</h3><p>预览未保存资料，不代表来源已采集或AI已处理。</p></div>}
    </section>}
    <NewsFeedback model={model} />
  </section>;
}
