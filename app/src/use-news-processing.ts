import { useOperationNotice } from './components/ui/operation-toast.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from './desktop-api.ts';
import { invoke, isTauri } from './desktop-api.ts';
import type { MaterialPage, NewsMaterial } from './news-contract.ts';
import { parsePendingPage, parseProgress, parseTaskDetail } from './news-processing-client.ts';
import type { ProcessingProgress, TaskDetail } from './news-processing-client.ts';
import { workspaceError } from './workspace-contract.ts';
import { initialNewsRange, newsRangeRequest } from './news-scope.ts';
import type { FrozenNewsScope } from './news-scope.ts';
export function useNewsProcessing(root:string|null,enabled:boolean,active:boolean){
  const [pending,setPending]=useState<MaterialPage>({items:[],total:0,page:0,pageSize:6});
  const [query,setQuery]=useState(''),[source,setSource]=useState(''),[selected,setSelected]=useState<NewsMaterial|null>(null);
  const [scope,setScope]=useState<'single'|'all'>('single'),[batchSize,setBatchSize]=useState(1);
  const [range,setRange]=useState(()=>initialNewsRange('latest'));
  const [rangeSnapshot,setRangeSnapshot]=useState<{scope:FrozenNewsScope;ids:string[];key:string}|null>(null);
  const [clearRequest,setClearRequest]=useState<{scope:FrozenNewsScope;ids:string[];requestId:string}|null>(null);
  const [clearing,setClearing]=useState(false),[clearNotice,setClearNotice]=useOperationNotice('');
  const clearingRef=useRef(false);
  const [dailyCount,setDailyCount]=useState<{total:number;at:string}|null>(null);
  const [eventQuery,setEventQuery]=useState('');
  const [progress,setProgress]=useState<ProcessingProgress|null>(null),[detail,setDetail]=useState<TaskDetail|null>(null);
  const [error,setError]=useState(''),[detailError,setDetailError]=useState(''),[loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false);
  const [detailTarget,setDetailTarget]=useState<{id:string;batch:number}|null>(null);
  const detailTargetRef=useRef(detailTarget);detailTargetRef.current=detailTarget;
  const mounted=useRef(false),rootRef=useRef(root),readSeq=useRef(0),detailSeq=useRef(0),pulling=useRef(false),again=useRef(false);
  const filters=useRef({query,source,range});filters.current={query,source,range};rootRef.current=root;
  const previousQuery=useRef(query);
  const refresh=useCallback(async(page=0)=>{const target=rootRef.current;if(!target||!isTauri())return;const seq=++readSeq.current;const filter={...filters.current};setLoading(true);setError('');
    setRangeSnapshot(null);
    const current=()=>mounted.current&&seq===readSeq.current&&rootRef.current===target&&JSON.stringify(filters.current)===JSON.stringify(filter);
    try{const value=parsePendingPage(await invoke('news_pending_materials',{page,sourceId:filter.source||null,query:filter.query,range:newsRangeRequest(filter.range)}));if(current()){setPending(value.page);setDailyCount({total:value.dailyTotal,at:value.at});setRangeSnapshot(value.scope?{scope:value.scope,ids:value.ids,key:JSON.stringify(filter)}:null);}}
    catch(e){if(current())setError(workspaceError(e));}finally{if(current())setLoading(false);}
  },[]);
  const scopeReady=rangeSnapshot?.key===JSON.stringify({query,source,range});
  function prepareClear(){if(scopeReady&&rangeSnapshot&&rangeSnapshot.ids.length&&!active&&!clearing){setClearNotice('');setClearRequest({scope:rangeSnapshot.scope,ids:[...rangeSnapshot.ids],requestId:crypto.randomUUID()});}}
  async function confirmClear(){const target=rootRef.current,request=clearRequest;if(!target||!request||clearingRef.current||active)return;clearingRef.current=true;setClearing(true);setError('');
    try{const total=await invoke<number>('news_dismiss_pending',request);if(mounted.current&&rootRef.current===target){setClearRequest(null);setSelected(null);setClearNotice(`已清出 ${total} 条待处理资料；原始资料、去重记录和已整理报道保留。`);await refresh();}}
    catch(e){if(mounted.current&&rootRef.current===target)setError(workspaceError(e));}finally{clearingRef.current=false;if(mounted.current&&rootRef.current===target)setClearing(false);}
  }
  const readProgress=useCallback(async()=>{if(!rootRef.current||!isTauri())return;if(pulling.current){again.current=true;return;}pulling.current=true;
    try{do{again.current=false;const target:string|null=rootRef.current;const value=parseProgress(await invoke('news_processing_snapshot'));if(mounted.current&&rootRef.current===target)setProgress(value);}while(again.current&&mounted.current);}
    catch(e){if(mounted.current)setError(workspaceError(e));}finally{pulling.current=false;}
  },[]);
  async function inspect(id:string,batch=0){const target=rootRef.current;if(!target||!isTauri())return;const seq=++detailSeq.current;setDetailTarget({id,batch});setDetailLoading(true);setDetailError('');
    try{const value=parseTaskDetail(await invoke('news_task_detail',{id,batch}));if(mounted.current&&seq===detailSeq.current&&rootRef.current===target)setDetail(value);}catch(e){if(mounted.current&&seq===detailSeq.current&&rootRef.current===target){setDetail(null);setDetailError(workspaceError(e));}}finally{if(mounted.current&&seq===detailSeq.current)setDetailLoading(false);}
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readSeq.current++;detailSeq.current++;};},[]);
  useEffect(()=>{readSeq.current++;detailSeq.current++;setLoading(false);setDetailLoading(false);setSelected(null);setScope('single');setBatchSize(1);setDailyCount(null);setDetail(null);setDetailTarget(null);setProgress(null);setError('');setDetailError('');setPending({items:[],total:0,page:0,pageSize:6});setRange(initialNewsRange('latest'));setRangeSnapshot(null);setClearRequest(null);setClearing(false);setClearNotice('');},[root]);
  useEffect(()=>{setSelected(null);},[root,enabled,query,source,range]);
  useEffect(()=>{readSeq.current++;const typing=previousQuery.current!==query;previousQuery.current=query;if(!enabled||!root){setLoading(false);return;}setLoading(true);const timer=window.setTimeout(()=>void refresh(),typing?250:0);return()=>{window.clearTimeout(timer);readSeq.current++;};},[root,enabled,query,source,range,active,refresh]);
  useEffect(()=>{if(!enabled||!root||!isTauri())return;let disposed=false;let off:(()=>void)|undefined;
    void listen('news-processing-changed',()=>{if(!disposed)void readProgress();}).then(stop=>{if(disposed)stop();else off=stop;}).catch(e=>{if(!disposed)setError(workspaceError(e));});void readProgress();
    const timer=active?window.setInterval(()=>void readProgress(),1000):undefined;
    return()=>{disposed=true;off?.();if(timer)window.clearInterval(timer);};
  },[root,enabled,active,readProgress]);
  useEffect(()=>{if(!root||!isTauri())return;let disposed=false,off:(()=>void)|undefined;
    void listen('news-data-reset',()=>{if(disposed)return;readSeq.current++;detailSeq.current++;setSelected(null);setProgress(null);setDetail(null);setDetailTarget(null);setDetailError('');setError('');setRangeSnapshot(null);setClearRequest(null);setClearNotice('');setDetailLoading(false);if(enabled)void refresh();}).then(stop=>{if(disposed)stop();else off=stop;}).catch(e=>{if(!disposed)setError(workspaceError(e));});
    return()=>{disposed=true;off?.();};
  },[root,enabled,refresh]);
  useEffect(()=>{if(!root||!isTauri())return;let disposed=false,off:(()=>void)|undefined;
    void listen<string|null>('news-history-changed',event=>{if(disposed)return;const id=event.payload;
      if(id===null||detailTargetRef.current?.id===id){detailSeq.current++;setDetail(null);setDetailTarget(null);setDetailError('');setDetailLoading(false);}
      setProgress(before=>id===null||before?.runId===id?null:before);
    }).then(stop=>{if(disposed)stop();else off=stop;}).catch(e=>{if(!disposed)setError(workspaceError(e));});
    return()=>{disposed=true;off?.();};
  },[root]);
  return {pending,query,setQuery,source,setSource,selected,select:setSelected,scope,setScope,batchSize,setBatchSize,dailyCount,eventQuery,setEventQuery,progress,detail,detailTarget,loading:loading||Boolean(root&&enabled&&!scopeReady&&!error),detailLoading,error,detailError,refresh,readProgress,inspect,range,setRange,rangeSnapshot,scopeReady,clearRequest,clearing,clearNotice,prepareClear,confirmClear,cancelClear:()=>setClearRequest(null)};
}
export type NewsProcessingController=ReturnType<typeof useNewsProcessing>;
