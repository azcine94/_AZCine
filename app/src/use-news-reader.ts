import {useEffect,useRef,useState} from 'react';
import {invoke,isTauri,listen} from './desktop-api.ts';
import {parseReader} from './news-reader-contract.ts';
import type {ReaderSnapshot,ReaderEdition} from './news-reader-contract.ts';
import {workspaceError} from './workspace-contract.ts';
export function useNewsReader(root:string|null,enabled=true){
  const [snapshot,setSnapshot]=useState<ReaderSnapshot|null>(null),[tab,setTab]=useState<'featured'|'all'|'hot'|'bookmarks'|'daily'>('all'),[category,setCategory]=useState(''),[query,setQuery]=useState(''),[limit,setLimit]=useState(100),[editionId,setEditionId]=useState('');
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');const seq=useRef(0),mounted=useRef(false),currentRoot=useRef(root),busyRef=useRef(false);currentRoot.current=root;
  const filters=useRef({tab,category,query,limit});filters.current={tab,category,query,limit};
  async function refresh(){if(!root||!isTauri())return;const request=++seq.current;const target=root;setLoading(true);const f=filters.current;try{const value=parseReader(await invoke('news_reader_snapshot',{...f,tab:f.tab==='daily'?'all':f.tab}));if(mounted.current&&request===seq.current&&currentRoot.current===target){setSnapshot(value);setError('');}}catch(e){if(mounted.current&&request===seq.current)setError(workspaceError(e));}finally{if(mounted.current&&request===seq.current)setLoading(false);}}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;seq.current++;};},[]);
  useEffect(()=>{seq.current++;setSnapshot(null);setError('');setNotice('');setEditionId('');setLoading(false);setBusy(false);busyRef.current=false;},[root]);
  useEffect(()=>{if(!enabled)return;const timer=window.setTimeout(()=>void refresh(),200);return()=>window.clearTimeout(timer);},[root,enabled,tab,category,query,limit]);
  useEffect(()=>{if(!root||!enabled||!isTauri())return;let disposed=false,off:(()=>void)|undefined;void listen('news-editorial-changed',()=>{if(!disposed)void refresh();}).then(stop=>{if(disposed)stop();else off=stop;}).catch(e=>{if(!disposed)setError(workspaceError(e));});return()=>{disposed=true;off?.();};},[root,enabled]);
  async function bookmark(id:string,value:boolean){const target=root;try{await invoke('news_reader_mark',{id,bookmarked:value,position:null});if(currentRoot.current===target)await refresh();}catch(e){if(currentRoot.current===target)setError(workspaceError(e));}}
  async function period(kind:'weekly'|'monthly'){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');const target=root;try{const edition=await invoke<ReaderEdition>('news_reader_period',{kind});if(currentRoot.current===target){setEditionId(edition.id);setTab('daily');setNotice('报告已保存；模型只编写总述，条目由规则选取。');await refresh();}}catch(e){if(currentRoot.current===target)setError(workspaceError(e));}finally{if(currentRoot.current===target){busyRef.current=false;setBusy(false);}}}
  return {snapshot,tab,setTab,category,setCategory,query,setQuery,limit,setLimit,editionId,setEditionId,loading,error,busy,notice,refresh,bookmark,period};
}
export type NewsReaderController=ReturnType<typeof useNewsReader>;
