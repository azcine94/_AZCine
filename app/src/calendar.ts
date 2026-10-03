import { validDate } from './workspace-contract.ts';

export interface CalendarDay { date: string; day: number; inMonth: boolean }
export const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;
function utcDate(year: number, month: number, day: number): Date {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  return result;
}
function format(date: Date): string | null {
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) return null;
  return `${String(year).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function shiftCalendarDay(value: string, days: number): string | null {
  if (!validDate(value) || !Number.isInteger(days)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return format(utcDate(year, month, day + days));
}
export function shiftCalendarMonth(value: string, months: number): string | null {
  if (!validDate(value) || !Number.isInteger(months)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const first = utcDate(year, month + months, 1);
  const last = utcDate(first.getUTCFullYear(), first.getUTCMonth() + 2, 0).getUTCDate();
  return format(utcDate(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(day, last)));
}
export function calendarWeekday(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return (utcDate(year, month, day).getUTCDay() + 6) % 7;
}
export function calendarDays(month: string): (CalendarDay | null)[] {
  if (!validDate(`${month}-01`)) throw new Error('日历需要有效的完整年月。');
  const first = `${month}-01`;
  const start = calendarWeekday(first);
  return Array.from({ length: 42 }, (_, index) => {
    const date = shiftCalendarDay(first, index - start);
    return date ? { date, day: Number(date.slice(8)), inMonth: date.startsWith(month) } : null;
  });
}
