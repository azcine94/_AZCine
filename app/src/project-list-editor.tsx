import { RecordContextMenu } from './components/ui/record-context-menu.tsx';
import { Input } from './components/ui/input.tsx';
import { Button } from './components/ui/button.tsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, FocusEvent, KeyboardEvent, PointerEvent } from 'react';
import type { ListBlock, ListColumn, ProjectContent } from './projects-contract.ts';
import { LIST_MAX_WIDTH, LIST_MIN_WIDTH } from './projects-contract.ts';
import { includeList } from './project-operations.ts';
import { columnWidth, clampColumnWidth, fitColumnWidths, insertListColumn, insertListRow, LIST_PAGE_SIZE, LIST_ROW_HEADER_WIDTH, reorderList } from './project-table-operations.ts';
import { DateInput } from './date-input.tsx';
import { ProjectStagePicker } from './project-stage-picker.tsx';
import type { ProjectStageLabelActions } from './project-stage-picker.tsx';
import { TableMenu } from './table-menu.tsx';

interface ListEditorProps {
  block: ListBlock; targetRowId?: string; labels: ProjectContent['labels'];
  labelActions: Omit<ProjectStageLabelActions, 'create'> & { create(name: string, rowId: string, columnId: string): boolean };
  disabled: boolean; locked: boolean; editingDisabled: boolean;
  update(fn: (block: ListBlock) => ListBlock, save?: boolean): boolean;
  blurSave(event: FocusEvent<HTMLElement>): void;
  remove(type: 'row' | 'column', id: string): boolean;
  commit(): void;
}
type DragItem = { kind: 'row' | 'column'; id: string };
type DropTarget = DragItem & { after: boolean };
export function ListEditor({ block, targetRowId, labels, labelActions, disabled, locked, editingDisabled, update, blurSave, remove, commit }: ListEditorProps) {
  const [pageIndex, setPageIndex] = useState(() => Math.max(0, Math.floor(block.rows.findIndex(row => row.id === targetRowId) / LIST_PAGE_SIZE)));
  const pageCount = Math.max(1, Math.ceil(block.rows.length / LIST_PAGE_SIZE));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const startIndex = currentPage * LIST_PAGE_SIZE;
  const shownRows = block.rows.slice(startIndex, startIndex + LIST_PAGE_SIZE);
  const tableRef = useRef<HTMLDivElement>(null), addRowRef = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<{ rowId: string; columnId: string } | null>(null);
  const nextFocus = useRef<{ rowId: string; columnId?: string } | null>(null);
  const dragRef = useRef<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const resize = useRef<{ columnId: string; start: number; original: number; width: number; pointerId: number; element: HTMLElement } | null>(null);
  const [preview, setPreview] = useState<{ columnId: string; width: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const widths = fitColumnWidths(block.columns, Math.max(0, containerWidth - 2), preview);
  const widthOf = (column: ListColumn) => widths[block.columns.findIndex(item => item.id === column.id)] ?? columnWidth(column);
  const tableWidth = widths.reduce((sum, width) => sum + width, LIST_ROW_HEADER_WIDTH + 2);
  const overflow = tableWidth > containerWidth + 1;
  useLayoutEffect(() => {
    const region = tableRef.current;
    if (!region) return;
    const measure = () => setContainerWidth(region.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const next = nextFocus.current;
    if (!next) return;
    const row = tableRef.current?.querySelector<HTMLElement>(`[data-row-id="${next.rowId}"]`);
    const control = next.columnId ? row?.querySelector<HTMLElement>(`[data-column-id="${next.columnId}"] input, [data-column-id="${next.columnId}"] button`) : row?.querySelector<HTMLElement>('.table-menu__trigger');
    if (control || !next.rowId || !block.rows.some(row => row.id === next.rowId)) {
      nextFocus.current = null; (control ?? addRowRef.current)?.focus({ preventScroll: true });
      control?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [block.rows, block.columns, currentPage]);
  function endResize(save: boolean) {
    const state = resize.current;
    if (!state) return;
    resize.current = null; setPreview(null);
    if (state.element.hasPointerCapture(state.pointerId)) state.element.releasePointerCapture(state.pointerId);
    if (save && state.width !== state.original && !disabled) update(current => ({ ...current, columns: current.columns.map(column => column.id === state.columnId ? { ...column, width: state.width } : column) }), true);
  }
  useEffect(() => {
    if (disabled) { dragRef.current = null; setDropTarget(null); endResize(false); }
  }, [disabled]);
  function cell(rowId: string, columnId: string, value: string, save = false) {
    update(current => ({ ...current, rows: current.rows.map(row => row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row) }), save);
  }
  function page(index: number) { setPageIndex(index); tableRef.current?.scrollTo({ top: 0 }); commit(); }
  function focusCell(rowId: string, columnId: string) {
    const targetPage = Math.floor(block.rows.findIndex(row => row.id === rowId) / LIST_PAGE_SIZE);
    if (targetPage < 0) return;
    const target = tableRef.current?.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-column-id="${columnId}"] input, [data-row-id="${rowId}"] [data-column-id="${columnId}"] button`);
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    else { nextFocus.current = { rowId, columnId }; setPageIndex(targetPage); commit(); }
  }
  function cellKeys(event: KeyboardEvent<HTMLTableElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof HTMLElement) || event.target.closest('[popover]')) return;
    const td = event.target.closest<HTMLElement>('td[data-column-id]'), rowId = td?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
    const columnId = td?.dataset.columnId;
    if (!rowId || !columnId) return;
    const row = block.rows.findIndex(item => item.id === rowId), column = block.columns.findIndex(item => item.id === columnId);
    const input = event.target instanceof HTMLInputElement && event.target.type === 'text' ? event.target : null;
    if (event.key === 'F2' && input) { event.preventDefault(); input.setSelectionRange(input.value.length, input.value.length); return; }
    let nextRow = row, nextColumn = column;
    if (event.key === 'Enter' && input) nextRow += event.shiftKey ? -1 : 1;
    else if (event.key === 'ArrowDown') nextRow++;
    else if (event.key === 'ArrowUp') nextRow--;
    else if (event.key === 'ArrowLeft' && input?.selectionStart === 0 && input.selectionEnd === 0) nextColumn--;
    else if (event.key === 'ArrowRight' && input && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) nextColumn++;
    else return;
    if (block.rows[nextRow] && block.columns[nextColumn]) { event.preventDefault(); focusCell(block.rows[nextRow].id, block.columns[nextColumn].id); }
  }
  function revealControl(event: FocusEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('[popover]')) return;
    const td = target.closest<HTMLElement>('td[data-column-id]');
    if (td?.dataset.columnId && td.closest<HTMLElement>('[data-row-id]')?.dataset.rowId) setSelection({ columnId: td.dataset.columnId, rowId: td.closest<HTMLElement>('[data-row-id]')!.dataset.rowId! });
    const region = event.currentTarget, bounds = region.getBoundingClientRect(), control = target.getBoundingClientRect();
    if (target.closest('tbody')) {
      const top = bounds.top + region.clientTop + 44, bottom = bounds.top + region.clientHeight;
      if (control.top < top) region.scrollTop += control.top - top;
      else if (control.bottom > bottom) region.scrollTop += control.bottom - bottom;
    }
    const left = bounds.left + region.clientLeft, right = left + region.clientWidth;
    if (control.left < left) region.scrollLeft += control.left - left;
    else if (control.right > right) region.scrollLeft += control.right - right;
  }
  function startDrag(event: DragEvent<HTMLElement>, kind: DragItem['kind'], id: string) {
    if (disabled) { event.preventDefault(); return; }
    dragRef.current = { kind, id }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-azcine-list', `${block.id}/${kind}/${id}`);
  }
  function clearDrag() { dragRef.current = null; setDropTarget(null); }
  function over(event: DragEvent<HTMLElement>, kind: DragItem['kind'], id: string) {
    if (disabled || dragRef.current?.kind !== kind || dragRef.current.id === id) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({ kind, id, after: kind === 'row' ? event.clientY > bounds.top + bounds.height / 2 : event.clientX > bounds.left + bounds.width / 2 });
  }
  function drop(event: DragEvent<HTMLElement>, kind: DragItem['kind'], id: string) {
    const source = dragRef.current;
    if (disabled || source?.kind !== kind || !dropTarget || dropTarget.id !== id || dropTarget.kind !== kind) return;
    event.preventDefault();
    update(current => reorderList(current, kind, source.id, id, dropTarget.after), true); clearDrag();
  }
  function move(kind: DragItem['kind'], entityId: string, offset: number) {
    const items = kind === 'row' ? block.rows : block.columns, index = items.findIndex(item => item.id === entityId);
    const neighbour = items[index + offset];
    if (neighbour) update(current => reorderList(current, kind, entityId, neighbour.id, offset > 0), true);
  }
  function insertRow(neighbour?: string, after = true) {
    const rowId = crypto.randomUUID(), index = neighbour ? block.rows.findIndex(row => row.id === neighbour) + Number(after) : block.rows.length;
    if (update(current => insertListRow(current, rowId, neighbour, after), true)) { nextFocus.current = { rowId, columnId: block.columns[0]?.id }; setPageIndex(Math.floor(index / LIST_PAGE_SIZE)); }
  }
  function deleteRow(rowId: string) {
    const index = block.rows.findIndex(row => row.id === rowId);
    if (remove('row', rowId)) nextFocus.current = { rowId: block.rows[index + 1]?.id ?? block.rows[index - 1]?.id ?? '' };
  }
  function deleteColumn(columnId: string) {
    const index = block.columns.findIndex(column => column.id === columnId);
    const focusRow = shownRows.find(row => row.id === selection?.rowId) ?? shownRows[0];
    if (remove('column', columnId)) nextFocus.current = { rowId: focusRow?.id ?? '', columnId: block.columns[index + 1]?.id ?? block.columns[index - 1]?.id };
  }
  function startResize(event: PointerEvent<HTMLElement>, column: ListColumn) {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { columnId: column.id, start: event.clientX, original: columnWidth(column), width: columnWidth(column), pointerId: event.pointerId, element: event.currentTarget };
  }
  const dropClass = (kind: DragItem['kind'], id: string) => dropTarget?.kind === kind && dropTarget.id === id ? ` table-drop-${dropTarget.after ? 'after' : 'before'}` : '';
  return <>
    <div className="form-actions list-toolbar" data-project-commit><span className="meta list-kind">表格 · {block.rows.length} 行 · {block.columns.length} 列</span><label className="check-label"><Input variant="inline" type="checkbox" checked={block.included} disabled={locked} aria-disabled={disabled} onChange={event => update(current => event.target.checked ? includeList(current) : { ...current, included: false }, true)} />参与交付汇总</label><Button variant="app-document" type="button" className="doc-button" aria-disabled={disabled} disabled={locked} onClick={() => update(current => insertListColumn(current, crypto.randomUUID()), true)}>添加列</Button></div>
    {pageCount > 1 && <nav className="form-actions list-pagination" data-project-commit aria-label={`${block.title}分页`}><span className="meta">共 {block.rows.length} 行 · 第 {currentPage + 1} / {pageCount} 页</span>{[['首页', 0], ['上一页', currentPage - 1], ['下一页', currentPage + 1], ['末页', pageCount - 1]].map(([name, index]) => <Button variant="app-pill" key={String(name)} type="button" className="pill" disabled={locked || Number(index) < 0 || Number(index) >= pageCount || Number(index) === currentPage} aria-disabled={disabled || Number(index) < 0 || Number(index) >= pageCount || Number(index) === currentPage} onClick={() => page(Number(index))}>{name}</Button>)}</nav>}
    <div ref={tableRef} className="list-scroll" role="region" aria-label={`${block.title}表格内容`} tabIndex={0} onFocusCapture={revealControl}><table className="doc-table office-table" style={{ width: '100%', minWidth: tableWidth }} onKeyDown={cellKeys}><colgroup><col style={{ width: LIST_ROW_HEADER_WIDTH }} />{block.columns.map(column => <col key={column.id} style={{ width: widthOf(column) }} />)}</colgroup><thead><tr><th className="table-corner" scope="col"><span className="visually-hidden">行号与行操作</span>#</th>{block.columns.map((column, index) => <RecordContextMenu key={column.id} copyText={column.name} actions={[{label:'左侧插入列',disabled,run:()=>{update(current=>insertListColumn(current,crypto.randomUUID(),column.id,false),true);}},{label:'右侧插入列',disabled,run:()=>{update(current=>insertListColumn(current,crypto.randomUUID(),column.id),true);}},{label:'删除列',destructive:true,disabled,run:()=>deleteColumn(column.id)}]}><th scope="col" data-column-id={column.id} className={`${selection?.columnId === column.id ? 'table-selected-header' : ''}${dropClass('column', column.id)}`} onDragOver={event => over(event, 'column', column.id)} onDrop={event => drop(event, 'column', column.id)}>
      <div className="table-column-heading"><Button variant="app-control" type="button" className="table-drag" data-project-commit draggable={!disabled} aria-disabled={disabled} aria-label={`拖动列：${column.name}`} onDragStart={event => startDrag(event, 'column', column.id)} onDragEnd={clearDrag}>⠿</Button><TableMenu label={`列操作：${column.name}`} disabled={disabled} extra={<label className="table-menu__rename">列名称<Input variant="app" id={`column-${column.id}`} className="input" value={column.name} disabled={editingDisabled} onChange={event => update(current => ({ ...current, columns: current.columns.map(item => item.id === column.id ? { ...item, name: event.target.value } : item) }))} onBlur={blurSave} /></label>} actions={[
        { name: '左侧插入列', run: () => update(current => insertListColumn(current, crypto.randomUUID(), column.id, false), true) },
        { name: '右侧插入列', run: () => update(current => insertListColumn(current, crypto.randomUUID(), column.id), true) },
        { name: '向左移动列', disabled: index === 0, run: () => move('column', column.id, -1) },
        { name: '向右移动列', disabled: index === block.columns.length - 1, run: () => move('column', column.id, 1) },
        { name: '删除列', run: () => deleteColumn(column.id) },
      ]}><span>{column.name}</span><span aria-hidden="true">⌄</span></TableMenu></div>
      <span className="table-resize" data-project-commit role="separator" aria-orientation="vertical" aria-label={`调整列宽：${column.name}`} aria-valuenow={preview?.columnId === column.id ? preview.width : columnWidth(column)} aria-valuemin={LIST_MIN_WIDTH} aria-valuemax={LIST_MAX_WIDTH} aria-disabled={disabled} tabIndex={0} onPointerDown={event => startResize(event, column)} onPointerMove={event => { const state = resize.current; if (!state || state.columnId !== column.id) return; state.width = clampColumnWidth(state.original + event.clientX - state.start); setPreview({ columnId: column.id, width: state.width }); }} onPointerUp={() => endResize(true)} onPointerCancel={() => endResize(false)} onLostPointerCapture={() => endResize(false)} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); endResize(false); return; }
        if (disabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); const width = clampColumnWidth(columnWidth(column) + (event.key === 'ArrowLeft' ? -8 : 8));
        update(current => ({ ...current, columns: current.columns.map(item => item.id === column.id ? { ...item, width } : item) }), true);
      }} />
    </th></RecordContextMenu>)}</tr></thead><tbody>{shownRows.map((row, index) => <RecordContextMenu key={row.id} copyText={block.columns.map(column=>row.cells[column.id]??'').join('\t')} actions={[{label:'上方插入行',disabled,run:()=>insertRow(row.id,false)},{label:'下方插入行',disabled,run:()=>insertRow(row.id)},{label:'删除行',destructive:true,disabled,run:()=>deleteRow(row.id)}]}><tr data-row-id={row.id} id={`row-${block.id}-${row.id}`} tabIndex={-1} className={dropClass('row', row.id)} onDragOver={event => over(event, 'row', row.id)} onDrop={event => drop(event, 'row', row.id)}><th scope="row" className={`table-row-heading${selection?.rowId === row.id ? ' table-selected-header' : ''}`}><Button variant="app-control" type="button" className="table-drag" data-project-commit draggable={!disabled} aria-disabled={disabled} aria-label={`拖动行：${startIndex + index + 1}`} onDragStart={event => startDrag(event, 'row', row.id)} onDragEnd={clearDrag}>⠿</Button><TableMenu label={`行操作：${startIndex + index + 1}`} disabled={disabled} actions={[
      { name: '上方插入行', run: () => insertRow(row.id, false) }, { name: '下方插入行', run: () => insertRow(row.id) },
      { name: '向上移动行', disabled: startIndex + index === 0, run: () => move('row', row.id, -1) }, { name: '向下移动行', disabled: startIndex + index === block.rows.length - 1, run: () => move('row', row.id, 1) },
      { name: '删除行', run: () => deleteRow(row.id) },
    ]}>{startIndex + index + 1}</TableMenu></th>{block.columns.map(column => <td key={column.id} data-column-kind={column.kind} data-column-id={column.id} data-selected={selection?.rowId === row.id && selection.columnId === column.id || undefined}>{column.kind === 'stage' ? <ProjectStagePicker labels={labels} labelActions={{ ...labelActions, create: name => labelActions.create(name, row.id, column.id) }} currentId={row.cells[column.id] || null} onChange={value => cell(row.id, column.id, value || '', true)} disabled={disabled} label={`${block.title}，${column.name}`} /> : column.kind === 'delivered' ? <label className="check-label"><Input variant="inline" type="checkbox" data-project-commit checked={row.cells[column.id] === 'true'} disabled={locked} aria-disabled={disabled} onChange={event => cell(row.id, column.id, String(event.target.checked), true)} />已交完</label> : column.kind === 'date' ? <DateInput label={`${block.title}，${column.name}`} value={row.cells[column.id] || ''} disabled={editingDisabled} selectionDisabled={disabled} onChange={(value, selected) => cell(row.id, column.id, value, !!selected)} onBlur={blurSave} /> : <Input variant="app" className="input" type="text" aria-label={`${block.title}，${column.name}`} spellCheck={false} autoComplete="off" value={row.cells[column.id] || ''} disabled={editingDisabled} onChange={event => cell(row.id, column.id, event.target.value)} onBlur={blurSave} />}</td>)}</tr></RecordContextMenu>)}</tbody></table></div>
    {!block.rows.length && <p className="project-empty">此 list 暂无内容，添加一行开始记录。</p>}
    {overflow && <p className="meta list-width-note">列较多时仅在表格容器内横向查看，不会撑开文档；可拖窄或删除不需要的列。</p>}
    <div className="list-footer"><Button variant="app-document" ref={addRowRef} type="button" className="doc-button doc-add-row" data-project-commit disabled={locked} aria-disabled={disabled} onClick={() => insertRow()}><span aria-hidden="true">＋</span>添加行</Button><span className="meta">拖动 ⠿ 排序 · 列边调宽 · Enter 换行 / F2 编辑</span></div>
  </>;
}
