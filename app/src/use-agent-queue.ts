import { useEffect, useRef, useState } from 'react';
import { callPi, desktopPi, piError } from './pi-client.ts';
import type { PiImage,AgentAttachment,AgentSource } from './pi-client.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
export interface QueuePayload {text:string;images:PiImage[];files:AgentAttachment[];objects:AgentSource[];source:AgentSource;model:{provider:string;id:string}}
export interface QueueEntry {id:string;conversationKey:string;sessionId:string;revision:number;behavior:string;status:string;payload:QueuePayload;error:string|null}
interface QueueDocument {entries:QueueEntry[];paused:Record<string,boolean>}
export function useAgentQueue(root:string|null){
  const [document,setDocument]=useState<QueueDocument>({entries:[],paused:{}}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [edits,setEdits]=useState<Record<string,{revision:number;payload:QueuePayload}>>({}),[open,setOpen]=useState<Record<string,boolean>>({});
  const target=useRef(root);target.current=root;const pending=useRef<Promise<unknown>>(Promise.resolve()),polling=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function run(command:string,args:Record<string,unknown>,at=root){
    const next=pending.current.catch(()=>{}).then(async()=>{if(!at||target.current!==at)throw new Error('数据目录已变化，原队列保留。');const result=await callPi<QueueDocument>(command,args);if(target.current===at&&alive.current){setDocument(result);setError('');}return result;});pending.current=next;return next;
  }
  useEffect(()=>{setDocument({entries:[],paused:{}});setEdits({});setError('');setBusy(false);if(!root||!desktopPi())return;let active=true;
    void run('agent_queue_read',{root}).catch(e=>{if(active)setError(piError(e));});
    const timer=setInterval(()=>{if(polling.current)return;polling.current=true;void run('agent_queue_tick',{root},root).catch(e=>{if(active)setError(piError(e));}).finally(()=>{polling.current=false;});},1000);
    return()=>{active=false;clearInterval(timer);};
  },[root]);
  async function mutate(conversationKey:string,action:string,args:Record<string,unknown>={}){if(!root)throw new Error('请先选择数据目录。');const at=root;setBusy(true);try{return await run('agent_queue_mutate',{input:{root,action,conversationKey,...args}});}catch(e){if(target.current===at)setError(piError(e));throw e;}finally{if(alive.current&&target.current===at)setBusy(false);}}
  const enqueueReceipts=useRef(new Map<string,{signature:string;id:string}>());
  async function enqueue(conversationKey:string,payload:QueuePayload,behavior:string){const key=`${root}/${conversationKey}`,signature=JSON.stringify([payload,behavior]),before=enqueueReceipts.current.get(key);const id=before?.signature===signature?before.id:crypto.randomUUID();enqueueReceipts.current.set(key,{signature,id});await mutate(conversationKey,'enqueue',{id,payload,behavior});enqueueReceipts.current.delete(key);}
  async function change(entry:QueueEntry,action:string){try{await mutate(entry.conversationKey,action,{id:entry.id,revision:entry.revision});if(action==='remove'){setEdits(before=>{const next={...before};delete next[entry.id];return next;});notifyOperation('已移除排队消息',{action:{label:'撤销',run:()=>mutate(entry.conversationKey,'restore',{id:entry.id,revision:entry.revision+1})}});}}catch{/* Visible error retains the queue entry. */}}
  async function edit(entry:QueueEntry){try{const result=await mutate(entry.conversationKey,'beginEdit',{id:entry.id,revision:entry.revision});const saved=result.entries.find(e=>e.id===entry.id);if(saved)setEdits(before=>({...before,[entry.id]:{revision:saved.revision,payload:structuredClone(saved.payload)}}));}catch{/* Already dispatched entries cannot be edited. */}}
  function update(id:string,text:string){setEdits(before=>before[id]?{...before,[id]:{...before[id],payload:{...before[id].payload,text}}}:before);}
  async function cancel(id:string){const entry=document.entries.find(e=>e.id===id);if(!entry)return;try{await mutate(entry.conversationKey,'cancelEdit',{id,revision:entry.revision});setEdits(before=>{const next={...before};delete next[id];return next;});}catch{/* Retain editing draft. */}}
  async function save(entry:QueueEntry){const draft=edits[entry.id];if(!draft)return;try{await mutate(entry.conversationKey,'edit',{id:entry.id,revision:draft.revision,payload:draft.payload});setEdits(before=>{const next={...before};delete next[entry.id];return next;});}catch{/* Keep the independent editing draft on conflict. */}}
  return {document,error,busy,edits,open,setOpen,enqueue,mutate,change,edit,update,cancel,save};
}
export type AgentQueueController=ReturnType<typeof useAgentQueue>;
