import { useCallback,useEffect,useRef,useState } from 'react';
import { invoke,isTauri,listen } from './desktop-api.ts';
import { piError } from './pi-client.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
export interface AgentDraft{id:string;conversationKey:string;inputId:string;messageKey?:string;payload:unknown;context:{sessionId?:string;messageCount?:number;objects:{source:import('./pi-client.ts').AgentSource}[]};validation:{items:Record<string,unknown>[];error:string|null};status:string;receipt:unknown;revision:number;createdAt:string}
export function pendingDraftDecisions(draft:AgentDraft):string[]{const payload=draft.payload as {decisions?:unknown}|null;return Array.isArray(payload?.decisions)?payload.decisions.filter((value):value is string=>typeof value==='string'&&!!value.trim()):[];}
export function useAgentData(root:string|null){
  const [drafts,setDrafts]=useState<AgentDraft[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const rootRef=useRef(root),mounted=useRef(false),reading=useRef(false),operation=useRef(false),again=useRef(false);rootRef.current=root;
  const refresh=useCallback(async()=>{if(!rootRef.current||!isTauri() )return;if(reading.current){again.current=true;return;}reading.current=true;try{do{again.current=false;const target=rootRef.current;const values=await invoke<AgentDraft[]>('agent_drafts');if(mounted.current&&target===rootRef.current){setDrafts(values);setError('');}}while(again.current&&mounted.current);}catch(e){if(mounted.current)setError(piError(e));}finally{reading.current=false;}},[]);
  useEffect(()=>{mounted.current=true;let off:(()=>void)|undefined,errorOff:(()=>void)|undefined,disposed=false;setDrafts([]);if(root&&isTauri()){void refresh();void listen<{message:string}>('azcine-agent-data-error',e=>setError(piError(e.payload))).then(value=>{if(disposed)value();else errorOff=value;});void listen('azcine-agent-data-changed',()=>void refresh()).then(value=>{if(disposed)value();else off=value;});}return()=>{disposed=true;mounted.current=false;off?.();errorOff?.();};},[root,refresh]);
  async function apply(draft:AgentDraft){if(operation.current)return false;operation.current=true;setBusy(draft.id);setError('');try{await invoke('agent_apply_draft',{id:draft.id,revision:draft.revision});notifyOperation(pendingDraftDecisions(draft).length?'已应用确定变更，待确认事项仍保留。':'草案已整批应用。');await refresh();return true;}catch(e){await refresh();setError(piError(e));return false;}finally{operation.current=false;setBusy('');}}
  async function discard(draft:AgentDraft){if(operation.current)return;operation.current=true;setBusy(draft.id);setError('');try{await invoke('agent_discard_draft',{id:draft.id,revision:draft.revision});notifyOperation('草案已作废，原回复与记录保留。');await refresh();}catch(e){setError(piError(e));}finally{operation.current=false;setBusy('');}}
  async function revalidate(draft:AgentDraft){if(operation.current)return;operation.current=true;setBusy(draft.id);setError('');try{await invoke('agent_revalidate_draft',{id:draft.id,revision:draft.revision});await refresh();}catch(e){setError(piError(e));}finally{operation.current=false;setBusy('');}}
  return{drafts,error,busy,refresh,apply,discard,revalidate};
}
export type AgentDataController=ReturnType<typeof useAgentData>;
