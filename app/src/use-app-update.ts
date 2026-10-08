import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri, listen } from './desktop-api.ts';

export interface UpdateStatus {
  version: string; enabled: boolean;
  stage: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  nextVersion: string | null; notes: string | null; downloaded: number; total: number | null; error: string | null;
}
const initial: UpdateStatus = {version:'',enabled:false,stage:'idle',nextVersion:null,notes:null,downloaded:0,total:null,error:null};
export function useAppUpdate() {
  const [status,setStatus]=useState(initial);
  const [requestError,setRequestError]=useState('');
  const pending=useRef(false);
  const connected=isTauri();
  useEffect(()=>{
    if(!connected)return;
    let active=true,events=0;let unlisten:undefined|(()=>void);
    void (async()=>{
      unlisten=await listen<UpdateStatus>('azcine-update-changed',event=>{events++;if(active)setStatus(event.payload);});
      if(!active){unlisten();return;}
      const seen=events;
      const value=await invoke<UpdateStatus>('app_update_status');
      if(active&&seen===events)setStatus(value);
    })().catch(()=>{if(active)setRequestError('版本信息未能读取，请重新进入此页。');});
    return()=>{active=false;unlisten?.();};
  },[connected]);
  async function run(command:'app_update_check'|'app_update_download'|'app_update_install') {
    if(!connected||pending.current)return;
    pending.current=true;setRequestError('');
    try {await invoke(command);setStatus(await invoke<UpdateStatus>('app_update_status'));}
    catch(error){setRequestError(typeof error==='object'&&error!==null&&'message' in error ? String(error.message) : '更新操作未完成，请重试。');}
    finally{pending.current=false;}
  }
  return {status,requestError,connected,check:()=>run('app_update_check'),download:()=>run('app_update_download'),install:()=>run('app_update_install')};
}
export type AppUpdateController=ReturnType<typeof useAppUpdate>;
