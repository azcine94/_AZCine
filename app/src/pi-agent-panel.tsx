import { supportedThinkingLevels, thinkingLabels } from './pi-thinking.ts';
import { AgentSessionNavigation } from './agent-session-navigation.tsx';
import { ChevronLeft,MessagesSquare } from 'lucide-react';
import {AgentObjectPicker} from './agent-object-picker.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { ActionGroup } from './components/ui/action-group.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { PiController } from './use-pi.ts';
import { piError } from './pi-client.ts';
import { activityText, conversationView } from './pi-process-view.ts';
import { Conversation, PiIcon } from './pi-process-panel.tsx';
import { RuntimeInfo } from './pi-panels.tsx';
import { PiExtensionPanel } from './pi-extension-panel.tsx';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from './components/ui/dialog.tsx';
import { NativeSelect,NativeSelectOption } from './components/ui/native-select.tsx';
import { Popover,PopoverTrigger,PopoverContent } from './components/ui/popover.tsx';
import type { PiModel } from './pi-contract.ts';
import type { AgentDataController } from './use-agent-data.ts';
import { AgentDraftsPanel } from './agent-drafts-panel.tsx';
import { AttachmentPreview } from './components/ui/attachment-preview.tsx';
import { ScaleLoader } from './components/ui/scale-loader.tsx';
import { MAX_AGENT_IMAGE_BYTES,MAX_AGENT_IMAGES,MAX_AGENT_IMAGE_BATCH_BASE64_BYTES } from './agent-image-limits.ts';

