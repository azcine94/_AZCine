import { notifyOperation, useOperationNotice } from './components/ui/operation-toast.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from './desktop-api.ts';
import { callPi as invokePi, desktopPi, parseSnapshot, parseSessions, piError } from './pi-client.ts';
import type { AgentSource, AgentBinding, AgentAttachment, RuntimeSummary, ModelInput, PiImage, PiSession, PiSnapshot, SendReceipt, ConversationDeleteTarget, ConversationDeleteReceipt } from './pi-client.ts';
import { parsePromptDisposition } from './pi-contract.ts';
import {useAgentObjects} from './use-agent-objects.ts';
import { usePiResources } from './use-pi-resources.ts';
import { useAgentSessionPins } from './use-agent-session-pins.ts';
import { MAX_AGENT_IMAGE_BYTES } from './agent-image-limits.ts';
interface ChatDraft { text:string; images:PiImage[] }
const emptyDraft=():ChatDraft=>({text:'',images:[]});
export function usePi(root:string|null){
  const {sessionPins,setSessionPinned,forgetSessionPins}=useAgentSessionPins(root);
  const [conversationKey,setConversationKey]=useState('default'),keyRef=useRef('default');
  const resources=usePiResources(root,conversationKey);
  const objects=useAgentObjects(root,conversationKey);
  const [uiAnswers,setUiAnswers]=useState<Record<string,string>>({});
  function setUiAnswer(id:string,value:string){setUiAnswers(before=>({...before,[`${keyRef.current}:${id}`]:value}));}
  const snapshots=useRef<Record<string,PiSnapshot>>({}),bindings=useRef<Record<string,AgentBinding>>({});
  const [source,setSource]=useState<AgentSource>({module:'agent',page:'agent',objectId:null});
  const [runtimeSummary,setRuntimeSummary]=useState<RuntimeSummary|null>(null);
  const runtimeReading=useRef<Promise<void>|null>(null),runtimeAgain=useRef(false),runtimeMetadata=useRef('');
  const [fileDrafts,setFileDrafts]=useState<Record<string,AgentAttachment[]>>({});
  const fileRef=useRef(fileDrafts);fileRef.current=fileDrafts;
  const deletedKeys=useRef(new Set<string>());
  const [stats,setStats]=useState<unknown>(null);
  function callPi<T=unknown>(command:string,args:Record<string,unknown>={},key=keyRef.current){return invokePi<T>(command,{...args,conversationKey:key});}
  function chooseKey(key:string){keyRef.current=key;setConversationKey(key);const saved=snapshots.current[key]??null;snap.current=saved;setSnapshot(saved);setError(null);setSource(bindings.current[key]?.source??{module:'agent',page:'agent',objectId:null});setStats(null);}
  function refreshRuntime():Promise<void>{
    if(!desktopPi()||!rootRef.current)return Promise.resolve();
    // Name changes can arrive after agent_settled while an older summary is
    // still in flight. Serialize reads and retain one follow-up refresh.
    if(runtimeReading.current){runtimeAgain.current=true;return runtimeReading.current;}
    const pending=(async()=>{
      do{
        runtimeAgain.current=false;const target=rootRef.current;
        if(!target||!mounted.current)return;
        try{
          const value=await invokePi<RuntimeSummary>('pi_runtime_summary');
          if(!mounted.current)return;
          if(rootRef.current!==target)continue;
          setRuntimeSummary(value);
          const metadata=JSON.stringify([target,value.conversations.map(slot=>[slot.conversationKey,slot.generation,slot.sessionId,slot.sessionFile,slot.name]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
          if(metadata!==runtimeMetadata.current){runtimeMetadata.current=metadata;void reloadSessions();}

        }catch(e){if(mounted.current&&rootRef.current===target)setError(piError(e));}
      }while(runtimeAgain.current);
    })();
    const complete=pending.finally(()=>{runtimeReading.current=null;});
    runtimeReading.current=complete;return complete;
  }

  const [snapshot,setSnapshot]=useState<PiSnapshot|null>(null);const snap=useRef<PiSnapshot|null>(null);
  const [error,setError]=useState<string|null>(null),[action,setAction]=useState<string|null>(null);
  const [drafts,setDrafts]=useState<Record<string,ChatDraft>>({});const draftRef=useRef(drafts);draftRef.current=drafts;
  const [acceptedInputs,setAcceptedInputs]=useState<Record<string,{id:string;draft:ChatDraft;files:AgentAttachment[];objects:AgentSource[];disposition:string}[]>>({});
  const transferred=useRef<Record<string,string>>({});
  const bindingPending=useRef(false),navigationEpoch=useRef(0);
  const [pendingDraftKey,setPendingDraftKey]=useState<string|null>(null);
  const [sessions,setSessions]=useState<PiSession[]>([]),[unreadable,setUnreadable]=useState(0),[sessionError,setSessionError]=useState<string|null>(null);
  const [cwd,setCwd]=useState(''),[notice,setNotice]=useOperationNotice<string|null>(null);
  const [modelForm,setModelForm]=useState({provider:'',baseUrl:'',api:'openai-completions',modelId:'',name:'',contextWindow:'128000',maxTokens:'8192',reasoning:false,supportsImages:false,apiKey:''});
  const [sessionName,setSessionName]=useState('');
  const [processChoices,setProcessChoices]=useState<Record<string,boolean>>({});
  const [displayRunStart,setDisplayRunStart]=useState(0);
  const runTrack=useRef<{context:string;count:number;activity:string;start:number}|null>(null);
  const chatScroll=useRef<Record<string,{top:number;following:boolean}>>({});
  function chooseProcess(key:string,open:boolean){setProcessChoices(before=>({...before,[key]:open}));}
  function rememberChatScroll(key:string,top:number,following:boolean){chatScroll.current[key]={top,following};}
  function readChatScroll(key:string){return chatScroll.current[key];}
  const actionRef=useRef<string|null>(null),stopRef=useRef(false),pulling=useRef(false),again=useRef(false),mounted=useRef(false),sessionsReading=useRef<Promise<void>|null>(null),sessionsAgain=useRef(false);
  const rootRef=useRef(root);rootRef.current=root;
  const autoStarted=useRef(new Set<string>());
  const connectRef=useRef(connect);connectRef.current=connect;
  function acceptSnapshot(value:PiSnapshot,key=keyRef.current){
    if(deletedKeys.current.has(key))return;
    if(value.state)transferDraft(`unconnected:${key}`,value.state.sessionId);
    snapshots.current[key]=value;if(key!==keyRef.current)return;
    if (value.notice && (snap.current || actionRef.current) && (value.notice !== snap.current?.notice || value.generation !== snap.current?.generation)) notifyOperation(value.notice);
    const context=`${rootRef.current}/${value.state?.sessionId??'unconnected'}/${value.generation}`;
    const previous=runTrack.current,projection=value.projection;
    const start=previous?.context!==context?projection.messages.length
      :previous.activity==='idle'&&projection.activity!=='idle'?previous.count:previous.start;
    runTrack.current={context,count:projection.messages.length,activity:projection.activity,start};
    setDisplayRunStart(start);snap.current=value;setSnapshot(value);
  }
  const refresh=useCallback(async()=>{
    if(!desktopPi()||!rootRef.current)return;
    if(pulling.current){again.current=true;return;}
    pulling.current=true;let requestingKey=keyRef.current;
    try{do{again.current=false;const key=keyRef.current;requestingKey=key;if(deletedKeys.current.has(key))return;const v=parseSnapshot(await callPi('pi_snapshot',{},key));if(!mounted.current)return;const old=snapshots.current[key];if(!old||v.generation>old.generation||v.generation===old.generation&&v.seq>=old.seq){acceptSnapshot(v,key);}}while(again.current);}
    catch(e){if(mounted.current&&!deletedKeys.current.has(requestingKey)&&requestingKey===keyRef.current)setError(piError(e));}
    finally{pulling.current=false;}
  },[]);
  const reloadSessions=useCallback(():Promise<void>=>{
    if(!desktopPi()||!rootRef.current)return Promise.resolve();
    if(sessionsReading.current){sessionsAgain.current=true;return sessionsReading.current;}
    const pending=(async()=>{
      do{
        sessionsAgain.current=false;const target=rootRef.current;
        if(!target||!mounted.current)return;
        try{
          const value=parseSessions(await callPi('pi_sessions'));
          if(!mounted.current)return;
          if(rootRef.current!==target)continue;
          setSessions(value.sessions);setUnreadable(value.unreadable);setSessionError(null);
        }catch(e){if(mounted.current&&rootRef.current===target)setSessionError(piError(e));}
      }while(sessionsAgain.current);
    })();
    const complete=pending.finally(()=>{sessionsReading.current=null;});
    sessionsReading.current=complete;return complete;
  },[]);
  useEffect(()=>{
    mounted.current=true;let disposed=false;let unlisten:(()=>void)|undefined;
    if(root&&desktopPi())void listen<{conversationKey?:string}>('azcine-pi-changed',event=>{if(!event.payload?.conversationKey||event.payload.conversationKey===keyRef.current)void refresh();void refreshRuntime();}).then(off=>{if(disposed){off();return;}unlisten=off;
      void (async()=>{const initial=parseSnapshot(await callPi('pi_snapshot'));if(disposed||rootRef.current!==root)return;
        const previous=snap.current;if(!previous||initial.generation>previous.generation||initial.generation===previous.generation&&initial.seq>=previous.seq)acceptSnapshot(initial);
        if(!autoStarted.current.has(root)){autoStarted.current.add(root);if(snap.current?.connection==='disconnected'&&!snap.current.busy&&!actionRef.current)await connectRef.current();}
        if(!disposed)await reloadSessions();})().catch(e=>{if(!disposed)setError(piError(e));});}).catch(e=>{if(!disposed)setError(piError(e));});
    return()=>{disposed=true;mounted.current=false;unlisten?.();};
  },[root,refresh,reloadSessions]);
  const draftKey=pendingDraftKey??snapshot?.state?.sessionId??`unconnected:${conversationKey}`;const draft=drafts[draftKey]??emptyDraft();
  function updateDraft(key:string,transform:(d:ChatDraft)=>ChatDraft){while(transferred.current[key])key=transferred.current[key];setDrafts(before=>{const next={...before,[key]:transform(before[key]??emptyDraft())};draftRef.current=next;return next;});}
  function setText(text:string){updateDraft(draftKey,d=>({...d,text}));}
  function setImages(images:PiImage[],key=draftKey){updateDraft(key,d=>({...d,images}));}
  function transferDraft(from:string,to:string){
    if(from===to)return;
    transferred.current[from]=to;
    for(const [alias,target] of Object.entries(transferred.current))if(target===from)transferred.current[alias]=to;
    setDrafts(before=>{
      const incoming=before[from];if(!incoming)return before;
      const existing=before[to]??emptyDraft(),text=existing.text&&incoming.text&&existing.text!==incoming.text?`${existing.text}\n${incoming.text}`:existing.text||incoming.text;
      const next={...before,[to]:{text,images:[...existing.images,...incoming.images.filter(image=>!existing.images.some(saved=>saved.id===image.id))]}};
      delete next[from];
      draftRef.current=next;return next;
    });
  }
  async function operate(name:string,work:()=>Promise<void>){if(actionRef.current)return;actionRef.current=name;setAction(name);setError(null);setNotice(null);try{await work();}catch(e){setError(piError(e));}finally{actionRef.current=null;setAction(null);await refresh();}}
  async function ensureBinding(target:AgentSource,fresh=false){const binding=await invokePi<AgentBinding>('agent_bind',{source:target,fresh});bindings.current[binding.conversationKey]=binding;return binding;}
  async function connectBinding(binding:AgentBinding,session?:PiSession,reconnect=false){
    const key=binding.conversationKey,pendingKey=`unconnected:${key}`;
    if(keyRef.current==='default')transferDraft('unconnected:default',pendingKey);
    chooseKey(key);
    await operate('连接',async()=>{const v=parseSnapshot(await callPi('pi_connect',{cwd:session?.cwd??binding.cwd??(cwd.trim()||null),sessionPath:session?.path??binding.sessionPath,reconnect},key));
      if(v.state)transferDraft(pendingKey,v.state.sessionId);
      acceptSnapshot(v,key);await invokePi('agent_remember',{conversationKey:key});await reloadSessions();await refreshRuntime();});
  }
  async function connect(session?:PiSession,reconnect=false){
    const epoch=navigationEpoch.current;
    try{const binding=session?await ensureBinding({module:'agent',page:'agent',objectId:session.id}):bindings.current[keyRef.current]??await ensureBinding({module:'agent',page:'agent',objectId:null});if(epoch!==navigationEpoch.current)return;await connectBinding(binding,session,reconnect);}catch(e){setError(piError(e));}
  }
  async function openSource(target:AgentSource,fresh=false){if(actionRef.current||bindingPending.current)return;bindingPending.current=true;++navigationEpoch.current;const pending=pendingDraftKey??`pending:${crypto.randomUUID()}`;setPendingDraftKey(pending);setAction('连接');try{const binding=await ensureBinding(target,fresh);const destination=snapshots.current[binding.conversationKey]?.state?.sessionId??`unconnected:${binding.conversationKey}`;transferDraft(pending,destination);setPendingDraftKey(null);await connectBinding(binding);}catch(e){setError(piError(e));}finally{bindingPending.current=false;if(!actionRef.current)setAction(null);}}
  async function selectConversation(key:string){if(actionRef.current)return;chooseKey(key);await refresh();if(snap.current?.connection==='disconnected'){const binding=bindings.current[key]??await invokePi<AgentBinding>('agent_conversation',{conversationKey:key});bindings.current[key]=binding;await connectBinding(binding);}await refreshRuntime();}
  async function prepareRedo(key:string,text:string,sources:AgentSource[]=[]){await selectConversation(key);objects.restore(key,sources);const target=snap.current?.state?.sessionId??`unconnected:${key}`;updateDraft(target,d=>({...d,text:d.text?`${d.text}\n${text}`:text}));}
  async function newConversation(){await openSource(bindings.current[keyRef.current]?.source??{module:'agent',page:'agent',objectId:null},true);}
  async function deleteConversations(targets:ConversationDeleteTarget[]):Promise<{deleted:string[];errors:{sessionId:string;error:string}[]}>{
    const result:{deleted:string[];errors:{sessionId:string;error:string}[]}={deleted:[],errors:[]};
    if(actionRef.current||bindingPending.current)return{deleted:[],errors:targets.map(target=>({sessionId:target.sessionId,error:'正在处理其他会话操作，请稍后再试。'}))};
    if(!targets.length)return result;
    actionRef.current='删除会话';setAction('删除会话');++navigationEpoch.current;
    let currentDeleted=false,replacement:AgentBinding|null=null;const previousSource=bindings.current[keyRef.current]?.source??source;
    try{
      for(const target of [...new Map(targets.map(target=>[target.sessionId,target])).values()]){
        try{
          const receipt=await invokePi<ConversationDeleteReceipt>('agent_delete_conversation',{target:{conversationKey:target.conversationKey,sessionPath:target.sessionPath,sessionId:target.sessionId,generation:target.generation}});
          if(receipt.deleted!==true||receipt.sessionId!==target.sessionId||!Array.isArray(receipt.conversationKeys)||!receipt.conversationKeys.every(key=>typeof key==='string'))throw new Error('删除回执不完整，请刷新会话列表核对。');
          result.deleted.push(target.sessionId);const removed=new Set(receipt.conversationKeys);currentDeleted ||=removed.has(keyRef.current);
          const sharedNative=Object.entries(snapshots.current).some(([key,value])=>!removed.has(key)&&value.state?.sessionId===target.sessionId);
          for(const key of removed){deletedKeys.current.add(key);delete snapshots.current[key];delete bindings.current[key];objects.restore(key,[]);}
          setFileDrafts(before=>{const next={...before};for(const key of removed)delete next[key];return next;});
          setDrafts(before=>{const next={...before};for(const key of removed)delete next[`unconnected:${key}`];if(!sharedNative)delete next[target.sessionId];draftRef.current=next;return next;});
          if(!sharedNative)setAcceptedInputs(before=>{const next={...before};delete next[target.sessionId];return next;});
          setSessions(before=>before.filter(session=>session.id!==target.sessionId));
          setRuntimeSummary(before=>before?{...before,conversations:before.conversations.filter(row=>!removed.has(row.conversationKey))}:before);
        }catch(error){result.errors.push({sessionId:target.sessionId,error:piError(error)});}
      }
      forgetSessionPins(result.deleted);
      if(currentDeleted){snap.current=null;setSnapshot(null);setError(null);try{replacement=await ensureBinding(previousSource,true);chooseKey(replacement.conversationKey);}catch(error){setError('会话已删除，新会话尚未连接：'+piError(error));}}
      if(result.deleted.length)setNotice(`已删除 ${result.deleted.length} 个会话${result.errors.length?'，部分会话未删除。':'。'}`);
    }finally{actionRef.current=null;setAction(null);}
    if(replacement)await connectBinding(replacement);
    await reloadSessions();await refreshRuntime();return result;
  }
  async function deleteConversation(target:ConversationDeleteTarget):Promise<{deleted:boolean;error?:string}>{const result=await deleteConversations([target]);return{deleted:result.deleted.includes(target.sessionId),error:result.errors[0]?.error};}
  async function disconnect(){if(rootRef.current)autoStarted.current.add(rootRef.current);await operate('断开',async()=>{await callPi('pi_disconnect');await reloadSessions();});}
  async function send(behavior:string|null){
    if(snap.current?.connection==='disconnected'){const binding=bindings.current[keyRef.current];if(binding)await connectBinding(binding);}
    const s=snap.current,key=s?.state?.sessionId??`unconnected:${keyRef.current}`,current=draftRef.current[key]??emptyDraft();
    if(!s?.state){setError('请先连接原版 Pi；消息和附件仍保留。');return;}
    const before={text:current.text,images:[...current.images]};
    await operate('发送',async()=>{
      const conversation=keyRef.current;const files=[...(fileRef.current[conversation]??[])];const sentObjects=[...objects.objects];const reply=await invokePi<SendReceipt>('agent_send',{request:{conversationKey:conversation,input:{generation:s.generation,sessionId:s.state!.sessionId,message:before.text,images:before.images.map(i=>({data:i.data,mimeType:i.mimeType})),behavior},objects:sentObjects,attachments:files.map(f=>f.id)}});
      const disposition=parsePromptDisposition(reply);
      if(reply.generation!==s.generation||reply.sessionId!==key)throw new Error('发送回执与原会话不一致，输入保留；不要自动重发，请先核对原生会话。');
      setAcceptedInputs(previous=>({...previous,[key]:[...(previous[key]??[]).slice(-19),{id:crypto.randomUUID(),draft:before,files,objects:sentObjects,disposition}]}));
      const clearMatching=(latest:ChatDraft)=>latest.text===before.text&&latest.images.length===before.images.length&&latest.images.every((v,i)=>v.id===before.images[i]?.id)?emptyDraft():latest;
      updateDraft(key,clearMatching);if(transferred.current[key])updateDraft(transferred.current[key],clearMatching);setFileDrafts(previous=>({...previous,[conversation]:(previous[conversation]??[]).filter(file=>!files.some(sent=>sent.id===file.id))}));objects.clearSent(conversation,sentObjects);await invokePi('agent_remember',{conversationKey:conversation});await refreshRuntime();
      setNotice(disposition==='handled'?'原生命令已处理，不代表任务完成。':disposition==='queued'?'消息已排队，尚未执行完成。':'原版已接受消息，等待实际回复与终态。');
    });
  }
  async function stop(){if(rootRef.current)autoStarted.current.add(rootRef.current);if(stopRef.current)return;stopRef.current=true;const s=snap.current;setError(null);try{if(s?.connection==='connecting'||s?.busy)await callPi('pi_disconnect');else if(s?.state)await callPi('pi_stop',{generation:s.generation,sessionId:s.state.sessionId});else await callPi('pi_disconnect');}catch(e){setError(piError(e));}finally{stopRef.current=false;await refresh();await reloadSessions();}}
  async function sessionAction(command:string,fields:Record<string,unknown>={}){if(command==='pi_new_session'){await newConversation();return;}if(command==='pi_switch_session'){const session=sessions.find(row=>row.path===fields.path);if(session)await connect(session);return;}const s=snap.current;if(!s?.state)return;await operate('会话操作',async()=>{await callPi(command,{generation:s.generation,sessionId:s.state!.sessionId,...fields});if(command==='pi_name_session')setSessionName('');await reloadSessions();});}
  async function saveConfiguration(command:'pi_save_model'|'pi_save_provider',input:unknown):Promise<{saved:boolean;connected:boolean;message:string}|null>{if(actionRef.current)return null;let receipt:{saved:boolean;connected:boolean;message:string}|null=null;const oldKey=draftKey;await operate('保存模型',async()=>{const result=await callPi<{saved:boolean;connected:boolean;message:string}>(command,{input});if(result.saved!==true||typeof result.connected!=='boolean'||typeof result.message!=='string')throw new Error('模型保存结果不完整，输入保留。');receipt=result;setNotice(result.message);await refresh();const id=snap.current?.state?.sessionId;if(id&&id!==oldKey)setDrafts(before=>{const next={...before};if(before[oldKey]&&!before[id])next[id]=before[oldKey];draftRef.current=next;return next;});await reloadSessions();});return receipt;}
  async function saveModel(input:ModelInput){return (await saveConfiguration('pi_save_model',input))?.saved===true;}
  function recoverQueue(index:number){const text=snapshot?.recoveredQueue[index];if(text!==undefined)updateDraft(draftKey,d=>({...d,text:d.text?`${d.text}\n${text}`:text}));}
  function recoverAccepted(id:string){const item=(acceptedInputs[draftKey]??[]).find(v=>v.id===id);if(!item)return;const current=draftRef.current[draftKey]??emptyDraft();if(current.text||current.images.length||(fileRef.current[keyRef.current]??[]).length||objects.objects.length){setError('输入区已有内容，请先保留或发送当前草稿，再取回这次消息，避免覆盖。');return;}updateDraft(draftKey,()=>({...item.draft,images:[...item.draft.images]}));setFileDrafts(before=>({...before,[keyRef.current]:[...item.files]}));objects.restore(keyRef.current,item.objects);}
  async function attachFile(file:File,key=keyRef.current){try{const image=/\.(png|jpe?g|webp|gif)$/i.test(file.name);if(file.size>(image?MAX_AGENT_IMAGE_BYTES:16*1024*1024))throw new Error(image?'图片每张不超过50MB，原件和输入保留。':'每个文件不超过16MiB，原件和输入保留。');if((fileRef.current[key]??[]).length>=16)throw new Error('最多附加16个文件。');const attachment=await invokePi<AgentAttachment>('agent_attach_file',{input:{name:file.name,mimeType:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))}});setFileDrafts(before=>{const next={...before,[key]:[...(before[key]??[]),attachment]};fileRef.current=next;return next;});}catch(e){setError(piError(e));}}
  function removeFile(id:string){const key=keyRef.current;setFileDrafts(before=>({...before,[key]:(before[key]??[]).filter(f=>f.id!==id)}));}
  async function respondUi(id:string,response:{cancelled?:boolean;value?:string;confirmed?:boolean}){const s=snap.current;if(!s?.state)return;const key=keyRef.current;try{await callPi('pi_respond_ui',{input:{generation:s.generation,sessionId:s.state.sessionId,id,cancelled:response.cancelled??false,value:response.value??null,confirmed:response.confirmed??null}},key);await refresh();}catch(e){setError(piError(e));}}
  async function refreshStats(){const s=snap.current;if(!s?.state)return;const key=keyRef.current;try{const value=await callPi('pi_stats',{generation:s.generation,sessionId:s.state.sessionId},key);if(key===keyRef.current)setStats(value);}catch(e){setError(piError(e));}}
  async function saveLimit(replyLimit:number){try{if(!runtimeSummary)return;setRuntimeSummary(await invokePi<RuntimeSummary>('pi_save_runtime',{replyLimit,revision:runtimeSummary.revision}));setNotice('同时回复上限已保存，运行中的会话继续完成。');}catch(e){setError(piError(e));}}
  function takeEditor(){const text=snapshot?.extensions?.editor?.text;if(text===undefined)return;updateDraft(draftKey,d=>({...d,text:d.text?`${d.text}\n${text}`:text}));}
  return {sessionPins,setSessionPinned,uiAnswers:Object.fromEntries(Object.entries(uiAnswers).filter(([key])=>key.startsWith(`${conversationKey}:`)).map(([key,value])=>[key.slice(conversationKey.length+1),value])),setUiAnswer,prepareRedo,conversationKey,source,openSource,newConversation,deleteConversation,deleteConversations,selectConversation,runtimeSummary,refreshRuntime,saveLimit,objects,files:fileDrafts[conversationKey]??[],attachFile,removeFile,respondUi,stats,refreshStats,takeEditor,snapshot,error,notice,action,connected:desktopPi(),root,draft,draftKey,setText,setImages,cwd,setCwd,sessions,unreadable,sessionError,refresh,reloadSessions,connect,disconnect,send,stop,sessionAction,saveModel,saveConfiguration,recoverQueue,acceptedInputs:acceptedInputs[draftKey]??[],recoverAccepted,modelForm,setModelForm,sessionName,setSessionName,processChoices,chooseProcess,rememberChatScroll,readChatScroll,displayRunStart,resources};
}
export type PiController=ReturnType<typeof usePi>;
