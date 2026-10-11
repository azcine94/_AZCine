import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { invoke, isTauri, listen } from './desktop-api.ts';
import { workspaceError } from './workspace-contract.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';

export interface LibraryRegion { kind:'pin'|'box'; x:number; y:number; w:number; h:number }
export interface LibraryNote { id:string; text:string; region:LibraryRegion|null }
export interface LibraryAsset { id:string; name:string; filename:string; groupId:string; kind:'image'|'video'; mime:string; bytes:number; hash:string; source:string; sourceUrl:string; createdAt:string; tags:string[]; notes:LibraryNote[]; revision:number }
export interface LibraryGroup { id:string; name:string; revision:number }
export interface LibrarySnapshot { assets:LibraryAsset[]; groups:LibraryGroup[] }
export interface LibraryBridge { endpoint:string; token:string; root:string; connected:boolean }
export interface LibraryInstall { directory:string; chromeOpened:boolean; folderOpened:boolean }
export interface LibraryImport { id:string; file:File; groupId:string; status:'queued'|'uploading'|'error'|'done'; error:string }
export interface LibraryState extends LibrarySnapshot { loading:boolean; error:string; busy:string; bridge:LibraryBridge|null; imports:LibraryImport[]; drafts:Record<string,LibraryAsset>; noteDrafts:Record<string,{id:string;text:string;region:LibraryRegion|null}> }
export const emptyLibraryState = ():LibraryState => ({assets:[],groups:[],loading:false,error:'',busy:'',bridge:null,imports:[],drafts:{},noteDrafts:{}});
export class LibraryStore {
  root:string;
  state:LibraryState=emptyLibraryState();
  private listeners=new Set<()=>void>();
  private request=0;
  private started=false;
  private upload:AbortController|null=null;
  constructor(root:string){this.root=root;}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
  snapshot=()=>this.state;
  put=(patch:Partial<LibraryState>)=>{this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());};
  async start(){if(this.started||!this.root||!isTauri())return;this.started=true;await listen('inspiration-changed',()=>void this.refresh()).catch(()=>{});await this.refresh();}
  async connect(){const bridge=await invoke<LibraryBridge>('inspiration_bridge',{root:this.root});this.put({bridge});return bridge;}
  async refresh(){
    if(!isTauri())return;const request=++this.request;this.put({loading:true});
    try{const [data,bridge]=await Promise.all([invoke<LibrarySnapshot>('inspiration_snapshot',{root:this.root}),this.connect()]);if(request===this.request)this.put({...data,bridge,error:''});}
    catch(e){if(request===this.request)this.put({error:workspaceError(e)});}
    finally{if(request===this.request)this.put({loading:false});}
  }
  media(asset:LibraryAsset){const b=this.state.bridge;return b?`${b.endpoint}/media/${asset.id}?token=${encodeURIComponent(b.token)}`:'';}
  draft(asset:LibraryAsset){return this.state.drafts[asset.id]??asset;}
  edit(asset:LibraryAsset,patch:Partial<Pick<LibraryAsset,'name'|'groupId'|'tags'|'notes'>>){const draft={...this.draft(asset),...patch};this.put({drafts:{...this.state.drafts,[asset.id]:draft}});}
  setNoteDraft(id:string,draft:{id:string;text:string;region:LibraryRegion|null}){this.put({noteDrafts:{...this.state.noteDrafts,[id]:draft}});}
  async save(asset:LibraryAsset):Promise<LibraryAsset>{
    if(this.state.busy)throw new Error('请等待当前操作完成。');
    const sent=this.draft(asset);this.put({busy:asset.id});
    try{const saved=await invoke<LibraryAsset>('inspiration_save',{root:this.root,asset:sent});
      const drafts={...this.state.drafts};if(drafts[asset.id]===sent)delete drafts[asset.id];else if(drafts[asset.id])drafts[asset.id]={...drafts[asset.id],revision:saved.revision};
      ++this.request;this.put({assets:this.state.assets.map(a=>a.id===saved.id?saved:a),drafts,loading:false});notifyOperation('素材信息与批注已保存');void this.refresh();return saved;
    }finally{this.put({busy:''});}
  }
  async group(group:LibraryGroup,remove=false){
    if(this.state.busy)throw new Error('请等待当前操作完成。');this.put({busy:'group'});
    try{const data=await invoke<LibrarySnapshot>('inspiration_group',{root:this.root,group,remove});++this.request;this.put({...data,loading:false});notifyOperation(remove?'空分组已删除':'分组已保存');}
    finally{this.put({busy:''});}
  }
  async move(ids:string[],groupId:string){
    if(this.state.busy)throw new Error('请等待当前操作完成。');
    if(ids.some(id=>this.state.drafts[id]))throw new Error('选中的素材还有编辑草稿，请先保存，再移动分组。');
    this.put({busy:'move'});
    try{const items=this.state.assets.filter(a=>ids.includes(a.id)).map(a=>({id:a.id,revision:a.revision}));const data=await invoke<LibrarySnapshot>('inspiration_move',{root:this.root,items,groupId});++this.request;this.put({...data,loading:false});notifyOperation(`已移动 ${items.length} 个素材`);}
    finally{this.put({busy:''});}
  }
  async local(asset:LibraryAsset,operation:'open'|'reveal'|'delete'){
    if(this.state.busy)throw new Error('请等待当前操作完成。');
    this.put({busy:operation});
    try{await invoke('inspiration_local',{root:this.root,id:asset.id,revision:asset.revision,operation});
      if(operation==='delete'){const drafts={...this.state.drafts},noteDrafts={...this.state.noteDrafts};delete drafts[asset.id];delete noteDrafts[asset.id];++this.request;this.put({assets:this.state.assets.filter(a=>a.id!==asset.id),drafts,noteDrafts,loading:false});notifyOperation('素材已删除，导入前的原文件未修改。');}
    }finally{this.put({busy:''});}
  }
  enqueue(files:File[],groupId:string){
    const incoming=files.map(file=>({id:crypto.randomUUID(),file,groupId,status:'queued' as const,error:''}));this.put({imports:[...this.state.imports,...incoming]});void this.runImports();
  }
  retry(id:string){this.put({imports:this.state.imports.map(item=>item.id===id?{...item,status:'queued',error:''}:item)});void this.runImports();}
  cancel(){this.upload?.abort();}
  private async runImports(){
    if(this.upload)return;
    while(this.state.imports.some(item=>item.status==='queued')){
      const item=this.state.imports.find(item=>item.status==='queued')!;const controller=new AbortController();this.upload=controller;
      const update=(status:LibraryImport['status'],error='')=>this.put({imports:this.state.imports.map(i=>i.id===item.id?{...i,status,error}:i)});
      update('uploading');
      try{if(!item.file.size||item.file.size>256*1024*1024)throw new Error('文件为空或超过256MiB。');
        const bridge=this.state.bridge??await this.connect();const meta={id:item.id,name:item.file.name.slice(0,200),groupId:item.groupId,source:'本地导入',sourceUrl:''};
        const response=await fetch(bridge.endpoint+'/import',{method:'POST',headers:{'X-Azcine-Token':bridge.token,'X-Azcine-Meta':encodeURIComponent(JSON.stringify(meta)),'Content-Type':'application/octet-stream'},body:item.file,signal:controller.signal});
        const asset=await response.json() as LibraryAsset&{message?:string};if(!response.ok)throw new Error(asset.message||'导入失败。');
        ++this.request;this.put({assets:[asset,...this.state.assets.filter(a=>a.id!==asset.id)],loading:false});update('done');notifyOperation('已导入 '+asset.name);
      }catch(e){update('error',controller.signal.aborted?'已停止等待；可能已入库，重试会核对同一编号，不重复导入。':workspaceError(e));}
      finally{this.upload=null;}
    }
    void this.refresh();
  }
}
const stores=new Map<string,LibraryStore>();
export function useInspirationLibrary(root:string){
  const model=useMemo(()=>{let store=stores.get(root);if(!store){store=new LibraryStore(root);stores.set(root,store);}return store;},[root]);
  const state=useSyncExternalStore(model.subscribe,model.snapshot);useEffect(()=>{void model.start();},[model]);return {model,state};
}
export function formatLibraryBytes(bytes:number){return bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':(bytes/1024).toFixed(1)+' KB';}
