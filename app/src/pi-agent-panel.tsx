import { EmptyState } from './components/ui/empty-state.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { ActionGroup } from './components/ui/action-group.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { PiController } from './use-pi.ts';
import { piError } from './pi-client.ts';
import { activityText, conversationView } from './pi-process-view.ts';
import { Conversation, PiIcon } from './pi-process-panel.tsx';
import { RuntimeInfo } from './pi-panels.tsx';
import type { PiModel } from './pi-contract.ts';

function ModelPicker({models,current,thinking,disabled,context,onSelect}:{models:PiModel[];current:PiModel|null|undefined;thinking:string|undefined;disabled:boolean;context:string;onSelect:(value:PiModel)=>Promise<void>}) {
  const [open,setOpen]=useState(false),id=useId();
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const selected=models.findIndex(value=>value.provider===current?.provider&&value.id===current?.id);
  const level=current?.reasoning&&thinking?({off:'关闭',minimal:'最低',low:'低',medium:'标准',high:'高',xhigh:'最高'} as Record<string,string>)[thinking]??thinking:null;
  useEffect(()=>{setOpen(false);},[context,disabled]);
  useLayoutEffect(()=>{if(open)(menu.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')??menu.current?.querySelector<HTMLButtonElement>('button'))?.focus();},[open]);
  useEffect(()=>{if(!open)return;function dismiss(event:PointerEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
    document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[open]);
  function close(){setOpen(false);trigger.current?.focus();}
  function keys(event:KeyboardEvent<HTMLDivElement>){if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const options=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button')??[]);if(!options.length)return;
      const index=options.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next]?.focus();}
    else if(event.key==='Tab')setOpen(false);
  }
  return <div className="pi-model-picker" ref={root}>
    <Button variant="app-control" ref={trigger} className="pi-model-trigger" type="button" aria-label="当前模型" aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} title={current?`${current.name} · ${current.provider}${level?` · 思考：${level}`:''}`:'请选择模型'} onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(!event.nativeEvent.isComposing&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true);}}}>
      <span className="pi-model-name">{current?.name??'请选择模型'}</span>{level&&<span className="pi-model-level">{level}</span>}<PiIcon type="chevron"/>
    </Button>
    {open&&<div id={id} ref={menu} className="pi-model-menu" role="menu" aria-label="选择模型" onKeyDown={keys}>
      <div className="pi-model-menu-heading">模型</div><div className="pi-model-menu-options">{models.map((value,index)=><Button variant="app-control" type="button" role="menuitemradio" aria-checked={index===selected} key={JSON.stringify([value.provider,value.id])} onClick={()=>{close();if(!disabled&&index!==selected)void onSelect(value);}}>
        <span><strong>{value.name}</strong><small>{value.provider}{value.reasoning?' · 支持思考':''}{value.input.includes('image')?' · 支持图片':''}</small></span><span className="pi-model-check">{index===selected&&<PiIcon type="check"/>}</span>
      </Button>)}</div>{level&&<div className="pi-model-menu-footer">当前思考级别：{level}<span>由原版 Pi 返回</span></div>}
    </div>}
  </div>;
}

const AgentDemo=import.meta.env.DEV?lazy(()=>import('./pi-agent-demo.tsx')):null;
export function AgentPanel({model}:{model:PiController}) {
  const [preview,setPreview]=useState(false);
  return <div className="pi-agent-workspace">
    {AgentDemo&&preview?<Suspense fallback={<p className="pi-preview-loading">正在载入界面示例…</p>}><AgentDemo onExit={()=>setPreview(false)}/></Suspense>
      :<>{AgentDemo&&<div className="pi-preview-strip"><span>开发版 · 界面示例</span><Button variant="app-control" type="button" onClick={()=>setPreview(true)}>载入示例</Button></div>}<AgentChat model={model}/></>}
  </div>;
}

