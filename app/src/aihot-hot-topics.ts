import { useEffect, useSyncExternalStore } from 'react';

const ENDPOINT = 'https://aihot.news/api/v1/hot-topics';
const REFRESH_MS = 5 * 60_000;
export interface HotTopic { id:string; rank:number; title:string; url:string; source:string; sourceCount:number }
export interface HotTopicsState { items:HotTopic[]; loaded:boolean; loading:boolean; error:string; checkedAt:string }
const initial:HotTopicsState = {items:[],loaded:false,loading:false,error:'',checkedAt:''};
let state = initial, etag = '', nextRequestAt = 0, failures = 0, edgeFailures = 0;
let pending:Promise<void> | null = null;
const listeners = new Set<() => void>();
const snapshot = () => state;
function subscribe(listener:() => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function patch(value:Partial<HotTopicsState>) { state = {...state,...value}; listeners.forEach(listener => listener()); }
function record(value:unknown):Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AIHOT 返回的数据格式有变化。');
  return value as Record<string,unknown>;
}
export function parseHotTopics(value:unknown):HotTopic[] {
  const root = record(value);
  if (root.schemaVersion !== 1 || !Array.isArray(root.items) || root.items.length > 10 || root.count !== root.items.length) throw new Error('AIHOT 热点榜格式暂不支持。');
  const ids = new Set<string>(), ranks = new Set<number>();
  return root.items.map(raw => {
    const item = record(raw), links = record(item.links), source = record(item.source);
    if (typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || !item.title.trim() || typeof item.rank !== 'number' || !Number.isInteger(item.rank) || item.rank < 1 || item.rank > 10 || typeof source.name !== 'string' || typeof links.aihot !== 'string' || typeof item.sourceCount !== 'number' || !Number.isSafeInteger(item.sourceCount) || item.sourceCount < 0) throw new Error('AIHOT 热点条目不完整。');
    const url = new URL(links.aihot);
    if (url.origin !== 'https://aihot.news' || url.username || url.password || ids.has(item.id) || ranks.has(item.rank)) throw new Error('AIHOT 热点条目格式不正确。');
    ids.add(item.id); ranks.add(item.rank);
    return {id:item.id,rank:item.rank,title:item.title,url:url.href,source:source.name,sourceCount:item.sourceCount};
  }).sort((a,b) => a.rank-b.rank);
}

async function fetchTopics() {
  // Shared in-memory snapshot avoids duplicate calls when navigating or under StrictMode.
  if (Date.now() < nextRequestAt || document.visibilityState === 'hidden' || document.documentElement.dataset.uiPreview === 'true') return;
  nextRequestAt = Date.now() + 60_000;
  patch({loading:true});
  const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(),15_000);
  try {
    const response = await fetch(ENDPOINT,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-cache',signal:controller.signal,headers:etag?{'If-None-Match':etag}:{}});
    if (response.status === 304 && state.loaded) {
      failures=0; edgeFailures=0; nextRequestAt=Date.now()+REFRESH_MS;
      patch({error:'',checkedAt:new Date().toISOString()}); return;
    }
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const delay = retry ? /^\d+$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-Date.now() : 0;
      if (Number.isFinite(delay) && delay > 0) nextRequestAt=Math.max(nextRequestAt,Date.now()+delay);
      if ([566,567].includes(response.status) && ++edgeFailures > 1) nextRequestAt=Infinity;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) nextRequestAt=Infinity;
      throw new Error(response.status===429?'AIHOT 请求暂时受限，稍后自动重试。':`AIHOT 暂时无法读取（${response.status}）。`);
    }
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('AIHOT 返回内容过大，本次未更新。');
    const items = parseHotTopics(JSON.parse(text));
    etag=response.headers.get('ETag')??'';
    failures=0; edgeFailures=0; nextRequestAt=Date.now()+REFRESH_MS;
    patch({items,loaded:true,error:'',checkedAt:new Date().toISOString()});
  } catch (error) {
    failures++;
    nextRequestAt=Math.max(nextRequestAt,Date.now()+Math.min(30*60_000,60_000*2**Math.min(failures-1,5)));
    patch({error:error instanceof Error && error.name!=='AbortError' && !(error instanceof TypeError) ? error.message : '暂时无法连接 AIHOT，请检查网络。'});
  } finally { window.clearTimeout(timer); patch({loading:false}); }
}
function refresh() {
  if (!pending) pending=fetchTopics().finally(() => { pending=null; });
  return pending;
}
export function useHotTopics(enabled:boolean) {
  const value = useSyncExternalStore(subscribe,snapshot);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer=window.setInterval(() => { void refresh(); },60_000);
    const visible=() => { if (document.visibilityState==='visible') void refresh(); };
    document.addEventListener('visibilitychange',visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange',visible); };
  },[enabled]);
  return value;
}