function ModelPicker({models,current,thinking,disabled,context,onSelect,onThinking}:{models:PiModel[];current:PiModel|null|undefined;thinking:string|undefined;disabled:boolean;context:string;onSelect:(value:PiModel)=>Promise<void>;onThinking?:(level:string)=>Promise<void>}) {
  const [open,setOpen]=useState(false),id=useId();
  const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const selected=models.findIndex(value=>value.provider===current?.provider&&value.id===current?.id);
  const level=current?.reasoning&&thinking?(thinkingLabels as Record<string,string>)[thinking]??thinking:null;
  useEffect(()=>{setOpen(false);},[context,disabled]);
  function close(){setOpen(false);trigger.current?.focus();}
  function keys(event:KeyboardEvent<HTMLDivElement>){if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const options=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button')??[]);if(!options.length)return;
      const index=options.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next]?.focus();}
    else if(event.key==='Tab')setOpen(false);
  }
  return <div className="pi-model-picker"><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <Button variant="app-control" ref={trigger} className="pi-model-trigger" type="button" aria-label="当前模型" aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} title={current?`${current.name} · ${current.provider}${level?` · 思考：${level}`:''}`:'请选择模型'} onKeyDown={event=>{if(!event.nativeEvent.isComposing&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true);}}}>
      <span className="pi-model-name">{current?.name??'请选择模型'}</span><PiIcon type="chevron"/>
    </Button></PopoverTrigger>
    <PopoverContent id={id} className="pi-agent-layout pi-model-popover" side="top" align={onThinking?'start':'end'} collisionPadding={12} aria-label="模型与思考设置" onEscapeKeyDown={event=>{if(event.isComposing)return;event.preventDefault();close();}} onOpenAutoFocus={event=>{event.preventDefault();(menu.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')??menu.current?.querySelector<HTMLButtonElement>('button'))?.focus();}}><div className="pi-model-menu">
      <div className="pi-model-menu-heading">模型</div><div ref={menu} className="pi-model-menu-options" role="menu" aria-label="选择模型" onKeyDown={keys}>{models.map((value,index)=><Button variant="app-control" type="button" role="menuitemradio" aria-checked={index===selected} key={JSON.stringify([value.provider,value.id])} onClick={()=>{close();if(!disabled&&index!==selected)void onSelect(value);}}>
        <span><strong>{value.name}</strong><small>{value.provider}{value.reasoning?' · 支持思考':''}{value.input.includes('image')?' · 支持图片':''}</small></span><span className="pi-model-check">{index===selected&&<PiIcon type="check"/>}</span>
      </Button>)}</div>{level&&<div className="pi-model-menu-footer">{onThinking?<label>思考级别<NativeSelect aria-label="思考级别" value={thinking} disabled={disabled} onChange={event=>void onThinking(event.target.value)}>{(current?supportedThinkingLevels(current):[]).map(value=><NativeSelectOption value={value} key={value}>{thinkingLabels[value]}</NativeSelectOption>)}</NativeSelect></label>:<>当前思考级别：{level}<span>由原版 Pi 返回</span></>}</div>}
    </div></PopoverContent></Popover>
  </div>;
}

export function AgentPanel({model,onDock,agentData}:{model:PiController;onDock?:()=>void;agentData?:AgentDataController}) {
  return <div className="pi-agent-workspace"><AgentChat model={model} onDock={onDock} agentData={agentData}/></div>;
}

export function AgentChat({model,preview=false,compact=false,onExpand,onClose,onDock,agentData}:{model:PiController;preview?:boolean;compact?:boolean;onExpand?:()=>void;onClose?:()=>void;onDock?:()=>void;agentData?:AgentDataController}) {
  const s=model.snapshot,state=s?.state,projection=s?.projection,currentModel=state?.model;
  const [attachmentError,setAttachmentError]=useState<string|null>(null),[attaching,setAttaching]=useState(false);
  const [sessionsOpen,setSessionsOpen]=useState(false),[narrow,setNarrow]=useState(()=>window.innerWidth<=1100),[atBottom,setAtBottom]=useState(true),[limit,setLimit]=useState('3');
  const [moreOpen,setMoreOpen]=useState(false),[detailsOpen,setDetailsOpen]=useState(false),[navVisible,setNavVisible]=useState(true),[addOpen,setAddOpen]=useState(false);
  const [dragging,setDragging]=useState(false),dragDepth=useRef(0),importInFlight=useRef(false);
  useEffect(()=>{if(model.runtimeSummary)setLimit(String(model.runtimeSummary.replyLimit));},[model.runtimeSummary?.replyLimit]);
  const composing=useRef(false),fileInput=useRef<HTMLInputElement>(null),documentInput=useRef<HTMLInputElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
  const viewport=useRef<HTMLDivElement>(null),flow=useRef<HTMLDivElement>(null),sessionsTrigger=useRef<HTMLButtonElement>(null),moreTrigger=useRef<HTMLButtonElement>(null),addTrigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{textarea.current?.focus({preventScroll:true});},[]);
  const following=useRef(true),anchor=useRef<{key:string;offset:number}|null>(null);
  const automaticScrollTop=useRef<number|null>(null);
  const setChatScroll=useCallback((top:number)=>{
    const area=viewport.current;if(!area)return;
    const target=Math.max(0,Math.min(top,area.scrollHeight-area.clientHeight));
    if(Math.abs(area.scrollTop-target)<1)return;
    automaticScrollTop.current=target;area.scrollTop=target;automaticScrollTop.current=area.scrollTop;
  },[]);
  const captureAnchor=useCallback(()=>{
    const area=viewport.current;if(!area)return null;const top=area.getBoundingClientRect().top;
    const node=Array.from(flow.current?.children??[]).find(child=>child.getBoundingClientRect().bottom>top);
    if(!node)return null;const el=node as HTMLElement,key=el.dataset.messageKey??el.dataset.processKey;
    return key?{key,offset:el.getBoundingClientRect().top-top}:null;
  },[]);
  const alignChatScroll=useCallback(()=>{
    const area=viewport.current;if(!area)return;
    if(following.current){setChatScroll(area.scrollHeight);return;}
    const saved=anchor.current;if(!saved)return;
    const node=Array.from(flow.current?.children??[]).find(child=>(child as HTMLElement).dataset.messageKey===saved.key||(child as HTMLElement).dataset.processKey===saved.key);
    if(node)setChatScroll(area.scrollTop+node.getBoundingClientRect().top-area.getBoundingClientRect().top-saved.offset);
  },[setChatScroll]);
  const context=`${model.root}/${state?.sessionId??'unconnected'}/${s?.generation??0}`;
  const scrollContext=`${model.root}/${state?.sessionId??model.conversationKey}`;
  const items=useMemo(()=>projection?conversationView(projection,context,model.displayRunStart):[],[projection,context,model.displayRunStart]);
  const connecting=s?.connection==='connecting',ready=s?.connection==='ready',busy=!!model.action||!!s?.busy||!!s?.stopping;
  const waiting=!!s?.extensions?.requests.some(r=>r.status==='pending');
  const running=!!projection&&(projection.activity!=='idle'||waiting);
  const pendingResponse=(model.viewing||model.action==='连接'||connecting||model.action==='发送'||s?.sending||running)&&!waiting&&!items.some(item=>item.kind==='process'&&item.live||item.kind==='message'&&item.role==='assistant'&&item.status==='streaming');
  const conversationDrafts=(agentData?.drafts??[]).filter(d=>d.status!=='discarded'&&(!d.context.sessionId||d.context.sessionId===state?.sessionId)&&(d.conversationKey===model.conversationKey||!!state?.sessionId&&(d.messageKey?.startsWith(state.sessionId+':')||d.messageKey?.startsWith('mcp:'+state.sessionId+':'))));
  const draftIndex=(key?:string)=>key?Number(key.split(':').at(-2)):NaN;
  const draftAnchors=new Map<string,string|undefined>(conversationDrafts.map((d):[string,string|undefined]=>{
    if(!d.messageKey?.startsWith('mcp:'))return [d.id,items.findLast(item=>item.kind==='message'&&item.role==='assistant'&&item.status!=='streaming'&&item.messageIndex===draftIndex(d.messageKey))?.key];
    const start=d.context.messageCount;if(start===undefined)return [d.id,undefined];
    const nextUser=items.find(item=>item.kind==='message'&&item.role==='user'&&item.messageIndex!==undefined&&item.messageIndex>start);
    const end=nextUser?.kind==='message'?(nextUser.messageIndex??Infinity):Infinity;
    return [d.id,items.findLast(item=>item.kind==='message'&&item.role==='assistant'&&item.status!=='streaming'&&item.messageIndex!==undefined&&item.messageIndex>=start&&item.messageIndex<end)?.key];
  }));
  const draftAfter=(item:Extract<(typeof items)[number],{kind:'message'}>)=>agentData?conversationDrafts.filter(d=>draftAnchors.get(d.id)===item.key).map(d=><AgentDraftsPanel key={d.id} model={agentData} pi={model} draft={d}/>):null;
  const available=!!currentModel&&!!s?.models.some(m=>m.provider===currentModel.provider&&m.id===currentModel.id);
  const imageUnsupported=ready&&model.draft.images.length>0&&!currentModel?.input.includes('image');
  const sendDisabled=preview||model.viewing||!model.root||!model.connected||ready&&!available||busy||attaching||imageUnsupported||(!model.draft.text.trim()&&!model.draft.images.length&&!model.files.length&&!model.objects.objects.length);
  const showStop=running||s?.connection==='connecting'||s?.busy||s?.sending||s?.stopping;
  const connection=preview?'界面示例 · 未连接模型':s?.connection==='connecting'?'正在连接原版 Pi…':ready?available?'已连接':'原版已就绪 · 请先配置模型':s?.connection==='error'?'连接中断，可重新连接':'发送时连接';
  const remember=useRef(model.rememberChatScroll);remember.current=model.rememberChatScroll;
  useEffect(()=>{
    const query=window.matchMedia('(min-width:1101px)'),resize=()=>{setNarrow(!query.matches);setSessionsOpen(false);};
    query.addEventListener('change',resize);return()=>query.removeEventListener('change',resize);
  },[]);
  useEffect(()=>{setMoreOpen(false);setDetailsOpen(false);setAddOpen(false);},[context]);
  useLayoutEffect(()=>{
    const area=viewport.current;if(!area)return;const saved=model.readChatScroll(scrollContext);
    following.current=saved?.following??true;anchor.current=null;automaticScrollTop.current=null;
    setChatScroll(saved?.top??area.scrollHeight);if(!following.current)anchor.current=captureAnchor();setAtBottom(following.current);
    return()=>remember.current(scrollContext,area.scrollTop,following.current);
  },[scrollContext,setChatScroll,captureAnchor]);
  // Resize the composer before aligning messages, so a send receipt cannot
  // scroll against its temporary height and correct itself again after paint.
  useLayoutEffect(()=>{const input=textarea.current;if(input){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,parseFloat(getComputedStyle(input).maxHeight)||180)+'px';}},[model.draft.text,compact]);
  useLayoutEffect(()=>{alignChatScroll();});
  useEffect(()=>{const area=viewport.current,content=flow.current;if(!area||!content)return;
    const observer=new ResizeObserver(alignChatScroll);observer.observe(area);observer.observe(content);return()=>observer.disconnect();},[alignChatScroll]);
  function beforeToggle(){following.current=false;anchor.current=captureAnchor();setAtBottom(false);}
  function beginManualScroll(){automaticScrollTop.current=null;}
  function scroll(){const area=viewport.current;if(!area)return;
    if(automaticScrollTop.current!==null&&Math.abs(area.scrollTop-automaticScrollTop.current)<1){model.rememberChatScroll(scrollContext,area.scrollTop,following.current);return;}
    automaticScrollTop.current=null;const bottom=area.scrollHeight-area.clientHeight-area.scrollTop<40;
    following.current=bottom;anchor.current=bottom?null:captureAnchor();setAtBottom(bottom);model.rememberChatScroll(scrollContext,area.scrollTop,bottom);}
  function latest(){following.current=true;anchor.current=null;setAtBottom(true);if(viewport.current)setChatScroll(viewport.current.scrollHeight);}
  async function importFiles(files:File[]){if(!files.length)return;if(preview){setAttachmentError('界面示例不导入本机文件。');return;}if(importInFlight.current){setAttachmentError('正在导入附件，请稍后再添加。');return;}importInFlight.current=true;setAttachmentError(null);setAttaching(true);
    const images=files.filter(file=>file.type.startsWith('image/')||/\.(png|jpe?g|webp|gif)$/i.test(file.name)),documents=files.filter(file=>!images.includes(file));
    const key=model.draftKey,conversation=model.conversationKey,existing=[...model.draft.images];
    try{if(images.length+existing.length>MAX_AGENT_IMAGES)throw new Error('最多附加4张图片，原附件仍保留。');if(documents.length+model.files.length>16)throw new Error('最多附加16个文件，原附件仍保留。');
      if(images.some(file=>file.size>MAX_AGENT_IMAGE_BYTES))throw new Error('图片每张不超过50MB，原附件仍保留。');
      const loaded=await Promise.all(images.map(async file=>{
        const header=new Uint8Array(await file.slice(0,12).arrayBuffer());const starts=(bytes:number[])=>bytes.every((v,i)=>header[i]===v);
        const mimeType=starts([137,80,78,71,13,10,26,10])?'image/png':starts([255,216,255])?'image/jpeg':starts([71,73,70,56])?'image/gif':starts([82,73,70,70])&&header[8]===87&&header[9]===69&&header[10]===66&&header[11]===80?'image/webp':null;
        if(!mimeType)throw new Error('请选择有效的 PNG、JPEG、WebP 或 GIF 图片。');
        const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('图片读取失败，文字和原附件仍保留。'));reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(file);});return{id:crypto.randomUUID(),name:file.name,mimeType,data};}));
      if([...existing,...loaded].reduce((n,i)=>n+i.data.length,0)>MAX_AGENT_IMAGE_BATCH_BASE64_BYTES)throw new Error('图片总大小超过限制：最多4张，每张50MB，原附件仍保留。');if(loaded.length)model.setImages([...existing,...loaded],key);
      for(const file of documents)await model.attachFile(file,conversation);
    }catch(error){setAttachmentError(piError(error));}finally{importInFlight.current=false;setAttaching(false);}}
  async function attach(event:ChangeEvent<HTMLInputElement>){const files=Array.from(event.target.files??[]);event.target.value='';await importFiles(files);}
  function keydown(event:KeyboardEvent<HTMLTextAreaElement>){if(event.key==='Enter'&&!event.shiftKey&&!composing.current&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();if(!sendDisabled)void model.send(running?'followUp':null);}}
  const navigationShown=!compact&&!narrow&&navVisible;
  const sessionListAction=navigationShown?'收起会话列表':'打开会话列表';
  const sessionNavigation=<AgentSessionNavigation model={model} busy={busy} attaching={attaching} inDialog={!navigationShown} onNavigate={()=>setSessionsOpen(false)} onCollapse={()=>{setNavVisible(false);setSessionsOpen(false);requestAnimationFrame(()=>sessionsTrigger.current?.focus());}} returnFocus={()=>sessionsTrigger.current}/>;
  return <div className="pi-agent-layout" data-redesign="true" data-compact={compact} data-navigation={!compact&&!narrow&&navVisible}
    onDragEnter={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();dragDepth.current++;setDragging(true);}}}
    onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=attaching?'none':'copy';setDragging(true);}}}
    onDragLeave={event=>{if(event.dataTransfer.types.includes('Files')){event.stopPropagation();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}}}
    onDrop={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();dragDepth.current=0;setDragging(false);void importFiles(Array.from(event.dataTransfer.files));}}}>
    {!compact&&!narrow&&navVisible&&<aside className="pi-sessions" aria-label="会话导航">{sessionNavigation}</aside>}
    {(compact||narrow||!navVisible)&&<Dialog open={sessionsOpen} onOpenChange={setSessionsOpen}><DialogContent layout="form" showCloseButton={false} className="pi-agent-layout pi-session-dialog" onCloseAutoFocus={event=>{event.preventDefault();sessionsTrigger.current?.focus();}}><DialogTitle className="sr-only">会话导航</DialogTitle><DialogDescription className="sr-only">选择已有会话或开始新的会话。</DialogDescription><nav className="pi-sessions" aria-label="会话导航">{sessionNavigation}</nav></DialogContent></Dialog>}
    <section className="pi-chat" aria-label="通用 Agent 对话">
      {dragging&&<div className="pi-attachment-drop" role="status"><div><PiIcon type="attachment"/><strong>松开以添加附件</strong><span>图片、PDF、表格或文本文件</span></div></div>}
      <header className="pi-chat-heading">
        <Button variant="app-quiet" size="icon-sm" ref={sessionsTrigger} data-agent-sessions={compact||narrow||!navVisible?true:undefined} aria-label={sessionListAction} title={sessionListAction} aria-haspopup={compact||narrow?'dialog':undefined} aria-expanded={compact||narrow?sessionsOpen:navVisible} onClick={()=>{if(compact||narrow)setSessionsOpen(true);else setNavVisible(value=>!value);}}>{navigationShown?<ChevronLeft aria-hidden="true"/>:<MessagesSquare aria-hidden="true"/>}</Button>
        <div className="pi-chat-identity"><h2 title={state?.sessionName??'新会话'}>{state?.sessionName??'新会话'}</h2><span className="pi-sr-only" role="status">{connection}{running&&(' · '+(waiting?'等待回答':activityText(projection!.activity)))}</span></div>
        <div className="pi-chat-controls">
          <Button variant="app-quiet" size="icon-sm" disabled={busy||!model.root} onClick={()=>void model.newConversation()} aria-label="新会话" title="新会话"><PiIcon type="plus"/></Button>
          {onExpand&&<Button variant="app-quiet" size="icon-sm" aria-label="打开 Agent 完整页" title="打开完整页" onClick={onExpand}><PiIcon type="expand"/></Button>}
          {onDock&&<Button variant="app-quiet" size="icon-sm" aria-label="收回 Agent 侧栏" title="收回侧栏" onClick={onDock}><PiIcon type="sidebar"/></Button>}
          <Popover open={moreOpen} onOpenChange={setMoreOpen}><PopoverTrigger asChild><Button type="button" variant="app-quiet" size="icon-sm" ref={moreTrigger} data-agent-more aria-label="更多会话操作" title="更多"><PiIcon type="more"/></Button></PopoverTrigger><PopoverContent className="pi-agent-layout pi-options-popover" align="end" side="bottom" collisionPadding={12} aria-label="会话操作">
            <ActionGroup direction="column" className="pi-options-actions" aria-label="会话操作">
              <Button variant="app-menu" onClick={()=>{setMoreOpen(false);setDetailsOpen(true);}}>会话设置</Button>
              <UILink variant="menu" href="#settings/models" onClick={()=>setMoreOpen(false)}>模型设置</UILink>
              <UILink variant="menu" href="#resources" onClick={()=>setMoreOpen(false)}>规则与资源</UILink>
              <Button variant="app-menu" disabled={preview||busy||running||!model.root||!model.connected} onClick={()=>{setMoreOpen(false);void model.connect(undefined,true);}}>重新连接</Button>
              {ready&&<Button variant="app-menu" disabled={busy} onClick={()=>{setMoreOpen(false);void model.disconnect();}}>断开连接</Button>}
            </ActionGroup>
          </PopoverContent></Popover>
          {onClose&&<Button variant="app-quiet" size="icon-sm" aria-label="收起 Agent 侧栏" title="收起" onClick={onClose}><PiIcon type="close"/></Button>}
        </div>
      </header>
      <FormDialog returnFocus={moreTrigger.current} open={detailsOpen} onOpenChange={setDetailsOpen} title="会话设置" description="调整当前会话名称、查看连接与用量。">
        <div className="pi-agent-layout pi-session-settings">
          <form onSubmit={event=>{event.preventDefault();void model.sessionAction('pi_name_session',{name:model.sessionName});}}><label className="pi-field">会话名称<Input value={model.sessionName} maxLength={1000} onChange={event=>model.setSessionName(event.target.value)}/></label><Button variant="outline" size="sm" disabled={!ready||busy||running||!model.sessionName.trim()}>保存名称</Button></form>
          {preview?<p className="pi-preview-note">界面示例，不调用模型或保存记录。</p>:<><div className="agent-runtime-strip"><form onSubmit={e=>{e.preventDefault();void model.saveLimit(Number(limit));}}><label>同时回复上限<Input type="number" min={1} max={64} value={limit} onChange={e=>setLimit(e.target.value)}/><Button variant="outline" size="sm">保存</Button></label></form></div><RuntimeInfo model={model}/><Button size="sm" variant="ghost" onClick={()=>void model.refreshStats()}>读取会话用量</Button>{model.stats!==null&&<pre className="agent-context-block">{JSON.stringify(model.stats,null,2)}</pre>}</>}
        </div>
      </FormDialog>
      <div className="pi-chat-feedback" aria-live="polite">{(model.error??s?.error?.message)&&<Feedback as="p" tone="error" className="form-error" role="alert">{model.error??s?.error?.message}</Feedback>}{projection?.notice&&<p>{projection.notice}</p>}
        {!running&&projection?.outcome&&projection.outcome!=='none'&&projection.outcome!=='success'&&<p className="pi-outcome" data-outcome={projection.outcome}>{preview?'示例状态':'本轮'}：{({success:preview?'已完成（演示）':'实际回复已完成',error:'失败',interrupted:'已中断',incomplete:'未完整结束'} as Record<string,string>)[projection.outcome]??'状态待确认'}</p>}
      </div>
      <div className="pi-message-area"><div className="pi-chat-messages" ref={viewport} onScroll={scroll} onWheel={beginManualScroll} onTouchStart={beginManualScroll} onPointerDown={beginManualScroll} onKeyDown={event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))beginManualScroll();}} tabIndex={0} role="region" aria-label="会话消息">
        <div className="pi-chat-flow" data-empty={!items.length&&!s?.recoveredQueue.length&&!pendingResponse&&!conversationDrafts.length} ref={flow}>{!items.length&&!pendingResponse&&!conversationDrafts.length?<EmptyState as="div" className="pi-chat-empty"><h3>{connecting?'正在连接会话':!ready||available?'今天想一起做点什么？':'先连接你自己的模型'}</h3><p>{connecting?'输入仍保留，连接完成后可以继续。':!ready?'写下想做的事，发送时会自动连接。':available?'写下你的想法，我们一起往前推进。':'输入可以先写在下方，连接模型后再发送。'}</p>{ready&&!available&&!connecting&&<UILink variant="text" className="foundation-link" href="#settings/models">前往模型设置</UILink>}{available&&!connecting&&!model.draft.text&&<div className="pi-chat-suggestions">{[["理清交付安排","把需要确认的事列清楚","帮我整理今天的交付安排。"],["一起梳理想法","从一个想法开始讨论","帮我一起梳理这个项目的想法。"]].map(([title,description,text])=><Button key={title} type="button" variant="outline" size="app" className="pi-chat-suggestion items-start gap-1 rounded-[var(--r-panel)] shadow-none bg-background dark:bg-background hover:bg-muted dark:hover:bg-muted" onClick={()=>{model.setText(text);textarea.current?.focus();}}><strong>{title}</strong><span>{description}</span></Button>)}</div>}</EmptyState>
          :<Conversation items={items} choices={model.processChoices} onChoice={model.chooseProcess} onBeforeChange={beforeToggle} afterMessage={draftAfter}/>}
          {agentData&&conversationDrafts.filter(d=>!draftAnchors.get(d.id)).map(d=><AgentDraftsPanel key={d.id} model={agentData} pi={model} draft={d}/>)}
          {pendingResponse&&<div className="pi-response-waiting" role="status" aria-live="polite"><ScaleLoader color="currentColor" height={16} width={2} margin={1}/><span>{s?.stopping?'正在停止…':model.viewing?'正在读取会话…':connecting||model.action==='连接'?'正在连接…':model.action==='发送'&&!running?'正在发送…':'正在思考…'}</span></div>}
          {!!s?.recoveredQueue.length&&<Disclosure variant="custom" className="pi-input-history" open><summary>停止时保留的排队文字</summary>{s.recoveredQueue.map((text,index)=><div className="pi-queue" key={index}><p>{text}</p><Button variant="app-quiet" className="pi-quiet" onClick={()=>model.recoverQueue(index)}>取回输入</Button></div>)}</Disclosure>}
        </div>
      </div>{!atBottom&&<Button variant="app-control" type="button" className="pi-latest" onClick={latest}>回到最新 ↓</Button>}</div>
      <AgentObjectPicker model={model.objects} returnFocus={addTrigger.current}/><PiExtensionPanel model={model}/><form className="pi-composer" onSubmit={event=>{event.preventDefault();if(!sendDisabled)void model.send(running?'followUp':null);}}>
        <div className="pi-composer-surface">
          {(!!model.draft.images.length||!!model.files.length)&&<div className="pi-attachment-tray">{model.draft.images.map(image=><AttachmentPreview key={image.id} value={{name:image.name,imageUrl:`data:${image.mimeType};base64,${image.data}`}} disabled={attaching||busy} onRemove={()=>model.setImages(model.draft.images.filter(v=>v.id!==image.id))}/>)}{model.files.map(file=><AttachmentPreview key={file.id} value={file} disabled={attaching||busy} onRemove={()=>model.removeFile(file.id)}/>)}</div>}
          <label className="pi-sr-only" htmlFor="pi-message-input">消息</label><Textarea variant="inline" id="pi-message-input" aria-describedby="pi-composer-help" rows={1} ref={textarea} value={model.draft.text} onChange={event=>model.setText(event.target.value)} onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();const text=event.clipboardData.getData('text/plain');if(text){const start=event.currentTarget.selectionStart,end=event.currentTarget.selectionEnd;model.setText(model.draft.text.slice(0,start)+text+model.draft.text.slice(end));}void importFiles(files);}}} onKeyDown={keydown} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} maxLength={100000} placeholder={preview?'随心输入 · 界面示例':'随心输入'}/>
          {!!model.objects.objects.length&&<div className="pi-attachments">{model.objects.objects.map(source=><div className="pi-attachment" key={JSON.stringify(source)}><span>{model.objects.catalog?.modules.flatMap(module=>module.objects).find(item=>JSON.stringify(item.source)===JSON.stringify(source))?.title??'工作台对象'}</span><Button type="button" variant="app-quiet" onClick={()=>model.objects.remove(source)}>移除</Button></div>)}</div>}
          <div className="pi-composer-actions"><Input variant="inline" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event=>void attach(event)}/>
            <Input ref={documentInput} type="file" accept=".pdf,.xlsx,.xls,.csv,.tsv,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif" hidden multiple onChange={event=>void attach(event)}/><div className="pi-composer-context"><Popover open={addOpen} onOpenChange={setAddOpen}><PopoverTrigger asChild><Button variant="app-quiet" size="icon-sm" type="button" ref={addTrigger} aria-label="添加附件或对象" title="添加附件或对象" disabled={preview||attaching||busy}><PiIcon type={attaching?'activity':'plus'}/></Button></PopoverTrigger><PopoverContent className="pi-agent-layout pi-add-popover" side="top" align="start" collisionPadding={12} aria-label="添加附件"><ActionGroup direction="column"><Button variant="app-menu" onClick={()=>{setAddOpen(false);documentInput.current?.click();}}>添加文件</Button><Button variant="app-menu" onClick={()=>{setAddOpen(false);fileInput.current?.click();}}>添加图片</Button><Button variant="app-menu" onClick={()=>{setAddOpen(false);void model.objects.show();}}>选择工作台对象</Button></ActionGroup></PopoverContent></Popover></div>
            <div className="pi-model-controls">{ready&&s.models.length>0?<ModelPicker models={s.models} current={currentModel} thinking={state?.thinkingLevel} context={context} disabled={busy||running} onSelect={value=>model.sessionAction('pi_select_model',{provider:value.provider,id:value.id})} onThinking={level=>model.sessionAction('pi_thinking',{level})}/>:!ready?<Button type="button" variant="app-quiet" className="pi-composer-model-link" disabled={preview||model.viewing||busy||!model.root||!model.connected} onClick={()=>void model.connect()}>发送时连接<PiIcon type="chevron"/></Button>:<UILink variant="plain" className="pi-composer-model-link" href="#settings/models">配置模型<PiIcon type="chevron"/></UILink>}</div>
            <div className="pi-send-actions">{running&&<Button variant="app-quiet" className="pi-quiet" type="button" aria-label="插入当前任务" disabled={sendDisabled} onClick={()=>void model.send('steer')}>{compact?'插入':'插入当前任务'}</Button>}
              {showStop&&<Button variant="app-quiet" type="button" className="pi-quiet pi-stop" aria-label={s?.stopping?'正在停止…':'停止'} title={s?.stopping?'正在停止':'停止当前任务'} disabled={preview||!model.connected||!s||s.stopping||!ready&&s.connection!=='connecting'} onClick={()=>void model.stop()}><PiIcon type="stop"/></Button>}
              <Button variant="app-primary" className={`pi-primary pi-composer-send${running?' pi-composer-send--queued':''}`} type="submit" aria-label={running?'排在之后':'发送'} title={running?'排在之后':'发送消息'} disabled={sendDisabled}><PiIcon type="send"/>{running&&<span>{compact?'随后':'排在之后'}</span>}</Button>
            </div>
          </div>
        </div>
        {attachmentError&&<Feedback as="p" tone="error" className="form-error" role="alert">{attachmentError}</Feedback>}{imageUnsupported&&<Feedback as="p" tone="error" className="form-error" role="alert">当前模型不支持图片，附件仍保留；请换模型或移除图片后发送。</Feedback>}
        <p className="pi-composer-help" id="pi-composer-help">{preview?'演示数据仅在页面内展示 · 不调用模型，不保存记录':<>Shift+Enter 换行{ready&&!available&&' · 请先选择模型'}</>}</p>
      </form><PiExtensionPanel model={model} belowOnly/>
    </section>
  </div>;
}
