import { notifyOperation } from './components/ui/operation-toast.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { callPi, desktopPi, piError } from './pi-client.ts';
import { parseProviders, parseRemoteModels } from './pi-provider-client.ts';
import type { ProviderModel, ProviderView, RemoteModels } from './pi-provider-client.ts';
import type { PiController } from './use-pi.ts';

export interface ModelDraft extends Omit<ProviderModel,'contextWindow'|'maxTokens'> { uid:string; persisted:boolean; contextWindow:string; maxTokens:string; limitsAssumed:boolean }
export interface ProviderDraft {
  uid:string; root:string; provider:string; baseUrl:string; api:string; apiKey:string; hasCredential:boolean; persisted:boolean; dirty:boolean; revision:number;
  models:ModelDraft[]; tab:'connection'|'models'|'advanced'; remote:RemoteModels|null; fetching:boolean; error:string|null; notice:string|null;
  selectedIds:string[]; modelQuery:string;
}
const id=()=>crypto.randomUUID();
function fromView(v:ProviderView,root:string,uid:string=id()):ProviderDraft{return {...v,uid,root,apiKey:'',persisted:true,dirty:false,revision:0,tab:'connection',remote:null,fetching:false,error:null,notice:null,selectedIds:[],modelQuery:'',models:v.models.map(m=>({...m,uid:id(),persisted:true,contextWindow:String(m.contextWindow),maxTokens:String(m.maxTokens),limitsAssumed:false}))};}
const signature=(v:ProviderDraft)=>JSON.stringify([v.provider,v.baseUrl,v.api,v.apiKey]);
export function usePiProviders(root:string|null,enabled:boolean,pi:PiController){
  const [all,setAll]=useState<ProviderDraft[]>([]),[selection,setSelection]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(false),[loadError,setLoadError]=useState<string|null>(null),[saving,setSaving]=useState<string|null>(null);
  const current=useRef(all);current.current=all;
  const rootRef=useRef(root);rootRef.current=root;
  const mounted=useRef(false),reads=useRef(new Set<string>()),loaded=useRef(new Set<string>()),requests=useRef(new Set<string>()),saveLock=useRef(false);
  const piRef=useRef(pi);piRef.current=pi;
  const change=useCallback((transform:(rows:ProviderDraft[])=>ProviderDraft[])=>setAll(before=>{const next=transform(before);current.current=next;return next;}),[]);
  const reload=useCallback(async()=>{
    const target=rootRef.current;if(!target||!desktopPi()||reads.current.has(target))return;
    reads.current.add(target);setLoading(true);setLoadError(null);
    try{const views=parseProviders(await callPi('pi_providers'));if(!mounted.current)return;
      loaded.current.add(target);
      change(before=>{
        const incoming=new Map(views.map(v=>[v.provider,v]));
        const kept=before.map<ProviderDraft>(d=>{if(d.root!==target)return d;const v=incoming.get(d.provider);if(!v)return d;incoming.delete(d.provider);
          return d.dirty?{...d,persisted:true,hasCredential:v.hasCredential}: {...fromView(v,target,d.uid),tab:d.tab,remote:d.remote,fetching:d.fetching,selectedIds:d.selectedIds,modelQuery:d.modelQuery,notice:d.notice,error:d.error};});
        return [...kept,...[...incoming.values()].map(v=>fromView(v,target))];
      });
    }catch(e){if(mounted.current&&rootRef.current===target)setLoadError(piError(e));}
    finally{reads.current.delete(target);if(mounted.current&&rootRef.current===target)setLoading(false);}
  },[change]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setLoading(!!root&&reads.current.has(root));setLoadError(null);if(root&&enabled&&!loaded.current.has(root))void reload();},[root,enabled,reload]);
  const providers=all.filter(v=>v.root===root),active=providers.find(v=>v.uid===selection[root??''])??providers[0]??null;
  function select(uid:string){if(root)setSelection(before=>({...before,[root]:uid}));}
  function addProvider(){if(!root)return;let n=1;while(providers.some(v=>v.provider===`provider-${n}`))n++;
    const uid=id();change(before=>[...before,{uid,root,provider:`provider-${n}`,baseUrl:'',api:'openai-completions',apiKey:'',hasCredential:false,persisted:false,dirty:true,revision:0,models:[],tab:'connection',remote:null,fetching:false,error:null,notice:null,selectedIds:[],modelQuery:''}]);select(uid);
  }
  function ui(uid:string,patch:Partial<Pick<ProviderDraft,'tab'|'selectedIds'|'modelQuery'>>){change(before=>before.map<ProviderDraft>(d=>d.uid===uid?{...d,...patch}:d));}
  function edit(uid:string,patch:Partial<Pick<ProviderDraft,'provider'|'baseUrl'|'api'|'apiKey'>>){change(before=>before.map<ProviderDraft>(d=>{
    if(d.uid!==uid)return d;if(d.persisted&&patch.provider!==undefined)return d;
    return {...d,...patch,dirty:true,revision:d.revision+1,error:null,notice:null,remote:null,selectedIds:[]};
  }));}
  function editModel(uid:string,modelUid:string,patch:Partial<Omit<ProviderModel,'contextWindow'|'maxTokens'>>&{contextWindow?:string;maxTokens?:string}){
    change(before=>before.map<ProviderDraft>(d=>d.uid!==uid?d:{...d,dirty:true,revision:d.revision+1,error:null,notice:null,models:d.models.map(m=>m.uid!==modelUid?m:{...m,...patch,id:m.persisted?m.id:patch.id??m.id,limitsAssumed:patch.contextWindow!==undefined||patch.maxTokens!==undefined?false:m.limitsAssumed})}));
  }
  function addManual(uid:string){change(before=>before.map<ProviderDraft>(d=>d.uid!==uid?d:{...d,dirty:true,revision:d.revision+1,tab:'models',models:[...d.models,{uid:id(),persisted:false,id:'',name:'',contextWindow:'32768',maxTokens:'4096',reasoning:false,supportsImages:false,baseUrl:'',api:'',limitsAssumed:true}]}));}
  function removeNew(uid:string,modelUid:string){change(before=>before.map<ProviderDraft>(d=>d.uid!==uid?d:{...d,dirty:true,revision:d.revision+1,models:d.models.filter(m=>m.uid!==modelUid||m.persisted)}));}
  function addSelected(uid:string){
    const sent=current.current.find(d=>d.uid===uid);
    if(sent?.remote){const ids=new Set(sent.models.map(m=>m.id));const selected=new Set(sent.selectedIds);const added=sent.remote.models.filter(m=>selected.has(m.id)&&!ids.has(m.id)).length;if(added&&sent.models.length+added<=200)notifyOperation(`已加入 ${added} 个模型，保存后生效。`);}
    change(before=>before.map<ProviderDraft>(d=>{
    if(d.uid!==uid||!d.remote)return d;const existing=new Set(d.models.map(m=>m.id));const selected=new Set(d.selectedIds);
    const additions=d.remote.models.filter(m=>selected.has(m.id)&&!existing.has(m.id)).map(m=>({...m,uid:id(),persisted:false,contextWindow:String(m.contextWindow??32768),maxTokens:String(m.maxTokens??4096),supportsImages:m.supportsImages??false,reasoning:false,baseUrl:'',api:'',limitsAssumed:m.contextWindow===null||m.maxTokens===null}));
    if(d.models.length+additions.length>200)return {...d,error:'每个服务商最多添加200个模型，请减少本次选择。'};
    return {...d,models:[...d.models,...additions],dirty:d.dirty||additions.length>0,revision:d.revision+(additions.length?1:0),selectedIds:[],notice:additions.length?`已加入 ${additions.length} 个模型，保存后生效。`:d.notice};
  }));}
  async function fetchModels(uid:string){const sent=current.current.find(v=>v.uid===uid);if(!sent||requests.current.has(uid)||sent.root!==rootRef.current)return;
    requests.current.add(uid);const address=signature(sent);change(before=>before.map<ProviderDraft>(d=>d.uid===uid?{...d,fetching:true,error:null,notice:null}:d));
    try{const result=parseRemoteModels(await callPi('pi_fetch_models',{input:{provider:sent.provider,baseUrl:sent.baseUrl.trim(),api:sent.api,apiKey:sent.apiKey||null}}));
      if(mounted.current&&rootRef.current===sent.root&&current.current.some(d=>d.uid===uid&&signature(d)===address))notifyOperation(result.models.length?`获取到 ${result.models.length} 个模型，请选择要添加的模型。`:'服务商返回了空模型列表，可手动添加。');
      if(mounted.current)change(before=>before.map<ProviderDraft>(d=>d.uid===uid&&signature(d)===address?{...d,remote:result,tab:'models',selectedIds:[],notice:result.models.length?`获取到 ${result.models.length} 个模型，请选择要添加的模型。`:'服务商返回了空模型列表，可手动添加。'}:d));
    }catch(e){if(mounted.current)change(before=>before.map<ProviderDraft>(d=>d.uid===uid&&signature(d)===address?{...d,error:piError(e)}:d));}
    finally{requests.current.delete(uid);if(mounted.current)change(before=>before.map<ProviderDraft>(d=>d.uid===uid?{...d,fetching:false}:d));}
  }
  async function save(uid:string){const sent=current.current.find(v=>v.uid===uid);if(!sent||saveLock.current||sent.root!==rootRef.current)return;
    function fail(message:string){change(before=>before.map<ProviderDraft>(d=>d.uid===uid?{...d,error:message}:d));}
    if(!/^[a-zA-Z0-9_.-]{1,80}$/.test(sent.provider)){fail('服务商标识限80个英文字符、数字、点、横线或下划线。');return;}
    if(current.current.some(d=>d.root===sent.root&&d.uid!==uid&&d.provider===sent.provider)){fail('这个服务商标识已经存在，请选择原服务商或换一个标识。');return;}
    if(!sent.models.length||sent.models.length>200){fail('请先添加1至200个模型。');ui(uid,{tab:'models'});return;}
    const ids=new Set<string>();
    for(const m of sent.models){if(!m.id.trim()||ids.has(m.id)){fail('模型ID不能为空或重复。');ui(uid,{tab:'models'});return;}ids.add(m.id);
      if([m.contextWindow,m.maxTokens].some(v=>!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<=0)){fail('上下文和最大输出长度需为正整数。');ui(uid,{tab:'advanced'});return;}}
    saveLock.current=true;setSaving(uid);change(before=>before.map<ProviderDraft>(d=>d.uid===uid?{...d,error:null,notice:null}:d));
    try{const input={provider:sent.provider,baseUrl:sent.baseUrl.trim(),api:sent.api,apiKey:sent.apiKey||null,models:sent.models.map(m=>({id:m.id,name:m.name.trim()||m.id,contextWindow:Number(m.contextWindow),maxTokens:Number(m.maxTokens),reasoning:m.reasoning,supportsImages:m.supportsImages,baseUrl:m.baseUrl.trim()||null,api:m.api||null}))};
      const receipt=await piRef.current.saveConfiguration('pi_save_provider',input);
      if(!receipt){fail(piRef.current.error??'本次保存未完成，请查看Pi连接状态；输入保留。');return;}
      if(mounted.current){const savedModels=new Set(sent.models.map(m=>m.uid));change(before=>before.map<ProviderDraft>(d=>d.uid!==uid?d:{...d,persisted:true,dirty:d.revision!==sent.revision,apiKey:d.apiKey===sent.apiKey?'':d.apiKey,hasCredential:d.hasCredential||!!sent.apiKey,models:d.models.map(m=>savedModels.has(m.uid)?{...m,persisted:true}:m),notice:receipt.message}));if(rootRef.current===sent.root)await reload();}
    }catch(e){if(mounted.current)fail(piError(e));}
    finally{saveLock.current=false;if(mounted.current)setSaving(null);}
  }
  return {providers,active,ready:!!root&&loaded.current.has(root),loading,loadError,saving,reload,select,addProvider,ui,edit,editModel,addManual,removeNew,addSelected,fetchModels,save};
}
export type PiProvidersController=ReturnType<typeof usePiProviders>;
