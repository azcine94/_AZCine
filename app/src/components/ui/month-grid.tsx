import { useRef } from 'react';
import { Button } from './button.tsx';
import { Card } from './card.tsx';
import { calendarDays, CALENDAR_WEEKDAYS, calendarWeekday, shiftCalendarDay, shiftCalendarMonth } from '../../calendar.ts';
export interface MonthItem {id:string;date:string;title:string;personal?:boolean;done?:boolean}
export function MonthGrid({month,today,selected,items,onSelect}:{month:string;today:string;selected:string;items:MonthItem[];onSelect:(date:string)=>void}){
  const root=useRef<HTMLDivElement>(null),days=calendarDays(month);
  const last=days.findLastIndex(day=>day?.inMonth),weeks=Math.ceil((last+1)/7),visibleCount=weeks===6?1:2;
  function move(date:string){onSelect(date);requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus());}
  return <div className="ui-month-grid" ref={root}><div className="ui-month-weekdays">{CALENDAR_WEEKDAYS.map(day=><span key={day}>周{day}</span>)}</div><div className="ui-month-days" style={{gridTemplateRows:`repeat(${weeks},minmax(0,1fr))`}}>{days.slice(0,weeks*7).map((day,index)=>{
    if(!day)return <div key={index}/>;const entries=items.filter(item=>item.date===day.date);
    // Card's utility-layer spacing must be removed here, not overridden by component CSS.
    return <Card variant="review" className="ui-month-cell p-0 gap-0" key={day.date} data-outside={!day.inMonth} data-today={day.date===today} data-selected={selected===day.date}>
      <Button variant="app-control" type="button" data-date={day.date} tabIndex={selected.startsWith(month)?selected===day.date?0:-1:day.day===1&&day.inMonth?0:-1} aria-current={day.date===today?'date':undefined} aria-pressed={selected===day.date} aria-label={`${day.date}${day.date===today?'，今天':''}，${entries.length} 项安排`} title={entries.map(item=>item.title).join('\n')} onClick={()=>onSelect(day.date)} onKeyDown={e=>{
        const delta:{[key:string]:number}={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-calendarWeekday(day.date),End:6-calendarWeekday(day.date)};
        const next=e.key in delta?shiftCalendarDay(day.date,delta[e.key]):e.key==='PageUp'?shiftCalendarMonth(day.date,-1):e.key==='PageDown'?shiftCalendarMonth(day.date,1):null;if(next){e.preventDefault();move(next);}
      }}><span className="ui-month-date">{day.date===today&&<span className="ui-month-today">今天</span>}<span className="ui-month-number">{day.day}</span></span><span className="ui-month-events"><span className="ui-month-event-list">{entries.slice(0,visibleCount).map(item=><span key={item.id} className="ui-month-event" data-personal={item.personal} data-done={item.done}><i aria-hidden="true"/><span>{item.title}</span></span>)}</span>{entries.length>visibleCount&&<span className="ui-month-more" aria-label={`另 ${entries.length-visibleCount} 项`}>+{entries.length-visibleCount}</span>}</span></Button>
    </Card>;
  })}</div></div>;
}
