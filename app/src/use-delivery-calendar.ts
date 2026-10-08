import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { localDate } from './workspace-contract.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
export interface CalendarEntry {id:string;title:string;date:string;time:string;note:string;done:boolean;deleted:boolean;revision:number}
export function useDeliveryCalendar(root:string|null){
  const [entries,setEntries]=useState<CalendarEntry[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
  const [selected,setSelected]=useState(localDate()),[month,setMonth]=useState(localDate().slice(0,7)),[expanded,setExpanded]=useState(true);
  const [draft,setDraft]=useState<CalendarEntry|null>(null),[open,setOpen]=useState(false);
  const lock=useRef(false),target=useRef(root),drafts=useRef(new Map<string,CalendarEntry|null>());target.current=root;
  useEffect(()=>{setEntries([]);setReady(false);setError('');setOpen(false);setDraft(drafts.current.get(root??'')??null);if(root&&isTauri())void reload(root);},[root]);
  async function reload(at=root){if(!at||!isTauri())return;try{const rows=await invoke<CalendarEntry[]>('calendar_entries',{root:at});if(target.current===at){setEntries(rows);setReady(true);setError('');}}catch(e){if(target.current===at)setError(message(e));}}
  function edit(entry:CalendarEntry|null){setDraft(entry);if(root)drafts.current.set(root,entry);}
  function create(){if(!draft)edit({id:crypto.randomUUID(),title:'',date:selected,time:'',note:'',done:false,deleted:false,revision:0});setOpen(true);}
  function choose(date:string){setSelected(date);setMonth(date.slice(0,7));}
  async function save(entry:CalendarEntry,close=false):Promise<boolean>{if(!root||!ready||lock.current)return false;const at=root;lock.current=true;setBusy(true);setError('');
    try{const rows=await invoke<CalendarEntry[]>('calendar_save',{root:at,entry});if(target.current===at){setEntries(rows);if(close){setOpen(false);edit(null);choose(entry.date);}notifyOperation(entry.deleted?'安排已移除':'安排已保存',entry.deleted?{action:{label:'撤销',run:()=>{const removed=rows.find(r=>r.id===entry.id);if(removed)return save({...removed,deleted:false}).then(()=>{});}}}:{});}return true;}
    catch(e){if(target.current===at)setError(message(e));return false;}finally{lock.current=false;setBusy(false);}
  }
  return {entries,error,busy,ready,selected,month,expanded,draft,open,setOpen,setExpanded,setMonth,choose,edit,create,save,reload};
}
function message(e:unknown){return typeof e==='object'&&e!==null&&'message'in e?String(e.message):'日历操作失败，输入保留。';}
export type DeliveryCalendarController=ReturnType<typeof useDeliveryCalendar>;
