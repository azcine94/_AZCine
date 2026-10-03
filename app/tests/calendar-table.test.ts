import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, calendarWeekday, shiftCalendarDay, shiftCalendarMonth } from '../src/calendar.ts';
import { columnLetter, columnWidth, clampColumnWidth, insertListColumn, insertListRow, reorderList } from '../src/project-table-operations.ts';
import { parseProjectContent, deleteColumn, restoreUndo, deriveDeliveries } from '../src/projects-contract.ts';
import type { ListBlock, ProjectContent } from '../src/projects-contract.ts';
const id = (n: number) => `00000000-1111-2222-3333-${String(n).padStart(12, '0')}`;
function fixture(): ProjectContent {
  return { id: id(1), name: '表格', labels: [{ id: id(2), name: 'FINAL' }], blocks: [{ id: id(3), kind: 'list', title: '表', included: true,
    columns: [{ id: id(4), name: '镜头', kind: 'shot' }, { id: id(5), name: '阶段', kind: 'stage' }, { id: id(6), name: '交期', kind: 'date', width: 240 }],
    rows: [{ id: id(7), cells: { [id(4)]: 'SH1', [id(5)]: id(2), [id(6)]: '2028-02-29' } }, { id: id(8), cells: { [id(4)]: 'SH2' } }] }] };
}
const block = (p: ProjectContent) => p.blocks[0] as ListBlock;
test('Given闰年跨年或小年份 When移动日历 Then完整年份不被1900偏移且边界不越界', () => {
  assert.equal(shiftCalendarDay('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftCalendarDay('2028-02-29', 1), '2028-03-01');
  assert.equal(shiftCalendarDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftCalendarDay('0001-01-01', 0), '0001-01-01');
  assert.equal(shiftCalendarDay('0001-01-01', -1), null);
  assert.equal(shiftCalendarDay('9999-12-31', 1), null);
  assert.equal(shiftCalendarMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(shiftCalendarMonth('2027-01-31', 1), '2027-02-28');
  assert.equal(shiftCalendarMonth('2026-12-31', 1), '2027-01-31');
  assert.equal(shiftCalendarMonth('2026-02-29', 1), null);
});
test('Given月份 When构建周一开头日历 Then42格及相邻日期完整且可定位', () => {
  const days = calendarDays('2028-02');
  assert.equal(days.length, 42); assert.equal(calendarWeekday(days[0]!.date), 0);
  assert.equal(days.filter(day => day?.inMonth).length, 29);
  assert.equal(new Set(days.map(day => day?.date)).size, 42);
  assert.equal(calendarDays('0001-01').filter(day => day?.inMonth).length, 31);
  assert.equal(calendarDays('9999-12').filter(day => day?.inMonth).length, 31);
  assert.throws(() => calendarDays('2026-13'));
});
test('Given旧文档无列宽或新版宽度 When解析 Then兼容旧数据拒绝非法宽度并独立复制', () => {
  const original = fixture(); delete block(original).columns[2].width;
  assert.deepEqual(parseProjectContent(original), original);
  for (const width of [112, 640]) { block(original).columns[0].width = width; assert.equal(block(parseProjectContent(original)).columns[0].width, width); }
  for (const width of [111, 641, 160.5, NaN, Infinity]) { block(original).columns[0].width = width; assert.throws(() => parseProjectContent(original)); }
  assert.deepEqual([columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(63)], ['A', 'Z', 'AA', 'BL']);
  assert.equal(clampColumnWidth(4), 112); assert.equal(clampColumnWidth(3000), 640);
  assert.equal(columnWidth({ id: id(4), name: '日期', kind: 'date' }), 184);
});
test('Given一镜头行和独立日期标签 When排序插入行列 ThenID原数据宽度不变且不改变交付语义', () => {
  const p = fixture(), original = structuredClone(block(p));
  const rows = reorderList(original, 'row', id(7), id(8), true);
  assert.deepEqual(rows.rows.map(row => row.id), [id(8), id(7)]);
  assert.deepEqual(rows.rows[1], original.rows[0]);
  const columns = reorderList(rows, 'column', id(6), id(4), false);
  assert.equal(columns.columns[0].id, id(6)); assert.equal(columns.columns[0].width, 240);
  assert.deepEqual(columns.rows, rows.rows);
  assert.deepEqual(block(p), original);
  assert.equal(deriveDeliveries([{ ...p, blocks: [columns] }]).find(item => item.rowId === id(7))!.dueDate, '2028-02-29');
  assert.equal(deriveDeliveries([{ ...p, blocks: [columns] }]).length, 2);
  const added = insertListColumn(insertListRow(columns, id(9), id(7), false), id(10), id(6));
  assert.deepEqual(added.rows.map(row => row.id), [id(8), id(9), id(7)]);
  assert.equal(added.columns[1].kind, 'text');
  assert.deepEqual(added.rows[2].cells, original.rows[0].cells);
  assert.throws(() => insertListRow(added, id(9))); assert.throws(() => insertListColumn(added, id(10)));
  assert.throws(() => insertListRow(added, id(11), id(99)));
  const deleted = deleteColumn({ ...p, blocks: [columns] }, id(3), id(6));
  assert.deepEqual(block(restoreUndo(deleted.content, deleted.undo)), columns);
});
