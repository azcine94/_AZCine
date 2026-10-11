import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from './button.tsx';
export interface MediaRegion { kind:'pin'|'box'; x:number; y:number; w:number; h:number }
export type MediaTool='pan'|'pin'|'box'|'pick';
export interface MediaMark { id:string; text:string; region:MediaRegion|null }
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function MediaCanvas({src,name,kind,tool='pan',marks=[],onRegion,onMark,onPick,onReady,onStep,onFailure}:{
  src:string;name:string;kind:'image'|'video';tool?:MediaTool;marks?:MediaMark[];
  onRegion?:(region:MediaRegion)=>void;onMark?:(id:string)=>void;onPick?:(hex:string)=>void;
  onReady?:(image:HTMLImageElement)=>void;onStep?:(direction:number)=>void;onFailure?:(message:string)=>void;
}){
  const viewport=useRef<HTMLDivElement>(null),image=useRef<HTMLImageElement>(null);
  const [natural,setNatural]=useState({width:0,height:0}),[size,setSize]=useState({width:0,height:0});
  const [view,setView]=useState({zoom:1,x:0,y:0,fitted:true}),[failed,setFailed]=useState(false);
  const held=useRef<{id:number;x:number;y:number;originX:number;originY:number;zoom:number;right:boolean;point:{x:number;y:number}|null;axis:string|null}|null>(null);
  const fit=natural.width?Math.min(1,Math.max(1,size.width-64)/natural.width,Math.max(1,size.height-48)/natural.height):1;
  const zoom=view.fitted?fit:view.zoom,maxX=Math.max(0,(natural.width*zoom-size.width)/2),maxY=Math.max(0,(natural.height*zoom-size.height)/2);
  const x=view.fitted?0:clamp(view.x,-maxX,maxX),y=view.fitted?0:clamp(view.y,-maxY,maxY);
  const current=useRef({zoom,x,y,fit});current.current={zoom,x,y,fit};
  const left=size.width/2+x-natural.width*zoom/2,top=size.height/2+y-natural.height*zoom/2;
  const reset=()=>setView({zoom:fit,x:0,y:0,fitted:true});
  const original=()=>setView({zoom:1,x:0,y:0,fitted:false});
  function scale(next:number,px=0,py=0){if(!natural.width)return;const old=current.current;const z=clamp(next,Math.min(.05,fit/4),8),ratio=z/old.zoom;setView({zoom:z,x:px-(px-old.x)*ratio,y:py-(py-old.y)*ratio,fitted:false});}
  const scaleRef=useRef(scale);scaleRef.current=scale;
  useLayoutEffect(()=>{const node=viewport.current;if(!node)return;const observer=new ResizeObserver(()=>setSize({width:node.clientWidth,height:node.clientHeight}));observer.observe(node);return()=>observer.disconnect();},[]);
  useLayoutEffect(()=>{setNatural({width:0,height:0});setFailed(false);setView({zoom:1,x:0,y:0,fitted:true});held.current=null;},[src]);
  useEffect(()=>{const node=viewport.current;if(!node)return;const wheel=(e:WheelEvent)=>{if(kind!=='image')return;e.preventDefault();const r=node.getBoundingClientRect();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?r.height:1);scaleRef.current(current.current.zoom*Math.exp(-clamp(delta,-100,100)*.003),e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2);};node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[kind]);
  function point(clientX:number,clientY:number,bounded=false){const r=viewport.current!.getBoundingClientRect();const nx=(clientX-r.left-left)/(natural.width*zoom),ny=(clientY-r.top-top)/(natural.height*zoom);if(!bounded&&(nx<0||nx>1||ny<0||ny>1))return null;return{x:clamp(nx,0,1),y:clamp(ny,0,1)};}
  function pointerDown(e:ReactPointerEvent<HTMLDivElement>){
    if(!natural.width||!['image'].includes(kind)||!([0,2].includes(e.button))||(e.target as HTMLElement).closest('button'))return;
    e.preventDefault();e.currentTarget.focus();const p=point(e.clientX,e.clientY);
    if(e.button===0&&tool!=='pan'&&!p)return;
    if(e.button===0&&tool==='pick'&&p&&image.current){try{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(image.current,Math.min(natural.width-1,Math.floor(p.x*natural.width)),Math.min(natural.height-1,Math.floor(p.y*natural.height)),1,1,0,0,1,1);const values=ctx.getImageData(0,0,1,1).data;if(values[3]===0){onFailure?.('该像素完全透明，请换个位置。');return;}onPick?.('#'+Array.from(values).slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase());}catch{onFailure?.('无法读取这张图片的像素。');}return;}
    if(e.button===0&&tool==='pin'&&p){onRegion?.({kind:'pin',...p,w:0,h:0});return;}
    held.current={id:e.pointerId,x:e.clientX,y:e.clientY,originX:x,originY:y,zoom,right:e.button===2,point:p,axis:null};e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e:ReactPointerEvent<HTMLDivElement>){const start=held.current;if(!start||start.id!==e.pointerId)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;
    if(start.right){if(!start.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)start.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';if(start.axis==='y')scale(start.zoom*Math.exp(-dy*.008));return;}
    if(tool==='box'&&start.point){const end=point(e.clientX,e.clientY,true)!;onRegion?.({kind:'box',x:Math.min(start.point.x,end.x),y:Math.min(start.point.y,end.y),w:Math.abs(start.point.x-end.x),h:Math.abs(start.point.y-end.y)});}
    else setView({zoom:current.current.zoom,x:start.originX+dx,y:start.originY+dy,fitted:false});
  }
  function pointerEnd(e:ReactPointerEvent<HTMLDivElement>,cancel=false){const start=held.current;held.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(!cancel&&start?.right&&start.axis==='x'&&Math.abs(e.clientX-start.x)>40)onStep?.(e.clientX<start.x?1:-1);}
  const overflow=natural.width>0&&(maxX>0||maxY>0),mapScale=natural.width?Math.min(140/natural.width,104/natural.height):1;
  const mapW=natural.width*mapScale,mapH=natural.height*mapScale;
  const minLeft=clamp(-left/(natural.width*zoom),0,1),minTop=clamp(-top/(natural.height*zoom),0,1),minRight=clamp((size.width-left)/(natural.width*zoom),0,1),minBottom=clamp((size.height-top)/(natural.height*zoom),0,1);
  function moveMap(e:ReactPointerEvent<HTMLDivElement>){const r=e.currentTarget.getBoundingClientRect();setView({zoom,x:(.5-clamp((e.clientX-r.left)/r.width,0,1))*natural.width*zoom,y:(.5-clamp((e.clientY-r.top)/r.height,0,1))*natural.height*zoom,fitted:false});}
  return <div className="ui-media-canvas">
    <div ref={viewport} className="ui-media-viewport" data-tool={tool} tabIndex={0} aria-label="图片查看区域：滚轮缩放、拖动平移、左右键切图" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={e=>pointerEnd(e)} onPointerCancel={e=>pointerEnd(e,true)} onLostPointerCapture={()=>held.current=null} onContextMenu={e=>{if(kind==='image')e.preventDefault();}} onDoubleClick={e=>{if(tool==='pan'&&!(e.target as HTMLElement).closest('button'))view.fitted?original():reset();}} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(['+','=','-','0','1','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();if(e.key==='+'||e.key==='=')scale(zoom*1.25);else if(e.key==='-')scale(zoom/1.25);else if(e.key==='0')reset();else if(e.key==='1')original();else if(e.key==='ArrowLeft')onStep?.(-1);else if(e.key==='ArrowRight')onStep?.(1);}}>
      {failed?<p className="ui-media-message" role="alert">无法预览此素材，原文件保留。请检查文件或视频编码。</p>:kind==='video'?<video src={src} controls playsInline preload="metadata" onError={()=>{setFailed(true);onFailure?.('视频无法播放，请检查浏览器支持的编码。');}}/>:<img ref={image} crossOrigin="anonymous" referrerPolicy="no-referrer" src={src||undefined} alt={name} draggable={false} style={{width:natural.width||undefined,height:natural.height||undefined,visibility:natural.width?'visible':'hidden',transform:`translate(-50%,-50%) translate(${x}px,${y}px) scale(${zoom})`}} onLoad={e=>{setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight});onReady?.(e.currentTarget);}} onError={()=>{setFailed(true);onFailure?.('图片无法读取，原素材记录保留。');}}/>}
      {!failed&&kind==='image'&&!natural.width&&<p className="ui-media-message">正在读取图片…</p>}
      {natural.width>0&&tool!=='pick'&&marks.map((mark,index)=>mark.region&&<Button key={mark.id} variant="app-content" className="ui-media-mark" data-kind={mark.region.kind} style={{left:left+mark.region.x*natural.width*zoom,top:top+mark.region.y*natural.height*zoom,width:mark.region.kind==='box'?mark.region.w*natural.width*zoom:undefined,height:mark.region.kind==='box'?mark.region.h*natural.height*zoom:undefined}} title={mark.text} aria-label={'批注 '+(index+1)+'：'+mark.text} onClick={()=>onMark?.(mark.id)}><span>{mark.id==='draft'?'+':index+1}</span></Button>)}
    </div>
    {overflow&&<div className="ui-media-minimap"><div role="slider" aria-label="缩略导航，方向键平移" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((minLeft+minRight)*50)} tabIndex={0} style={{width:mapW,height:mapH}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);moveMap(e);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))moveMap(e);}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onKeyDown={e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();setView({zoom,x:x+(e.key==='ArrowLeft'?60:e.key==='ArrowRight'?-60:0),y:y+(e.key==='ArrowUp'?60:e.key==='ArrowDown'?-60:0),fitted:false});}}><img src={src} alt="整图导航"/><span style={{left:minLeft*mapW,top:minTop*mapH,width:(minRight-minLeft)*mapW,height:(minBottom-minTop)*mapH}}/></div><small>拖动定位</small></div>}
    <footer className="ui-media-controls"><Button variant="ghost" size="icon-sm" disabled={!natural.width||zoom<=Math.min(.05,fit/4)} aria-label="缩小" onClick={()=>scale(zoom/1.25)}><Minus/></Button><Button variant="ghost" size="sm" disabled={!natural.width} onClick={original} title="原始大小（1）">{natural.width?Math.round(zoom*100)+'%':'—'}</Button><Button variant="ghost" size="icon-sm" disabled={!natural.width||zoom>=8} aria-label="放大" onClick={()=>scale(zoom*1.25)}><Plus/></Button><Button variant="ghost" size="sm" disabled={!natural.width} aria-pressed={view.fitted} onClick={reset}>适应窗口</Button><Button variant="ghost" size="sm" disabled={!natural.width} onClick={original}>原始大小</Button><small>{natural.width?`${natural.width} × ${natural.height}`:'视频'}</small></footer>
  </div>;
}
