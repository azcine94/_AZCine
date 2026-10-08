import { createContext, useContext, useState } from 'react';
import type { MouseEvent } from 'react';
import { EmptyState } from './components/ui/empty-state.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { UILink } from './components/ui/ui-link.tsx';
import { LoadingStatus } from './components/ui/loading-status.tsx';
import { invoke, isTauri } from './desktop-api.ts';
import { useHotTopics } from './aihot-hot-topics.ts';
import type { HotTopicsState } from './aihot-hot-topics.ts';

export const TodayHotTopicsPreview = createContext<HotTopicsState | undefined>(undefined);
export function TodayNewsPanel() {
  const preview = useContext(TodayHotTopicsPreview);
  const isPreview = document.documentElement.dataset.uiPreview === 'true';
  const live = useHotTopics(!isPreview && !preview);
  const model = preview ?? live;
  const [openError,setOpenError] = useState('');
  function open(event:MouseEvent<HTMLAnchorElement>,url:string) {
    if (isPreview) { event.preventDefault(); return; }
    if (!isTauri()) return;
    event.preventDefault(); setOpenError('');
    void invoke('open_news_url',{url}).catch(() => setOpenError('无法打开热点链接，请右键复制链接后在浏览器查看。'));
  }
  return <div className="today-hot-topics" aria-busy={model.loading}>
    <header className="card-heading"><div className="today-hot-heading"><h2>当前热点 Top 10</h2><span className="meta" title="来源 AIHOT，每 5 分钟自动更新">{model.checkedAt ? `${new Date(model.checkedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 更新` : 'AIHOT'}</span><LoadingStatus active={model.loading} delayMs={200}>更新中…</LoadingStatus></div><UILink variant="plain" href="https://aihot.news/hot" target="_blank" rel="noopener noreferrer" onClick={event=>open(event,'https://aihot.news/hot')}>AIHOT ↗</UILink></header>
    {(model.error||openError)&&<Feedback as="p" tone="error" role="alert">{openError||model.error}{model.error&&model.loaded?' 上次读取的榜单已保留。':''}</Feedback>}
    {model.items.length>0?<ol className="today-hot-list" aria-label="AIHOT 当前热点排名">{model.items.map(item=><li key={item.id}>
      <span className="today-hot-rank" aria-label={`第 ${item.rank} 名`}>{String(item.rank).padStart(2,'0')}</span>
      <div className="today-hot-content"><UILink variant="plain" href={item.url} title={item.title} target="_blank" rel="noopener noreferrer" onClick={event=>open(event,item.url)}>{item.title}</UILink><span className="meta" title={item.source}>{item.sourceCount} 个来源{item.source ? ` · ${item.source}` : ''}</span></div>
    </li>)}</ol>:!model.loading&&<EmptyState as="div"><p>{model.loaded?'AIHOT 当前暂无热点。':model.error?'热点榜暂未读到。':'正在连接 AIHOT…'}</p></EmptyState>}
  </div>;
}
