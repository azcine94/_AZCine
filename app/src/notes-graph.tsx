import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Minus,Plus,Maximize} from 'lucide-react';
import {Button} from './components/ui/button.tsx';
import {Input} from './components/ui/input.tsx';
import {Checkbox} from './components/ui/checkbox.tsx';
import type {LocalNote} from '../plainva-editor/assets/editor.js';

type Point={x:number;y:number};
type Camera=Point&{scale:number};
// Deterministic force layout: linked notes attract; all notes repel. Positions
// remain stable while filtering, zooming or switching back to the graph tab.
function layout(docs:LocalNote[]){
  const index=new Map(docs.map((doc,i)=>[doc.path,i]));
  const nodes=docs.map((doc,i)=>({path:doc.path,x:Math.cos(i*2.39996)*Math.sqrt(i+1)*65,y:Math.sin(i*2.39996)*Math.sqrt(i+1)*65}));
  const edges=docs.flatMap((doc,i)=>doc.links.flatMap(link=>{const j=index.get(link.resolved??'');return j===undefined||j===i?[]:[{source:i,target:j}];}));
  const unique=[...new Map(edges.map(e=>[[e.source,e.target].sort((a,b)=>a-b).join(':'),e])).values()];
  const steps=nodes.length>400?55:180;
  for(let step=0;step<steps;step++){
    const forces=nodes.map(p=>({x:-p.x*.008,y:-p.y*.008}));
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d2=Math.max(25,dx*dx+dy*dy),distance=Math.sqrt(d2),force=8500/d2;
      forces[i].x+=dx/distance*force;forces[i].y+=dy/distance*force;forces[j].x-=dx/distance*force;forces[j].y-=dy/distance*force;
    }
    for(const {source,target} of unique){const a=nodes[source],b=nodes[target],dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),f=(d-150)*.025;forces[source].x+=dx/d*f;forces[source].y+=dy/d*f;forces[target].x-=dx/d*f;forces[target].y-=dy/d*f;}
    const cooling=1-step/steps*.8;
    nodes.forEach((p,i)=>{p.x+=Math.max(-14,Math.min(14,forces[i].x))*cooling;p.y+=Math.max(-14,Math.min(14,forces[i].y))*cooling;});
  }
  return {nodes,edges:unique};
}

