import { useOperationNotice } from './components/ui/operation-toast.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { callPi as invokePi, desktopPi, piError } from './pi-client.ts';

export interface PiResource {
  id:string; kind:'official'|'rule'|'skill'|'extension'; name:string; path:string; description:string;
  content:string; hash:string|null; editable:boolean; enabled:boolean; loaded:boolean; toggleable:boolean; error:string|null; commands:string[];
}
export interface PiResourceIndex { generation:number; connected:boolean; agentDir:string; cwd:string; entries:PiResource[]; diagnostics:string[]; settingsHash:string|null }
interface ResourceDraft { content:string; hash:string|null }
function resourceErrorCode(value:unknown):unknown {
  return typeof value==='object'&&value!==null&&'code' in value?value.code:null;
}
function parseIndex(value:unknown):PiResourceIndex {
  const index=value as PiResourceIndex;
  if(!index||!Number.isSafeInteger(index.generation)||typeof index.connected!=='boolean'||typeof index.agentDir!=='string'||typeof index.cwd!=='string'||!Array.isArray(index.entries)||!Array.isArray(index.diagnostics)||index.diagnostics.some(item=>typeof item!=='string')||index.settingsHash!==null&&typeof index.settingsHash!=='string')throw new Error('资源清单格式不完整，已有内容保留。');
  for(const item of index.entries)if(!item||!['official','rule','skill','extension'].includes(item.kind)||typeof item.id!=='string'||typeof item.name!=='string'||typeof item.path!=='string'||typeof item.description!=='string'||typeof item.content!=='string'||typeof item.editable!=='boolean'||typeof item.enabled!=='boolean'||typeof item.loaded!=='boolean'||typeof item.toggleable!=='boolean'||!Array.isArray(item.commands)||item.commands.some(cmd=>typeof cmd!=='string')||item.hash!==null&&typeof item.hash!=='string'||item.error!==null&&typeof item.error!=='string')throw new Error('资源条目格式不完整，已有内容保留。');
  return index;
}
export function usePiResources(root:string|null,conversationKey="default",enabled=true){
  const scope=useRef(conversationKey);scope.current=conversationKey;
  function callPi<T=unknown>(command:string,args:Record<string,unknown>={}){return invokePi<T>(command,{...args,conversationKey:scope.current});}
  const [index,setIndex]=useState<PiResourceIndex|null>(null),[selected,setSelected]=useState('official:system');
  const [drafts,setDrafts]=useState<Record<string,ResourceDraft>>({}),[editing,setEditing]=useState<Record<string,boolean>>({});
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useOperationNotice('');
  const rootRef=useRef(root);rootRef.current=root;const seq=useRef(0),savingRef=useRef(false),mounted=useRef(false);
  const reading=useRef<Promise<void>|null>(null),readAgain=useRef(false);
  const loaded=useRef({root:null as string|null,scope:'',at:0}),visible=useRef(enabled);visible.current=enabled;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;seq.current++;};},[]);
  useEffect(()=>{seq.current++;loaded.current={root:null,scope:'',at:0};setIndex(null);setDrafts({});setEditing({});setSelected('official:system');setError('');setNotice('');setLoading(false);},[root]);
  const refresh=useCallback(()=>{
    if(!rootRef.current||!desktopPi()||!mounted.current)return Promise.resolve();
    // StrictMode, page re-entry and connection changes may all request a read.
    // Keep one IPC in flight and coalesce follow-up refreshes behind it.
    if(reading.current){readAgain.current=true;setLoading(true);return reading.current;}
    const pending=(async()=>{
      do{
        readAgain.current=false;
        const target=rootRef.current,conversation=scope.current;if(!target||!mounted.current)return;
        const request=++seq.current;
        const isCurrent=()=>mounted.current&&rootRef.current===target&&scope.current===conversation&&request===seq.current;
        setLoading(true);setError('');
        for(let attempt=0;attempt<4&&isCurrent();attempt++){
          try{
            const next=parseIndex(await invokePi('pi_resources',{conversationKey:conversation}));
            if(isCurrent()){loaded.current={root:target,scope:conversation,at:Date.now()};setIndex(next);setError('');}
            break;
          }catch(e){
            if(!isCurrent())break;
            const code=resourceErrorCode(e);
            // Read-only retries cover the brief gap between a ready snapshot
            // and release of the backend operation lock. Never retry writes.
            if((code==='pi_busy'||code==='pi_cancelled')&&attempt<3){
              await new Promise<void>(resolve=>window.setTimeout(resolve,150*2**attempt));
              continue;
            }
            setError(code==='pi_busy'?'资源读取正在等待 Pi 完成其他操作，请稍后刷新；已有内容与草稿保留。':piError(e));
            break;
          }
        }
      }while(readAgain.current&&mounted.current);
    })().finally(()=>{reading.current=null;if(mounted.current)setLoading(false);});
    reading.current=pending;
    return pending;
  },[]);
  function edit(item:PiResource){setDrafts(before=>({...before,[item.id]:before[item.id]??{content:item.content,hash:item.hash}}));setEditing(before=>({...before,[item.id]:true}));}
  function change(item:PiResource,content:string){setDrafts(before=>({...before,[item.id]:{content,hash:before[item.id]?before[item.id].hash:item.hash}}));}
  function cancel(item:PiResource){setEditing(before=>({...before,[item.id]:false}));setDrafts(before=>{const next={...before};delete next[item.id];return next;});}
  useEffect(()=>{if(enabled&&root&&mounted.current&&(loaded.current.root!==root||loaded.current.scope!==conversationKey||Date.now()-loaded.current.at>30_000))void refresh();},[enabled,conversationKey,root,refresh]);
  function invalidate(){loaded.current.at=0;if(visible.current)void refresh();}
  async function save(item:PiResource,enabled?:boolean){
    if(!index||savingRef.current)return;const target=rootRef.current,original=drafts[item.id];
    if(loaded.current.root!==target||loaded.current.scope!==scope.current){setError('会话已变化，请刷新资源后保存；编辑内容仍保留。');return;}
    if(enabled===undefined&&!original)return;savingRef.current=true;setSaving(true);setError('');setNotice('');
    try{const result=await callPi<{saved:boolean;message:string}>('pi_save_resource',{input:{generation:index.generation,id:item.id,hash:enabled===undefined?original!.hash:index.settingsHash,content:enabled===undefined?original!.content:null,enabled:enabled??null}});
      if(result.saved!==true||typeof result.message!=='string')throw new Error('保存回执不完整，请核对原文件；草稿保留。');
      if(mounted.current&&rootRef.current===target){setNotice(result.message);if(enabled===undefined){setDrafts(before=>{if(before[item.id]?.content!==original!.content||before[item.id]?.hash!==original!.hash)return before;const next={...before};delete next[item.id];return next;});setEditing(before=>({...before,[item.id]:false}));}await refresh();}
    }catch(e){if(mounted.current&&rootRef.current===target)setError(piError(e));}
    finally{savingRef.current=false;if(mounted.current)setSaving(false);}
  }
  return {index,selected,setSelected,drafts,editing,loading,saving,error,notice,refresh,invalidate,edit,change,cancel,save};
}
export type PiResourcesController=ReturnType<typeof usePiResources>;
