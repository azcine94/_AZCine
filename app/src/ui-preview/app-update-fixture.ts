import { useState } from 'react';
import type { AppUpdateController, UpdateStatus } from '../use-app-update.ts';
export function usePreviewUpdate(state:string):AppUpdateController {
  const stage:UpdateStatus['stage']=state==='update-current'?'current':state==='update-ready'?'ready':state==='update-downloading'?'downloading':state==='update-error'?'error':'available';
  const [status,setStatus]=useState<UpdateStatus>({version:'0.1.0',enabled:state!=='update-development',stage,nextVersion:stage==='error'||stage==='current'?null:'0.2.0',notes:'虚构更新说明：改善数据目录体验，修复会话恢复问题。',downloaded:12582912,total:50331648,error:stage==='error'?'虚构错误：网络暂时不可用，现有版本仍可使用。':null});
  return {status,connected:true,requestError:'',check:async()=>setStatus(before=>({...before,stage:'available',nextVersion:'0.2.0',error:null})),download:async()=>setStatus(before=>({...before,stage:'ready',downloaded:50331648})),install:async()=>setStatus(before=>({...before,stage:'installing'}))};
}