export function NotesGraph({docs,current,open,controls}:{docs:LocalNote[];current:string;open:(path:string)=>void;controls?:ReactNode}){
  const surface=useRef<SVGSVGElement>(null),cameraRef=useRef<Camera>({x:0,y:0,scale:1});
  const [size,setSize]=useState({width:800,height:600}),[camera,setCamera]=useState(cameraRef.current),[query,setQuery]=useState(''),[hideIsolated,setHideIsolated]=useState(false),[hover,setHover]=useState('');
  const [moved,setMoved]=useState<Record<string,Point>>({});
  const drag=useRef<{pointer:number;start:Point;camera:Camera;path?:string;point?:Point;moved:boolean}|null>(null);
  const graph=useMemo(()=>layout(docs),[docs]);
  const connected=new Set(graph.edges.flatMap(e=>[graph.nodes[e.source].path,graph.nodes[e.target].path]));
  const nodes=graph.nodes.filter(n=>(!hideIsolated||connected.has(n.path))&&n.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const visible=new Set(nodes.map(n=>n.path));
  const point=(n:typeof graph.nodes[number])=>moved[n.path]??n;
  function change(next:Camera){cameraRef.current=next;setCamera(next);}
  function fit(){
    if(!nodes.length){change({x:size.width/2,y:size.height/2,scale:1});return;}
    const points=nodes.map(point),minX=Math.min(...points.map(n=>n.x))-95,maxX=Math.max(...points.map(n=>n.x))+95,minY=Math.min(...points.map(n=>n.y))-50,maxY=Math.max(...points.map(n=>n.y))+60;
    const scale=Math.max(.08,Math.min(1.6,size.width/(maxX-minX),size.height/(maxY-minY)));
    change({scale,x:size.width/2-(minX+maxX)/2*scale,y:size.height/2-(minY+maxY)/2*scale});
  }
  function zoom(factor:number,anchor={x:size.width/2,y:size.height/2}){const c=cameraRef.current,scale=Math.max(.08,Math.min(5,c.scale*factor)),ratio=scale/c.scale;change({scale,x:anchor.x-(anchor.x-c.x)*ratio,y:anchor.y-(anchor.y-c.y)*ratio});}
  useEffect(()=>{const svg=surface.current;if(!svg)return;const observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;if(width&&height)setSize({width,height});});observer.observe(svg);return()=>observer.disconnect();},[]);
  useEffect(()=>{fit();},[graph,size.width,size.height,query,hideIsolated]);
  useEffect(()=>{const svg=surface.current;if(!svg)return;const wheel=(event:WheelEvent)=>{event.preventDefault();const box=svg.getBoundingClientRect();zoom(Math.exp(-event.deltaY*.0015),{x:event.clientX-box.left,y:event.clientY-box.top});};svg.addEventListener('wheel',wheel,{passive:false});return()=>svg.removeEventListener('wheel',wheel);},[size]);
  const neighbors=new Set(graph.edges.flatMap(e=>{const a=graph.nodes[e.source].path,b=graph.nodes[e.target].path;return a===hover?[b]:b===hover?[a]:[];}));
  const labelText=(path:string)=>{const name=path.split('/').pop()!.replace(/\.md$/i,'');return name.length>18?name.slice(0,18)+'…':name;};
  const labels=new Set<string>(),occupied:{x:number;y:number;width:number}[]=[];
  for(const n of [...nodes].sort((a,b)=>Number(b.path===hover||b.path===current)-Number(a.path===hover||a.path===current))){
    const p=point(n),width=[...labelText(n.path)].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?12:7),0),box={x:p.x*camera.scale+camera.x-width/2,y:p.y*camera.scale+camera.y+14,width};
    if(n.path===hover||!occupied.some(r=>box.x<r.x+r.width+8&&box.x+box.width+8>r.x&&Math.abs(box.y-r.y)<20)){labels.add(n.path);occupied.push(box);}
  }
  return <div className="notes-graph-view">
    <div className="notes-local-toolbar notes-graph-controls">{controls}<Input variant="app" aria-label="筛选关系图笔记" placeholder="筛选笔记…" value={query} onChange={e=>setQuery(e.target.value)}/><label><Checkbox checked={hideIsolated} onCheckedChange={v=>setHideIsolated(v===true)}/>仅显示有连接的笔记</label><span className="notes-graph-count">{nodes.length} 篇</span><Button variant="app-quiet" size="icon-sm" aria-label="缩小关系图" onClick={()=>zoom(1/1.25)}><Minus/></Button><span className="notes-graph-scale">{Math.round(camera.scale*100)}%</span><Button variant="app-quiet" size="icon-sm" aria-label="放大关系图" onClick={()=>zoom(1.25)}><Plus/></Button><Button variant="app-quiet" size="icon-sm" aria-label="适应关系图" onClick={fit}><Maximize/></Button></div>
    <div className="notes-graph-canvas">
      <svg ref={surface} className="notes-graph-interactive" role="group" aria-label="关系图画布，滚轮缩放，拖动平移，点击笔记打开" tabIndex={0} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}else if(e.key==='-'){e.preventDefault();zoom(.8);}else if(e.key==='0'){e.preventDefault();fit();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const c=cameraRef.current;change({...c,x:c.x+(e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0),y:c.y+(e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0)});}}}
        onPointerDown={e=>{if(e.button!==0)return;const node=(e.target as Element).closest('[data-graph-node]'),path=node?.getAttribute('data-graph-node')??undefined,n=graph.nodes.find(n=>n.path===path);drag.current={pointer:e.pointerId,start:{x:e.clientX,y:e.clientY},camera:{...cameraRef.current},path,point:n?point(n):undefined,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
        onPointerMove={e=>{const d=drag.current;if(!d||d.pointer!==e.pointerId)return;const dx=e.clientX-d.start.x,dy=e.clientY-d.start.y;if(Math.hypot(dx,dy)>4)d.moved=true;if(d.path&&d.point){const p=d.point;setMoved(old=>({...old,[d.path!]:{x:p.x+dx/d.camera.scale,y:p.y+dy/d.camera.scale}}));}else change({...d.camera,x:d.camera.x+dx,y:d.camera.y+dy});}}
        onPointerUp={e=>{const d=drag.current;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(d?.path&&!d.moved)open(d.path);}}
        onPointerCancel={()=>{drag.current=null;}}>
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`} data-graph-transform>
          {graph.edges.map(({source,target})=>{const a=graph.nodes[source],b=graph.nodes[target];if(!visible.has(a.path)||!visible.has(b.path))return null;const p=point(a),q=point(b);return <line key={source+':'+target} x1={p.x} y1={p.y} x2={q.x} y2={q.y} data-highlight={a.path===hover||b.path===hover}/>;})}
          {nodes.map(n=>{const pos=point(n),highlight=n.path===hover||neighbors.has(n.path);return <g key={n.path} data-graph-node={n.path} data-current={n.path===current} data-highlight={highlight} role="button" tabIndex={0} aria-label={`打开 ${n.path}`} transform={`translate(${pos.x} ${pos.y})`} onPointerEnter={()=>setHover(n.path)} onPointerLeave={()=>setHover('')} onFocus={()=>setHover(n.path)} onBlur={()=>setHover('')} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(n.path);}}}><title>{n.path}</title><circle r={n.path===current?8:6}/><text y={24/camera.scale} style={{fontSize:12/camera.scale,strokeWidth:3/camera.scale}} textAnchor="middle" data-muted={!labels.has(n.path)}>{labelText(n.path)}</text></g>;})}
        </g>
      </svg>
      {!nodes.length&&<p className="notes-graph-empty">没有符合条件的笔记</p>}
      <div className="notes-graph-help">滚轮缩放 · 拖动画布平移 · 拖动节点调整 · 点击打开笔记</div>
    </div>
  </div>;
}