export function AgentChat({model,preview=false}:{model:PiController;preview?:boolean}) {
  const s=model.snapshot,state=s?.state,projection=s?.projection,currentModel=state?.model;
  const [attachmentError,setAttachmentError]=useState<string|null>(null),[attaching,setAttaching]=useState(false);
  const [sessionsOpen,setSessionsOpen]=useState(()=>window.innerWidth>1100),[atBottom,setAtBottom]=useState(true);
  const composing=useRef(false),fileInput=useRef<HTMLInputElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
  const viewport=useRef<HTMLDivElement>(null),flow=useRef<HTMLDivElement>(null),more=useRef<HTMLDetailsElement>(null),sidebar=useRef<HTMLDetailsElement>(null);
  const following=useRef(true),anchor=useRef<{key:string;offset:number}|null>(null);
  const context=`${model.root}/${state?.sessionId??'unconnected'}/${s?.generation??0}`;
  const items=useMemo(()=>projection?conversationView(projection,context,model.displayRunStart):[],[projection,context,model.displayRunStart]);
  const ready=s?.connection==='ready',busy=!!model.action||!!s?.busy||!!s?.stopping;
  const running=!!projection&&projection.activity!=='idle';
  const available=!!currentModel&&!!s?.models.some(m=>m.provider===currentModel.provider&&m.id===currentModel.id);
  const imageUnsupported=model.draft.images.length>0&&!currentModel?.input.includes('image');
  const sendDisabled=preview||!ready||!available||busy||attaching||imageUnsupported||(!model.draft.text.trim()&&!model.draft.images.length);
  const showStop=running||s?.connection==='connecting'||s?.busy||s?.sending||s?.stopping;
  const connection=preview?'界面示例 · 未连接模型':s?.connection==='connecting'?'正在连接原版 Pi…':ready?available?'已连接':'原版已就绪 · 请先配置模型':s?.connection==='error'?'连接中断，可重新连接':'尚未连接原版 Pi';
  const remember=useRef(model.rememberChatScroll);remember.current=model.rememberChatScroll;
  useEffect(()=>{
    const query=window.matchMedia('(min-width:1101px)'),resize=()=>setSessionsOpen(query.matches);
    query.addEventListener('change',resize);return()=>query.removeEventListener('change',resize);
  },[]);
  useEffect(()=>{
    function dismiss(event:PointerEvent){if(more.current?.open&&!more.current.contains(event.target as Node))more.current.open=false;
      if(window.innerWidth<=1100&&sidebar.current?.open&&!sidebar.current.contains(event.target as Node))setSessionsOpen(false);}
    document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);
  },[]);
  useEffect(()=>{
    function escape(event:globalThis.KeyboardEvent){if(event.key!=='Escape'||event.isComposing)return;
      if(more.current?.open){more.current.open=false;more.current.querySelector('summary')?.focus();}
      else if(window.innerWidth<=1100&&sidebar.current?.open){setSessionsOpen(false);sidebar.current.querySelector('summary')?.focus();}}
    document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
  },[]);
  useLayoutEffect(()=>{
    const area=viewport.current;if(!area)return;const saved=model.readChatScroll(context);
    following.current=saved?.following??true;area.scrollTop=saved?.top??area.scrollHeight;setAtBottom(following.current);
    return()=>remember.current(context,area.scrollTop,following.current);
  },[context]);
  useLayoutEffect(()=>{
    const area=viewport.current;if(!area)return;
    if(anchor.current){const saved=anchor.current;anchor.current=null;
      const node=Array.from(flow.current?.children??[]).find(child=>(child as HTMLElement).dataset.messageKey===saved.key||(child as HTMLElement).dataset.processKey===saved.key);
      if(node)area.scrollTop+=node.getBoundingClientRect().top-area.getBoundingClientRect().top-saved.offset;
    }else if(following.current)area.scrollTop=area.scrollHeight;
  },[items,model.processChoices]);
  useLayoutEffect(()=>{const input=textarea.current;if(input){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,parseFloat(getComputedStyle(input).maxHeight)||180)+'px';}},[model.draft.text]);
  useEffect(()=>{const area=viewport.current,content=flow.current;if(!area||!content)return;
    const observer=new ResizeObserver(()=>{if(following.current)area.scrollTop=area.scrollHeight;});observer.observe(area);observer.observe(content);return()=>observer.disconnect();},[]);
  function beforeToggle(){const area=viewport.current;if(!area)return;const top=area.getBoundingClientRect().top;
    const node=Array.from(flow.current?.children??[]).find(child=>child.getBoundingClientRect().bottom>top);
    if(node){const el=node as HTMLElement;anchor.current={key:el.dataset.messageKey??el.dataset.processKey??'',offset:el.getBoundingClientRect().top-top};}}
  function scroll(){const area=viewport.current;if(!area)return;const bottom=area.scrollHeight-area.clientHeight-area.scrollTop<40;
    following.current=bottom;setAtBottom(bottom);model.rememberChatScroll(context,area.scrollTop,bottom);}
  function latest(){following.current=true;setAtBottom(true);if(viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;}
  async function attach(event:ChangeEvent<HTMLInputElement>){const files=Array.from(event.target.files??[]);event.target.value='';if(!files.length)return;setAttachmentError(null);setAttaching(true);
    try{if(files.length+model.draft.images.length>4)throw new Error('最多附加4张图片，原附件仍保留。');const key=model.draftKey,existing=[...model.draft.images];
      const loaded=await Promise.all(files.map(async file=>{if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>3*1024*1024)throw new Error('请选择 PNG、JPEG、WebP 或 GIF，每张不超过3MiB。');
        const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('图片读取失败，文字和原附件仍保留。'));reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(file);});return{id:crypto.randomUUID(),name:file.name,mimeType:file.type,data};}));
      if([...existing,...loaded].reduce((n,i)=>n+i.data.length,0)>8*1024*1024)throw new Error('图片合计编码超过8MiB，原附件仍保留。');model.setImages([...existing,...loaded],key);
    }catch(error){setAttachmentError(piError(error));}finally{setAttaching(false);}}
  function keydown(event:KeyboardEvent<HTMLTextAreaElement>){if(event.key==='Enter'&&!event.shiftKey&&!composing.current&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();if(!sendDisabled)void model.send(running?'followUp':null);}}
  function closeDisclosure(event:KeyboardEvent<HTMLDetailsElement>){if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();if(event.currentTarget===sidebar.current)setSessionsOpen(false);}}
  return <div className="pi-agent-layout">
    <Disclosure variant="custom" ref={sidebar} className="pi-sessions" open={sessionsOpen} onKeyDown={closeDisclosure}>
      <summary onClick={event=>{event.preventDefault();setSessionsOpen(open=>!open);}}><strong>会话</strong><PiIcon type="chevron"/></summary>
      <div className="pi-session-body"><div className="pi-session-actions"><Button variant="app-control" type="button" className="pi-new-session" disabled={!ready||busy||running} onClick={()=>void model.sessionAction('pi_new_session')}><PiIcon type="plus"/>新会话</Button></div>
        {model.sessionError&&<Feedback as="p" tone="error" className="form-error" role="alert">{model.sessionError}</Feedback>}{model.unreadable>0&&<p role="status">{model.unreadable} 个会话文件未能读取；原文件保留。</p>}
        <p className="pi-session-label">最近会话</p>
        <div className="pi-session-items">{!model.sessions.length?<p className="pi-session-empty">暂无已落盘会话。空会话尚未写入文件，不会补造历史。</p>:model.sessions.map(session=><Button variant="app-control" type="button" className="pi-session-item" key={session.path} title={session.name??'未命名会话'} aria-current={state?.sessionFile===session.path?'true':undefined} disabled={busy||running} onClick={()=>{if(window.innerWidth<=1100)setSessionsOpen(false);void (ready&&s?.cwd===session.cwd?model.sessionAction('pi_switch_session',{path:session.path}):model.connect(session));}}><strong>{session.name??'未命名会话'}</strong><span className="pi-session-meta"><span title={session.updatedAt}>{/^\d{4}-\d{2}-\d{2}T/.test(session.updatedAt)?session.updatedAt.slice(0,10):session.updatedAt}</span><span>{session.messageCount} 条消息</span></span></Button>)}</div>
      </div>
    </Disclosure>
    <section className="pi-chat" aria-label="通用 Agent 对话">
      <header className="pi-chat-heading"><div className="pi-chat-identity"><h2>{state?.sessionName??'新会话'}</h2><p className="pi-connection" data-ready={!preview&&ready&&available}>{connection}{running&&` · ${activityText(projection!.activity)}`}</p></div>
        <div className="pi-chat-controls">
          <Button variant="app-quiet" className="pi-quiet" disabled={preview||busy||running||!model.root||!model.connected} onClick={()=>void model.connect()}>连接 / 重连</Button>
          <Disclosure variant="custom" ref={more} className="pi-chat-options" onKeyDown={closeDisclosure}><summary aria-label="更多会话操作"><PiIcon type="more"/></summary><div className="pi-options-panel"><h3>会话与连接</h3>
            <form onSubmit={event=>{event.preventDefault();void model.sessionAction('pi_name_session',{name:model.sessionName});}}><label className="pi-field">新名称<Input variant="inline" value={model.sessionName} maxLength={1000} onChange={event=>model.setSessionName(event.target.value)}/></label><Button variant="app-quiet" className="pi-quiet" disabled={!ready||busy||running||!model.sessionName.trim()}>保存名称</Button></form>
            {preview?<p className="pi-preview-note">虚构会话，仅用于查看界面；切回真实会话后可配置和连接模型。</p>:<><ActionGroup direction="column" className="pi-options-actions" aria-label="会话设置与连接"><UILink variant="menu" href="#settings/models">模型设置</UILink><UILink variant="menu" href="#resources">规则与资源</UILink>{ready&&<Button variant="app-menu" disabled={busy} onClick={()=>void model.disconnect()}>断开连接</Button>}</ActionGroup><RuntimeInfo model={model}/></>}
          </div></Disclosure>
        </div>
      </header>
      <div className="pi-chat-feedback" aria-live="polite">{(model.error??s?.error?.message)&&<Feedback as="p" tone="error" className="form-error" role="alert">{model.error??s?.error?.message}</Feedback>}{projection?.notice&&<p>{projection.notice}</p>}
        {projection?.outcome&&projection.outcome!=='none'&&<p className="pi-outcome" data-outcome={projection.outcome}>{preview?'示例状态':'本轮'}：{({success:preview?'已完成（演示）':'实际回复已完成',error:'失败',interrupted:'已中断',incomplete:'未完整结束'} as Record<string,string>)[projection.outcome]??'状态待确认'}</p>}
      </div>
      <div className="pi-message-area"><div className="pi-chat-messages" ref={viewport} onScroll={scroll} tabIndex={0} role="region" aria-label="会话消息">
        <div className="pi-chat-flow" ref={flow}>{!items.length?<EmptyState as="div" className="pi-chat-empty"><PiIcon type="activity"/><h3>{available?'开始新的对话':'先连接你自己的模型'}</h3><p>{available?'写下你要做的事，也可以附加图片。':'输入可以先写在下方，连接模型后再发送。'}</p>{!available&&<UILink variant="text" className="foundation-link" href="#settings/models">前往模型设置</UILink>}</EmptyState>
          :<Conversation items={items} choices={model.processChoices} onChoice={model.chooseProcess} onBeforeChange={beforeToggle}/>}
          {!!s?.recoveredQueue.length&&<Disclosure variant="custom" className="pi-input-history" open><summary>停止时保留的排队文字</summary>{s.recoveredQueue.map((text,index)=><div className="pi-queue" key={index}><p>{text}</p><Button variant="app-quiet" className="pi-quiet" onClick={()=>model.recoverQueue(index)}>取回输入</Button></div>)}</Disclosure>}
        </div>
      </div>{!atBottom&&<Button variant="app-control" type="button" className="pi-latest" onClick={latest}>回到最新 ↓</Button>}</div>
      <form className="pi-composer" onSubmit={event=>{event.preventDefault();if(!sendDisabled)void model.send(running?'followUp':null);}}>
        <div className="pi-composer-surface"><label className="pi-sr-only" htmlFor="pi-message-input">消息</label><Textarea variant="inline" id="pi-message-input" aria-describedby="pi-composer-help" rows={1} ref={textarea} value={model.draft.text} onChange={event=>model.setText(event.target.value)} onKeyDown={keydown} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} maxLength={100000} placeholder={preview?'随心输入 · 界面示例':'随心输入'}/>
          {!!model.draft.images.length&&<div className="pi-attachments">{model.draft.images.map(image=><div className="pi-attachment" key={image.id}><span>{image.name}</span><Button variant="app-quiet" type="button" className="pi-quiet" disabled={attaching} onClick={()=>model.setImages(model.draft.images.filter(v=>v.id!==image.id))} aria-label={`移除图片 ${image.name}`}>移除</Button></div>)}</div>}
          <div className="pi-composer-actions"><Input variant="inline" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event=>void attach(event)}/>
            <div className="pi-composer-context"><Button variant="app-quiet" className="pi-quiet pi-composer-add" type="button" aria-label={attaching?'读取图片…':'附加图片'} title={attaching?'读取图片中':'添加图片'} disabled={preview||attaching} onClick={()=>fileInput.current?.click()}><PiIcon type={attaching?'activity':'plus'}/></Button>
            </div>
            <div className="pi-send-actions">{ready&&s.models.length>0?<ModelPicker models={s.models} current={currentModel} thinking={state?.thinkingLevel} context={context} disabled={busy||running} onSelect={value=>model.sessionAction('pi_select_model',{provider:value.provider,id:value.id})}/>:<UILink variant="plain" className="pi-composer-model-link" href="#settings/models">配置模型<PiIcon type="chevron"/></UILink>}
              {running&&<Button variant="app-quiet" className="pi-quiet" type="button" disabled={sendDisabled} onClick={()=>void model.send('steer')}>插入当前任务</Button>}
              {showStop&&<Button variant="app-quiet" type="button" className="pi-quiet pi-stop" aria-label={s?.stopping?'正在停止…':'停止'} title={s?.stopping?'正在停止':'停止当前任务'} disabled={preview||!model.connected||!s||s.stopping||!ready&&s.connection!=='connecting'} onClick={()=>void model.stop()}><PiIcon type="stop"/></Button>}
              <Button variant="app-primary" className={`pi-primary pi-composer-send${running?' pi-composer-send--queued':''}`} type="submit" aria-label={running?'排在之后':'发送'} title={running?'排在之后':'发送消息'} disabled={sendDisabled}><PiIcon type="send"/>{running&&<span>排在之后</span>}</Button>
            </div>
          </div>
        </div>
        {attachmentError&&<Feedback as="p" tone="error" className="form-error" role="alert">{attachmentError}</Feedback>}{imageUnsupported&&<Feedback as="p" tone="error" className="form-error" role="alert">当前模型不支持图片，附件仍保留；请换模型或移除图片后发送。</Feedback>}
        <p className="pi-sr-only" id="pi-composer-help">{preview?'演示数据仅在页面内展示 · 不调用模型，不保存记录':<>Enter 发送 · Shift+Enter 换行{!available&&' · 连接模型后可发送'}</>}</p>
      </form>
    </section>
  </div>;
}
