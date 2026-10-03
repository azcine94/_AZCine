import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { callPi, desktopPi, parseSnapshot, parseSessions, piError } from './pi-client.ts';
import type { ModelInput, PiImage, PiSession, PiSnapshot, SendReceipt } from './pi-client.ts';
import { parsePromptDisposition } from './pi-contract.ts';
interface ChatDraft { text:string; images:PiImage[] }
const emptyDraft=():ChatDraft=>({text:'',images:[]});
export function usePi(root:string|null){
  const [snapshot,setSnapshot]=useState<PiSnapshot|null>(null);const snap=useRef<PiSnapshot|null>(null);
  const [error,setError]=useState<string|null>(null),[action,setAction]=useState<string|null>(null);
  const [drafts,setDrafts]=useState<Record<string,ChatDraft>>({});const draftRef=useRef(drafts);draftRef.current=drafts;
  const [acceptedInputs,setAcceptedInputs]=useState<Record<string,{id:string;draft:ChatDraft;disposition:string}[]>>({});
  const transferred=useRef<Record<string,string>>({});
  const [sessions,setSessions]=useState<PiSession[]>([]),[unreadable,setUnreadable]=useState(0),[sessionError,setSessionError]=useState<string|null>(null);
  const [cwd,setCwd]=useState(''),[notice,setNotice]=useState<string|null>(null);
  const [modelForm,setModelForm]=useState({provider:'',baseUrl:'',api:'openai-completions',modelId:'',name:'',contextWindow:'128000',maxTokens:'8192',reasoning:false,supportsImages:false,apiKey:''});
  const [sessionName,setSessionName]=useState('');
  const actionRef=useRef<string|null>(null),stopRef=useRef(false),pulling=useRef(false),again=useRef(false),mounted=useRef(false),sessionsReading=useRef(false);
  const rootRef=useRef(root);rootRef.current=root;
  const refresh=useCallback(async()=>{
    if(!desktopPi()||!rootRef.current)return;
    if(pulling.current){again.current=true;return;}
    pulling.current=true;
    try{do{again.current=false;const v=parseSnapshot(await callPi('pi_snapshot'));if(!mounted.current)return;const old=snap.current;if(!old||v.generation>old.generation||v.generation===old.generation&&v.seq>=old.seq){snap.current=v;setSnapshot(v);}}while(again.current);}
    catch(e){if(mounted.current)setError(piError(e));}
    finally{pulling.current=false;}
  },[]);
  const reloadSessions=useCallback(async()=>{if(!desktopPi()||!rootRef.current||sessionsReading.current)return;sessionsReading.current=true;try{const v=parseSessions(await callPi('pi_sessions'));if(mounted.current){setSessions(v.sessions);setUnreadable(v.unreadable);setSessionError(null);}}catch(e){if(mounted.current)setSessionError(piError(e));}finally{sessionsReading.current=false;}},[]);
  useEffect(()=>{
    mounted.current=true;let disposed=false;let unlisten:(()=>void)|undefined;
    if(root&&desktopPi())void listen('azcine-pi-changed',()=>void refresh()).then(off=>{if(disposed){off();return;}unlisten=off;void refresh();void reloadSessions();}).catch(e=>{if(!disposed)setError(piError(e));});
    return()=>{disposed=true;mounted.current=false;unlisten?.();};
  },[root,refresh,reloadSessions]);
  const draftKey=snapshot?.state?.sessionId??'unconnected';const draft=drafts[draftKey]??emptyDraft();
  function updateDraft(key:string,transform:(d:ChatDraft)=>ChatDraft){setDrafts(before=>{const next={...before,[key]:transform(before[key]??emptyDraft())};draftRef.current=next;return next;});}
  function setText(text:string){updateDraft(draftKey,d=>({...d,text}));}
  function setImages(images:PiImage[],key=draftKey){updateDraft(key,d=>({...d,images}));}
  async function operate(name:string,work:()=>Promise<void>){if(actionRef.current)return;actionRef.current=name;setAction(name);setError(null);setNotice(null);try{await work();}catch(e){setError(piError(e));}finally{actionRef.current=null;setAction(null);await refresh();}}
  async function connect(session?:PiSession){
    const oldKey=draftKey;
    await operate('连接',async()=>{const resume=session??(!cwd.trim()?sessions.find(row=>row.path===snap.current?.state?.sessionFile):undefined);const v=parseSnapshot(await callPi('pi_connect',{cwd:resume?.cwd??(cwd.trim()||null),sessionPath:resume?.path??null}));
      if(v.state&&!session)setDrafts(before=>{const current=before[oldKey];const next={...before};if(current&&!before[v.state!.sessionId]){next[v.state!.sessionId]=current;transferred.current[oldKey]=v.state!.sessionId;}draftRef.current=next;return next;});
      if(!snap.current||v.generation>snap.current.generation||v.generation===snap.current.generation&&v.seq>=snap.current.seq){snap.current=v;setSnapshot(v);}await reloadSessions();});
  }
  async function disconnect(){await operate('断开',async()=>{await callPi('pi_disconnect');await reloadSessions();});}
  async function send(behavior:string|null){
    const s=snap.current,key=draftKey,current=draftRef.current[key]??emptyDraft();
    if(!s?.state){setError('请先连接原版 Pi；消息和附件仍保留。');return;}
    const before={text:current.text,images:[...current.images]};
    await operate('发送',async()=>{
      const reply=await callPi<SendReceipt>('pi_send',{input:{generation:s.generation,sessionId:s.state!.sessionId,message:before.text,images:before.images.map(i=>({data:i.data,mimeType:i.mimeType})),behavior}});
      const disposition=parsePromptDisposition(reply);
      if(reply.generation!==s.generation||reply.sessionId!==key)throw new Error('发送回执与原会话不一致，输入保留；不要自动重发，请先核对原生会话。');
      setAcceptedInputs(previous=>({...previous,[key]:[...(previous[key]??[]).slice(-19),{id:crypto.randomUUID(),draft:before,disposition}]}));
      const clearMatching=(latest:ChatDraft)=>latest.text===before.text&&latest.images.length===before.images.length&&latest.images.every((v,i)=>v.id===before.images[i]?.id)?emptyDraft():latest;
      updateDraft(key,clearMatching);if(transferred.current[key])updateDraft(transferred.current[key],clearMatching);
      setNotice(disposition==='handled'?'原生命令已处理，不代表任务完成。':disposition==='queued'?'消息已排队，尚未执行完成。':'原版已接受消息，等待实际回复与终态。');
    });
  }
  async function stop(){if(stopRef.current)return;stopRef.current=true;const s=snap.current;setError(null);try{if(s?.connection==='connecting'||s?.busy)await callPi('pi_disconnect');else if(s?.state)await callPi('pi_stop',{generation:s.generation,sessionId:s.state.sessionId});else await callPi('pi_disconnect');}catch(e){setError(piError(e));}finally{stopRef.current=false;await refresh();await reloadSessions();}}
  async function sessionAction(command:string,fields:Record<string,unknown>={}){const s=snap.current;if(!s?.state)return;await operate('会话操作',async()=>{await callPi(command,{generation:s.generation,sessionId:s.state!.sessionId,...fields});if(command==='pi_name_session')setSessionName('');await reloadSessions();});}
  async function saveModel(input:ModelInput):Promise<boolean>{if(actionRef.current)return false;let saved=false;const oldKey=draftKey;await operate('保存模型',async()=>{const result=await callPi<{saved:boolean;connected:boolean;message:string}>('pi_save_model',{input});if(result.saved!==true||typeof result.message!=='string')throw new Error('模型保存结果不完整，输入保留。');saved=true;setNotice(result.message);await refresh();const id=snap.current?.state?.sessionId;if(id&&id!==oldKey)setDrafts(before=>{const next={...before};if(before[oldKey]&&!before[id])next[id]=before[oldKey];draftRef.current=next;return next;});await reloadSessions();});return saved;}
  function recoverQueue(index:number){const text=snapshot?.recoveredQueue[index];if(text!==undefined)updateDraft(draftKey,d=>({...d,text:d.text?`${d.text}\n${text}`:text}));}
  function recoverAccepted(id:string){const item=(acceptedInputs[draftKey]??[]).find(v=>v.id===id);if(!item)return;const current=draftRef.current[draftKey]??emptyDraft();if(current.text||current.images.length){setError('输入区已有内容，请先保留或发送当前草稿，再取回这次消息，避免覆盖。');return;}updateDraft(draftKey,()=>({...item.draft,images:[...item.draft.images]}));}
  return {snapshot,error,notice,action,connected:desktopPi(),root,draft,draftKey,setText,setImages,cwd,setCwd,sessions,unreadable,sessionError,refresh,reloadSessions,connect,disconnect,send,stop,sessionAction,saveModel,recoverQueue,acceptedInputs:acceptedInputs[draftKey]??[],recoverAccepted,modelForm,setModelForm,sessionName,setSessionName};
}
export type PiController=ReturnType<typeof usePi>;
