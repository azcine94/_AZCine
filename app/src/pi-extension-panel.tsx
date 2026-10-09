import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import type { PiController } from './use-pi.ts';
export function PiExtensionPanel({model,belowOnly=false}:{model:PiController;belowOnly?:boolean}){
  const ui=model.snapshot?.extensions;if(!ui)return null;
  if(belowOnly)return <div className="pi-extension-panel">{Object.entries(ui.widgets).filter(([,widget])=>widget.placement==='belowEditor').map(([key,widget])=><Disclosure key={key}><summary>{key}</summary>{widget.lines.map((line,index)=><p key={index}>{line}</p>)}</Disclosure>)}</div>;
  return <div className="pi-extension-panel" aria-live="polite">
    {ui.title&&<p className="meta">{ui.title}</p>}
    {Object.entries(ui.statuses).map(([key,value])=><p key={key}>{value}</p>)}
    {ui.notifications.map(n=><Feedback as="p" key={n.id} tone={n.tone==='error'?'error':n.tone==='warning'?'pending':'info'}>{n.message}</Feedback>)}
    {Object.entries(ui.widgets).filter(([,widget])=>widget.placement!=='belowEditor').map(([key,widget])=><Disclosure key={key}><summary>{key}</summary><div>{widget.lines.map((line,index)=><p key={index}>{line}</p>)}</div></Disclosure>)}
    {ui.requests.map(request=><section className="pi-extension-question" key={request.id} aria-label={request.title||'扩展问题'}>
      <h3>{request.title||'扩展问题'}</h3>{request.message&&<p>{request.message}</p>}
      {request.status==='pending'?<>
        {request.expiresAt&&<p className="meta">超时后 Agent 扩展会结束等待 · {new Date(request.expiresAt).toLocaleTimeString('zh-CN')}</p>}
        {request.method==='select'?<div className="pi-extension-options">{request.options.map((option,index)=><Button key={index} variant="outline" size="sm" onClick={()=>void model.respondUi(request.id,{value:option})}>{option}</Button>)}</div>
          :request.method==='confirm'?<div className="pi-extension-options"><Button size="sm" onClick={()=>void model.respondUi(request.id,{confirmed:true})}>确认</Button><Button variant="outline" size="sm" onClick={()=>void model.respondUi(request.id,{confirmed:false})}>拒绝</Button></div>
          :<form onSubmit={e=>{e.preventDefault();void model.respondUi(request.id,{value:model.uiAnswers[request.id]??request.prefill});}}>
            <label>{request.title||'回答'}{request.method==='editor'?<Textarea value={model.uiAnswers[request.id]??request.prefill} maxLength={100000} onChange={e=>model.setUiAnswer(request.id,e.target.value)}/>:<Input value={model.uiAnswers[request.id]??''} placeholder={request.placeholder} maxLength={100000} onChange={e=>model.setUiAnswer(request.id,e.target.value)}/>}</label>
            <Button size="sm" type="submit">发送回答</Button>
          </form>}
        <Button size="sm" variant="ghost" onClick={()=>void model.respondUi(request.id,{cancelled:true})}>取消这次提问</Button>
      </>:<p className="meta">{request.status==='expired'?'已超时':request.status==='answered'?'回答已发送，等待实际结果':'已取消'}</p>}
    </section>)}
    {ui.editor&&<Disclosure><summary>扩展提供了输入文字</summary><p>{ui.editor.text}</p><Button variant="outline" size="sm" onClick={model.takeEditor}>附加到输入草稿</Button></Disclosure>}
  </div>;
}
