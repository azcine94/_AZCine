import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx';

const currentMonth = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; };
export function MonthInput({ id, value, onChange, disabled = false, defaultOpen = false }: { id: string; value: string; onChange(value: string): void; disabled?: boolean; defaultOpen?: boolean }) {
  const valid = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const baseline = valid ? value : currentMonth();
  const [open, setOpen] = useState(defaultOpen), [year, setYear] = useState(Number(baseline.slice(0, 4)));
  const [focused, setFocused] = useState(Number(baseline.slice(5)) - 1);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function changeOpen(next: boolean) { if (next) { setYear(Number(baseline.slice(0, 4))); setFocused(Number(baseline.slice(5)) - 1); } setOpen(next); }
  function choose(month: string) { onChange(month); setOpen(false); }
  function key(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const movement: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); setYear(before => Math.min(9999, Math.max(1, before + (event.key === 'PageUp' ? -1 : 1)))); return;
    }
    if (movement[event.key] === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 11 : Math.min(11, Math.max(0, index + movement[event.key]));
    setFocused(next); buttons.current[next]?.focus();
  }
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><Button id={id} type="button" variant="outline" size="lg" className="month-input-trigger" disabled={disabled} aria-label={`选择月份，当前${valid ? `${value.slice(0, 4)}年${Number(value.slice(5))}月` : '全部月份'}`}><span>{valid ? `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月` : '全部月份'}</span><CalendarDays size={16} aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="month-input-popover" aria-label="选择月份" onOpenAutoFocus={event => { event.preventDefault(); buttons.current[focused]?.focus(); }}>
      <div className="month-input-year"><Button type="button" variant="ghost" size="icon" aria-label="上一年" disabled={year <= 1} onClick={() => setYear(year - 1)}><ChevronLeft size={16} /></Button><strong aria-live="polite">{year} 年</strong><Button type="button" variant="ghost" size="icon" aria-label="下一年" disabled={year >= 9999} onClick={() => setYear(year + 1)}><ChevronRight size={16} /></Button></div>
      <div className="month-input-grid" role="group" aria-label={`${year}年月份`}>{Array.from({ length: 12 }, (_, index) => {
        const month = `${String(year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`;
        return <Button key={index} type="button" ref={node => { buttons.current[index] = node; }} variant={month === value ? 'default' : 'ghost'} size="lg" aria-pressed={month === value} tabIndex={index === focused ? 0 : -1} onFocus={() => setFocused(index)} onKeyDown={event => key(event, index)} onClick={() => choose(month)}>{index + 1} 月</Button>;
      })}</div>
      <div className="month-input-footer"><Button type="button" variant="outline" size="sm" onClick={() => choose(currentMonth())}>本月</Button><Button type="button" variant="ghost" size="sm" onClick={() => choose('')}>全部月份</Button></div>
    </PopoverContent>
  </Popover>;
}
