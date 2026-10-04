import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ConversationView, ProcessView, ToolView } from './pi-process-view.ts';
import { activityText, processHasIssue } from './pi-process-view.ts';

const states: Record<string,string> = { success:'完成',finished:'完成',running:'进行中',waiting:'等待执行',
  error:'失败',interrupted:'已中断',incomplete:'状态待确认' };
export function PiIcon({type}:{type:'tool'|'chevron'|'check'|'activity'|'plus'|'send'|'stop'|'more'|'history'|'attachment'}) {
  const paths = {tool:'M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3Z',
    chevron:'m7 10 5 5 5-5',check:'m5 12 4 4L19 6',activity:'M20 12a8 8 0 1 1-8-8',
    plus:'M12 5v14M5 12h14',send:'m5 12 7-7 7 7M12 5v14',stop:'M6 6h12v12H6Z',
    more:'M5 12h.01M12 12h.01M19 12h.01',history:'M4 5v5h5M4 10a8 8 0 1 1 1 8M12 8v5l3 2',
    attachment:'m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9'};
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type]}/></svg>;
}
function ToolRow({value,choice,onChoice,onBeforeChange}:{value:ToolView;choice:boolean|undefined;onChoice:(open:boolean)=>void;onBeforeChange:()=>void}) {
  const id = useId();
  const issue = ['error','interrupted','incomplete'].includes(value.status);
  const open = choice ?? issue;
  return <div className="pi-call" data-call-id={value.id} data-status={value.status}>
    <button type="button" className="pi-call-toggle" aria-expanded={open} aria-controls={id} onClick={()=>{onBeforeChange();onChoice(!open);}}>
      <PiIcon type="tool"/><span className="pi-call-title">调用工具：<code>{value.name}</code></span>
      <span className="pi-call-status">{states[value.status] ?? '状态待确认'}</span><span className="pi-chevron" data-open={open}><PiIcon type="chevron"/></span>
    </button>
    <div className="pi-call-description">{value.path&&<p className="pi-call-path">{value.path}</p>}
      {value.output&&<p className="pi-call-preview">{value.output}</p>}
      {value.notice&&<p className="pi-call-notice">{value.notice}</p>}
      {!value.output&&<p>{value.status==='running'?'工具执行中…':value.status==='waiting'?'等待实际工具事件。':'尚无可显示的输出。'}</p>}
    </div>
    <div id={id} hidden={!open} className="pi-call-details"><h4>输入</h4><pre tabIndex={0} aria-label={`${value.name}输入`}>{value.input}</pre>
      <h4>输出</h4><pre tabIndex={0} aria-label={`${value.name}输出`}>{value.output || '尚无可显示的输出。'}</pre></div>
  </div>;
}
function Thinking({text,title,expanded,onChoice,onBeforeChange}:{text:string;title:string;expanded:boolean;onChoice:(open:boolean)=>void;onBeforeChange:()=>void}) {
  const paragraph=useRef<HTMLParagraphElement>(null),[long,setLong]=useState(false);
  useLayoutEffect(()=>{const el=paragraph.current;if(!el)return;const measure=()=>setLong(el.scrollHeight>parseFloat(getComputedStyle(el).lineHeight)*4+1);
    measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();},[text,expanded]);
  // The preview is only a display clip; the full original string remains available.
  return <div className="pi-thinking"><p ref={paragraph} className={!expanded?'pi-thinking-preview':undefined}>{text}</p>
    {long&&<button type="button" className="pi-inline-action" aria-expanded={expanded} onClick={()=>{onBeforeChange();onChoice(!expanded);}}>{expanded?'收起全文':`展开${title}全文`}</button>}</div>;
}
function Process({value,choices,onChoice,onBeforeChange}:{value:ProcessView;choices:Record<string,boolean>;onChoice:(key:string,open:boolean)=>void;onBeforeChange:()=>void}) {
  const id = useId(), issue = processHasIssue(value), open = choices[value.key] ?? (value.live || issue);
  const count = new Set(value.entries.filter(entry=>entry.kind==='tool').map(entry=>entry.id)).size;
  const title = (value.live ? activityText(value.activity) : '处理过程') + (issue?' · 有异常':'');
  return <section className="pi-process" data-process-key={value.key} data-live={value.live}>
    <button className="pi-process-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={()=>{onBeforeChange();onChoice(value.key,!open);}}>
      <span className={value.live?'pi-process-activity':'pi-process-symbol'}><PiIcon type={value.live?'activity':issue?'tool':'more'}/></span>
      <strong>{title}</strong>{count>0&&<span className="pi-process-count">{count} 次工具调用</span>}
      <span className="pi-process-toggle-label">{open?'收起':'展开'}</span><span className="pi-chevron" data-open={open}><PiIcon type="chevron"/></span>
    </button>
    <div id={id} className="pi-process-content" hidden={!open}>{value.entries.map(entry=>entry.kind==='thinking'
      ? <Thinking key={entry.key} text={entry.text} title={entry.title} expanded={choices[entry.key+'/full']??false} onChoice={open=>onChoice(entry.key+'/full',open)} onBeforeChange={onBeforeChange}/>
      :<ToolRow key={entry.key} value={entry} choice={choices[entry.key+'/details']} onChoice={open=>onChoice(entry.key+'/details',open)} onBeforeChange={onBeforeChange}/>)}
      {value.errors.map((error,index)=><p key={index} className="form-error" role="alert">{error}</p>)}</div>
  </section>;
}
export function Conversation({items,choices,onChoice,onBeforeChange}:{items:ConversationView[];choices:Record<string,boolean>;onChoice:(key:string,open:boolean)=>void;onBeforeChange:()=>void}) {
  return <>{items.map(item=>item.kind==='process'?<Process key={item.key} value={item} choices={choices} onChoice={onChoice} onBeforeChange={onBeforeChange}/>
    :<article key={item.key} className={`pi-message pi-message--${item.role}`} data-message-key={item.key}>
      {item.role!=='assistant'&&<header><strong>{item.title}</strong></header>}
      {item.parts.map((part,index)=><p key={index} className="pi-message-text">{part.text}</p>)}
      {item.status==='streaming'&&<span className="pi-answer-state">接收中</span>}
      {item.status==='incomplete'&&<span className="pi-answer-state">回复未完整结束</span>}
      {item.status==='interrupted'&&<span className="pi-answer-state">已中断</span>}
      {item.error&&<p className="form-error" role="alert">{item.error}</p>}</article>)}</>;
}
