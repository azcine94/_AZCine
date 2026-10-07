import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from './dialog.tsx';
// Keep an Escape dispatched inside a child layer from also dismissing its parent.
// Its native target stays in the child even if closing has already moved focus.
function closeChildLayer(event:KeyboardEvent,source:Element){
  event.preventDefault();
  if(source.matches('[data-slot="dialog-content"][data-state="open"]'))source.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')?.click();
}
export function AgentSidebar({open,onClose,title,children,returnFocus}:{open:boolean;onClose:()=>void;title:string;children:ReactNode;returnFocus?:()=>void}){
  const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width:1100px)').matches);
  const focus=useRef<HTMLElement|null>(null),heading=useRef<HTMLHeadingElement>(null);
  const drawer=useRef<HTMLDivElement>(null),dock=useRef<HTMLElement>(null);
  const [preferredWidth,setPreferredWidth]=useState(()=>{try{const value=Number(localStorage.getItem('azcine.agent-sidebar-width'));return value>=320&&value<=720?value:420;}catch{return 420;}});
  const [viewportWidth,setViewportWidth]=useState(window.innerWidth),[availableWidth,setAvailableWidth]=useState(window.innerWidth),[resizing,setResizing]=useState(false);
  const resize=useRef<{x:number;width:number;original:number;latest:number}|null>(null);
  const maxWidth=Math.max(320,Math.min(720,narrow?viewportWidth-24:availableWidth-440));
  const width=Math.min(maxWidth,Math.max(320,preferredWidth));
  const sidebarStyle={'--agent-sidebar-width':`${width}px`} as CSSProperties;
  const persistWidth=(value:number)=>{setPreferredWidth(value);try{localStorage.setItem('azcine.agent-sidebar-width',String(value));}catch{/* Width still works for this window. */}};
  useEffect(()=>{const changed=()=>setViewportWidth(window.innerWidth);window.addEventListener('resize',changed);return()=>window.removeEventListener('resize',changed);},[]);
  useEffect(()=>{const parent=dock.current?.parentElement;if(!open||narrow||!parent)return;const changed=()=>setAvailableWidth(parent.clientWidth);changed();const observer=new ResizeObserver(changed);observer.observe(parent);return()=>observer.disconnect();},[open,narrow]);
  function finishResize(event:PointerEvent<HTMLDivElement>,cancel=false){if(!resize.current)return;const value=cancel?resize.current.original:resize.current.latest;resize.current=null;setResizing(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(cancel)setPreferredWidth(value);else persistWidth(value);}
  const handle=<div className="agent-sidebar-resize" role="separator" aria-label="调整Agent面板宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={maxWidth} aria-valuenow={width} tabIndex={0}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);resize.current={x:event.clientX,width,original:preferredWidth,latest:width};setResizing(true);}}
    onPointerMove={event=>{const active=resize.current;if(!active)return;event.preventDefault();active.latest=Math.max(320,Math.min(maxWidth,active.width+active.x-event.clientX));setPreferredWidth(active.latest);}}
    onPointerUp={event=>finishResize(event)} onPointerCancel={event=>finishResize(event,true)} onLostPointerCapture={()=>{resize.current=null;setResizing(false);}}
    onDoubleClick={()=>persistWidth(Math.min(420,maxWidth))} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Escape'&&resize.current){event.preventDefault();event.stopPropagation();setPreferredWidth(resize.current.original);resize.current=null;setResizing(false);return;}const value=event.key==='ArrowLeft'?width+20:event.key==='ArrowRight'?width-20:event.key==='Home'?320:event.key==='End'?maxWidth:null;if(value!==null){event.preventDefault();persistWidth(Math.max(320,Math.min(maxWidth,value)));}}}/>;
  useEffect(()=>{
    const query=window.matchMedia('(max-width:1100px)');let pending:MutationObserver|undefined;
    const change=()=>{
      // Reparenting the chat while its child dialog is open would lose the
      // review/confirmation state. Finish that layer before changing layout.
      const child=[...document.querySelectorAll('[data-slot="dialog-content"][data-state="open"],[data-slot="popover-content"][data-state="open"]')].some(node=>!node.classList.contains('agent-sidebar'));
      if(child){if(!pending){pending=new MutationObserver(change);pending.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-state']});}return;}
      pending?.disconnect();pending=undefined;setNarrow(query.matches);
    };
    query.addEventListener('change',change);return()=>{query.removeEventListener('change',change);pending?.disconnect();};
  },[]);
  useEffect(()=>{if(!open)return;focus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;(heading.current?.parentElement?.querySelector<HTMLTextAreaElement>('textarea')??heading.current)?.focus({preventScroll:true});return()=>{if(returnFocus)returnFocus();else if(focus.current?.isConnected)focus.current.focus({preventScroll:true});};},[open]);
  useEffect(()=>{if(!open||narrow)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing&&!e.defaultPrevented){const source=e.target instanceof Element?e.target.closest('[data-slot="dialog-content"],[data-slot="popover-content"],[data-slot="context-menu-content"],[data-slot="dropdown-menu-content"]'):null;if(source){closeChildLayer(e,source);return;}e.preventDefault();onClose();}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[open,narrow,onClose]);
  if(!open)return null;
  if(narrow)return <Dialog open onOpenChange={value=>{if(!value)onClose();}}><DialogContent ref={drawer} style={sidebarStyle} data-resizing={resizing} layout="form" className="agent-sidebar agent-sidebar--drawer bg-card left-auto top-[68px] translate-x-0 translate-y-0" showCloseButton={false} onOpenAutoFocus={event=>{event.preventDefault();drawer.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({preventScroll:true});}} onEscapeKeyDown={event=>{if(resize.current){event.preventDefault();setPreferredWidth(resize.current.original);resize.current=null;setResizing(false);return;}const source=event.target instanceof Element?event.target.closest('[data-slot="dialog-content"],[data-slot="popover-content"],[data-slot="context-menu-content"],[data-slot="dropdown-menu-content"]'):null;if(event.isComposing)event.preventDefault();else if(source&&source!==drawer.current)closeChildLayer(event,source);}} onCloseAutoFocus={event=>{if(returnFocus){event.preventDefault();returnFocus();}}}><DialogTitle className="sr-only">{title}</DialogTitle><DialogDescription className="sr-only">当前来源的Agent会话；关闭面板保留会话和草稿。</DialogDescription>{handle}<div className="agent-sidebar-body">{children}</div></DialogContent></Dialog>;
  return <aside ref={dock} className="agent-sidebar" style={sidebarStyle} data-resizing={resizing} aria-label={title}><h2 className="sr-only" ref={heading} tabIndex={-1}>{title}</h2>{handle}<div className="agent-sidebar-body">{children}</div></aside>;
}
