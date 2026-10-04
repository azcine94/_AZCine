import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { PiController } from './use-pi.ts';
import { piError } from './pi-client.ts';
import { activityText, conversationView } from './pi-process-view.ts';
import { Conversation, PiIcon } from './pi-process-panel.tsx';
import { RuntimeInfo } from './pi-panels.tsx';

export function AgentPanel({model}:{model:PiController}) {
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
  const sendDisabled=!ready||!available||busy||attaching||imageUnsupported||(!model.draft.text.trim()&&!model.draft.images.length);
  const connection=s?.connection==='connecting'?'正在连接原版 Pi…':ready?available?'已连接':'原版已就绪 · 请先配置模型':s?.connection==='error'?'连接中断，可重新连接':'尚未连接原版 Pi';
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
  useLayoutEffect(()=>{const input=textarea.current;if(input){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';}},[model.draft.text]);
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
    <details ref={sidebar} className="pi-sessions" open={sessionsOpen} onKeyDown={closeDisclosure}>
      <summary onClick={event=>{event.preventDefault();setSessionsOpen(open=>!open);}}><PiIcon type="history"/><strong>会话</strong><PiIcon type="chevron"/></summary>
      <div className="pi-session-body"><div className="pi-session-actions"><button className="pi-primary" disabled={!ready||busy||running} onClick={()=>void model.sessionAction('pi_new_session')}><PiIcon type="plus"/>新会话</button><button className="pi-quiet" onClick={()=>void model.reloadSessions()} disabled={!model.root}>刷新</button></div>
        {model.sessionError&&<p className="form-error" role="alert">{model.sessionError}</p>}{model.unreadable>0&&<p role="status">{model.unreadable} 个会话文件未能读取；原文件保留。</p>}
        <div className="pi-session-items">{!model.sessions.length?<p className="pi-session-empty">暂无已落盘会话。空会话尚未写入文件，不会补造历史。</p>:model.sessions.map(session=><button className="pi-session-item" key={session.path} aria-current={state?.sessionFile===session.path?'true':undefined} disabled={busy||running} onClick={()=>{if(window.innerWidth<=1100)setSessionsOpen(false);void (ready&&s?.cwd===session.cwd?model.sessionAction('pi_switch_session',{path:session.path}):model.connect(session));}}><strong>{session.name??'未命名会话'}</strong><span>{session.updatedAt} · {session.messageCount} 条消息</span></button>)}</div>
      </div>
    </details>
    <section className="pi-chat" aria-label="通用 Agent 对话">
      <header className="pi-chat-heading"><div className="pi-chat-identity"><h2>{state?.sessionName??'新会话'}</h2><p className="pi-connection" data-ready={ready&&available}>{connection}{running&&` · ${activityText(projection!.activity)}`}</p></div>
        <div className="pi-chat-controls">{ready&&s.models.length>0&&<label className="pi-model-choice"><span className="pi-sr-only">当前模型</span><select aria-label="当前模型" value={currentModel?JSON.stringify([currentModel.provider,currentModel.id]):''} disabled={busy||running} onChange={event=>{const [provider,id]=JSON.parse(event.target.value) as [string,string];void model.sessionAction('pi_select_model',{provider,id});}}>{!available&&<option value="">请选择模型</option>}{s.models.map(m=><option key={JSON.stringify([m.provider,m.id])} value={JSON.stringify([m.provider,m.id])}>{m.name} · {m.provider}</option>)}</select></label>}
          <button className="pi-quiet" disabled={busy||running||!model.root||!model.connected} onClick={()=>void model.connect()}>连接 / 重连</button>
          <details ref={more} className="pi-chat-options" onKeyDown={closeDisclosure}><summary aria-label="更多会话操作"><PiIcon type="more"/></summary><div className="pi-options-panel"><h3>会话与连接</h3>
            <form onSubmit={event=>{event.preventDefault();void model.sessionAction('pi_name_session',{name:model.sessionName});}}><label className="pi-field">新名称<input value={model.sessionName} maxLength={1000} onChange={event=>model.setSessionName(event.target.value)}/></label><button className="pi-quiet" disabled={!ready||busy||running||!model.sessionName.trim()}>保存名称</button></form>
            <a className="foundation-link" href="#settings">模型设置</a>{ready&&<button className="pi-quiet" disabled={busy} onClick={()=>void model.disconnect()}>断开连接</button>}<RuntimeInfo model={model}/>
          </div></details>
        </div>
      </header>
      <div className="pi-chat-feedback" aria-live="polite">{(model.error??s?.error?.message)&&<p className="form-error" role="alert">{model.error??s?.error?.message}</p>}{model.notice&&<p>{model.notice}</p>}{s?.notice&&<p>{s.notice}</p>}{projection?.notice&&<p>{projection.notice}</p>}
        {projection?.outcome&&projection.outcome!=='none'&&<p className="pi-outcome" data-outcome={projection.outcome}>本轮：{({success:'实际回复已完成',error:'失败',interrupted:'已中断',incomplete:'未完整结束'} as Record<string,string>)[projection.outcome]??'状态待确认'}</p>}
      </div>
      <div className="pi-message-area"><div className="pi-chat-messages" ref={viewport} onScroll={scroll} tabIndex={0} role="region" aria-label="会话消息">
        <div className="pi-chat-flow" ref={flow}>{!items.length?<div className="pi-chat-empty"><PiIcon type="activity"/><h3>{available?'开始新的对话':'先连接你自己的模型'}</h3><p>{available?'写下你要做的事，也可以附加图片。':'输入可以先写在下方，连接模型后再发送。'}</p>{!available&&<a className="foundation-link" href="#settings">前往模型设置</a>}</div>
          :<Conversation items={items} choices={model.processChoices} onChoice={model.chooseProcess} onBeforeChange={beforeToggle}/>}
          {!!s?.recoveredQueue.length&&<details className="pi-input-history" open><summary>停止时保留的排队文字</summary>{s.recoveredQueue.map((text,index)=><div className="pi-queue" key={index}><p>{text}</p><button className="pi-quiet" onClick={()=>model.recoverQueue(index)}>取回输入</button></div>)}</details>}
          {!!model.acceptedInputs.length&&<details className="pi-input-history"><summary>最近已接受输入（可取回）</summary><p className="meta">本次打开期间，每会话最多20次；已接受不等于已执行，不自动重发。</p>{model.acceptedInputs.map(item=><div className="pi-queue" key={item.id}><p>{item.draft.text}</p>{item.draft.images.map(image=><p className="meta" key={image.id}>{image.name}</p>)}<button className="pi-quiet" type="button" onClick={()=>model.recoverAccepted(item.id)}>取回此输入</button></div>)}</details>}
        </div>
      </div>{!atBottom&&<button type="button" className="pi-latest" onClick={latest}>回到最新 ↓</button>}</div>
      <form className="pi-composer" onSubmit={event=>{event.preventDefault();if(!sendDisabled)void model.send(running?'followUp':null);}}>
        <div className="pi-composer-surface"><label className="pi-sr-only" htmlFor="pi-message-input">消息</label><textarea id="pi-message-input" ref={textarea} value={model.draft.text} onChange={event=>model.setText(event.target.value)} onKeyDown={keydown} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} maxLength={100000} placeholder="写下你的任务或问题…"/>
          {!!model.draft.images.length&&<div className="pi-attachments">{model.draft.images.map(image=><div className="pi-attachment" key={image.id}><span>{image.name}</span><button type="button" className="pi-quiet" disabled={attaching} onClick={()=>model.setImages(model.draft.images.filter(v=>v.id!==image.id))} aria-label={`移除图片 ${image.name}`}>移除</button></div>)}</div>}
          <div className="pi-composer-actions"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event=>void attach(event)}/><button className="pi-quiet" type="button" disabled={attaching} onClick={()=>fileInput.current?.click()}><PiIcon type="attachment"/>{attaching?'读取图片…':'附加图片'}</button>
            <div className="pi-send-actions">{running&&<button className="pi-quiet" type="button" disabled={sendDisabled} onClick={()=>void model.send('steer')}>插入当前任务</button>}
              <button type="button" className="pi-quiet pi-stop" disabled={!model.connected||!s||s.stopping||!ready&&s.connection!=='connecting'} onClick={()=>void model.stop()}><PiIcon type="stop"/>{s?.stopping?'正在停止…':'停止'}</button>
              <button className="pi-primary" disabled={sendDisabled}><PiIcon type="send"/>{running?'排在之后':'发送'}</button>
            </div>
          </div>
        </div>
        {attachmentError&&<p className="form-error" role="alert">{attachmentError}</p>}{imageUnsupported&&<p className="form-error" role="alert">当前模型不支持图片，附件仍保留；请换模型或移除图片后发送。</p>}
        <p className="pi-composer-help">Enter 发送 · Shift+Enter 换行{!available&&' · 连接模型后可发送'}</p>
      </form>
    </section>
  </div>;
}
