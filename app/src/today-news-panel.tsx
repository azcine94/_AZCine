import { EmptyState } from './components/ui/empty-state.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import type { NewsReaderController } from './use-news-reader.ts';
import type { EditorialController } from './use-news-editorial.ts';

const MAX_TODAY_NEWS = 10;
export function TodayNewsPanel({reader,editorial}:{reader:Pick<NewsReaderController,'snapshot'|'loading'|'error'>;editorial:Pick<EditorialController,'snapshot'|'loading'|'loadError'>}){
  const daily=reader.snapshot?.editions.filter(edition=>edition.kind==='daily').sort((a,b)=>b.date.localeCompare(a.date)||b.generatedAt.localeCompare(a.generatedAt))[0];
  const legacy=daily?undefined:editorial.snapshot?.editions.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.version-a.version)[0];
  const candidates=daily?[...daily.main,...daily.flashes].map(article=>({id:article.id,title:article.titleZh,source:article.sourceName,href:`#news/items/${article.id}`}))
    :legacy?[...legacy.overviewIds,...legacy.events.map(event=>event.id)].flatMap(id=>{const event=legacy.events.find(event=>event.id===id);return event?[{id:event.id,title:event.draft.title,source:'',href:`#news/events/${event.id}`}]:[];}):[];
  const seen=new Set<string>(),items=candidates.filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;}).slice(0,MAX_TODAY_NEWS);
  const error=reader.error||(!daily?editorial.loadError:'');
  const loading=reader.loading||!daily&&editorial.loading;
  return <div className="today-news-summary" aria-busy={loading}>
    {error&&<Feedback as="p" tone="error" role="alert">{error}</Feedback>}
    {loading&&<p className="meta" role="status">正在读取资讯…</p>}
    {daily||legacy?<>
      <p className="meta">{daily?.date??legacy!.date} · 日报 · {items.length} 条{legacy?.incomplete&&' · 覆盖不完整'}</p>
      {items.length?<div className="today-news-list" role="region" aria-label="今日资讯列表" tabIndex={0}>
        <ul>{items.map(item=><li key={item.id}><UILink variant="text" className="foundation-link today-news-link" href={item.href}><span className="today-news-title">{item.title}</span>{item.source&&<span className="meta today-news-source">{item.source}</span>}</UILink></li>)}</ul>
      </div>:<p className="subtle">本期暂无符合规则的条目。</p>}
    </>:!loading&&<EmptyState as="div" className="foundation-empty"><h2>暂无资讯刊期</h2><p>采集与整理在设置的资讯管理中操作，生成后的日报在资讯页阅读。</p></EmptyState>}
  </div>;
}
