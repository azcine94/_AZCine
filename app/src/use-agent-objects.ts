import {useEffect,useRef,useState} from 'react';
import {invoke} from './desktop-api.ts';
import {piError} from './pi-client.ts';
import type {AgentSource} from './pi-client.ts';
export interface ContextCatalog {modules:{id:string;label?:string;total?:number;hasMore?:boolean;objects:{source:AgentSource;title:string}[]}[]}
const identity=(source:AgentSource)=>JSON.stringify(source);
export function useAgentObjects(root:string|null,scope:string){
 const [open,setOpen]=useState(false),[catalog,setCatalog]=useState<ContextCatalog|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[selections,setSelections]=useState<Record<string,AgentSource[]>>({});
 const [query,setQuery]=useState(''),epoch=useRef(0);
 const scopeRef=useRef(scope),rootRef=useRef(root);scopeRef.current=scope;rootRef.current=root;
 useEffect(()=>{setCatalog(null);setSelections({});setOpen(false);setError('');},[root]);
 function show(){setQuery('');setOpen(true);}
 useEffect(()=>{
  if(!open||!root)return;
  const token=++epoch.current;setLoading(true);setError('');
  const timer=setTimeout(()=>{void invoke<ContextCatalog>('agent_context_catalog',{query}).then(value=>{if(epoch.current===token)setCatalog(value);}).catch(e=>{if(epoch.current===token)setError(piError(e));}).finally(()=>{if(epoch.current===token)setLoading(false);});},query?180:0);
  return()=>{clearTimeout(timer);epoch.current++;};
 },[open,root,query]);

 function toggle(source:AgentSource){const key=scopeRef.current;setSelections(before=>{const selected=before[key]??[],found=selected.some(item=>identity(item)===identity(source));if(!found&&selected.length>=16){setError('最多附加16个工作台对象。');return before;}return{...before,[key]:found?selected.filter(item=>identity(item)!==identity(source)):[...selected,source]};});}
 function remove(source:AgentSource){const key=scopeRef.current;setSelections(before=>({...before,[key]:(before[key]??[]).filter(item=>identity(item)!==identity(source))}));}
 function clearSent(key:string,sent:AgentSource[]){setSelections(before=>({...before,[key]:(before[key]??[]).filter(item=>!sent.some(source=>identity(source)===identity(item)))}));}
 function restore(key:string,sent:AgentSource[]){setSelections(before=>({...before,[key]:[...sent]}));}
 return{open,setOpen,query,setQuery,catalog,error,loading,objects:selections[scope]??[],show,toggle,remove,clearSent,restore};
}
export type AgentObjectsController=ReturnType<typeof useAgentObjects>;
