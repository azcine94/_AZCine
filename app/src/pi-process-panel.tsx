import { Feedback } from './components/ui/feedback.tsx';
import { Button } from './components/ui/button.tsx';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ConversationView, ProcessView, ToolView } from './pi-process-view.ts';
import { activityText, processHasIssue,processFinished } from './pi-process-view.ts';
import { agentMessageContent,agentMessageAttachments,assistantDraftContent } from './agent-message-content.ts';
import { AttachmentPreview } from './components/ui/attachment-preview.tsx';
import type { ReactNode } from 'react';
import { Disclosure } from './components/ui/disclosure.tsx';
import { MessageMarkdown } from './components/ui/message-markdown.tsx';
import { notifyOperation } from './components/ui/operation-toast.tsx';

function MessageText({text,user,finished,showAttachments=true}:{text:string;user:boolean;finished:boolean;showAttachments?:boolean}){
  const assistant=!user&&finished?assistantDraftContent(text):{text,draft:null};
  const content=user?agentMessageContent(text):{text:assistant.text,files:[]};
  const draft=assistant.draft;
  const attachments=user&&showAttachments?agentMessageAttachments(text):[];
  return <>{content.text&&(user?<p className="pi-message-text">{content.text}</p>:<MessageMarkdown text={content.text}/>)}{draft&&<Disclosure className="pi-draft-original"><summary>草案原文</summary><pre>{draft}</pre></Disclosure>}{attachments.length>0&&<div className="pi-message-files">{attachments.map((file,index)=><AttachmentPreview key={file.id??index} value={file}/>)}</div>}</>;
}

const states: Record<string,string> = { success:'完成',finished:'完成',running:'进行中',waiting:'等待执行',
  error:'失败',interrupted:'已中断',incomplete:'状态待确认' };
