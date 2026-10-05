// Page-independent source drafts, previews and immutable save requests.
import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { listen } from './desktop-api.ts';
import { equalConfig, normalizedConfig, parseFeedPreview, parseMaterialPage, parseNewsSnapshot, parseNewsSource, validateSource } from './news-contract.ts';
import type { CollectionRun, FeedPreview, MaterialPage, NewsSnapshot, NewsSource, SaveSourceRequest, SourceConfig } from './news-contract.ts';
import { workspaceError } from './workspace-contract.ts';
import { initialNewsRange, newsRangeRequest } from './news-scope.ts';
import {useNewsReset} from './use-news-reset.ts';

export interface SourceDraft { config: SourceConfig; baseline: number | null; dirty: boolean }
interface PreviewState { result: FeedPreview; config: SourceConfig }
const emptyPage: MaterialPage = { items: [], total: 0, page: 0, pageSize: 50 };
export function useNews(root: string | null) {
  const reset=useNewsReset(root);
  const [collectionRange,setCollectionRange]=useState(()=>initialNewsRange('day'));
  const collectionRangeRef=useRef(collectionRange);collectionRangeRef.current=collectionRange;
  useEffect(()=>{if(!root||!isTauri())return;let disposed=false,off:(()=>void)|undefined;void listen('news-data-reset',()=>{if(disposed)return;setPreviews({});setError('');setNotice('');setMaterialError('');}).then(stop=>{if(disposed)stop();else off=stop;}).catch(e=>{if(!disposed)setLoadError(workspaceError(e));});return()=>{disposed=true;off?.();};},[root]);
  const connected = isTauri();
  const [snapshot, setSnapshot] = useState<NewsSnapshot>({ sources: [], runs: [] });
  const snapshotRef = useRef(snapshot);
  const [materials, setMaterials] = useState<MaterialPage>(emptyPage);
  const [loading, setLoading] = useState(false);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [materialError, setMaterialError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [collecting, setCollecting] = useState(false);
  const collectingRef = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, SourceDraft>>({});
  const draftsRef = useRef(drafts);
  const [pending, setPending] = useState<Record<string, SaveSourceRequest>>({});
  const pendingRef = useRef(pending);
  const [busy, setBusy] = useState<string[]>([]);
  const busyRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [filter, setFilter] = useState('');
  const filterRef = useRef('');
  const [newId, setNewId] = useState<string | null>(null);
  const newIdRef = useRef<string | null>(null);
  const materialSequence = useRef(0);
  const readSequence = useRef(0);
  const loadedRoot = useRef<string | null>(null);
  const currentRoot = useRef(root); currentRoot.current = root;

  function putDraft(id: string, draft: SourceDraft) {
    draftsRef.current = { ...draftsRef.current, [id]: draft }; setDrafts(draftsRef.current);
  }
  function putPending(id: string, request: SaveSourceRequest | null) {
    const next = { ...pendingRef.current }; if (request) next[id] = request; else delete next[id];
    pendingRef.current = next; setPending(next);
  }
  function message(id: string, failure = '', success = '') {
    setErrors(previous => ({ ...previous, [id]: failure })); setNotices(previous => ({ ...previous, [id]: success }));
  }
  function acceptSnapshot(incoming: NewsSnapshot) {
    const incomingIds = new Set(incoming.sources.map(source => source.config.id));
    const next = { ...incoming, sources: [...incoming.sources.map(source => {
      const previous = snapshotRef.current.sources.find(item => item.config.id === source.config.id);
      return previous && previous.revision > source.revision ? previous : source;
    }), ...snapshotRef.current.sources.filter(source => !incomingIds.has(source.config.id))] };
    // Sources are paused rather than deleted. An older collection event must not hide a newly saved source.
    snapshotRef.current = next; setSnapshot(next); setLoadError('');
    const nextDrafts = { ...draftsRef.current };
    for (const source of next.sources) {
      if (!nextDrafts[source.config.id] || !nextDrafts[source.config.id].dirty && !pendingRef.current[source.config.id]) {
        nextDrafts[source.config.id] = { config: structuredClone(source.config), baseline: source.revision, dirty: false };
      }
    }
    draftsRef.current = nextDrafts; setDrafts(nextDrafts);
  }
  async function readSnapshot() {
    const sequence = ++readSequence.current;
    const next = parseNewsSnapshot(await invoke<unknown>('news_snapshot'));
    if (sequence === readSequence.current) acceptSnapshot(next);
    return next;
  }
  async function readMaterials(source = filterRef.current, page = 0) {
    const sequence = ++materialSequence.current; setMaterialsLoading(true);
    const target = currentRoot.current, range = collectionRangeRef.current;
    const current = () => sequence === materialSequence.current && target === currentRoot.current && source === filterRef.current && JSON.stringify(range) === JSON.stringify(collectionRangeRef.current);
    try {
      const next = parseMaterialPage(await invoke<unknown>('news_materials', { sourceId: source || null, page,range:newsRangeRequest(range) }));
      if (current()) { setMaterials(next); setMaterialError(''); }
    } catch (e) { if (current()) setMaterialError(workspaceError(e)); }
    finally { if (current()) setMaterialsLoading(false); }
  }
  async function refresh(includeMaterials = true) {
    if (!connected || !root) return;
    setLoading(true);
    try { await readSnapshot(); } catch (e) { setLoadError(workspaceError(e)); }
    finally { setLoading(false); }
    if (includeMaterials) await readMaterials(filterRef.current, materials.page);
  }
  useEffect(()=>{if(connected&&root){++materialSequence.current;void readMaterials(filterRef.current,0);}},[collectionRange,connected,root]);
  useEffect(() => {
    if (root && loadedRoot.current !== root) { loadedRoot.current = root; void refresh(false); }
  });
  useEffect(() => {
    if (!connected || !root) return;
    let disposed = false; let stop: (() => void) | undefined;
    void listen<unknown>('news-progress', event => {
      if (disposed) return;
      try {
        const next = parseNewsSnapshot(event.payload);
        const hasNewMaterials = next.runs.some(run => run.status === 'added' && snapshotRef.current.runs.find(previous => previous.id === run.id)?.status !== 'added');
        ++readSequence.current; acceptSnapshot(next);
        if (hasNewMaterials) void readMaterials(filterRef.current, 0);
      } catch (e) { setLoadError(workspaceError(e)); }
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(e => setLoadError(workspaceError(e)));
    return () => { disposed = true; stop?.(); };
  }, [connected, root]);

  async function action(key: string, work: () => Promise<void>) {
    if (!connected || !root || busyRef.current.has(key)) return;
    busyRef.current.add(key); setBusy([...busyRef.current]);
    try { await work(); } catch (e) { message(key.split(':').slice(1).join(':'), workspaceError(e)); }
    finally { busyRef.current.delete(key); setBusy([...busyRef.current]); }
  }
  function changeDraft(id: string, update: Partial<SourceConfig>) {
    const previous = draftsRef.current[id]; if (!previous) return;
    putDraft(id, { ...previous, config: { ...previous.config, ...update }, dirty: true });
  }
  function startNew() {
    if (newIdRef.current && draftsRef.current[newIdRef.current]?.baseline === null) return newIdRef.current;
    const id = crypto.randomUUID(); newIdRef.current = id;
    putDraft(id, { config: { id, name: '', feedUrl: '', identity: 'media', domains: [], usage: 'editorial', intervalMinutes: 120, enabled: false }, baseline: null, dirty: true });
    setNewId(id); return id;
  }
  function acceptSaved(saved: NewsSource, request: SaveSourceRequest) {
    if (saved.config.id !== request.source.id || !equalConfig(saved.config, request.source) || saved.revision !== (request.expectedRevision ?? 0) + 1) {
      throw new Error('保存回执不对应本次信源配置，草稿保留，请核对保存结果。');
    }
    const id = saved.config.id; const current = draftsRef.current[id];
    let matchesRequest = false;
    try { matchesRequest = !!current && equalConfig(normalizedConfig(current.config), request.source); } catch { /* A later invalid URL is still a draft, not a failed committed save. */ }
    const nextSources = snapshotRef.current.sources.filter(source => source.config.id !== id);
    // Preserve collection status until the following snapshot read.
    const old = snapshotRef.current.sources.find(source => source.config.id === id);
    ++readSequence.current;
    acceptSnapshot({ ...snapshotRef.current, sources: [...nextSources, { ...saved, feedKind: old?.feedKind ?? null, lastAttemptAt: old?.lastAttemptAt ?? null,
      lastSuccessAt: old?.lastSuccessAt ?? null, lastStatus: old?.lastStatus ?? null, lastError: old?.lastError ?? null }] });
    const latest = snapshotRef.current.sources.find(source => source.config.id === id)!;
    if (latest.revision > saved.revision && (!current || !current.dirty)) {
      // A delayed receipt for an old request must not roll back an already-read newer draft.
      putDraft(id, { config: structuredClone(latest.config), baseline: latest.revision, dirty: false });
    } else {
      putDraft(id, { config: !current || matchesRequest ? structuredClone(saved.config) : current.config,
        baseline: Math.max(current?.baseline ?? 0, saved.revision), dirty: latest.revision > saved.revision || !!current && !matchesRequest });
    }
    putPending(id, null);
    if (request.expectedRevision === null && window.location.hash === '#settings/news/sources/new') window.location.hash = `settings/news/sources/${id}`;
  }
  async function sendSave(id: string, request: SaveSourceRequest) {
    putPending(id, request);
    let value: unknown;
    try { value = await invoke<unknown>('save_news_source', { input: request }); }
    catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? e.code : null;
      if (typeof code === 'string' && ['invalid_news_source', 'unsupported_feed_url', 'duplicate_source_name', 'new_source_paused', 'stale_record'].includes(code)) {
        putPending(id, null);
        if (code === 'stale_record') { try { await readSnapshot(); } catch (readError) { setLoadError(workspaceError(readError)); } }
      }
      throw e;
    }
    const saved = parseNewsSource(value);
    acceptSaved(saved, request);
    const latest = snapshotRef.current.sources.find(source => source.config.id === id)!;
    message(id, '', `已核对本次保存配置 v${saved.revision}${latest.revision > saved.revision ? `，正式配置已更新为 v${latest.revision}，请对照核对` : '，下次采集生效'}；运行中任务与历史资料不变。${draftsRef.current[id]?.dirty ? '未保存草稿仍保留。' : ''}`);
    try { await readSnapshot(); } catch (e) { setLoadError(workspaceError(e)); }
  }
  const saveSource = (id: string) => action(`save:${id}`, async () => {
    message(id);
    const draft = draftsRef.current[id]; if (!draft) return;
    if (pendingRef.current[id]) { await sendSave(id, pendingRef.current[id]); return; }
    const problem = validateSource(draft.config, snapshotRef.current.sources); if (problem) throw new Error(problem);
    const request: SaveSourceRequest = { requestId: crypto.randomUUID(), expectedRevision: draft.baseline, source: normalizedConfig(draft.config) };
    await sendSave(id, request);
  });
  const reconcile = (id: string) => action(`save:${id}`, async () => {
    const request = pendingRef.current[id]; if (!request) return;
    const value = await invoke<unknown>('news_source_request', { requestId: request.requestId });
    if (value !== null) { acceptSaved(parseNewsSource(value), request); message(id, '', '已核对保存成功，没有重复保存；后续手改仍然保留。'); }
    else { putPending(id, null); message(id, '', '已确认这次请求未保存，草稿保留；可调整后重新保存。'); }
    await readSnapshot();
  });
  const preview = (id: string) => action(`preview:${id}`, async () => {
    message(id);
    const draft = draftsRef.current[id]; if (!draft) return;
    const problem = validateSource(draft.config, snapshotRef.current.sources); if (problem) throw new Error(problem);
    const config = normalizedConfig(draft.config);
    const result = parseFeedPreview(await invoke<unknown>('preview_news_source', { source: config }));
    setPreviews(previous => ({ ...previous, [id]: { result, config } }));
    message(id, '', '预览完成，仅核对订阅内容，没有入资料库或发布资讯。');
  });
  const toggle = (source: NewsSource) => action(`save:${source.config.id}`, async () => {
    const id = source.config.id; message(id);
    if (pendingRef.current[id]) throw new Error('上次保存结果待核对，请进入编辑页先核对保存。');
    if (draftsRef.current[id]?.dirty) throw new Error('这个来源还有未保存草稿，请进入编辑页保存后再切换启停。');
    const config = { ...source.config, enabled: !source.config.enabled };
    putDraft(id, { config: structuredClone(config), baseline: source.revision, dirty: true });
    await sendSave(id, { requestId: crypto.randomUUID(), expectedRevision: source.revision, source: config });
  });
  function useLatest(id: string) {
    if (pendingRef.current[id] || busyRef.current.has(`save:${id}`)) return;
    const latest = snapshotRef.current.sources.find(source => source.config.id === id); if (!latest || !draftsRef.current[id]) return;
    putDraft(id, { ...draftsRef.current[id], baseline: latest.revision, dirty: true });
    message(id, '', `已对照最新配置 v${latest.revision}；草稿未覆盖，确认后保存。`);
  }
  async function collect(sourceId: string | null = null, retryRun: CollectionRun | null = null) {
    if (!connected || !root || collectingRef.current) return;
    collectingRef.current = true; setCollecting(true); setError(''); setNotice('');
    try {
      const result = parseNewsSnapshot(await invoke<unknown>(retryRun ? 'retry_news_run' : 'collect_news', retryRun ? { runId: retryRun.id } : { requestId: crypto.randomUUID(), sourceId,range:newsRangeRequest(collectionRange) }));
      ++readSequence.current; acceptSnapshot(result);
      if (retryRun) {
        const run = result.runs.find(run => run.id === retryRun.id);
        if (run?.status === 'added' || run?.status === 'noNew') setNotice('重试成功，采集记录已更新；处理进度在资讯阅读页查看。');
        else if (run?.error) setError(`重试仍未完成：${run.error}`);
        else setNotice('重试请求已结束，请重新读取采集记录核对结果；未报告成功。');
      } else {
        const failures = result.runs.filter(run => ['fetchFailed', 'parseFailed', 'saveFailed', 'interrupted'].includes(run.status));
        setNotice(`本轮手动采集结束${failures.length ? '，最近记录仍有失败或中断，请展开查看原因并重试' : ''}；处理进度在资讯阅读页查看。`);
      }
    } catch (e) {
      setError(workspaceError(e));
      try { await readSnapshot(); } catch (readError) { setLoadError(workspaceError(readError)); }
    } finally {
      collectingRef.current = false; setCollecting(false); await readMaterials(filterRef.current, 0);
    }
  }
  function changeFilter(value: string) { filterRef.current = value; setFilter(value); void readMaterials(value, 0); }
  async function openOriginal(url: string) {
    if (!connected) { setError('网页预览未接桌面命令，请从项目根目录运行桌面版。'); return; }
    try { await invoke('open_news_url', { url }); } catch (e) { setError(workspaceError(e)); }
  }
  async function cancelCapture() { try { await invoke('cancel_news_capture'); setNotice('已请求取消，等待当前网络请求结束后保留输入；以采集记录的中断状态为准。'); } catch (e) { setError(workspaceError(e)); } }
  return { reset,cancelCapture, connected, snapshot, materials, loading:loading||Boolean(root&&loadedRoot.current!==root), materialsLoading:materialsLoading||Boolean(root&&loadedRoot.current!==root), loadError, materialError, error, notice, collecting,
    drafts, pending, busy, errors, notices, previews, filter, newId, refresh, readMaterials, changeFilter, changeDraft, startNew,
    saveSource, reconcile, preview, toggle, useLatest, collect, openOriginal,collectionRange,setCollectionRange };
}
export type NewsController = ReturnType<typeof useNews>;
