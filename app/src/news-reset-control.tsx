import {Button} from './components/ui/button.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog.tsx';
import type {NewsController} from './use-news.ts';
export function NewsResetControl({model,disabled=false}:{model:NewsController;disabled?:boolean}){
  const state=model.reset,request=state.request;
  return <section className="news-reset-control" aria-label="资讯数据清理">
    <div className="form-actions"><Button variant="app-text" disabled={disabled||state.busy||!model.connected} onClick={()=>void state.prepare('results')}>清空整理结果</Button><Button variant="app-text" disabled={disabled||state.busy||!model.connected} onClick={()=>void state.prepare('all')}>清空采集与全部资讯</Button></div>
    <p className="meta">清空整理结果会保留采集资料；清空全部还会移除原始资料与去重记录。信源、模型配置和其他模块保留。</p>
    {state.notice&&<p className="subtle" role="status">{state.notice}</p>}{state.error&&!request&&<Feedback as="p" tone="error" role="alert">{state.error}</Feedback>}
    <Dialog open={!!request} onOpenChange={open=>{if(!open)state.cancel();}}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={e=>{if(state.busy)e.preventDefault();}} onPointerDownOutside={e=>{if(state.busy)e.preventDefault();}}>
        <DialogHeader><DialogTitle>{request?.mode==='all'?'清空采集与全部资讯？':'清空整理结果？'}</DialogTitle><DialogDescription>此操作不可撤销。信源、模型设置及项目、待办、灵感、Agent 数据保留。</DialogDescription></DialogHeader>
        {request&&<div><p>将删除 {request.articles} 篇报道、{request.editions} 份日报或报告，以及 {request.tasks} 条整理任务和对应模型回执。</p><p>{request.mode==='all'?`同时删除全部 ${request.materials} 条采集资料、采集记录、去重记录和资讯任务文件。`:`保留全部 ${request.materials} 条采集资料及原文，清除处理标记后可重新整理。`}</p></div>}
        {state.error&&<Feedback as="p" tone="error" role="alert">{state.error}</Feedback>}
        <DialogFooter><Button variant="app-control" disabled={state.busy} onClick={state.cancel}>取消</Button><Button variant="app-pill" disabled={state.busy} onClick={()=>void state.confirm()}>{state.busy?'正在清空…':'确认清空'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
