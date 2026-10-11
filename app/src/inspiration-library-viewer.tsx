import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Fullscreen, Hand, MessageSquare, Pipette, X } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { MediaCanvas } from './components/ui/media-canvas.tsx';
import type { MediaTool } from './components/ui/media-canvas.tsx';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { formatLibraryBytes } from './inspiration-library-client.ts';
import type { LibraryAsset,LibraryStore,LibraryState,LibraryRegion } from './inspiration-library-client.ts';
import { imagePalette } from './image-palette.ts';
import type { PaletteColor } from './image-palette.ts';
import { workspaceError } from './workspace-contract.ts';

export function InspirationViewer({asset,ids,state,model,initialNotes=false,onChange,onClose}:{asset:LibraryAsset;ids:string[];state:LibraryState;model:LibraryStore;initialNotes?:boolean;onChange:(id:string)=>void;onClose:()=>void}){
  const frame=useRef<HTMLDivElement>(null),inspector=useRef<HTMLElement>(null),notesArea=useRef<HTMLElement>(null),hexField=useRef<HTMLInputElement>(null);
  const [tool,setTool]=useState<MediaTool>('pan'),[showNotes,setShowNotes]=useState(initialNotes),[palette,setPalette]=useState<PaletteColor[]>([]),[paletteError,setPaletteError]=useState(''),[picked,setPicked]=useState(''),[error,setError]=useState(''),[dimensions,setDimensions]=useState(''),[deleting,setDeleting]=useState('');
  const currentId=useRef(asset.id);currentId.current=asset.id;
  const draft=model.draft(asset),noteDraft=state.noteDrafts[asset.id]??{id:'',text:'',region:null};
  const editing=draft.notes.find(n=>n.id===noteDraft.id);
  const index=ids.indexOf(asset.id);
  useLayoutEffect(()=>{setPalette([]);setPicked('');setPaletteError('');setError('');setTool('pan');setDimensions('');setDeleting('');if(inspector.current)inspector.current.scrollTop=0;},[asset.id]);
  useEffect(()=>()=>{if(document.fullscreenElement===frame.current)void document.exitFullscreen().catch(()=>{});},[]);
  const step=(delta:number)=>{const next=ids[index+delta];if(next)onChange(next);};
  function openNotes(){setShowNotes(true);requestAnimationFrame(()=>notesArea.current?.scrollIntoView({block:'nearest'}));}
  function changeTool(value:MediaTool){setTool(value);if(value==='pin'||value==='box')openNotes();else if(value==='pick'&&inspector.current)inspector.current.scrollTop=0;}
  function region(value:LibraryRegion){model.setNoteDraft(asset.id,{...noteDraft,region:value});openNotes();}
  async function copy(hex:string){setPicked(hex);try{await navigator.clipboard.writeText(hex);notifyOperation('已复制 '+hex);}catch{hexField.current?.focus();hexField.current?.select();setError('自动复制失败，色值已选中，请按 Ctrl+C 复制。');}}
  async function save(){setError('');const id=asset.id;try{await model.save(asset);}catch(e){if(currentId.current===id)setError(workspaceError(e));}}
  async function saveNote(){
    if(!noteDraft.text.trim()){setError('请输入批注内容。');return;}
    if(noteDraft.region?.kind==='box'&&(!noteDraft.region.w||!noteDraft.region.h)){setError('请框选有效的图片区域。');return;}
    const sent={...noteDraft,id:noteDraft.id||crypto.randomUUID()},entry={...sent,text:sent.text.trim()};
    model.setNoteDraft(asset.id,sent);
    const notes=draft.notes.some(n=>n.id===entry.id)?draft.notes.map(n=>n.id===entry.id?entry:n):[...draft.notes,entry];
    model.edit(asset,{notes});setError('');const id=asset.id;
    try{await model.save(asset);if(model.state.noteDrafts[id]===sent)model.setNoteDraft(id,{id:'',text:'',region:null});if(currentId.current===id)setTool('pan');}
    catch(e){if(currentId.current===id)setError(workspaceError(e));}
  }
  function selectNote(id:string){
    if(id==='draft'){openNotes();return;}
    const note=draft.notes.find(n=>n.id===id);if(!note)return;
    if(noteDraft.text.trim()&&noteDraft.id!==id){setError('当前批注草稿已保留，请先保存，再编辑另一条批注。');openNotes();return;}
    model.setNoteDraft(asset.id,{...note});setTool('pan');openNotes();
  }
  async function removeNote(id:string){const assetId=asset.id;model.edit(asset,{notes:draft.notes.filter(n=>n.id!==id)});setError('');try{await model.save(asset);if(model.state.noteDrafts[assetId]===noteDraft&&noteDraft.id===id)model.setNoteDraft(assetId,{id:'',text:'',region:null});if(currentId.current===assetId)setDeleting('');}catch(e){if(currentId.current===assetId)setError(workspaceError(e));}}
  function imageReady(image:HTMLImageElement){
    setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
    try{
      setPalette(imagePalette(image));
      setPaletteError('');
    }catch(e){
      setPaletteError(workspaceError(e));
    }
  }
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await frame.current?.requestFullscreen();}catch{setError('当前桌面环境未允许全屏。');}}
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent ref={frame} layout="form" className="inspiration-viewer" showCloseButton={false} onEscapeKeyDown={e=>{
    if(tool!=='pan'){
      e.preventDefault();
      setTool('pan');
    }
  }} onKeyDown={e=>{if(e.defaultPrevented||e.nativeEvent.isComposing||e.ctrlKey||e.metaKey||e.altKey||(e.target as HTMLElement).closest('input,textarea,select,video'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}if(e.key.toLowerCase()==='f'){e.preventDefault();void fullscreen();}if(e.key.toLowerCase()==='n'){e.preventDefault();setShowNotes(!showNotes);}if(e.key.toLowerCase()==='v')setTool('pan');if(e.key.toLowerCase()==='p'&&asset.kind==='image'&&dimensions)changeTool('pin');}}>
    <header className="inspiration-viewer-header"><div><DialogTitle title={draft.name}>{draft.name}</DialogTitle><small>{index+1} / {ids.length}</small></div><div><Button variant="ghost" size="sm" aria-pressed={showNotes} onClick={()=>{if(showNotes)setShowNotes(false);else openNotes();}}><MessageSquare/>批注{draft.notes.length||''}</Button><Button variant="ghost" size="icon-sm" aria-label="切换全屏" onClick={()=>void fullscreen()}><Fullscreen/></Button><Button variant="ghost" size="icon-sm" aria-label="关闭预览" onClick={onClose}><X/></Button></div></header>
    <DialogDescription className="sr-only">滚轮缩放，拖动平移，双击切换适应与原图，左右方向键切图；信息与色板常驻右侧。编辑草稿在切图与关闭时保留。</DialogDescription>
    <div className="inspiration-viewer-body"><div className="inspiration-viewer-main">
      <MediaCanvas key={asset.id} src={model.media(asset)} name={asset.name} kind={asset.kind} tool={tool} marks={[...draft.notes.filter(n=>n.id!==noteDraft.id),...(noteDraft.region?[{id:'draft',text:noteDraft.text||'待保存批注',region:noteDraft.region}]:[])]} onRegion={region} onMark={selectNote} onPick={hex=>{setPicked(hex);setTool('pan');notifyOperation('已取色 '+hex);}} onStep={step} onFailure={setError} onReady={imageReady}/>
      <Button variant="secondary" className="inspiration-viewer-prev" size="icon-sm" disabled={index<=0} aria-label="上一张" onClick={()=>step(-1)}><ChevronLeft/></Button><Button variant="secondary" className="inspiration-viewer-next" size="icon-sm" disabled={index>=ids.length-1} aria-label="下一张" onClick={()=>step(1)}><ChevronRight/></Button>
    </div><aside ref={inspector} className="inspiration-inspector" aria-label="信息与色板"><h3>信息与色板</h3>
      <section className="inspiration-palette"><div className="inspiration-color-strip">{palette.map(c=><Button key={c.hex} variant="app-content" style={{background:c.hex,flex:c.fraction}} title={c.hex} aria-label={'复制 '+c.hex} onClick={()=>void copy(c.hex)}/>)}</div><div className="inspiration-colors">{palette.map(c=><Button key={c.hex} variant="app-content" className="inspiration-color" onClick={()=>void copy(c.hex)} aria-label={'复制 '+c.hex}><span style={{background:c.hex}}/><code>{c.hex}</code><small>{(c.fraction*100).toFixed(1)}%</small></Button>)}</div><p>{asset.kind==='video'?'视频不提取色板。':paletteError||(palette.length?'主色近似占比 · 点击复制 HEX':'正在读取图片色板…')}</p><Button variant="ghost" size="sm" disabled={asset.kind!=='image'||!dimensions} aria-pressed={tool==='pick'} onClick={()=>changeTool(tool==='pick'?'pan':'pick')}><Pipette/>从画面取色</Button>{picked&&<div className="inspiration-picked"><span style={{background:picked}}/><Input ref={hexField} variant="app" readOnly value={picked} aria-label="选中色值"/><Button variant="ghost" size="sm" onClick={()=>void copy(picked)}>复制</Button></div>}</section>
      <section className="inspiration-info"><label>名称<Input variant="app" value={draft.name} maxLength={200} onChange={e=>model.edit(asset,{name:e.target.value})}/></label><label>分组<NativeSelect variant="app" value={draft.groupId} onChange={e=>model.edit(asset,{groupId:e.target.value})}><option value="">未分组</option>{state.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect></label><label>标签<Input variant="app" value={draft.tags.join('，')} maxLength={4000} placeholder="用逗号分隔" onChange={e=>model.edit(asset,{tags:e.target.value.split(/[,，]/)})}/></label><Button variant="default" size="sm" disabled={!!state.busy} onClick={()=>void save()}>{state.busy===asset.id?'保存中…':'保存信息'}</Button>
      <details><summary>文件详情</summary><dl><dt>文件</dt><dd>{asset.filename}</dd><dt>尺寸</dt><dd>{dimensions||'视频'}</dd><dt>大小</dt><dd>{formatLibraryBytes(asset.bytes)}</dd><dt>来源</dt><dd>{asset.source}</dd>{asset.sourceUrl&&<><dt>网址</dt><dd>{asset.sourceUrl}</dd></>}<dt>添加</dt><dd>{new Date(asset.createdAt).toLocaleString()}</dd></dl></details></section>
      {error&&<Feedback tone="error" role="alert">{error}</Feedback>}
      <div className="inspiration-tools"><Button variant="ghost" size="sm" aria-pressed={tool==='pan'} onClick={()=>changeTool('pan')}><Hand/>拖动</Button><Button variant="ghost" size="sm" disabled={asset.kind!=='image'||!dimensions} aria-pressed={tool==='pin'} onClick={()=>changeTool('pin')}>点标记</Button><Button variant="ghost" size="sm" disabled={asset.kind!=='image'||!dimensions} aria-pressed={tool==='box'} onClick={()=>changeTool('box')}>框选</Button></div>
      {showNotes&&<section ref={notesArea} className="inspiration-notes"><h3>图片批注</h3>{!draft.notes.length&&<p>标记画面细节，或直接写下整图批注。</p>}{draft.notes.map((note,i)=><div key={note.id} className="inspiration-note"><Button variant="app-content" onClick={()=>selectNote(note.id)}><small>{i+1} · {note.region?'位置批注':'整图批注'}</small><span>{note.text}</span></Button>{deleting===note.id?<div><Button variant="destructive" size="sm" disabled={!!state.busy} onClick={()=>void removeNote(note.id)}>确认删除</Button><Button variant="ghost" size="sm" onClick={()=>setDeleting('')}>取消</Button></div>:<Button variant="ghost" size="sm" disabled={!!state.busy} onClick={()=>setDeleting(note.id)}>删除</Button>}</div>)}
        <label>{editing?'编辑批注':'新批注'}<Textarea variant="app" rows={4} maxLength={2000} value={noteDraft.text} onChange={e=>model.setNoteDraft(asset.id,{...noteDraft,text:e.target.value})} placeholder="哪些构图、光影或细节值得借鉴？"/></label><small>{noteDraft.region?noteDraft.region.kind==='box'?'已框选区域':'已标记位置':'整图批注'}</small><Button variant="ghost" size="sm" onClick={()=>{model.setNoteDraft(asset.id,{...noteDraft,region:null});setTool('pan');}}>改为整图批注</Button><Button variant="default" size="sm" disabled={!!state.busy} onClick={()=>void saveNote()}>保存批注</Button>
      </section>}
    </aside></div>
  </DialogContent></Dialog>;
}
