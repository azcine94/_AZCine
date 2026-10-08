import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { Label } from './components/ui/label.tsx';
import { StatusBadge } from './components/ui/status-badge.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { liveExecution } from './task-panel-contract.ts';
import type { TaskView } from './task-panel-contract.ts';
import type { TaskPanelController } from './use-task-panel.ts';
import { taskPanelClient } from './task-panel-client.ts';

const feedbackLabels:Record<string,string>={pending:'待发送',sending:'发送待核对',sent:'已发送 · 待 Agent 确认',uncertain:'发送结果不明',received:'Agent 已收到',addressed:'Agent 回报已处理',cancelled:'待发送意见已撤回'};

export function TaskFeedbackPanel({task,model}:{task:TaskView;model:TaskPanelController}) {
  const [sending,setSending]=useState(false), [localError,setLocalError]=useState('');
  const identity=useRef('');identity.current=JSON.stringify([model.root,task.id]);
  useEffect(()=>{setLocalError('');setSending(false);},[task.id,model.root]);
  useEffect(()=>()=>{identity.current='';},[]);
  const run=model.snapshot?.executions.find(r=>r.taskId===task.id&&r.taskRevision===task.revision&&liveExecution(r.state));
  const rows=(model.snapshot?.feedback?.filter(f=>f.taskId===task.id) || []).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const proposals=model.snapshot?.memories.filter(m=>m.taskId===task.id&&m.status==='draft'&&['decision','requirement','goal'].includes(m.kind)) || [];
  const busy=!!model.action||!!model.workflow.action||sending;
  return <section className="tp-feedback-panel" aria-label="任务意见与回应"><div className="tp-feedback-heading"><h3><MessageSquare size={14}/>意见与回应</h3><Button size="sm" variant="ghost" disabled={busy} onClick={()=>model.openEditor(task)}>修改任务要求</Button></div>
    {run && run.reason && <p className="tp-meta tp-feedback-text">原执行最近说明：{run.reason}</p>}
    <Disclosure key={`${model.root}-${task.id}-feedback`}><summary>{run?'给原 Agent 补充意见':'查看补充意见'}{rows.length>0&&` · ${rows.length} 条`}</summary><div className="tp-form">
      {run && task.lifecycle==='active'&&<form className="tp-form" onSubmit={async e=>{e.preventDefault();if(sending)return;const target=identity.current;setSending(true);try{await model.sendFeedback(task,run.id);}finally{if(target===identity.current)setSending(false);}}}>
        <Label className="grid gap-2 font-normal leading-5">你的意见<Textarea variant="app" rows={3} maxLength={5000} value={model.feedbackText(task)} disabled={busy} onChange={e=>model.updateFeedback(task,e.target.value)} placeholder="补充说明；改变范围与完成条件请使用“修改任务要求”。"/></Label>
        <p className="tp-meta">意见先保存，原会话空闲时发送；正在等待交互时可回原窗格继续沟通。发送与确认收到分别显示。</p>
        <Button size="sm" variant="outline" disabled={busy||!model.feedbackText(task).trim()}>{sending?'保存并发送意见…':'发送给原 Agent'}</Button>
      </form>}
      {model.draftStorageError&&<Feedback tone="error" role="alert">{model.draftStorageError}</Feedback>}
      {(localError||model.feedbackError)&&<Feedback tone="error" role="alert">{localError||model.feedbackError}</Feedback>}
      {!run&&<p className="tp-meta">当前没有可继续沟通的执行。可以修改要求后重新交接任务。</p>}
      {rows.map(item=><article className="tp-feedback-item" key={item.id}>
        <div className="tp-row"><StatusBadge tone={['uncertain','sending'].includes(item.state)?'warning':'neutral'}>{feedbackLabels[item.state]||'状态待核对'}</StatusBadge><span className="tp-meta">r{item.taskRevision} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span></div>
        <p className="tp-feedback-text">{item.body}</p><p className="tp-meta">{item.reason}</p>
        {item.response&&<div className="tp-feedback-response"><strong>Agent 回应</strong><p className="tp-feedback-text">{item.response}</p><p className="tp-meta">这是 Agent 回报，交付与验收仍需核对。</p></div>}
        {item.state==='pending'&&run?.id===item.executionId&&item.taskRevision===task.revision&&<Button size="sm" variant="ghost" disabled={busy} onClick={async()=>{
          const target=identity.current;setSending(true);setLocalError('');try{await model.cancelFeedback(task,run.id,item.id);}catch(e){if(target===identity.current)setLocalError(e&&typeof e==='object'&&'message'in e?String(e.message):'撤回未完成，意见保留。');}finally{if(target===identity.current)setSending(false);}
        }}>撤回待发送意见</Button>}
      </article>)}
    </div></Disclosure>
    {proposals.length>0&&<Disclosure><summary>Agent 提出的建议 · {proposals.length} 条</summary><div className="tp-form">{proposals.map(proposal=><article key={proposal.id} className="tp-feedback-item"><StatusBadge tone="warning">候选 · 待你核对{proposal.stale?' · 出处已变':''}</StatusBadge><p className="tp-feedback-text">{proposal.body}</p><Button size="sm" variant="outline" disabled={busy||!!proposal.stale} onClick={()=>{model.openEditor(task);model.updateDraft({goal:`${task.goal}\n\n## 补充要求草案\n${proposal.body}`});}}>带入草案，核对任务要求</Button><p className="tp-meta">先编辑草案，核对后保存；原执行与旧要求保留。</p></article>)}</div></Disclosure>}
  </section>;
}

export function TaskRevisionGate({model}:{model:TaskPanelController}) {
  const [checked,setChecked]=useState(false);
  const run=model.snapshot?.executions.find(r=>r.taskId===model.draft.id&&liveExecution(r.state));
  useEffect(()=>{setChecked(false);},[run?.id,model.editorOpen]);
  if(!run)return null;
  const w=model.workflow;
  return <section className="tp-revision-gate" aria-label="修改前核对原执行"><h3>先停止旧约定，再交接新要求</h3><p>原 Agent 仍按 r{run.taskRevision} 执行。编辑草案会保留；核对停止后才能保存新版本。</p><div className="tp-acts"><Button type="button" size="sm" variant="outline" disabled={!!w.action} onClick={()=>void w.input('execution_action','请求停止原执行',{executionId:run.id,action:'interrupt',reason:'本人准备修改任务约定，请求停止原执行。',approved:true})}>请求停止</Button><Button type="button" size="sm" variant="ghost" onClick={()=>void w.perform('打开原窗格',()=>taskPanelClient(model.root).focus(run.bindingId))}>查看原窗格</Button></div>
    <Label className="tp-check"><Checkbox checked={checked} onCheckedChange={v=>setChecked(v===true)}/>我已在原窗格核对，这次执行已停止</Label><Button type="button" size="sm" variant="outline" disabled={!checked||!!w.action} onClick={()=>void w.input('execution_action','核对停止并保留旧执行',{executionId:run.id,action:'release_for_revision',reason:'本人核对原执行已停止，准备保存新要求；旧记录保留，重新交接使用新修订。',approved:true})}>核对停止，继续修改</Button>
  </section>;
}
