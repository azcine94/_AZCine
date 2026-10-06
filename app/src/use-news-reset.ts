import { useOperationNotice } from './components/ui/operation-toast.tsx';
import {useEffect,useRef,useState} from 'react';
import {invoke,isTauri} from './desktop-api.ts';
import {workspaceError} from './workspace-contract.ts';
export type NewsResetMode='results'|'all'|'history'|`history:${string}`;
export const isHistoryReset=(mode:NewsResetMode)=>mode==='history'||mode.startsWith('history:');
interface ResetPreview {mode:NewsResetMode;token:string;materials:number;articles:number;tasks:number;editions:number}
interface ResetResult {removed:ResetPreview;warning:string|null}
export function useNewsReset(root:string|null){
  const [request,setRequest]=useState<(ResetPreview&{requestId:string})|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useOperationNotice('');
  const currentRoot=useRef(root),mounted=useRef(false),pending=useRef(false),generation=useRef(0);currentRoot.current=root;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  useEffect(()=>{generation.current++;setRequest(null);setBusy(false);setError('');setNotice('');},[root]);
  async function prepare(mode:NewsResetMode){
    if(!root||!isTauri()||pending.current)return;const target=root,seq=++generation.current;pending.current=true;setBusy(true);setError('');setNotice('');
    try{const preview=await invoke<ResetPreview>('news_reset_preview',{mode});if(preview.mode!==mode||!/^[0-9a-f]{64}$/.test(preview.token)||![preview.materials,preview.articles,preview.tasks,preview.editions].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('清理预览不完整，未确认操作。');if(mounted.current&&currentRoot.current===target&&seq===generation.current)setRequest({...preview,requestId:crypto.randomUUID()});}
    catch(e){if(mounted.current&&currentRoot.current===target&&seq===generation.current)setError(workspaceError(e));}
    finally{pending.current=false;if(mounted.current&&currentRoot.current===target&&seq===generation.current)setBusy(false);}
  }
  async function confirm(){
    if(!root||!request||pending.current)return;const target=root,seq=++generation.current;pending.current=true;setBusy(true);setError('');
    try{const result=await invoke<ResetResult>('news_reset_data',{requestId:request.requestId,mode:request.mode,token:request.token});if(result.removed?.mode!==request.mode||result.removed.token!==request.token)throw Error('清理回执不对应原请求，请保留原请求并重试核对。');if(mounted.current&&currentRoot.current===target&&seq===generation.current){setRequest(null);setNotice(result.warning??(isHistoryReset(request.mode)?'处理记录已删除，原始资料、资讯与处理标记保留。':request.mode==='all'?'已清空采集资料、整理结果与任务记录。现在可以重新采集最近24小时的资料。':'已清空整理结果与任务记录，原始资料保留，可以重新整理。'));}}
    catch(e){if(mounted.current&&currentRoot.current===target&&seq===generation.current)setError(workspaceError(e));}
    finally{pending.current=false;if(mounted.current&&currentRoot.current===target&&seq===generation.current)setBusy(false);}
  }
  return {request,busy,error,notice,prepare,confirm,cancel:()=>{if(!pending.current){setRequest(null);setError('');}}};
}
