import {useAgentObjects} from './use-agent-objects.ts';
import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke,isTauri,listen} from './desktop-api.ts';
import {piError} from './pi-client.ts';
export interface AgentJob {id:string;template:string;input:string;parentId:string|null;status:string;output:string|null;error:string|null;createdAt:string;timeoutMs:number}
export interface JobsSnapshot {logs:{jobId:string;at:string;message:string}[];slots:{limit:number;active:string[];queued:string[]};jobs:AgentJob[]}
export function useAgentJobs(root:string|null){
  const objects=useAgentObjects(root,'jobs');
  const [snapshot,setSnapshot]=useState<JobsSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[content,setContent]=useState(''),[template,setTemplate]=useState('summarize-text');
  const mounted=useRef(false),rootRef=useRef(root),reading=useRef(false),again=useRef(false),working=useRef(false);rootRef.current=root;
  const refresh=useCallback(async()=>{if(!rootRef.current||!isTauri())return;if(reading.current){again.current=true;return;}reading.current=true;try{do{again.current=false;const target:string|null=rootRef.current;const v=await invoke<JobsSnapshot>('agent_jobs');if(mounted.current&&target===rootRef.current)setSnapshot(v);}while(again.current&&mounted.current);}catch(e){if(mounted.current)setError(piError(e));}finally{reading.current=false;}},[]);
  useEffect(()=>{mounted.current=true;setSnapshot(null);let disposed=false,off:(()=>void)|undefined;if(root&&isTauri()){void refresh();void listen('azcine-agent-jobs-changed',()=>void refresh()).then(fn=>{if(disposed)fn();else off=fn;});}return()=>{disposed=true;mounted.current=false;off?.();};},[root,refresh]);
  async function submit(){if(working.current)return;working.current=true;setBusy(true);setError('');const sent=content,sentObjects=[...objects.objects];try{await invoke('agent_submit_job',{input:{template,content:sent,timeoutSeconds:600,objects:sentObjects}});setContent(v=>v===sent?'':v);objects.clearSent('jobs',sentObjects);await refresh();}catch(e){setError(piError(e));}finally{working.current=false;setBusy(false);}}
  async function cancel(id:string){try{await invoke('agent_cancel_job',{id});await refresh();}catch(e){setError(piError(e));}}
  return{objects,snapshot,error,busy,content,setContent,template,setTemplate,submit,cancel,refresh};
}
export type AgentJobsController=ReturnType<typeof useAgentJobs>;
