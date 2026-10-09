import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke,isTauri,listen} from './desktop-api.ts';
import {piError} from './pi-client.ts';
import {notifyOperation} from './components/ui/operation-toast.tsx';
import type {EvolutionSnapshot,EvolutionSettings} from './self-evolution-types.ts';
export function useSelfEvolution(root:string|null){
  const [snapshot,setSnapshot]=useState<EvolutionSnapshot|null>(null),[error,setError]=useState(''),[working,setWorking]=useState(false);
  const [drafts,setDrafts]=useState<Record<string,string>>({}),[settingsDraft,setSettingsDraft]=useState<EvolutionSettings|null>(null);
  const [selected,setSelected]=useState<Set<string>>(new Set()),[active,setActive]=useState<string|null>(null);
  const [tab,setTab]=useState('pending'),[query,setQuery]=useState(''),[target,setTarget]=useState('all'),[kind,setKind]=useState('all'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20);
  const rootRef=useRef(root),mounted=useRef(false),lock=useRef(false),reading=useRef(false),rerun=useRef(false);rootRef.current=root;
  const refresh=useCallback(async()=>{
    if(!rootRef.current||!isTauri())return;if(reading.current){rerun.current=true;return;}reading.current=true;
    try{do{rerun.current=false;const at:string|null=rootRef.current;const value=await invoke<EvolutionSnapshot>('evolution_snapshot');if(mounted.current&&at===rootRef.current)setSnapshot(value);}while(rerun.current&&mounted.current);}
    catch(e){if(mounted.current)setError(piError(e));}finally{reading.current=false;}
  },[]);
  useEffect(()=>{mounted.current=true;setSnapshot(null);setDrafts({});setSettingsDraft(null);setSelected(new Set());setActive(null);setError('');let disposed=false;const off:Array<()=>void>=[];
    if(root&&isTauri()){void refresh();for(const event of ['azcine-evolution-changed','azcine-evolution-error'])void listen(event,()=>void refresh()).then(fn=>{if(disposed)fn();else off.push(fn);});}
    return()=>{mounted.current=false;disposed=true;off.forEach(fn=>fn());};
  },[root,refresh]);
  async function mutate(action:string,fields:Record<string,unknown>={}){
    if(lock.current||!snapshot)return false;lock.current=true;setWorking(true);setError('');const at=root;
    try{
      const value=await invoke<EvolutionSnapshot>('evolution_mutate',{input:{action,revision:snapshot.state.revision,...fields}});
      if(mounted.current&&at===rootRef.current){setSnapshot(value);setSelected(previous=>new Set([...previous].filter(id=>value.state.candidates.some(c=>c.id===id&&c.status==='pending'))));notifyOperation(action==='approve'?'已写入规则，新对话会读取更新内容。':action==='undo'?'已撤销写入，可在「已撤销」中查看。':action==='restore'?'已放回待批准，核对后可重新批准。':'已保存。');}
      return true;
    }catch(e){if(mounted.current&&at===rootRef.current){setError(piError(e));await refresh();}return false;}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }
  async function extract(cancel=false){if(lock.current)return;lock.current=true;setWorking(true);setError('');try{await invoke(cancel?'evolution_cancel':'evolution_extract');await refresh();}catch(e){setError(piError(e));}finally{lock.current=false;setWorking(false);}}
  const source=(id:string)=>invoke<{messages:Array<{role:string;content:Array<{type:string;text?:string}>}>}>('evolution_source',{id});
  const openSource=(id:string)=>invoke<void>('evolution_open_source',{id});
  const models=()=>invoke<Array<{provider:string;id:string;name?:string}>>('pi_model_catalog');
  return {root,snapshot,error,setError,working,refresh,mutate,extract,source,openSource,models,drafts,setDrafts,settingsDraft,setSettingsDraft,selected,setSelected,active,setActive,tab,setTab,query,setQuery,target,setTarget,kind,setKind,page,setPage,pageSize,setPageSize};
}
export type EvolutionController=ReturnType<typeof useSelfEvolution>;