export function PiIcon({type}:{type:'tool'|'chevron'|'check'|'activity'|'plus'|'send'|'stop'|'more'|'history'|'attachment'|'expand'|'close'|'sidebar'|'copy'}) {
  const paths = {tool:'M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3Z',
    chevron:'m7 10 5 5 5-5',check:'m5 12 4 4L19 6',activity:'M20 12a8 8 0 1 1-8-8',
    plus:'M12 5v14M5 12h14',send:'m5 12 7-7 7 7M12 5v14',stop:'M6 6h12v12H6Z',
    more:'M5 12h.01M12 12h.01M19 12h.01',history:'M4 5v5h5M4 10a8 8 0 1 1 1 8M12 8v5l3 2',
    attachment:'m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9',expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',close:'m6 6 12 12M6 18 18 6',sidebar:'M4 4h16v16H4ZM9 4v16',copy:'M9 9h11v11H9ZM5 15H4V4h11v1'};
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type]}/></svg>;
}
function ToolRow({value,choice,onChoice,onBeforeChange}:{value:ToolView;choice:boolean|undefined;onChoice:(open:boolean)=>void;onBeforeChange:()=>void}) {
  const id = useId();
  const issue = ['error','interrupted','incomplete'].includes(value.status);
  const open = choice ?? issue;
  return <div className="pi-call" data-call-id={value.id} data-status={value.status}>
    <Button variant="app-control" type="button" className="pi-call-toggle" aria-expanded={open} aria-controls={id} onClick={()=>{onBeforeChange();onChoice(!open);}}>
      <PiIcon type="tool"/><span className="pi-call-title">调用工具：<code>{value.name}</code></span>
      <span className="pi-call-status">{states[value.status] ?? '状态待确认'}</span><span className="pi-chevron" data-open={open}><PiIcon type="chevron"/></span>
    </Button>
    <div className="pi-call-description">{value.path&&<p className="pi-call-path">{value.path}</p>}
      {value.output&&<p className="pi-call-preview">{value.output}</p>}
      {value.notice&&<p className="pi-call-notice">{value.notice}</p>}
      {!value.output&&<p>{value.status==='running'?'工具执行中…':value.status==='waiting'?'等待实际工具事件。':'尚无可显示的输出。'}</p>}
    </div>
    <div id={id} hidden={!open} className="pi-call-details"><h4>输入</h4><pre tabIndex={0} aria-label={`${value.name}输入`}>{value.input}</pre>
      {value.children.length>0&&<><h4>实际子调用 · {value.children.length}</h4><ul className="pi-call-children">{value.children.map((child,index)=><li key={index} data-status={child.status}><code>{child.name}</code><span>{states[child.status]??'状态待确认'}</span></li>)}</ul></>}
      <h4>输出</h4><pre tabIndex={0} aria-label={`${value.name}输出`}>{value.output || '尚无可显示的输出。'}</pre></div>
  </div>;
}
function Thinking({text,title,expanded,onChoice,onBeforeChange}:{text:string;title:string;expanded:boolean;onChoice:(open:boolean)=>void;onBeforeChange:()=>void}) {
  const paragraph=useRef<HTMLParagraphElement>(null),[long,setLong]=useState(false);
  useLayoutEffect(()=>{const el=paragraph.current;if(!el)return;const measure=()=>setLong(el.scrollHeight>parseFloat(getComputedStyle(el).lineHeight)*4+1);
    measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();},[text,expanded]);
  // The preview is only a display clip; the full original string remains available.
  return <div className="pi-thinking"><p ref={paragraph} className={!expanded?'pi-thinking-preview':undefined}>{text}</p>
    {long&&<Button variant="app-control" type="button" className="pi-inline-action" aria-expanded={expanded} onClick={()=>{onBeforeChange();onChoice(!expanded);}}>{expanded?'收起全文':`展开${title}全文`}</Button>}</div>;
}
function Process({value,choices,onChoice,onBeforeChange}:{value:ProcessView;choices:Record<string,boolean>;onChoice:(key:string,open:boolean)=>void;onBeforeChange:()=>void}) {
  const id = useId(), issue = processHasIssue(value), finished=processFinished(value),open = choices[value.key] ?? (value.live || issue&&!finished);
  const count = new Set(value.entries.filter(entry=>entry.kind==='tool').map(entry=>entry.id)).size;
  const failures=value.entries.filter(entry=>entry.kind==='tool'&&['error','interrupted','incomplete'].includes(entry.status)).length;
  const title=value.live?activityText(value.activity):finished?'已工作':value.terminal==='interrupted'?'工作已中断':issue?'工作过程 · 有异常':'工作过程 · 未记录最终回复';
  return <section className="pi-process" data-process-key={value.key} data-live={value.live}>
    <Button variant="app-control" className="pi-process-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={()=>{onBeforeChange();onChoice(value.key,!open);}}>
      <span className={value.live?'pi-process-activity':'pi-process-symbol'}><PiIcon type={value.live?'activity':finished?'check':'tool'}/></span>
      <span className="pi-process-summary"><strong>{title}</strong>{count>0&&<span className="pi-process-count">{count} 次工具调用</span>}
        {finished&&issue&&<span className="pi-process-warning">{failures?`含 ${failures} 次异常调用`:'过程含异常记录'}</span>}
      </span>
      <span className="pi-process-toggle-label">{open?'收起':'展开'}</span><span className="pi-chevron" data-open={open}><PiIcon type="chevron"/></span>
    </Button>
    <div id={id} className="pi-process-content" hidden={!open}>{value.entries.map(entry=>entry.kind==='thinking'
      ? <Thinking key={entry.key} text={entry.text} title={entry.title} expanded={choices[entry.key+'/full']??false} onChoice={open=>onChoice(entry.key+'/full',open)} onBeforeChange={onBeforeChange}/>
      :entry.kind==='commentary'?<div className="pi-process-commentary" key={entry.key}><span className="meta">执行说明</span><MessageMarkdown text={entry.text}/></div>
      :<ToolRow key={entry.key} value={entry} choice={choices[entry.key+'/details']} onChoice={open=>onChoice(entry.key+'/details',open)} onBeforeChange={onBeforeChange}/>)}
      {value.errors.map((error,index)=><Feedback as="p" tone="error" key={index} className="form-error" role="alert">{error}</Feedback>)}</div>
  </section>;
}
export function Conversation({items,choices,onChoice,onBeforeChange,afterMessage}:{items:ConversationView[];choices:Record<string,boolean>;onChoice:(key:string,open:boolean)=>void;onBeforeChange:()=>void;afterMessage?:(item:Extract<ConversationView,{kind:'message'}>)=>ReactNode}) {
  return <>{items.map(item=>item.kind==='process'?<Process key={item.key} value={item} choices={choices} onChoice={onChoice} onBeforeChange={onBeforeChange}/>
    :<article key={item.key} className={`pi-message pi-message--${item.role}`} data-message-key={item.key}>
      {item.role!=='assistant'&&<header><strong>{item.title}</strong></header>}
      {item.role==='user'?<>
        {(item.parts.some(part=>part.kind==='image')||item.parts.some(part=>agentMessageAttachments(part.text).length))&&<div className="pi-sent-attachment-tray">{item.parts.flatMap((part,index)=>part.kind==='image'?[<AttachmentPreview key={`image-${index}`} value={{name:'图片.png',imageUrl:part.imageUrl}}/>]:agentMessageAttachments(part.text).map((file,i)=><AttachmentPreview key={`${index}-${file.id??i}`} value={file}/>))}</div>}
        {item.parts.some(part=>part.kind!=='image'&&agentMessageContent(part.text).text.trim())&&<div className="pi-user-bubble">{item.parts.filter(part=>part.kind!=='image').map((part,index)=><MessageText key={index} text={part.text} user finished={false} showAttachments={false}/>)}</div>}
        {item.parts.some(part=>part.imageNote)&&<Disclosure className="pi-image-metadata"><summary>图片尺寸信息</summary><pre>{item.parts.map(part=>part.imageNote).filter(Boolean).join('\n')}</pre></Disclosure>}
      </>:item.role==='assistant'?<>
        <MessageText text={item.parts.filter(part=>part.kind==='text').map(part=>part.text).join('\n\n')} user={false} finished={item.status==='success'}/>
        {item.parts.filter(part=>part.kind!=='text').map((part,index)=><MessageText key={index} text={part.text} user={false} finished={false}/>)}
      </>:item.parts.map((part,index)=>part.kind==='image'?<AttachmentPreview key={index} value={{name:'图片.png',imageUrl:part.imageUrl}}/>:<MessageText key={index} text={part.text} user={false} finished={false}/>)}
      {item.status==='streaming'&&<span className="pi-answer-state">接收中</span>}
      {item.status==='incomplete'&&<span className="pi-answer-state">回复未完整结束</span>}
      {item.status==='interrupted'&&<span className="pi-answer-state">已中断</span>}
      {item.error&&<Feedback as="p" tone="error" className="form-error" role="alert">{item.error}</Feedback>}
      {item.role==='assistant'&&item.status!=='streaming'&&item.parts.some(part=>part.text)&&<div className="pi-message-actions"><Button variant="app-quiet" size="icon-sm" type="button" aria-label="复制这条回复" title="复制回复" onClick={async()=>{try{await navigator.clipboard.writeText(item.parts.map(part=>part.text).join('\n'));notifyOperation('已复制回复');}catch{notifyOperation('复制失败，请选择文字后复制。',{tone:'error'});}}}><PiIcon type="copy"/></Button></div>}
      {afterMessage?.(item)}
    </article>)}</>;
}
