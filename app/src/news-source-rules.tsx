import { useId, useState } from 'react';
import { Button } from './components/ui/button.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import { Input } from './components/ui/input.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table.tsx';
import type { NewsSource } from './news-contract.ts';
import type { SourceRule } from './news-reader-contract.ts';

const tiers: Record<SourceRule['tier'], string> = {
  T1: 'T1 · 官方 / 一手（60）',
  T1_5: 'T1.5 · 中间档（65）',
  T2: 'T2 · 媒体 / 二手（76）',
  EXCLUDE_MP: 'EXCLUDE_MP · 不参与精选评分',
};
const pageSize = 8;

export function NewsSourceRules({ sources, rule, onChange }: {
  sources: NewsSource[];
  rule: (source: NewsSource) => SourceRule;
  onChange: (source: NewsSource, patch: Partial<SourceRule>) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(0);
  const filtered = sources.filter(source => source.config.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (!tier || rule(source).tier === tier));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return <section className="news-source-rules" aria-labelledby={`${id}-title`}>
    <div className="news-preferences-section-heading"><h3 id={`${id}-title`}>信源等级与正文</h3><span className="meta">{filtered.length} / {sources.length} 个信源</span></div>
    <p className="meta">补取正文：订阅缺正文时读取公开原始页面。展示正文：在阅读页显示已取得正文。排除评分的信源仅展示导读。</p>
    <div className="news-source-rules-filter">
      <Input variant="app" type="search" aria-label="搜索信源名称" placeholder="搜索信源名称" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <NativeSelect variant="app" aria-label="筛选来源档位" value={tier} onChange={event => { setTier(event.target.value); setPage(0); }}>
        <option value="">全部档位</option>{Object.entries(tiers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </NativeSelect>
    </div>
    {!!visible.length && <Table className="table-fixed" containerProps={{ className: 'news-source-rules-table' }}>
      <colgroup><col style={{ width: '32%' }} /><col style={{ width: '44%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /></colgroup>
      <TableHeader><TableRow>
        <TableHead scope="col" className="whitespace-normal py-3">信源</TableHead>
        <TableHead scope="col" className="whitespace-normal py-3">来源档位</TableHead>
        <TableHead scope="col" className="whitespace-normal py-3 text-center">补取正文</TableHead>
        <TableHead scope="col" className="whitespace-normal py-3 text-center">展示正文</TableHead>
      </TableRow></TableHeader>
      <TableBody>{visible.map(source => {
        const current = rule(source);
        return <TableRow key={source.config.id}>
          <TableCell className="whitespace-normal py-3 [overflow-wrap:anywhere] font-medium">{source.config.name}</TableCell>
          <TableCell className="py-3"><NativeSelect variant="app" aria-label={`${source.config.name}的来源档位`} value={current.tier} onChange={event => onChange(source, { tier: event.target.value as SourceRule['tier'] })}>
            {Object.entries(tiers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </NativeSelect></TableCell>
          <TableCell className="text-center py-3"><Checkbox aria-label={`${source.config.name}订阅缺正文时补取公开原始页面`} checked={current.fetchBody} onCheckedChange={checked => onChange(source, { fetchBody: checked === true })} /></TableCell>
          <TableCell className="text-center py-3"><Checkbox aria-label={`${source.config.name}在阅读页展示可用正文`} checked={current.displayBody && current.tier !== 'EXCLUDE_MP'} disabled={current.tier === 'EXCLUDE_MP'} onCheckedChange={checked => onChange(source, { displayBody: checked === true })} /></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>}
    {!visible.length && <EmptyState><p>{sources.length ? '没有符合条件的信源。' : '添加信源后可设置来源档位与正文展示方式。'}</p>{sources.length > 0 && <Button variant="ghost" type="button" onClick={() => { setQuery(''); setTier(''); setPage(0); }}>清除筛选</Button>}</EmptyState>}
    {filtered.length > 0 && <nav className="news-pager" aria-label="信源规则分页">
      <Button variant="outline" size="sm" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button>
      <span className="meta" aria-live="polite">第 {currentPage + 1} / {pages} 页 · 每页 {pageSize} 条</span>
      <Button variant="outline" size="sm" type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</Button>
    </nav>}
  </section>;
}
