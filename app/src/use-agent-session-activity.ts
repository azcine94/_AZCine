import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { RuntimeSummary } from './pi-client.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';

export interface SessionActivity { activityAt:number; replyAt:number; readAt:number }
const changedEvent='azcine:session-activity-changed';
const temporary=new Map<string,string>();
const empty='{}';
const storageKey=(root:string)=>`azcine.agent-session-activity:${root}`;
const time=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=8.64e15?value:0;
function read(key:string|null){if(!key)return empty;try{return temporary.get(key)??localStorage.getItem(key)??empty;}catch{return temporary.get(key)??empty;}}
function parse(raw:string):Record<string,SessionActivity>{
  try{const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))return {};
    return Object.fromEntries(Object.entries(value).filter(([,v])=>v&&typeof v==='object').map(([id,v])=>[id,{activityAt:time(v.activityAt),replyAt:time(v.replyAt),readAt:time(v.readAt)}]));
  }catch{return {};}
}
function update(root:string,change:(rows:Record<string,SessionActivity>)=>void){
  const key=storageKey(root),before=read(key),rows=parse(before);change(rows);const next=JSON.stringify(rows);if(next===before)return;
  try{localStorage.setItem(key,next);temporary.delete(key);}catch{if(!temporary.has(key))notifyOperation('会话未读状态暂存于当前窗口，未能保存到本机。',{tone:'error'});temporary.set(key,next);}
  window.dispatchEvent(new CustomEvent<string>(changedEvent,{detail:key}));
}

/** Local display preferences only. Success is supplied by Pi's settled projection. */
export function useAgentSessionActivity(root:string|null){
  const key=root?storageKey(root):null;
  const subscribe=useCallback((notify:()=>void)=>{
    const changed=(event:Event)=>{if((event as CustomEvent<string>).detail===key)notify();};
    const stored=(event:StorageEvent)=>{if(event.key===key||event.key===null){if(key)temporary.delete(key);notify();}};
    window.addEventListener(changedEvent,changed);window.addEventListener('storage',stored);
    return()=>{window.removeEventListener(changedEvent,changed);window.removeEventListener('storage',stored);};
  },[key]);
  const raw=useSyncExternalStore(subscribe,useCallback(()=>read(key),[key]),()=>empty);
  const entries=useMemo(()=>parse(raw),[raw]);
  const observe=useCallback((summary:RuntimeSummary,sourceRoot:string)=>update(sourceRoot,rows=>{
    for(const row of summary.conversations){if(!row.sessionId)continue;
      const activityAt=time(row.lastActivityAt),replyAt=!row.active&&!row.waiting&&row.outcome==='success'?time(row.lastReplyAt):0;
      if(!activityAt&&!replyAt)continue;
      const before=rows[row.sessionId]??{activityAt:0,replyAt:0,readAt:0};
      rows[row.sessionId]={...before,activityAt:Math.max(before.activityAt,activityAt),replyAt:Math.max(before.replyAt,replyAt)};
    }
  }),[]);
  const markRead=useCallback((id:string,replyAt:number)=>{if(root&&time(replyAt))update(root,rows=>{
    const before=rows[id];if(!before)return;
    rows[id]={...before,readAt:Math.max(before.readAt,Math.min(before.replyAt,replyAt))};
  });},[root]);
  const forget=useCallback((ids:string[])=>{if(root)update(root,rows=>{for(const id of ids)delete rows[id];});},[root]);
  return {entries,observe,markRead,forget};
}
