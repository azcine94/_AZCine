import { useState } from 'react';
import { Button } from './components/ui/button.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { FormDialog,useCreationDialog } from './components/ui/form-dialog.tsx';
import { pendingDraftDecisions,type AgentDataController,type AgentDraft } from './use-agent-data.ts';
import type { PiController } from './use-pi.ts';
import { AgentDraftPreview } from './agent-draft-preview.tsx';
import { ArrowUpRight,FilePenLine,CircleCheck } from 'lucide-react';

const draftTitle=(draft:AgentDraft)=>draft.validation.items.map(item=>String(item.title??'业务记录')).join('、')||'业务变更草案';
const statusLabels:Record<string,string>={applied:'已应用到正式记录',review:'待核对',conflict:'原记录已变化',discarded:'已作废'};
function DraftDetails({title,value}:{title:string;value:unknown}) {
  const [open,setOpen]=useState(false);
  return <Disclosure onToggle={event=>setOpen(event.currentTarget.open)}><summary>{title}</summary>{open&&<pre>{JSON.stringify(value,null,2)}</pre>}</Disclosure>;
}
export function AgentDraftsPanel({model,pi,conversationOnly=false,draft}:{model:AgentDataController;pi:PiController;conversationOnly?:boolean;draft?:AgentDraft}) {
  const review=useCreationDialog(),[selectedId,setSelectedId]=useState('');
  const [confirm,setConfirm]=useState<{id:string;revision:number}|null>(null);
  const drafts=draft?[draft]:model.drafts.filter(d=>!['applied','discarded'].includes(d.status)&&(!conversationOnly||d.conversationKey===pi.conversationKey));
  const active=drafts.find(d=>d.id===selectedId)??drafts[0];
  if(!drafts.length&&!model.error&&!review.open)return null;
  const confirming=!!active&&confirm?.id===active.id&&confirm.revision===active.revision&&active.status==='review';
  const applied=draft?.status==='applied',title=draft?draftTitle(draft):'业务变更草案';
  const decisions=active?pendingDraftDecisions(active):[];
  const close=()=>{review.setOpen(false);setConfirm(null);};
  const footer=active?<>
    {confirming?<div className="agent-draft-confirm" role="group" aria-label="确认应用草案">
      <p>已核对这 {active.validation.items.length} 项变更？任何原记录已变化都会整批拒绝。{decisions.length>0?'待确认事项保留，不在本次应用中。':''}</p>
      <div className="agent-draft-actions"><Button disabled={!!model.busy} onClick={async()=>{const session=review.session.current;if(await model.apply(active)&&review.session.current===session)setConfirm(null);}}>本人已核对，应用变更</Button><Button variant="outline" disabled={!!model.busy} onClick={()=>setConfirm(null)}>继续核对</Button></div>
    </div>:<div className="agent-draft-footer-content">
      <p className="meta">{active.status==='applied'?'已记录正式保存回执':active.status==='discarded'?'此草案已作废':`${active.validation.items.length} 项变更${decisions.length?` · ${decisions.length} 项待确认`:' · 确认后才正式保存'}`}</p>
      <div className="agent-draft-actions">
        {!['applied','discarded'].includes(active.status)&&<>
          {active.status!=='review'&&<Button variant="outline" size="sm" disabled={!!model.busy} onClick={()=>{setConfirm(null);void model.revalidate(active);}}>重新校验</Button>}
          <Button size="sm" disabled={active.status!=='review'||!!model.busy} onClick={()=>setConfirm({id:active.id,revision:active.revision})}>{decisions.length?'应用确定变更':'核对后应用'}</Button>
          <Button variant="outline" size="sm" disabled={!!model.busy} onClick={async()=>{
            const session=review.session.current;
            try{
              await pi.prepareRedo(active.conversationKey,`请按当前最新对象版本重做这份草案。旧草案的问题：${active.validation.error??'请重新核对原记录'}。通过AZCine MCP的describe_action读取当前动作契约，保留未决定项与用户原表结构，不猜测补全。提交后等待本人核对，不能说已写入。`,active.context.objects.map(o=>o.source));
              if(review.session.current===session){close();location.hash='agent';}
            }catch{
              /* Pi controller keeps the actual error and input. */
            }
          }}>按新版本重做</Button>
          <Button variant="ghost" size="sm" disabled={!!model.busy} onClick={()=>void model.discard(active)}>作废草案</Button>
        </>}
        <Button variant="outline" size="sm" onClick={close}>关闭</Button>
      </div>
    </div>}
  </>:<Button variant="outline" size="sm" onClick={close}>关闭</Button>;
  return <section className={draft?'agent-draft-card':'agent-draft-entry'} aria-label="Agent草案">
    {draft?<Button variant="app-control" className="agent-draft-card-trigger" onClick={()=>review.setOpen(true)} aria-label={applied?`查看应用结果：${title}`:`核对草案：${title}`}>
      <span className="agent-draft-card-icon">{applied?<CircleCheck/>:<FilePenLine/>}</span><span><strong>{title}</strong><small>{applied?pendingDraftDecisions(draft).length?'已应用确定变更 · 仍有待确认事项':'已应用到工作台':draft.status==='review'?`${draft.validation.items.length} 项变更 · 等待你核对`:draft.status==='conflict'?'原记录已变化 · 需要重做':'草案校验未通过 · 查看原因'}</small></span><ArrowUpRight/>
    </Button>:<Button variant="outline" size="sm" onClick={()=>review.setOpen(true)}>核对草案 · {drafts.length}</Button>}
    {!draft&&!review.open&&model.error&&<Feedback tone="error">{model.error}</Feedback>}
    <FormDialog wide className="agent-review-dialog" open={review.open} onOpenChange={open=>{review.setOpen(open);if(!open)setConfirm(null);}} title="核对Agent草案" description="检查建议内容与变更。本人确认后才会写入正式记录；关闭窗口会保留草案。" footer={footer}>
      {model.error&&<Feedback tone="error" role="alert">{model.error}</Feedback>}
      {drafts.length>1&&<label className="agent-draft-selector">选择草案<NativeSelect variant="app" value={active?.id??''} disabled={!!model.busy} onChange={event=>{setSelectedId(event.target.value);setConfirm(null);}}>{drafts.map(d=><option key={d.id} value={d.id}>{draftTitle(d)} · {statusLabels[d.status]??'需要重写'}</option>)}</NativeSelect></label>}
      <div className="agent-draft-list">{active?<article key={active.id}>
        <p className="meta">{statusLabels[active.status]??'需要Agent重写'} · {new Date(active.createdAt).toLocaleString('zh-CN')}</p>
        {decisions.length>0&&<Disclosure className="agent-draft-decisions"><summary>待确认事项 · {decisions.length}（本次不写入）</summary><ul>{decisions.map((value,index)=><li key={index}>{value}</li>)}</ul></Disclosure>}
        {active.validation.error&&<Feedback tone="conflict">{active.validation.error}</Feedback>}
        {active.validation.items.map((item,index)=><AgentDraftPreview key={`${active.revision}-${index}`} item={item}/>)}
        <DraftDetails title="技术详情与校验依据" value={active.validation.items.length?active.validation.items:active.payload}/>
        {active.status==='applied'&&<DraftDetails title="正式保存回执" value={active.receipt}/>}
      </article>:<p>当前没有待核对草案。</p>}</div>
    </FormDialog>
  </section>;
}
