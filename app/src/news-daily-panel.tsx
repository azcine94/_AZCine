import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight, MoreHorizontal} from 'lucide-react';
import {Button} from './components/ui/button.tsx';
import {NativeSelect} from './components/ui/native-select.tsx';
import {UILink} from './components/ui/ui-link.tsx';
import {Disclosure} from './components/ui/disclosure.tsx';
import {EmptyState} from './components/ui/empty-state.tsx';
import {StatusBadge} from './components/ui/status-badge.tsx';
import {DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem} from './components/ui/dropdown-menu.tsx';
import {useOperationNotice} from './components/ui/operation-toast.tsx';
import {invoke, isTauri} from './desktop-api.ts';
import {workspaceError} from './workspace-contract.ts';
import {formatNewsTime} from './news-contract.ts';
import {dailyEditions, dailyCutoffDate, beijingDate, editionVersion} from './news-daily.ts';
import type {ReaderEdition} from './news-reader-contract.ts';
import type {NewsReaderController} from './use-news-reader.ts';
import type {EditorialController} from './use-news-editorial.ts';
import type {NewsController} from './use-news.ts';
import {ReaderLink} from './news-article-body.tsx';

export function NewsViewSelect({daily = false}: {daily?: boolean}) {
  return <NativeSelect variant="app" className="reader-view-select" aria-label="资讯阅读方式" value={daily ? 'daily' : 'all'}
    onChange={e => {location.hash = e.target.value === 'daily' ? 'news/daily' : 'news';}}>
    <option value="all">全部报道</option><option value="daily">日报</option>
  </NativeSelect>;
}

function reportText(e: ReaderEdition, version: number) {
  const brief = (a: ReaderEdition['main'][number]) => `## ${a.titleZh}\n\n${a.summaryZh}\n\n来源：${a.sourceName}${a.url ? ` ${a.url}` : ''}`;
  return [`# ${e.date} 日报 · 第 ${version} 版`, `收录窗口：${formatNewsTime(e.windowStart)} — ${formatNewsTime(e.windowEnd)}（北京时间）`,
    e.overview, ...e.main.map(brief), ...(e.flashes.length ? ['## 快讯', ...e.flashes.map(a => `- ${a.titleZh}（${a.sourceName}）${a.url ? ` ${a.url}` : ''}`)] : []),
    ...(e.gaps.length ? ['## 来源覆盖', ...e.gaps] : []), `${formatNewsTime(e.generatedAt)} 生成`].filter(Boolean).join('\n\n');
}

