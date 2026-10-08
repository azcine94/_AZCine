import { Button } from './button.tsx';
import { NativeSelect, NativeSelectOption } from './native-select.tsx';

export function recordPage(total: number, requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  const start = (page - 1) * pageSize;
  return { page, pageCount, start, end: Math.min(start + pageSize, total) };
}

/** Shared footer for bounded record lists. The caller retains page state across navigation. */
export function RecordPagination({ label, total, page, pageSize, onPageChange, onPageSizeChange }: {
  label: string; total: number; page: number; pageSize: number;
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void;
}) {
  const range = recordPage(total, page, pageSize);
  return <div className="ui-record-pagination" role="group" aria-label={`${label}分页`}>
    <span className="meta" role="status">共 {total} 条 · 当前 {total ? range.start + 1 : 0}–{range.end} 条</span>
    <div className="ui-record-pagination-actions">
      <NativeSelect size="sm" aria-label={`每页${label}数量`} value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value))}>
        {[20, 50, 100].map(size => <NativeSelectOption key={size} value={size}>每页 {size} 条</NativeSelectOption>)}
      </NativeSelect>
      <Button variant="outline" size="sm" disabled={range.page <= 1} onClick={() => onPageChange(range.page - 1)}>上一页</Button>
      <span className="meta" aria-label={`第 ${range.page} 页，共 ${range.pageCount} 页`}>{range.page} / {range.pageCount}</span>
      <Button variant="outline" size="sm" disabled={range.page >= range.pageCount} onClick={() => onPageChange(range.page + 1)}>下一页</Button>
    </div>
  </div>;
}
