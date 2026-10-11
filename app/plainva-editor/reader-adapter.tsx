// Only desktop/platform services are replaced. MarkdownReader and its rendering
// plugins are the original source, backed by the selected local vault.
import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import {createRoot} from 'react-dom/client';
import {MenuSurface,MenuItem} from './vendor/packages/ui/src/components/ui/Menu';
import {Button} from './vendor/packages/ui/src/components/ui/Button';
import { buildWikiTargetSet } from './vendor/packages/ui/src/lib/wikiResolver';
let environment: any;
let resolver: ReturnType<typeof buildWikiTargetSet> | null = null;
let notify: (text:string)=>void = () => {};
let external:(url:string)=>void=()=>{};
export function setExternalOpener(open:typeof external){external=open;}
export const VaultContext=createContext<any>(null);
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);};
export function setReaderEnvironment(value:any, files:{path:string;title:string}[], notice:typeof notify) {
  environment=value; resolver=buildWikiTargetSet(files); notify=notice;
  listeners.forEach(listener=>listener());
}
export function useVault() { const scoped=useContext(VaultContext);const fallback=useSyncExternalStore(subscribe,()=>environment);return scoped??fallback; }
export function useWikiResolver() { const scoped=useContext(VaultContext);return scoped?.linkResolver??resolver; }
export async function openUrl(url:string) {
  if(/^https?:\/\//i.test(url)) external(url);
  else notify('暂时只支持 HTTP / HTTPS 外部链接。');
}
export function openContextMenu(input:{x:number;y:number;image?:{open:()=>void;loadBytes:()=>Promise<Uint8Array>;filename:string;mime:string}}) {
  if(!input.image)return;const image=input.image,element=document.createElement('div');element.className='plainva-overlays';document.body.append(element);const root=createRoot(element);const close=()=>{setTimeout(()=>{root.unmount();element.remove();},0);};
  root.render(<MenuSurface open at={{x:input.x,y:input.y}} onClose={close} ariaLabel="附件操作"><MenuItem onSelect={image.open}>打开附件</MenuItem><MenuItem onSelect={()=>{void image.loadBytes().then(bytes=>{const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:image.mime}));const link=document.createElement('a');link.href=url;link.download=image.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(e=>notify(String(e)));}}>另存附件</MenuItem><MenuItem onSelect={()=>{void image.loadBytes().then(async bytes=>{await navigator.clipboard.write([new ClipboardItem({[image.mime]:new Blob([new Uint8Array(bytes)],{type:image.mime})})]);notify('已复制图片。');}).catch(()=>notify('此格式无法复制到剪贴板，请使用另存附件。'));}}>复制图片</MenuItem></MenuSurface>);
}
export function BaseViewer({activePath,onOpenPath}:{activePath:string;onOpenPath?:(path:string,newTab:boolean)=>void}) {
  const env=useVault();const [data,setData]=useState<{rows:any[];config:any}|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;setError('');void env.baseData(activePath).then((value:any)=>{if(active)setData(value);}).catch((e:unknown)=>{if(active)setError(String(e));});return()=>{active=false;};},[activePath,env.fileTreeVersion]);
  if(error)return <p role="alert">{error}</p>;if(!data)return <p role="status">正在读取数据库…</p>;
  const columns=data.config.views?.[0]?.order??['file.name'];return <div className="pv-base-embed"><Button variant="ghost" onClick={()=>onOpenPath?.(activePath,false)}>打开 {activePath.split('/').pop()}</Button><div style={{overflow:'auto',maxHeight:360}}><table><thead><tr>{columns.map((c:string)=><th key={c}>{c.replace(/^note\./,'')}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={row['file.path']}>{columns.map((c:string)=><td key={c}><Button variant="ghost" onClick={()=>onOpenPath?.(row['file.path'],false)}>{String(row[c]??row[c.replace(/^note\./,'')]??'')}</Button></td>)}</tr>)}</tbody></table></div></div>;
}