export function NewsDailyPanel({model, editorial, news, editionId}: {model: NewsReaderController; editorial: EditorialController; news: NewsController; editionId?: string}) {
  const [now, setNow] = useState(Date.now);
  const [operationError, setOperationError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [, notice] = useOperationNotice('');
  const mounted = useRef(true), routeRef = useRef(editionId);
  const page = useRef<HTMLElement>(null);
  routeRef.current = editionId;
  useEffect(() => {mounted.current = true; const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => {mounted.current = false; window.clearInterval(timer);};}, []);
  useEffect(() => {setAttempted(false); setOperationError('');}, [editionId]);
  const editions = dailyEditions(model.snapshot?.editions ?? []);
  const edition = editionId ? editions.find(e => e.id === editionId) : editions[0];
  useEffect(() => {
    if (!editionId && edition && document.documentElement.dataset.uiPreview !== 'true') location.replace(`#news/daily/${edition.id}`);
  }, [editionId, edition?.id]);
  useLayoutEffect(() => {
    const scroll = page.current?.closest('.workspace-scroll');
    if (!(scroll instanceof HTMLElement) || !edition) return;
    const key = `daily:${edition.id}`, positions = model.readingPositions.current;
    const save = () => {positions[key] = scroll.scrollTop;};
    const frame = window.requestAnimationFrame(() => {scroll.scrollTop = positions[key] ?? 0; scroll.addEventListener('scroll', save, {passive: true});});
    return () => {window.cancelAnimationFrame(frame); scroll.removeEventListener('scroll', save);};
  }, [edition?.id, model.readingPositions]);
  const dates = [...new Set(editions.map(e => e.date))];
  const versions = editions.filter(e => e.date === edition?.date);
  const dateIndex = dates.indexOf(edition?.date ?? '');
  const version = edition ? editionVersion(edition, editions) : 1;
  const cutoff = dailyCutoffDate(now), today = beijingDate(now);
  const currentEdition = editions.find(e => e.date === cutoff);
  const preferences = editorial.snapshot?.preferences.config;
  const runs = [...(editorial.snapshot?.runs ?? [])].filter(r => r.kind === 'daily').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const running = runs.find(r => ['running', 'saving'].includes(r.status));
  const latestRun = runs[0];
  const failed = latestRun && ['failed', 'cancelled', 'interrupted', 'awaitingModel', 'pendingMaterials'].includes(latestRun.status) ? latestRun : undefined;
  const failedDate = failed ? dailyCutoffDate(Date.parse(failed.startedAt)) : undefined;
  const generating = !!running || editorial.busy === 'daily';
  const locked = !editorial.connected || !editorial.snapshot || editorial.loading || editorial.active || !!editorial.busy || model.busy;
  const initialLoading = !model.snapshot && !model.error;
  const loadError = model.error || editorial.loadError;
  const localError = operationError || (attempted && editorial.error !== failed?.error ? editorial.error : '');
  const beforeSchedule = preferences && new Date(now + 8 * 3600000).toISOString().slice(11, 16) < preferences.dailyTime;
  const status = generating ? '正在生成' : failedDate === cutoff ? failed?.status === 'cancelled' ? '已取消生成' : '生成未完成' : currentEdition ? currentEdition.main.length + currentEdition.flashes.length ? '已生成' : '本期无入选报道' : preferences?.autoDaily ? beforeSchedule ? '等待定时生成' : editorial.active ? '等待当前任务结束' : '等待生成' : '尚未生成';
  function open(id: string) { model.setEditionId(id); location.hash = `news/daily/${id}`; }
  async function generate(runId?: string) {
    setOperationError(''); setAttempted(true);
    const startedOn = routeRef.current;
    const result = await editorial.organize('daily', runId, {scope: 'all', materialId: null, batchSize: 1});
    await model.refresh();
    if (mounted.current && routeRef.current === startedOn && result?.status === 'completed') open(result.id);
  }
  async function copy() {
    if (!edition) return;
    const selected = edition, label = `${edition.date} 日报 · 第 ${version} 版`;
    try {const text = document.documentElement.dataset.uiPreview === 'true' ? reportText(selected, version) : await invoke<string>('news_edition_text', {id: selected.id}); await navigator.clipboard.writeText(text); notice(`已复制 ${label}`);}
    catch {if (mounted.current) setOperationError(`未能复制 ${label}，可在正文中手动选择复制。`);}
  }
  async function exportEdition() {
    if (!edition || exporting) return;
    const selected = edition, label = `${edition.date} 日报 · 第 ${version} 版`;
    if (document.documentElement.dataset.uiPreview === 'true') {notice('UI 虚构场景：未导出文件。'); return;}
    setExporting(true); setOperationError('');
    try {const path = await invoke<string | null>('news_reader_export', {id: selected.id, kind: 'edition'}); notice(path ? `已导出 ${label}` : '已取消导出');}
    catch (error) {if (mounted.current) setOperationError(workspaceError(error));}
    finally {if (mounted.current) setExporting(false);}
  }
  const selectDate = (date: string) => {const target = editions.find(e => e.date === date); if (target) open(target.id);};
  return <section ref={page} className="reader-page reader-daily">
    <div className="reader-toolbar"><NewsViewSelect daily/><div className="daily-top-actions">
      <UILink variant="text" href="#settings/news/materials">采集资料</UILink>
      <UILink variant="text" href="#settings/news/processing">整理资料</UILink>
      <Button variant="app-pill" disabled={locked} onClick={() => void generate()} loading={generating} loadingText="正在生成…">{ currentEdition ? '重新生成当前刊期' : '生成当前刊期'}</Button>
    </div></div>
    <div className="daily-status" role="status" aria-live="polite">
      <div><StatusBadge tone={generating ? 'neutral' : failedDate === cutoff ? 'warning' : currentEdition?.main.length || currentEdition?.flashes.length ? 'success' : 'neutral'}>{initialLoading ? '正在读取日报' : status}</StatusBadge>
        <span className="meta">{cutoff} 刊期 · 截稿 08:00 · 北京时间{cutoff !== today ? '（今日尚未到截稿时间）' : ''}</span></div>
      <p className="meta">{preferences ? preferences.autoDaily ? `每天 ${preferences.dailyTime} 自动生成，应用需保持运行。` : '自动日报已关闭，可手动生成。' : '正在读取生成设置。'} 仅使用已整理结果，重新生成保留旧版。 <UILink variant="text" href="#settings/news/automation">生成设置</UILink></p>
      {failed && <div className="daily-failure"><p>{failedDate} 刊期生成未完成：{failed.error || '已有刊期保留。'}</p><Button variant="outline" size="sm" disabled={locked} onClick={() => void generate(failed.id)}>重试这次生成</Button></div>}
      {localError && <p className="form-error" role="alert">{localError}</p>}
      {loadError && <div className="daily-failure" role="alert"><p>{loadError}</p><Button variant="outline" size="sm" onClick={() => {void model.refresh(); void editorial.refresh();}}>重新读取</Button></div>}
    </div>
    <div className="daily-reading">
      {editions.length > 0 && <nav className="daily-navigation" aria-label="日报刊期">
        <div className="daily-date-navigation"><Button variant="ghost" size="icon-sm" aria-label="上一期" disabled={dateIndex < 0 || dateIndex >= dates.length - 1} onClick={() => selectDate(dates[dateIndex + 1])}><ChevronLeft/></Button>
          <NativeSelect variant="app" aria-label="选择日报日期" value={edition?.date ?? ''} onChange={e => selectDate(e.target.value)}>{!edition && <option value="">选择刊期</option>}{dates.map(date => <option key={date} value={date}>{date}</option>)}</NativeSelect>
          <Button variant="ghost" size="icon-sm" aria-label="下一期" disabled={dateIndex <= 0} onClick={() => selectDate(dates[dateIndex - 1])}><ChevronRight/></Button></div>
        <div className="daily-version-actions">{versions.length > 1 && <NativeSelect variant="app" aria-label="选择日报版本" value={edition?.id ?? ''} onChange={e => open(e.target.value)}>{versions.map((e, i) => <option key={e.id} value={e.id}>第 {versions.length - i} 版{i === 0 ? ' · 最新' : ''}</option>)}</NativeSelect>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="日报更多操作" disabled={!edition || exporting}><MoreHorizontal/></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copy()}>复制整期</DropdownMenuItem>
              <DropdownMenuItem disabled={!isTauri() && document.documentElement.dataset.uiPreview !== 'true'} onSelect={() => void exportEdition()}>导出 Markdown</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => {location.hash = 'settings/news/processing';}}>查看生成记录</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>}
      {edition ? <article className="daily-report">
        <header><p className="meta">AZCine 日报 · 第 {version} 版</p><h2>{edition.date}</h2><p className="daily-window">{formatNewsTime(edition.windowStart)} — {formatNewsTime(edition.windowEnd)} · 北京时间</p><p className="meta">{edition.main.length} 条重点 · {edition.flashes.length} 条快讯</p></header>
        {edition.overview && <p className="daily-overview">{edition.overview}</p>}
        {!edition.main.length && !edition.flashes.length && <EmptyState><h3>本期没有符合规则的报道</h3><p>已保存本期记录，没有凑数补稿。</p></EmptyState>}
        {edition.main.map((a, index) => <section className="daily-story" key={a.id}><p className="meta">{String(index + 1).padStart(2, '0')} · {a.sourceName}{a.followUp ? ' · 新进展' : ''}</p><h3><UILink variant="plain" href={`#news/items/${a.id}`}>{a.titleZh}</UILink></h3><p>{a.summaryZh}</p>
          <Disclosure className="daily-story-details"><summary>来源与选稿信息</summary><p>{a.sources != null && `${a.sources} 个独立信源`}{a.score != null && ` · 推荐评分 ${a.score}`}{a.fillIn && ' · 多来源补充'}</p>{a.url && <ReaderLink href={a.url} news={news}>阅读来源原文 ↗</ReaderLink>}{!!a.related?.length && <ul>{a.related.map(related => <li key={related.id}><UILink variant="text" href={`#news/items/${related.id}`}>{related.sourceName} · {related.titleZh}</UILink></li>)}</ul>}</Disclosure>
        </section>)}
        {edition.flashes.length > 0 && <section className="daily-flashes"><h3>快讯</h3><ul>{edition.flashes.map(a => <li key={a.id}><UILink variant="plain" href={`#news/items/${a.id}`}>{a.titleZh}</UILink><span className="meta">{a.sourceName}</span></li>)}</ul></section>}
        <Disclosure className="daily-coverage" open={!edition.main.length && !edition.flashes.length || undefined}><summary>本期选稿与来源覆盖{edition.gaps.length > 0 ? ` · ${edition.gaps.length} 个来源待检查` : ''}</summary>
          {edition.selection ? <><p>符合时间窗口的已整理报道 {edition.selection.readyInWindow} 篇；生成时仍待整理 {edition.selection.pendingAtGeneration} 篇；截稿后才整理完成 {edition.selection.afterCutoff} 篇。</p><p>排除来源报道 {edition.selection.excludedArticles} 篇；未达选稿条件 {edition.selection.belowSelectionStories} 个事件；七日内重复进展 {edition.selection.repeatedStories} 个事件。</p></> : <p>这一旧版未保存选稿统计，无法还原当时的缺稿数量。</p>}
          {edition.gaps.length > 0 && <ul>{edition.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
          <p>主稿最多 12 条，每个来源最多 2 条；快讯最多 10 条。同一进展七日内去重。刊期保存后不随资讯库变化。</p>
          <UILink variant="text" href="#settings/news/processing">检查待整理资料 →</UILink>
        </Disclosure>
        <footer className="meta">{formatNewsTime(edition.generatedAt)} 生成 · 已保存的固定刊期</footer>
      </article> : !initialLoading && !model.error ? <EmptyState className="daily-empty"><h2>{editionId ? '未找到这期日报' : '还没有日报'}</h2><p>{editionId ? '选择其他日期查看，原有刊期不会被替换。' : '完成资讯整理后，点击“生成当前刊期”。'}</p><UILink variant="text" href="#settings/news/processing">前往整理资料 →</UILink></EmptyState> : initialLoading ? <p className="daily-empty meta">正在读取已保存刊期…</p> : null}
    </div>
  </section>;
}
