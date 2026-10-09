import {useEffect,useRef,useState} from 'react';
import {invoke,isTauri} from './desktop-api.ts';
import {workspaceError} from './workspace-contract.ts';
import {notifyOperation} from './components/ui/operation-toast.tsx';
export interface GithubProject{id:string;name:string;fullName:string;title:string;summary:string;author:string;language:string;updatedAt:string;views:number|null;comments:number|null}
export interface GithubSnapshot{items:GithubProject[];fetchedAt:string|null;nextPage:number;hasMore:boolean;revision:number}
export interface GithubController{root:string|null;snapshot:GithubSnapshot|null;loading:boolean;busy:boolean;error:string;refresh:(append?:boolean)=>Promise<void>;open:(repositoryName?:string)=>Promise<void>;avatar?:(owner:string)=>Promise<string>}
export function useGithubProjects(root:string|null,visible:boolean):GithubController{
  const [snapshot,setSnapshot]=useState<GithubSnapshot|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const epoch=useRef(0),busyRef=useRef(false),rootRef=useRef(root),loaded=useRef(false);rootRef.current=root;
  useEffect(()=>{++epoch.current;loaded.current=false;busyRef.current=false;setSnapshot(null);setError('');setLoading(false);setBusy(false);return()=>{++epoch.current;};},[root]);
  async function refresh(append=false){
    const target=rootRef.current;if(!target||!isTauri()||busyRef.current)return;
    const ticket=epoch.current;busyRef.current=true;setBusy(true);setError('');
    try{const next=await invoke<GithubSnapshot>('github_projects_refresh',{expectedRoot:target,append});if(ticket===epoch.current){setSnapshot(next);notifyOperation(`已读取 ${next.items.length} 个项目`);}}
    catch(e){if(ticket===epoch.current)setError(workspaceError(e));}
    finally{if(ticket===epoch.current){busyRef.current=false;setBusy(false);}}
  }
  useEffect(()=>{
    if(!root||!visible||!isTauri()||loaded.current)return;
    const ticket=epoch.current;let active=true;loaded.current=true;setLoading(true);
    void invoke<GithubSnapshot>('github_projects_snapshot',{expectedRoot:root}).then(next=>{if(active&&ticket===epoch.current){setSnapshot(next);setError('');if(!next.fetchedAt)void refresh();}}).catch(e=>{if(active&&ticket===epoch.current){setError(workspaceError(e));loaded.current=false;}}).finally(()=>{if(active&&ticket===epoch.current)setLoading(false);});
    return()=>{active=false;loaded.current=false;};
  },[root,visible]);
  async function open(repositoryName?:string){try{await invoke('github_project_open',{repositoryName:repositoryName??null});}catch(e){setError(workspaceError(e));}}
  return {root,snapshot,loading,busy,error,refresh,open};
}

const avatars=new Map<string,Promise<string>>();let activeAvatars=0;const waiting:Array<()=>void>=[];
async function avatarSlot<T>(run:()=>Promise<T>):Promise<T>{if(activeAvatars>=4)await new Promise<void>(resolve=>waiting.push(resolve));else activeAvatars++;try{return await run();}finally{const next=waiting.shift();if(next)next();else activeAvatars--;}}
export function githubAvatar(root:string,owner:string):Promise<string>{
  const key=JSON.stringify([root,owner]);const previous=avatars.get(key);if(previous)return previous;
  const request=avatarSlot(async()=>{const image=await invoke<{mime:string;bytes:number[]}>('github_project_avatar',{expectedRoot:root,ownerName:owner});if(!['image/png','image/jpeg','image/webp','image/gif'].includes(image.mime)||image.bytes.length>2*1024*1024)throw new Error('头像格式无效');let binary='';for(let i=0;i<image.bytes.length;i+=8192)binary+=String.fromCharCode(...image.bytes.slice(i,i+8192));return `data:${image.mime};base64,${btoa(binary)}`;});
  avatars.set(key,request);request.catch(()=>avatars.delete(key));return request;
}
