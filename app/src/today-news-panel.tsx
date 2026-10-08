import { EmptyState } from './components/ui/empty-state.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import type { NewsReaderController } from './use-news-reader.ts';
import type { EditorialController } from './use-news-editorial.ts';
import {useEffect, useState} from 'react';
import {beijingDate, dailyEditions} from './news-daily.ts';

const MAX_TODAY_NEWS = 5;
export function TodayNewsPanel({reader,editorial}:{reader:Pick<NewsReaderController,'snapshot'|'loading'|'error'>;editorial:Pick<EditorialController,'snapshot'|'loading'|'loadError'>}){
  const [today,setToday]=useState(()=>beijingDate());
  useEffect(()=>{const timer=window.setInterval(()=>setToday(beijingDate()),30000);return()=>window.clearInterval(timer);},[]);
  const daily=dailyEditions(reader.snapshot?.editions??[])[0];
  const legacy=daily?undefined:editorial.snapshot?.editions.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.version-a.version)[0];
  const candidates=daily?[...daily.main,...daily.flashes].map(article=>({id:article.id,title:article.titleZh,source:article.sourceName,href:`#news/items/${article.id}`}))
    :legacy?[...legacy.overviewIds,...legacy.events.map(event=>event.id)].flatMap(id=>{const event=legacy.events.find(event=>event.id===id);return event?[{id:event.id,title:event.draft.title,source:'',href:`#news/events/${event.id}`}]:[];}):[];
  const seen=new Set<string>(),items=candidates.filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true;}).slice(0,MAX_TODAY_NEWS);
  const error=reader.error||(!daily?editorial.loadError:'');
  const loading=reader.loading||!daily&&editorial.loading;
  const editionDate=daily?.date??legacy?.date;
  const count=new Set(candidates.map(item=>item.id)).size;
  return <div className="today-news-summary" aria-busy={loading}>
    {error&&<Feedback as="p" tone="error" role="alert">{error}</Feedback>}
    {loading&&<p className="meta" role="status">正在读取资讯…</p>}
    {daily||legacy?<>
      <p className="meta">{editionDate!==today?`今日尚未生成 · 最近一期 ${editionDate}`:`${editionDate} · 今日日报`} · 共 {count} 条{count>items.length?` · 预览 ${items.length} 条`:''}{(daily?.gaps.length||legacy?.incomplete)?' · 来源覆盖有缺口':''}</p>
      {items.length?<div className="today-news-list" role="region" aria-label="最新日报看点" tabIndex={0}>
        <ul>{items.map(item=><li key={item.id}><UILink variant="text" className="foundation-link today-news-link" href={item.href}><span className="today-news-title">{item.title}</span>{item.source&&<span className="meta today-news-source">{item.source}</span>}</UILink></li>)}</ul>
      </div>:<p className="subtle">本期暂无符合规则的条目。</p>}
    </>:!loading&&<EmptyState as="div" className="foundation-empty"><h2>还没有日报</h2><p>完成资讯整理后，可在日报页生成并阅读。</p><UILink variant="text" href="#news/daily">打开日报 →</UILink></EmptyState>}
  </div>;
}
