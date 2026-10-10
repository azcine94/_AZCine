import {useEffect,useRef,useState,type MouseEvent,type ReactNode} from 'react';
import {FilePlus,FolderPlus,MoreHorizontal,ChevronRight,ChevronDown,Folder,FileText,Database,Paperclip} from 'lucide-react';
import {Button} from './components/ui/button.tsx';
import {RecordContextMenu} from './components/ui/record-context-menu.tsx';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './components/ui/dropdown-menu.tsx';
import type {NotesIndex} from './notes-contract.ts';
export type FileAction={operation:string;paths:string[];folder?:boolean;target?:string;template?:string;properties?:Record<string,unknown>};
export function NotesFileTree({index,current,query,dirty,open,action,revealTick=0}:{index:NotesIndex;current:string;query:string;dirty:(path:string)=>boolean;open:(path:string)=>void;action:(value:FileAction)=>void;revealTick?:number}){
  const [expanded,setExpanded]=useState<Set<string>>(new Set()),[selected,setSelected]=useState<Set<string>>(new Set());
  const anchor=useRef(''),tree=useRef<HTMLElement>(null);
  useEffect(()=>{setExpanded(old=>{const next=new Set(old);const parts=current.split('/');parts.pop();while(parts.length){next.add(parts.join('/'));parts.pop();}return next;});if(revealTick)requestAnimationFrame(()=>tree.current?.querySelector<HTMLElement>(`[data-note-path="${CSS.escape(current)}"]`)?.scrollIntoView({block:'nearest'}));},[current,revealTick]);
  useEffect(()=>{const paths=new Set([...index.directories,...index.files.map(f=>f.path)]);setSelected(old=>new Set([...old].filter(p=>paths.has(p))));},[index]);
  const visible:string[]=[];
  function children(parent:string){const prefix=parent?parent+'/':'',match=query.toLocaleLowerCase();return {
    folders:index.directories.filter(p=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')&&(!match||p.toLocaleLowerCase().includes(match)||index.files.some(f=>f.path.startsWith(p+'/')&&f.path.toLocaleLowerCase().includes(match)))),
    files:index.files.filter(f=>f.path.startsWith(prefix)&&!f.path.slice(prefix.length).includes('/')&&(!match||f.path.toLocaleLowerCase().includes(match))),
  };}
  function enumerate(parent:string){const {folders,files}=children(parent);for(const path of folders){visible.push(path);if(expanded.has(path)||query)enumerate(path);}visible.push(...files.map(f=>f.path));}enumerate('');
  function select(path:string,event:MouseEvent){
    if(event.shiftKey&&anchor.current&&visible.includes(anchor.current)){const a=visible.indexOf(anchor.current),b=visible.indexOf(path);const range=visible.slice(Math.min(a,b),Math.max(a,b)+1);setSelected(old=>new Set(event.ctrlKey||event.metaKey?[...old,...range]:range));return;}
    anchor.current=path;if(event.ctrlKey||event.metaKey){setSelected(old=>{const next=new Set(old);next.has(path)?next.delete(path):next.add(path);return next;});return;}
    setSelected(new Set([path]));if(index.directories.includes(path))setExpanded(old=>{const next=new Set(old);next.has(path)?next.delete(path):next.add(path);return next;});else open(path);
  }
  function operations(path:string){const paths=selected.has(path)?[...selected]:[path],folder=paths.length===1&&index.directories.includes(path);return [
    ...(folder?[{label:'在此新建笔记',run:()=>action({operation:'create',paths:[path]})},{label:'在此新建文件夹',run:()=>action({operation:'create',paths:[path],folder:true})},{label:'在此新建数据库',run:()=>action({operation:'base-create',paths:[path]})}]:[]),
    ...[['rename','重命名'],['move','移动到…'],['copy','复制到…'],['trash','移到回收站'],['reveal','在资源管理器中显示']].map(([operation,label])=>({label,run:()=>action({operation,paths,folder}),disabled:operation==='rename'&&paths.length!==1,destructive:operation==='trash'})),
    ...(!folder&&paths.length===1?[{label:'用默认应用打开',run:()=>action({operation:'open',paths})}]:[]),
  ];}
  function row(path:string,depth:number,folder:boolean,icon:ReactNode){const actions=operations(path),shown=expanded.has(path)||!!query;return <RecordContextMenu key={path} actions={actions}><div className="notes-file-row" data-active={current===path} data-selected={selected.has(path)} style={{paddingLeft:depth*12}} onContextMenuCapture={()=>{if(!selected.has(path)){setSelected(new Set([path]));anchor.current=path;}}} draggable onDragStart={e=>e.dataTransfer.setData('application/azcine-note',JSON.stringify(selected.has(path)?[...selected]:[path]))} onDragOver={e=>{if(folder)e.preventDefault();}} onDrop={e=>{if(!folder)return;e.preventDefault();const raw=e.dataTransfer.getData('application/azcine-note');if(!raw)return;try{const paths=JSON.parse(raw) as string[];if(paths.every(p=>p!==path&&!path.startsWith(p+'/')))action({operation:'move',paths,target:path});}catch{/* Ignore foreign drag data. */}}}>
    <Button variant="app-quiet" className="notes-file-label" data-note-path={path} title={path} aria-pressed={selected.has(path)} aria-expanded={folder?shown:undefined} onClick={e=>select(path,e)} onKeyDown={e=>{const i=visible.indexOf(path);let next:string|undefined;if(e.key==='ArrowDown')next=visible[i+1];if(e.key==='ArrowUp')next=visible[i-1];if(e.key==='Home')next=visible[0];if(e.key==='End')next=visible.at(-1);if(next){e.preventDefault();tree.current?.querySelector<HTMLElement>(`[data-note-path="${CSS.escape(next)}"]`)?.focus();}if(e.key==='Escape')setSelected(new Set());}}>{folder?(shown?<ChevronDown/>:<ChevronRight/>):<span className="notes-tree-spacer" aria-hidden="true"/>}{icon}<span className="notes-file-name">{path.split('/').pop()}</span>{dirty(path)&&<span aria-label="未保存">•</span>}</Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="app-quiet" className="notes-file-more" size="icon-sm" aria-label={`${path} 操作`}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent>{actions.map(a=><DropdownMenuItem key={a.label} disabled={'disabled' in a?a.disabled:false} onSelect={a.run}>{a.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
  </div></RecordContextMenu>;}
  function rows(parent:string,depth:number):ReactNode{const {folders,files}=children(parent);return <>{folders.map(path=><div key={path}>{row(path,depth,true,<Folder/>)}{(expanded.has(path)||query)&&rows(path,depth+1)}</div>)}{files.map(f=>row(f.path,depth,false,f.kind==='base'?<Database/>:f.kind==='attachment'?<Paperclip/>:<FileText/>))}</>;}
  return <><div className="notes-file-tools"><Button variant="app-quiet" size="icon-sm" title="新建笔记" aria-label="新建笔记" onClick={()=>action({operation:'create',paths:[]})}><FilePlus/></Button><Button variant="app-quiet" size="icon-sm" title="新建文件夹" aria-label="新建文件夹" onClick={()=>action({operation:'create',paths:[],folder:true})}><FolderPlus/></Button><Button variant="app-quiet" onClick={()=>action({operation:'base-create',paths:[]})}>新建数据库</Button></div><nav ref={tree} className="notes-tree" aria-label="笔记文件">{rows('',0)}</nav><span className="sr-only" aria-live="polite">已选 {selected.size} 项；右键操作，Ctrl 或 Shift 多选。</span></>;
}
