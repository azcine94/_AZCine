import { useCallback, useEffect, useRef, useState } from 'react';
import { callPi, desktopPi, piError } from './pi-client.ts';

export interface PiResource {
  id:string; kind:'official'|'rule'|'skill'|'extension'; name:string; path:string; description:string;
  content:string; hash:string|null; editable:boolean; enabled:boolean; loaded:boolean; toggleable:boolean; error:string|null; commands:string[];
}
export interface PiResourceIndex { generation:number; connected:boolean; agentDir:string; cwd:string; entries:PiResource[]; diagnostics:string[]; settingsHash:string|null }
interface ResourceDraft { content:string; hash:string|null }
function parseIndex(value:unknown):PiResourceIndex {
  const index=value as PiResourceIndex;
  if(!index||!Number.isSafeInteger(index.generation)||typeof index.connected!=='boolean'||typeof index.agentDir!=='string'||typeof index.cwd!=='string'||!Array.isArray(index.entries)||!Array.isArray(index.diagnostics)||index.diagnostics.some(item=>typeof item!=='string')||index.settingsHash!==null&&typeof index.settingsHash!=='string')throw new Error('资源清单格式不完整，已有内容保留。');
  for(const item of index.entries)if(!item||!['official','rule','skill','extension'].includes(item.kind)||typeof item.id!=='string'||typeof item.name!=='string'||typeof item.path!=='string'||typeof item.description!=='string'||typeof item.content!=='string'||typeof item.editable!=='boolean'||typeof item.enabled!=='boolean'||typeof item.loaded!=='boolean'||typeof item.toggleable!=='boolean'||!Array.isArray(item.commands)||item.commands.some(cmd=>typeof cmd!=='string')||item.hash!==null&&typeof item.hash!=='string'||item.error!==null&&typeof item.error!=='string')throw new Error('资源条目格式不完整，已有内容保留。');
  return index;
}
export function usePiResources(root:string|null){
  const [index,setIndex]=useState<PiResourceIndex|null>(null),[selected,setSelected]=useState('official:system');
  const [drafts,setDrafts]=useState<Record<string,ResourceDraft>>({}),[editing,setEditing]=useState<Record<string,boolean>>({});
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const rootRef=useRef(root);rootRef.current=root;const seq=useRef(0),savingRef=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;seq.current++;};},[]);
  useEffect(()=>{seq.current++;setIndex(null);setDrafts({});setEditing({});setSelected('official:system');setError('');setNotice('');setLoading(false);},[root]);
  const refresh=useCallback(async()=>{
    const target=rootRef.current;if(!target||!desktopPi())return;const request=++seq.current;setLoading(true);setError('');
    try{const next=parseIndex(await callPi('pi_resources'));if(mounted.current&&rootRef.current===target&&request===seq.current)setIndex(next);}
    catch(e){if(mounted.current&&rootRef.current===target&&request===seq.current)setError(piError(e));}
    finally{if(mounted.current&&rootRef.current===target&&request===seq.current)setLoading(false);}
  },[]);
  function edit(item:PiResource){setDrafts(before=>({...before,[item.id]:before[item.id]??{content:item.content,hash:item.hash}}));setEditing(before=>({...before,[item.id]:true}));}
  function change(item:PiResource,content:string){setDrafts(before=>({...before,[item.id]:{content,hash:before[item.id]?before[item.id].hash:item.hash}}));}
  function cancel(item:PiResource){setEditing(before=>({...before,[item.id]:false}));setDrafts(before=>{const next={...before};delete next[item.id];return next;});}
  async function save(item:PiResource,enabled?:boolean){
    if(!index||savingRef.current)return;const target=rootRef.current,original=drafts[item.id];
    if(enabled===undefined&&!original)return;savingRef.current=true;setSaving(true);setError('');setNotice('');
    try{const result=await callPi<{saved:boolean;message:string}>('pi_save_resource',{input:{generation:index.generation,id:item.id,hash:enabled===undefined?original!.hash:index.settingsHash,content:enabled===undefined?original!.content:null,enabled:enabled??null}});
      if(result.saved!==true||typeof result.message!=='string')throw new Error('保存回执不完整，请核对原文件；草稿保留。');
      if(mounted.current&&rootRef.current===target){setNotice(result.message);if(enabled===undefined){setDrafts(before=>{if(before[item.id]?.content!==original!.content||before[item.id]?.hash!==original!.hash)return before;const next={...before};delete next[item.id];return next;});setEditing(before=>({...before,[item.id]:false}));}await refresh();}
    }catch(e){if(mounted.current&&rootRef.current===target)setError(piError(e));}
    finally{savingRef.current=false;if(mounted.current)setSaving(false);}
  }
  return {index,selected,setSelected,drafts,editing,loading,saving,error,notice,refresh,edit,change,cancel,save};
}
export type PiResourcesController=ReturnType<typeof usePiResources>;
