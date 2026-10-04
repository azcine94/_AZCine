import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from './desktop-api.ts';
import { invoke, isTauri } from './desktop-api.ts';
import type { MaterialPage, NewsMaterial } from './news-contract.ts';
import { parsePendingPage, parseProgress, parseTaskDetail } from './news-processing-client.ts';
import type { ProcessingProgress, TaskDetail } from './news-processing-client.ts';
import { workspaceError } from './workspace-contract.ts';
export function useNewsProcessing(root:string|null,enabled:boolean,active:boolean){
  const [pending,setPending]=useState<MaterialPage>({items:[],total:0,page:0,pageSize:6});
  const [query,setQuery]=useState(''),[source,setSource]=useState(''),[selected,setSelected]=useState<NewsMaterial|null>(null);
  const [scope,setScope]=useState<'single'|'all'>('single'),[batchSize,setBatchSize]=useState(1);
  const [dailyCount,setDailyCount]=useState<{total:number;at:string}|null>(null);
  const [eventQuery,setEventQuery]=useState('');
  const [progress,setProgress]=useState<ProcessingProgress|null>(null),[detail,setDetail]=useState<TaskDetail|null>(null);
  const [error,setError]=useState(''),[detailError,setDetailError]=useState(''),[loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false);
  const [detailTarget,setDetailTarget]=useState<{id:string;batch:number}|null>(null);
  const mounted=useRef(false),rootRef=useRef(root),readSeq=useRef(0),detailSeq=useRef(0),pulling=useRef(false),again=useRef(false);
  const filters=useRef({query,source});filters.current={query,source};rootRef.current=root;
  const refresh=useCallback(async(page=0)=>{const target=rootRef.current;if(!target||!isTauri())return;const seq=++readSeq.current;const filter={...filters.current};setLoading(true);setError('');
    try{const value=parsePendingPage(await invoke('news_pending_materials',{page,sourceId:filter.source||null,query:filter.query}));if(mounted.current&&seq===readSeq.current&&rootRef.current===target){setPending(value.page);setDailyCount({total:value.dailyTotal,at:value.at});}}
    catch(e){if(mounted.current&&seq===readSeq.current)setError(workspaceError(e));}finally{if(mounted.current&&seq===readSeq.current)setLoading(false);}
  },[]);
  const readProgress=useCallback(async()=>{if(!rootRef.current||!isTauri())return;if(pulling.current){again.current=true;return;}pulling.current=true;
    try{do{again.current=false;const target:string|null=rootRef.current;const value=parseProgress(await invoke('news_processing_snapshot'));if(mounted.current&&rootRef.current===target)setProgress(value);}while(again.current&&mounted.current);}
    catch(e){if(mounted.current)setError(workspaceError(e));}finally{pulling.current=false;}
  },[]);
  async function inspect(id:string,batch=0){const target=rootRef.current;if(!target||!isTauri())return;const seq=++detailSeq.current;setDetailTarget({id,batch});setDetailLoading(true);setDetailError('');
    try{const value=parseTaskDetail(await invoke('news_task_detail',{id,batch}));if(mounted.current&&seq===detailSeq.current&&rootRef.current===target)setDetail(value);}catch(e){if(mounted.current&&seq===detailSeq.current&&rootRef.current===target){setDetail(null);setDetailError(workspaceError(e));}}finally{if(mounted.current&&seq===detailSeq.current)setDetailLoading(false);}
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readSeq.current++;detailSeq.current++;};},[]);
  useEffect(()=>{readSeq.current++;detailSeq.current++;setLoading(false);setDetailLoading(false);setSelected(null);setScope('single');setBatchSize(1);setDailyCount(null);setDetail(null);setDetailTarget(null);setProgress(null);setError('');setDetailError('');setPending({items:[],total:0,page:0,pageSize:6});},[root]);
  useEffect(()=>{if(!enabled||!root)return;const timer=window.setTimeout(()=>void refresh(),250);return()=>window.clearTimeout(timer);},[root,enabled,query,source,refresh]);
  useEffect(()=>{if(!enabled||!root||!isTauri())return;let disposed=false;let off:(()=>void)|undefined;
    void listen('news-processing-changed',()=>{if(!disposed)void readProgress();}).then(stop=>{if(disposed)stop();else off=stop;}).catch(e=>{if(!disposed)setError(workspaceError(e));});void readProgress();
    const timer=active?window.setInterval(()=>void readProgress(),1000):undefined;
    return()=>{disposed=true;off?.();if(timer)window.clearInterval(timer);};
  },[root,enabled,active,readProgress]);
  useEffect(()=>{if(enabled&&!active){void refresh();void readProgress();}},[enabled,active,refresh,readProgress]);
  return {pending,query,setQuery,source,setSource,selected,select:setSelected,scope,setScope,batchSize,setBatchSize,dailyCount,eventQuery,setEventQuery,progress,detail,detailTarget,loading,detailLoading,error,detailError,refresh,readProgress,inspect};
}
export type NewsProcessingController=ReturnType<typeof useNewsProcessing>;
