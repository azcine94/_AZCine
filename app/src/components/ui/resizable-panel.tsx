import { useEffect, useRef, useState } from 'react';
import type { ComponentProps,KeyboardEvent,PointerEvent } from 'react';
import { notifyOperation } from './operation-toast.tsx';

export function useResizablePanel({storageKey,defaultWidth,minWidth,maxWidth,reserveWidth,persist=true}:{storageKey:string;defaultWidth:number;minWidth:number;maxWidth:number;reserveWidth:number;persist?:boolean}){
  const container=useRef<HTMLDivElement>(null);
  const [preferred,setPreferred]=useState(()=>{try{const value=persist?Number(localStorage.getItem(storageKey)):0;return value>=minWidth&&value<=maxWidth?value:defaultWidth;}catch{return defaultWidth;}});
  const [available,setAvailable]=useState(maxWidth+reserveWidth);
  const [resizing,setResizing]=useState(false);
  const drag=useRef<{id:number;x:number;width:number;original:number;latest:number}|null>(null);
  const maximum=Math.max(minWidth,Math.min(maxWidth,available-reserveWidth));
  const width=Math.max(minWidth,Math.min(maximum,preferred));
  useEffect(()=>{const node=container.current;if(!node)return;const measure=()=>setAvailable(node.clientWidth);measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
  const save=(value:number)=>{setPreferred(value);if(persist)try{localStorage.setItem(storageKey,String(value));}catch{notifyOperation('栏宽已调整，但未能保存；关闭窗口后可能丢失。',{tone:'error'});}};
  function finish(event:PointerEvent<HTMLDivElement>,cancel=false){
    const active=drag.current;if(!active||active.id!==event.pointerId)return;
    drag.current=null;setResizing(false);if(cancel)setPreferred(active.original);else save(active.latest);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const handleProps={
    role:'separator' as const,tabIndex:0,'aria-orientation':'vertical' as const,
    'aria-valuemin':minWidth,'aria-valuemax':maximum,'aria-valuenow':Math.round(width),
    'aria-valuetext':`${Math.round(width)} 像素`,'data-resizing':resizing,
    onPointerDown:(event:PointerEvent<HTMLDivElement>)=>{if(event.button!==0||drag.current)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,width,original:preferred,latest:width};setResizing(true);},
    onPointerMove:(event:PointerEvent<HTMLDivElement>)=>{const active=drag.current;if(!active||active.id!==event.pointerId)return;event.preventDefault();active.latest=Math.max(minWidth,Math.min(maximum,active.width+event.clientX-active.x));setPreferred(active.latest);},
    onPointerUp:(event:PointerEvent<HTMLDivElement>)=>finish(event),
    onPointerCancel:(event:PointerEvent<HTMLDivElement>)=>finish(event,true),
    onLostPointerCapture:(event:PointerEvent<HTMLDivElement>)=>finish(event,true),
    onDoubleClick:()=>save(defaultWidth),
    onKeyDown:(event:KeyboardEvent<HTMLDivElement>)=>{
      if(event.nativeEvent.isComposing)return;
      if(event.key==='Escape'&&drag.current){event.preventDefault();event.stopPropagation();const active=drag.current;drag.current=null;setResizing(false);setPreferred(active.original);if(event.currentTarget.hasPointerCapture(active.id))event.currentTarget.releasePointerCapture(active.id);return;}
      const next=event.key==='ArrowLeft'?width-16:event.key==='ArrowRight'?width+16:event.key==='Home'?minWidth:event.key==='End'?maximum:null;
      if(next!==null){event.preventDefault();save(Math.max(minWidth,Math.min(maximum,next)));}
    },
  };
  return {container,width,resizing,handleProps};
}

export function ResizeHandle({className='',...props}:ComponentProps<'div'>){
  return <div {...props} className={`ui-resize-handle ${className}`}/>;
}
