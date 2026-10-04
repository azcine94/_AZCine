import { Input } from './components/ui/input.tsx';
import { Button } from './components/ui/button.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEventHandler, KeyboardEvent } from 'react';
import { calendarDays, calendarWeekday, CALENDAR_WEEKDAYS, shiftCalendarDay, shiftCalendarMonth } from './calendar.ts';
import { localDate, validDate } from './workspace-contract.ts';
import { useAnchoredPopover } from './use-anchored-popover.ts';

interface DateInputProps {
  id?: string; label: string; value: string;
  onChange(value: string, selected?: boolean): void;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  disabled?: boolean; selectionDisabled?: boolean; readOnly?: boolean;
}
export function DateInput({ id, label, value, onChange, onBlur, disabled = false, selectionDisabled = disabled, readOnly = false }: DateInputProps) {
  const instance = useId();
  const panelId = `${instance}-calendar`;
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(localDate);
  const [month, setMonth] = useState(() => active.slice(0, 7));
  const focusDay = useRef(false);
  const { triggerRef, panelRef } = useAnchoredPopover(open && !selectionDisabled, () => setOpen(false), 304, 'start', 420);
  const days = calendarDays(month);
  const today = localDate();
  function close(restore = false) {
    focusDay.current = false; setOpen(false);
    if (restore) triggerRef.current?.focus({ preventScroll: true });
  }
  function reveal(date: string) {
    setActive(date); setMonth(date.slice(0, 7)); focusDay.current = true;
  }
  useLayoutEffect(() => {
    if (selectionDisabled) { if (open) close(); return; }
    if (open && focusDay.current) {
      focusDay.current = false;
      panelRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${active}"]`)?.focus({ preventScroll: true });
    }
  }, [open, active, month, selectionDisabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (root.current && !event.composedPath().includes(root.current)) close(); };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('click', outside, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('click', outside, true); };
  }, [open]);
  function choose(date: string) {
    if (selectionDisabled) return;
    close(true);
    if (value !== date) onChange(date, true);
  }
  function dayKeys(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    let next: string | null;
    switch (event.key) {
      case 'ArrowLeft': next = shiftCalendarDay(active, -1); break;
      case 'ArrowRight': next = shiftCalendarDay(active, 1); break;
      case 'ArrowUp': next = shiftCalendarDay(active, -7); break;
      case 'ArrowDown': next = shiftCalendarDay(active, 7); break;
      case 'PageUp': next = shiftCalendarMonth(active, -1); break;
      case 'PageDown': next = shiftCalendarMonth(active, 1); break;
      case 'Home': next = shiftCalendarDay(active, -calendarWeekday(active)); break;
      case 'End': next = shiftCalendarDay(active, 6 - calendarWeekday(active)); break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
    if (next) reveal(next);
  }
  return <div ref={root} className="date-input" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={event => {
    if (open && event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(true); }
  }}>
    <Input variant="app" id={id} className="input" type="text" aria-label={label} placeholder="YYYY-MM-DD" autoComplete="off" spellCheck={false} value={value} disabled={disabled} readOnly={readOnly} aria-disabled={disabled || readOnly} onChange={event => onChange(event.target.value)} onBlur={onBlur} />
    <Button variant="app-control" ref={triggerRef} type="button" className="date-input__trigger" data-project-commit aria-label={`${label}：选择日期`} aria-disabled={selectionDisabled} aria-haspopup="dialog" aria-expanded={open && !selectionDisabled} aria-controls={panelId} onClick={() => {
      if (selectionDisabled) return;
      if (open) close(true);
      else { reveal(validDate(value) ? value : localDate()); setOpen(true); }
    }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 2v6m10-6v6M3 11h18m-13 4h3" /></svg></Button>
    <div ref={panelRef} id={panelId} role="dialog" aria-label={`${label}日历`} className="date-input__calendar" popover="manual" data-project-commit onPointerDown={event => event.stopPropagation()}>
      {open && !selectionDisabled && <>
        <header><Button variant="app-control" type="button" aria-label="上个月" disabled={!shiftCalendarMonth(`${month}-01`, -1)} onClick={() => { const next = shiftCalendarMonth(active, -1); if (next) reveal(next); }}>‹</Button><strong aria-live="polite">{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</strong><Button variant="app-control" type="button" aria-label="下个月" disabled={!shiftCalendarMonth(`${month}-01`, 1)} onClick={() => { const next = shiftCalendarMonth(active, 1); if (next) reveal(next); }}>›</Button></header>
        <div className="date-input__week" aria-hidden="true">{CALENDAR_WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
        <div className="date-input__days" role="group" aria-label="选择完整日期">{days.map((day, index) => day ? <Button variant="app-control" key={day.date} type="button" data-calendar-date={day.date} className={day.inMonth ? '' : 'date-input__other'} aria-label={day.date} aria-pressed={value === day.date} aria-current={day.date === today ? 'date' : undefined} tabIndex={active === day.date ? 0 : -1} onFocus={() => setActive(day.date)} onKeyDown={dayKeys} onClick={() => choose(day.date)}>{day.day}</Button> : <span key={index} />)}</div>
        <footer><Button variant="app-control" type="button" onClick={() => choose(today)}>今天</Button><Button variant="app-control" type="button" onClick={() => choose('')}>清空日期</Button></footer>
      </>}
    </div>
  </div>;
}
