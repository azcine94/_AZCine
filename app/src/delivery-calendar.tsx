import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, Trash2, Undo2 } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { ActionGroup } from './components/ui/action-group.tsx';
import { Label } from './components/ui/label.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { MonthGrid } from './components/ui/month-grid.tsx';
import { DateInput } from './date-input.tsx';
import { localDate } from './workspace-contract.ts';
import { calendarWeekday, CALENDAR_WEEKDAYS, shiftCalendarMonth } from './calendar.ts';
import { deriveDeliveries } from './projects-contract.ts';
import type { ProjectContent } from './projects-contract.ts';
import { projectLink } from './projects-panels.tsx';
import type { DeliveryCalendarController } from './use-delivery-calendar.ts';
export function DeliveryCalendar({model:m,projects,loading=false,error}:{model:DeliveryCalendarController;projects:ProjectContent[];loading?:boolean;error?:string|null}){
  const [today,setToday]=useState(localDate());useEffect(()=>{const timer=setInterval(()=>setToday(localDate()),30000);return()=>clearInterval(timer);},[]);
  const deliveries=deriveDeliveries(projects),personal=m.entries.filter(e=>!e.deleted),items=[...deliveries.map(d=>({id:`${d.projectId}/${d.blockId}/${d.rowId}`,date:d.dueDate,title:d.shot||'未命名交付',personal:false})),...personal.map(e=>({...e,personal:true}))];
  const selectedDeliveries=deliveries.filter(d=>d.dueDate===m.selected),selectedEntries=personal.filter(e=>e.date===m.selected).sort((a,b)=>a.time.localeCompare(b.time));
  const draft=m.draft;
  const [focused,setFocused]=useState(false),agendaId=useId(),formId=useId();
  const reopen=useRef<HTMLButtonElement>(null),collapse=useRef<HTMLButtonElement>(null);
  const selectedCount=selectedDeliveries.length+selectedEntries.length;
  const missingDates=deliveries.filter(d=>!d.dueDate).length;
  function showAgenda(expanded:boolean){
    m.setExpanded(expanded);
    requestAnimationFrame(()=>(expanded?collapse:reopen).current?.focus());
  }
  function changeMonth(offset:number){
    const date=shiftCalendarMonth(`${m.month}-01`,offset);
    if(date)m.setMonth(date.slice(0,7));
  }
  return <section className="today-card today-delivery-card delivery-calendar" data-focused={focused}>
    {(error||(!m.open&&m.error))&&<Feedback tone="error" role="alert">{error||m.error}<Button variant="app-quiet" disabled={m.busy} onClick={()=>void m.reload()}>重新读取</Button></Feedback>}
    {loading&&<p className="meta">正在读取项目交付…</p>}
    <div className="delivery-calendar-body" data-expanded={m.expanded}>
      <div className="delivery-calendar-month">
        <header className="delivery-calendar-heading">
          <h2>日历</h2>
          <div className="delivery-calendar-heading-actions">
            {!m.expanded&&<Button ref={reopen} variant="app-quiet" aria-controls={agendaId} aria-expanded={false} onClick={()=>showAgenda(true)}>当天事项<ChevronLeft aria-hidden="true"/></Button>}
            <Button variant="app-icon" aria-label={focused?'还原首页布局':'展开日历'} title={focused?'还原首页布局':'展开日历'} aria-pressed={focused} onClick={()=>setFocused(!focused)}>{focused?<Minimize2 aria-hidden="true"/>:<Maximize2 aria-hidden="true"/>}</Button>
          </div>
        </header>
        <div className="delivery-calendar-toolbar">
          <strong>{Number(m.month.slice(0,4))} 年 {Number(m.month.slice(5))} 月</strong>
          <div className="delivery-calendar-month-nav">
            <Button variant="app-icon" aria-label="上个月" onClick={()=>changeMonth(-1)}><ChevronLeft aria-hidden="true"/></Button>
            <Button variant="app-icon" aria-label="下个月" onClick={()=>changeMonth(1)}><ChevronRight aria-hidden="true"/></Button>
          </div>
          <Button variant="secondary" size="sm" onClick={()=>m.choose(today)}>今天</Button>
          <Button variant="secondary" size="icon-sm" disabled={!m.ready||m.busy} aria-label={draft?'继续编辑安排':'添加当天安排'} title={draft?'继续编辑安排':'添加当天安排'} onClick={m.create}><Plus aria-hidden="true"/></Button>
        </div>
        <MonthGrid month={m.month} today={today} selected={m.selected} items={items} onSelect={m.choose}/>
        <div className="delivery-calendar-key"><span><i aria-hidden="true"/>项目交付</span><span><i className="personal" aria-hidden="true"/>个人安排</span></div>
        {!!missingDates&&<UILink variant="text" href="#projects" className="meta delivery-calendar-missing">{missingDates} 项交付日期待补</UILink>}
      </div>
      {m.expanded&&<aside className="delivery-calendar-agenda" id={agendaId} aria-label="当天事项">
        <header><h3>当天事项</h3><span>{selectedCount?`${selectedCount} 件事`:''}</span><Button ref={collapse} variant="app-icon" aria-label="收起当天事项" title="收起当天事项" aria-expanded={true} aria-controls={agendaId} onClick={()=>showAgenda(false)}><ChevronRight aria-hidden="true"/></Button></header>
        <p className="delivery-calendar-selected">{Number(m.selected.slice(5,7))} 月 {Number(m.selected.slice(8))} 日 · 周{CALENDAR_WEEKDAYS[calendarWeekday(m.selected)]}</p>
        <div className="delivery-calendar-events" tabIndex={0} aria-label="当天全部事项">
          {selectedDeliveries.map(d=><UILink variant="plain" className="delivery-calendar-entry" key={`${d.projectId}/${d.blockId}/${d.rowId}`} href={projectLink(d.projectId,d.blockId,d.rowId)}>
            <i className="delivery-calendar-dot" aria-hidden="true"/><span className="delivery-calendar-entry-content"><strong>{d.shot||'未命名交付'}</strong><span>{d.projectName}</span></span><ArrowUpRight aria-hidden="true"/>
          </UILink>)}
          {selectedEntries.map(e=><div className="delivery-calendar-entry" key={e.id} data-personal="true" data-done={e.done}>
            <i className="delivery-calendar-dot" aria-hidden="true"/>
            <Button variant="app-control" className="delivery-calendar-entry-content" disabled={m.busy} onClick={()=>{m.edit(e);m.setOpen(true);}}><strong>{e.title}</strong><span>{e.time||'个人安排'}</span></Button>
            <ActionGroup className="delivery-calendar-entry-actions">
              <Button variant="app-icon" disabled={m.busy} aria-label={`${e.done?'恢复':'完成'}：${e.title}`} title={e.done?'恢复安排':'完成安排'} onClick={()=>void m.save({...e,done:!e.done})}>{e.done?<Undo2 aria-hidden="true"/>:<Check aria-hidden="true"/>}</Button>
              <Button variant="app-icon" data-calendar-delete disabled={m.busy} aria-label={`删除安排：${e.title}`} title="删除安排" onClick={()=>void m.save({...e,deleted:true})}><Trash2 aria-hidden="true"/></Button>
            </ActionGroup>
          </div>)}
          {!selectedCount&&<p className="delivery-calendar-empty">暂无安排</p>}
        </div>
        <Button variant="outline" size="sm" className="delivery-calendar-add" disabled={!m.ready||m.busy} onClick={m.create}><Plus aria-hidden="true"/>{draft?'继续编辑安排':'添加当天安排'}</Button>
      </aside>}
    </div>
    <FormDialog open={m.open} onOpenChange={open=>{if(!m.busy)m.setOpen(open);}} title={draft?.revision?'编辑个人安排':'添加个人安排'} description="安排保存在日历中。" footer={
      <ActionGroup className="calendar-form-actions">
        {!!draft?.revision&&<Button variant="ghost" className="text-destructive mr-auto" disabled={m.busy} onClick={()=>void m.save({...draft,deleted:true},true)}>移除安排</Button>}
        <Button variant="outline" disabled={m.busy} onClick={()=>m.setOpen(false)}>取消</Button>
        <Button disabled={m.busy||!draft?.title.trim()||!draft?.date} onClick={()=>draft&&void m.save(draft,true)}>{m.busy?'正在保存…':'保存'}</Button>
      </ActionGroup>
    }>{draft&&<div className="calendar-form">
      <div className="calendar-form-field"><Label htmlFor={`${formId}-title`}>标题</Label><Input id={`${formId}-title`} value={draft.title} maxLength={200} disabled={m.busy} onChange={e=>m.edit({...draft,title:e.target.value})}/></div>
      <div className="calendar-form-field"><Label htmlFor={`${formId}-date`}>日期</Label><DateInput id={`${formId}-date`} label="日期" value={draft.date} disabled={m.busy} onChange={date=>m.edit({...draft,date})}/></div>
      <div className="calendar-form-field"><Label htmlFor={`${formId}-time`}>时间（可选）</Label><Input id={`${formId}-time`} type="time" value={draft.time} disabled={m.busy} onChange={e=>m.edit({...draft,time:e.target.value})}/></div>
      <div className="calendar-form-field"><Label htmlFor={`${formId}-note`}>备注（可选）</Label><Textarea id={`${formId}-note`} value={draft.note} maxLength={10000} disabled={m.busy} onChange={e=>m.edit({...draft,note:e.target.value})}/></div>
      {m.error&&<Feedback tone="error" role="alert">{m.error}</Feedback>}
    </div>}</FormDialog>
  </section>;
}
