import {useRef} from 'react';
import {isHistoryReset} from './use-news-reset.ts';
import {Button} from './components/ui/button.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog.tsx';
import type {NewsController} from './use-news.ts';
export function NewsResetControl({model,disabled=false}:{model:NewsController;disabled?:boolean}){
  const state=model.reset,request=state.request&&!isHistoryReset(state.request.mode)?state.request:null;
  return <section className="news-reset-control" aria-label="资讯数据清理">
    <div className="form-actions"><Button variant="app-text" disabled={disabled||state.busy||!!state.request||!model.connected} onClick={()=>void state.prepare('results')}>清空整理结果</Button><Button variant="app-text" disabled={disabled||state.busy||!!state.request||!model.connected} onClick={()=>void state.prepare('all')}>清空采集与全部资讯</Button></div>
    <p className="meta">清空整理结果会保留采集资料；清空全部还会移除原始资料与去重记录。信源、模型配置和其他模块保留。</p>
    {state.error&&!state.request&&<Feedback as="p" tone="error" role="alert">{state.error}</Feedback>}
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

/** History removal has its own confirmation and never clears news results. */
export function NewsHistoryControl({model,disabled=false,total=0}:{model:NewsController;disabled?:boolean;total?:number}){
  const state=model.reset;
  const request=state.request&&isHistoryReset(state.request.mode)?state.request:null;
  const retained=useRef(request);if(request)retained.current=request;
  const shown=request??retained.current;
  const cancel=useRef<HTMLButtonElement>(null);
  return <><Button variant="app-text" data-history-clear disabled={disabled||state.busy||!!state.request||!model.connected||total===0} onClick={()=>void state.prepare('history')}>清空已结束记录</Button>
    <Dialog open={!!request} onOpenChange={open=>{if(!open)state.cancel();}}><DialogContent showCloseButton={!state.busy} onOpenAutoFocus={event=>{event.preventDefault();cancel.current?.focus();}} onEscapeKeyDown={event=>{if(state.busy)event.preventDefault();}} onInteractOutside={event=>{if(state.busy)event.preventDefault();}}>
      <DialogHeader><DialogTitle>{shown?.mode==='history'?'清空已结束的处理记录？':'删除这条处理记录？'}</DialogTitle><DialogDescription>只移出处理记录列表，保留原始资料、已生成资讯、日报及处理标记，不会重新处理资料。任务留档仍保留。</DialogDescription></DialogHeader>
      <p>将移除 {shown?.tasks??0} 条已结束记录。运行中的任务不能删除。</p>
      {state.error&&<Feedback tone="error" role="alert">{state.error}</Feedback>}
      <DialogFooter><Button ref={cancel} variant="outline" disabled={state.busy} onClick={state.cancel}>取消</Button><Button variant="destructive" disabled={state.busy||!request?.tasks} onClick={()=>void state.confirm()}>{state.busy?'正在删除…':'确认删除'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
