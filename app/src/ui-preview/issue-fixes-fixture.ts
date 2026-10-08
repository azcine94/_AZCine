import { useState } from 'react';
import { notifyOperation } from '../components/ui/operation-toast.tsx';
import { localDate } from '../workspace-contract.ts';
import { useDeliveryCalendar } from '../use-delivery-calendar.ts';
import type { CalendarEntry,DeliveryCalendarController } from '../use-delivery-calendar.ts';
import { useAgentQueue } from '../use-agent-queue.ts';
import type { QueueEntry,AgentQueueController } from '../use-agent-queue.ts';
import { uuid,attachmentImageData } from './data.ts';

export function useCalendarFixture(state:string):DeliveryCalendarController{
  const base=useDeliveryCalendar(null),date=state==='calendar-today'?localDate():state==='calendar-six-weeks'?'2026-11-01':'2026-10-06';
  const [rows,setRows]=useState<CalendarEntry[]>(()=>state==='calendar-empty'?[]:Array.from({length:state==='calendar-many'?12:3},(_,i)=>({id:uuid(850+i),title:i===0?'长标题示例：核对城市镜头的光线与材质，准备下一轮交付':'个人安排示例 '+(i+1),date,time:i?'':'14:30',note:'仅用于 UI 总览，资料不写入数据库。',done:i===2,deleted:false,revision:1})));
  const [selected,setSelected]=useState(date),[month,setMonth]=useState(date.slice(0,7)),[open,setOpen]=useState(state==='calendar-edit'||state==='calendar-create'),[draft,setDraft]=useState<CalendarEntry|null>(state==='calendar-create'?{id:uuid(849),title:'吃饭',date,time:'',note:'',done:false,deleted:false,revision:0}:state==='calendar-edit'?rows[0]??null:null),[expanded,setExpanded]=useState(state!=='calendar-collapsed');
  return {...base,entries:rows,ready:true,error:state==='calendar-error'?'示例：保存失败，输入保留。':'',selected,month,expanded,open,draft,setOpen,setExpanded,setMonth,choose:date=>{setSelected(date);setMonth(date.slice(0,7));},edit:setDraft,create:()=>{setDraft(draft??{id:crypto.randomUUID(),title:'',date:selected,time:'',note:'',done:false,deleted:false,revision:0});setOpen(true);},save:async(entry,close)=>{if(state==='calendar-error')return false;setRows(before=>[...before.filter(e=>e.id!==entry.id),{...entry,revision:entry.revision+1}]);if(close){setOpen(false);setDraft(null);}if(entry.deleted)notifyOperation('安排已移除',{action:{label:'撤销',run:()=>setRows(before=>before.map(row=>row.id===entry.id?{...row,deleted:false,revision:row.revision+1}:row))}});return true;},reload:async()=>{}};
}
export function useQueueFixture(state:string,conversationKey:string,sessionId:string):AgentQueueController{
  const base=useAgentQueue(null),shown=state.startsWith('queue-');
  const [entries,setEntries]=useState<QueueEntry[]>(()=>shown?Array.from({length:state==='queue-many'?12:2},(_,i)=>({id:uuid(900+i),conversationKey,sessionId,revision:1,behavior:i?'steer':'followUp',status:state==='queue-waiting'&&i?'nativeQueued':state==='queue-error'?'uncertain':'waiting',error:state==='queue-error'?'示例：回执未确认，请先核对历史。':null,payload:{text:'请核对下一组镜头。\n这条排队消息与下方输入框的草稿互不覆盖。',images:i?[]:[{id:uuid(990),name:'示例图片.png',data:attachmentImageData,mimeType:'image/png'}],files:[],objects:[],source:{module:'agent',page:'agent',objectId:null},model:{provider:'ui-example',id:'example-model'}}})):[]);
  const [paused,setPaused]=useState(state==='queue-paused'),[edits,setEdits]=useState<AgentQueueController['edits']>({});
  return {...base,document:{entries,paused:{[conversationKey]:paused}},edits,error:state==='queue-error'?'示例：未自动重发。':'',mutate:async()=>{setPaused(false);return {entries,paused:{[conversationKey]:false}};},edit:async entry=>setEdits(before=>({...before,[entry.id]:{revision:entry.revision,payload:structuredClone(entry.payload)}})),update:(id,text)=>setEdits(before=>({...before,[id]:{...before[id],payload:{...before[id].payload,text}}})),cancel:async id=>setEdits(before=>{const next={...before};delete next[id];return next;}),save:async entry=>{if(edits[entry.id])setEntries(before=>before.map(e=>e.id===entry.id?{...e,payload:edits[entry.id].payload}:e));setEdits({});},change:async(entry,action)=>setEntries(before=>action==='remove'?before.filter(e=>e.id!==entry.id):before.map(e=>e.id===entry.id?{...e,behavior:action==='steer'?'steer':e.behavior,status:'waiting'}:e))};
}
