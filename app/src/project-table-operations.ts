import { LIST_MAX_WIDTH, LIST_MIN_WIDTH } from './projects-contract.ts';
import type { ListBlock, ListColumn } from './projects-contract.ts';

export const LIST_PAGE_SIZE = 100;
export const LIST_ROW_HEADER_WIDTH = 64;
const DEFAULT_WIDTHS = { text: 176, shot: 176, stage: 160, date: 184, delivered: 112 };
export function columnWidth(column: ListColumn): number { return column.width ?? DEFAULT_WIDTHS[column.kind]; }
export function clampColumnWidth(value: number): number { return Math.max(LIST_MIN_WIDTH, Math.min(LIST_MAX_WIDTH, Math.round(value))); }
// Stored widths remain preferences; the normal table fits its container without
// changing saved data. Only an exceptionally wide set needs local overflow.
export function fitColumnWidths(columns: readonly ListColumn[], availableWidth: number, preview?: { columnId: string; width: number } | null): number[] {
  const minimums = { text: 80, shot: 88, stage: 96, date: 136, delivered: 88 };
  const minimum = columns.map(column => minimums[column.kind]);
  const preferred = columns.map(column => preview?.columnId === column.id ? preview.width : columnWidth(column));
  const available = Math.max(0, availableWidth - LIST_ROW_HEADER_WIDTH);
  const minimumTotal = minimum.reduce((sum, width) => sum + width, 0);
  if (available <= minimumTotal) return preferred;
  const weights = preferred.map((width, index) => Math.max(1, width - minimum[index]));
  const totalWeight = weights.reduce((sum, width) => sum + width, 0);
  return minimum.map((width, index) => width + (available - minimumTotal) * weights[index] / totalWeight);
}
export function columnLetter(index: number): string {
  let result = '';
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) result = String.fromCharCode(65 + (number - 1) % 26) + result;
  return result;
}
export function reorderList(block: ListBlock, kind: 'row' | 'column', sourceId: string, targetId: string, after: boolean): ListBlock {
  if (sourceId === targetId) return block;
  function reordered<T extends { id: string }>(items: T[]): T[] {
    const source = items.find(item => item.id === sourceId);
    if (!source || !items.some(item => item.id === targetId)) return items;
    const next = items.filter(item => item.id !== sourceId);
    next.splice(next.findIndex(item => item.id === targetId) + Number(after), 0, source);
    return next;
  }
  return kind === 'row' ? { ...block, rows: reordered(block.rows) } : { ...block, columns: reordered(block.columns) };
}
export function insertListRow(block: ListBlock, rowId: string, neighbourId?: string, after = true): ListBlock {
  if (block.rows.some(row => row.id === rowId)) throw new Error('新行编号已占用，未覆盖原行。');
  const rows = [...block.rows];
  const index = neighbourId ? rows.findIndex(row => row.id === neighbourId) : rows.length - 1;
  if (neighbourId && index < 0) throw new Error('相邻行已不存在，未插入到未知位置。');
  rows.splice(index + Number(after), 0, { id: rowId, cells: {} });
  return { ...block, rows };
}
export function insertListColumn(block: ListBlock, columnId: string, neighbourId?: string, after = true): ListBlock {
  if (block.columns.some(column => column.id === columnId)) throw new Error('新列编号已占用，未覆盖原列。');
  const columns = [...block.columns];
  const index = neighbourId ? columns.findIndex(column => column.id === neighbourId) : columns.length - 1;
  if (neighbourId && index < 0) throw new Error('相邻列已不存在，未插入到未知位置。');
  columns.splice(index + Number(after), 0, { id: columnId, name: '新列', kind: 'text' });
  return { ...block, columns };
}
