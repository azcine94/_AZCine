import {useRef,useState,type ReactNode,type DragEvent} from 'react';
import {ChevronRight} from 'lucide-react';
import {pages,type PageId} from '../../routes.ts';
import {Button} from './button.tsx';
import {UILink} from './ui-link.tsx';
import {StatusDot,type StatusDotTone} from './status-dot.tsx';
import {notifyOperation} from './operation-toast.tsx';

const tools:PageId[]=['agent','self-evolution','task-panel','jobs','dev-environment','resources'];
const workbench=pages.filter(page=>page.id!=='settings'&&!tools.includes(page.id));
const storageKey='azcine.navigation.v1';
type Preferences={order:PageId[];toolsCollapsed:boolean};
type Target={id:PageId;after:boolean};
function normalize(value:unknown):Preferences{
  const data=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const saved=Array.isArray(data.order)?data.order:[];
  const order=[...new Set([...saved,...workbench.map(page=>page.id)])].filter((id):id is PageId=>workbench.some(page=>page.id===id));
  return {order,toolsCollapsed:data.toolsCollapsed===true};
}
function initial(preview?:string):Preferences{
  if(preview!==undefined)return normalize({toolsCollapsed:preview==='tools-collapsed',order:preview==='navigation-reordered'?[...workbench].reverse().map(page=>page.id):[]});
  try{return normalize(JSON.parse(localStorage.getItem(storageKey)??'null'));}catch{return normalize(null);}
}

export function WorkspaceNavigation({activePage,icon,reminder,preview}: {
  activePage:PageId|'missing';icon:(name:PageId)=>ReactNode;
  reminder:{count:number;label:string;tone:StatusDotTone};preview?:string;
}){
  const [preferences,setPreferences]=useState(()=>initial(preview));
  const [target,setTarget]=useState<Target|null>(null);
  const [dragging,setDragging]=useState<PageId|null>(null);
  const [announcement,setAnnouncement]=useState('');
  const source=useRef<PageId|null>(null);
  const suppressClickUntil=useRef(0);
  const groupId='workspace-tool-links';
  const activeTool=activePage!=='missing'&&tools.includes(activePage)?pages.find(page=>page.id===activePage):undefined;
  function save(next:Preferences){
    setPreferences(next);
    if(preview!==undefined)return;
    try{localStorage.setItem(storageKey,JSON.stringify(next));}
    catch{notifyOperation('排列已在本次窗口生效，但无法保存本机导航偏好。');}
  }
  function finish(){source.current=null;setDragging(null);setTarget(null);suppressClickUntil.current=Date.now()+250;}
  function move(id:PageId,to:Target){
    if(id===to.id)return;
    const order=preferences.order.filter(item=>item!==id);
    const index=order.indexOf(to.id);if(index<0)return;
    order.splice(index+(to.after?1:0),0,id);
    if(order.every((item,i)=>item===preferences.order[i]))return;
    save({...preferences,order});
    setAnnouncement(`${pages.find(page=>page.id===id)?.title}已移到第${order.indexOf(id)+1}项`);
  }
  function position(event:DragEvent<HTMLAnchorElement>,id:PageId):Target{
    const box=event.currentTarget.getBoundingClientRect();return {id,after:event.clientY>box.top+box.height/2};
  }
  function link(id:PageId,sortable=false){
    const page=pages.find(item=>item.id===id)!;
    const notice=id==='servers-credentials'&&reminder.count>0;
    const label=notice?`${page.title} · ${reminder.label}`:page.title;
    return <UILink variant="navigation" key={id} href={`#${id}`}
      className={`nav-item${notice?' nav-item--notice':''}${sortable?' nav-item--sortable':''}`}
      title={sortable?`${label} · 拖动排序，或按 Alt + ↑ / ↓` : label}
      aria-label={label} aria-current={activePage===id?'page':undefined}
      aria-keyshortcuts={sortable?'Alt+ArrowUp Alt+ArrowDown':undefined}
      draggable={sortable} data-dragging={dragging===id||undefined}
      data-drop={target?.id===id?(target.after?'after':'before'):undefined}
      onClick={event=>{if(sortable&&Date.now()<suppressClickUntil.current)event.preventDefault();}}
      onDragStart={event=>{
        if(!sortable)return;
        source.current=id;setDragging(id);event.dataTransfer.effectAllowed='move';
        event.dataTransfer.setData('text/plain',id);
      }}
      onDragOver={event=>{
        if(!sortable||!source.current)return;
        event.preventDefault();event.dataTransfer.dropEffect='move';
        const next=position(event,id);setTarget(source.current===id?null:next);
        const scroll=event.currentTarget.closest('nav');
        if(scroll){const box=scroll.getBoundingClientRect();if(event.clientY<box.top+32)scroll.scrollTop-=12;else if(event.clientY>box.bottom-32)scroll.scrollTop+=12;}
      }}
      onDrop={event=>{
        if(!sortable||!source.current)return;
        event.preventDefault();move(source.current,position(event,id));finish();
      }} onDragEnd={finish}
      onKeyDown={event=>{
        if(!sortable||!event.altKey||event.ctrlKey||event.metaKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
        event.preventDefault();const index=preferences.order.indexOf(id);
        const other=preferences.order[index+(event.key==='ArrowUp'?-1:1)];
        if(other){const element=event.currentTarget;move(id,{id:other,after:event.key==='ArrowDown'});requestAnimationFrame(()=>element.focus());}
      }}>
      {icon(page.icon)}<span>{page.title}</span>
      {notice&&<StatusDot className="nav-status-dot" tone={reminder.tone} label={reminder.label} aria-hidden="true"/>}
    </UILink>;
  }
  return <nav aria-label="主导航">
    <section className="nav-group" aria-label="工作台" onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setTarget(null);}}>
      <h2>工作台</h2>{preferences.order.map(id=>link(id,true))}
    </section>
    <section className="nav-group nav-tools" aria-label="工具">
      <Button variant="ghost" className="nav-tools-toggle w-full justify-between px-3 text-xs font-medium text-muted-foreground"
        aria-expanded={!preferences.toolsCollapsed} aria-controls={groupId}
        aria-label={`${preferences.toolsCollapsed?'展开':'收起'}工具${activeTool?`，当前：${activeTool.title}`:''}`}
        title={`${preferences.toolsCollapsed?'展开':'收起'}工具${activeTool?` · ${activeTool.title}`:''}`}
        onClick={()=>save({...preferences,toolsCollapsed:!preferences.toolsCollapsed})}>
        <span className="nav-tools-label">工具{preferences.toolsCollapsed&&activeTool?` · ${activeTool.title}`:''}</span>
        <ChevronRight className="nav-tools-chevron" aria-hidden="true"/>
      </Button>
      <div id={groupId} className="nav-tools-links" hidden={preferences.toolsCollapsed}>{tools.map(id=>link(id))}</div>
    </section>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </nav>;
}
