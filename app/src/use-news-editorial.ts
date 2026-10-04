import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { equalEditorial, parseEditorialSnapshot, parseEvent, parsePreferences } from './news-editorial-contract.ts';
import type { Domain } from './news-contract.ts';
import type { EditorialConfig, EditorialSnapshot, Preferences, ReadingTab, SavePreferences } from './news-editorial-contract.ts';
import { workspaceError } from './workspace-contract.ts';
export function useNewsEditorial(root: string | null) {
  const connected = isTauri();
  const [snapshot, setSnapshot] = useState<EditorialSnapshot | null>(null); const snapshotRef = useRef(snapshot);
  const [draft, setDraft] = useState<Preferences | null>(null); const draftRef = useRef(draft);
  const [pending, setPending] = useState<SavePreferences | null>(null); const pendingRef = useRef(pending);
  const [tab, setTab] = useState<ReadingTab>('featured'); const [domain, setDomain] = useState<Domain | ''>('');
  const [editionId, setEditionId] = useState(''); const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(''); const busyRef = useRef('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loadError, setLoadError] = useState('');
  const [copyText, setCopyText] = useState(''); const reads = useRef(0); const loadedRoot = useRef<string | null>(null);
  function putDraft(p: Preferences) { draftRef.current = p; setDraft(p); }
  function putPending(p: SavePreferences | null) { pendingRef.current = p; setPending(p); }
  function acceptPreferences(p: Preferences, request?: SavePreferences) {
    const old = snapshotRef.current?.preferences;
    const latest = old && old.revision > p.revision ? old : p;
    if (snapshotRef.current) { snapshotRef.current = { ...snapshotRef.current, preferences: latest }; setSnapshot(snapshotRef.current); }
    const edited = draftRef.current;
    if (!edited || request && equalEditorial(edited.config, request.config) || !request && old && equalEditorial(edited.config, old.config) && !pendingRef.current) putDraft(structuredClone(latest));
    else if (request && edited.revision === request.expectedRevision) putDraft({ ...edited, revision: latest.revision });
  }
  function accept(s: EditorialSnapshot) {
    const old = snapshotRef.current; const p = old && old.preferences.revision > s.preferences.revision ? old.preferences : s.preferences;
    const edited = draftRef.current;
    if (!edited || old && equalEditorial(edited.config, old.preferences.config) && !pendingRef.current) putDraft(structuredClone(p));
    snapshotRef.current = { ...s, preferences: p }; setSnapshot(snapshotRef.current); setLoadError('');
  }
  async function refresh() { if (!connected || !root) return; const seq = ++reads.current; setLoading(true); try { const s = parseEditorialSnapshot(await invoke('news_editorial_snapshot')); if (seq === reads.current) accept(s); } catch (e) { if (seq === reads.current) setLoadError(workspaceError(e)); } finally { if (seq === reads.current) setLoading(false); } }
  useEffect(() => { if (root && loadedRoot.current !== root) { loadedRoot.current = root; void refresh(); } });
  useEffect(() => { if (!root || !connected) return; let disposed = false; let stop: (() => void) | undefined;
    void listen('news-editorial-changed', () => { if (!disposed) void refresh(); }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(e => { if (!disposed) setLoadError(workspaceError(e)); });
    return () => { disposed = true; stop?.(); }; }, [root, connected]);
  async function action(name: string, work: () => Promise<void>) { if (!connected || !root || busyRef.current) return; busyRef.current = name; setBusy(name); setError(''); setNotice(''); try { await work(); } catch (e) { setError(workspaceError(e)); } finally { busyRef.current = ''; setBusy(''); } }
  function changeConfig(config: EditorialConfig) { if (draftRef.current) putDraft({ ...draftRef.current, config }); }
  function rebase() { if (draftRef.current && snapshotRef.current && !pendingRef.current) { putDraft({ ...draftRef.current, revision: snapshotRef.current.preferences.revision }); setNotice('已对照最新配置版本，草稿保留；确认后保存。'); } }
  const save = () => action('save', async () => {
    if (!draftRef.current) return; const request = pendingRef.current ?? { requestId: crypto.randomUUID(), expectedRevision: draftRef.current.revision, config: structuredClone(draftRef.current.config) }; putPending(request);
    try { const p = parsePreferences(await invoke('save_news_preferences', { input: request })); ++reads.current; acceptPreferences(p, request); putPending(null); setNotice(`配置 v${p.revision} 已保存，下次任务生效；当前任务和旧刊保持原版本。`); }
    catch (e) { throw e; }
    await refresh();
  });
  const reconcile = () => action('save', async () => { const request = pendingRef.current; if (!request) return; const value = await invoke('news_preference_request', { requestId: request.requestId }); ++reads.current;
    if (value !== null) acceptPreferences(parsePreferences(value), request); putPending(null); setNotice(value !== null ? '已核对保存成功，后续手改仍保留。' : '已确认上次未保存，草稿保留，可以调整后保存。'); await refresh(); });
  const organize = (kind: 'organize' | 'daily' | 'analysis', runId?: string) => action(kind, async () => { try { await invoke(runId ? 'retry_news_editorial' : 'organize_news', runId ? { runId } : { requestId: crypto.randomUUID(), kind }); setNotice(kind === 'daily' ? '固定日报已保存为独立版本，可阅读、复制或导出整期。' : '整理完成，已有事件与出处可阅读。'); } finally { await refresh(); } });
  const analyze = (id: string, revision: number) => action('analysis', async () => { parseEvent(await invoke('analyze_news_event', { id, revision })); await refresh(); setNotice('事件分析已保存；判断与未验证项单独展示。'); });
  async function cancel() { try { await invoke('cancel_news_editorial'); setNotice('已请求取消；终态以任务记录为准，已完成结果保留。'); await refresh(); } catch (e) { setError(workspaceError(e)); } }
  const exportPdf = (id: string) => action('export', async () => { const path = await invoke<string | null>('export_news_edition', { id }); setNotice(path === null ? '已取消导出，刊期保留。' : `整期PDF已导出：${path}`); });
  const copy = (id: string) => action('copy', async () => { const text = await invoke<string>('news_edition_text', { id }); setCopyText(text); try { await navigator.clipboard.writeText(text); setNotice('已复制完整刊期，与所选版本及PDF内容一致。'); } catch { setNotice('剪贴板受限，完整刊期已展开，可手动全选复制。'); } });
  const active = !!busy && ['organize', 'daily', 'analysis'].includes(busy) || !!snapshot?.runs.some(r => ['running', 'saving'].includes(r.status));
  return { connected, snapshot, draft, pending, loading, busy, active, error, notice, loadError, tab, setTab, domain, setDomain, editionId, setEditionId, limit, setLimit, copyText, setCopyText, changeConfig, rebase, save, reconcile, refresh, organize, cancel, analyze, exportPdf, copy };
}
export type EditorialController = ReturnType<typeof useNewsEditorial>;
