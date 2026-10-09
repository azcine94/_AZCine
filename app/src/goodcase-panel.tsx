import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Play } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { NativeSelect } from './components/ui/native-select.tsx';
import { Card } from './components/ui/card.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { GoodcaseLink } from './goodcase-shared.tsx';
import { GoodcaseDetail } from './goodcase-detail.tsx';
import { goodcaseImage, rankingRoute } from './goodcase-source.ts';
import { GoodcaseStore, goodcaseStore, useGoodcase } from './goodcase-store.ts';
import { categoryNames } from './goodcase-types.ts';
import type { GoodcaseCategory, GoodcaseSort, GoodcaseItem, GoodcaseGroup, GoodcaseInfo } from './goodcase-types.ts';

export const GoodcasePreview=createContext<{store:GoodcaseStore;detailSlug?:string}|null>(null);
const views=[['rankings','排行榜'],['models','模型覆盖'],['skills','Skills'],['creators','创作者'],['daily','早报'],['favorites','收藏']] as const;
const sorts=[['heat','热度'],['stability','稳定度'],['latest','最新'],['overview','榜单总览']] as const;
function Empty({children='当前筛选下没有内容'}:{children?:ReactNode}){return <EmptyState className="gc-empty"><h2>{children}</h2><p>可更换筛选，或到原站查看。</p></EmptyState>;}
function Cover({src,className}:{src:string;className?:string}){const [bad,setBad]=useState(false);return src&&!bad?<img className={className} src={src} alt="" loading="lazy" decoding="async" onError={()=>setBad(true)}/>:null;}
const score=(x:GoodcaseItem,type:GoodcaseSort)=>type==='latest'?(x.createdAt?.slice(0,10)||'—'):type==='stability'?((x.stabilityScore??0)>0?x.stabilityScore+'%':'—'):(x.currentHeatScore??x.sourceHeatScore??'—');
const models=(x:GoodcaseItem)=>(x.recommendedModels||[x.model]).filter(Boolean).join(' / ');
function RankCard({item,index,type,onOpen}:{item:GoodcaseItem;index:number;type:GoodcaseSort;onOpen:(x:GoodcaseItem,trigger:HTMLElement)=>void}){
  const video=item.mediaType==='video',source=[type==='stability'?models(item):item.creator,item.source].filter(Boolean).join(' · ')||'来源见详情',cover=goodcaseImage(item);
  return <Button variant="app-content" className="gc-rank-card" onClick={e=>onOpen(item,e.currentTarget)} aria-label={`第 ${index+1} 名，${item.title}，打开${video?'视频':'作品'}预览`}>
    <span className="gc-rank-card-cover"><span className="gc-rank-card-placeholder"><span>{video?'视频作品':'作品预览'}</span><span>封面暂不可用 · 点击查看详情</span></span><Cover key={cover} src={cover}/><span className="gc-rank-card-number">{String(index+1).padStart(2,'0')}</span><span className="gc-rank-card-kind">{categoryNames[item.category]}</span>{video&&<span className="gc-rank-card-play" aria-hidden="true"><Play/></span>}</span>
    <span className="gc-rank-card-body"><span className="gc-rank-card-title">{item.title}</span><span className="gc-rank-card-meta"><span className="gc-rank-card-source" title={source}>{source}</span><span className="gc-rank-card-score"><small>{type==='latest'?'收录':type==='stability'?'稳定分':'热度'}</small>{score(item,type)}</span></span>{type==='stability'&&<span className="gc-rank-card-retest">{item.retest?.total?`人工复现 ${item.retest.reproduced} / ${item.retest.total}`:'人工复现次数：原站未提供'}</span>}</span>
  </Button>;
}
function Board({type,groups,category,query,onMode,onOpen,items}:{type:'heat'|'stability';groups:GoodcaseGroup[];category:GoodcaseCategory;query:(x:GoodcaseItem)=>boolean;onMode:()=>void;onOpen:(x:GoodcaseItem,t:HTMLElement)=>void;items:Record<string,GoodcaseItem>}){
  const [selected,setSelected]=useState(type==='heat'?'x':'seedance-2');
  const filtered=groups.map(g=>({...g,rows:g.rows.filter(r=>r.media.category===category)})).filter(g=>g.rows.length);
  const group=filtered.find(g=>g.key===selected)||filtered[0];if(!group)return null;
  const rows=group.rows.map((r,index)=>({...r,index,media:{...items[r.media.slug],...r.media}})).filter(r=>query(r.media));
  return <section className="gc-board"><header className="gc-board-heading"><div><p className="gc-eyebrow">{type==='heat'?'POPULARITY':'STABILITY / BETA'}</p><h2>{type==='heat'?'分平台热度榜':'分模型稳定榜'}</h2></div><Button variant="app-quiet" onClick={onMode}>完整榜单 →</Button></header><div className="gc-chips">{filtered.map(g=><Button variant="app-choice-chip" key={g.key} aria-pressed={group.key===g.key} onClick={()=>setSelected(g.key)}>{g.label}</Button>)}</div>{rows.length?rows.map(({media:x,index,subline})=><Button variant="app-content" className="gc-rank-row" key={x.slug} onClick={e=>onOpen(x,e.currentTarget)}><span className="gc-rank-num">{String(index+1).padStart(2,'0')}</span><span className="gc-rank-image"><Cover key={goodcaseImage(x)} src={goodcaseImage(x)}/></span><span><span className="gc-rank-title">{x.title}</span><span className="gc-rank-sub">{subline||(type==='stability'?models(x):x.creator||x.source)}{type==='stability'?` · 复现 ${x.retest?.total?x.retest.reproduced+'/'+x.retest.total:'—'}`:''}</span></span><span className="gc-rank-score">{score(x,type)}<small>{type==='heat'?'热度':'稳定分'}</small></span></Button>):<Empty/>}<footer className="gc-board-foot">官网首页小榜单中的{categoryNames[category]}作品，保留原站顺序。<br/><GoodcaseLink href={rankingRoute(category,type,1)}>查看原站完整榜单 ↗</GoodcaseLink></footer></section>;
}
export function GoodcasePanel({root}:{root:string}){
  const preview=useContext(GoodcasePreview);
  // UI preview always supplies a fixture store; never fall back to live networking.
  if(document.documentElement.dataset.uiPreview==='true'&&!preview)return <Empty>作品预览数据未提供</Empty>;
  return <GoodcasePage key={root} store={preview?.store||goodcaseStore(root)} initialDetail={preview?.detailSlug}/>;
}
function GoodcasePage({store,initialDetail}:{store:GoodcaseStore;initialDetail?:string}){
  const state=useGoodcase(store),{category,view,sort,query,snapshot}=state;
  const [current,setCurrent]=useState<string|null>(initialDetail||null),trigger=useRef<HTMLElement|null>(null);
  const scroll=useRef<HTMLDivElement>(null),marker=useRef<HTMLDivElement>(null),page=state.rankings[`${category}:${sort}`];
  const scrollKey=`${state.selectedSnapshotId}:${category}:${view}:${sort}:${query}`;
  useLayoutEffect(()=>{
    const node=scroll.current;if(!node)return;
    node.scrollTop=store.scrollPositions.get(scrollKey)||0;
    const remember=()=>store.scrollPositions.set(scrollKey,node.scrollTop);
    node.addEventListener('scroll',remember,{passive:true});
    return()=>{remember();node.removeEventListener('scroll',remember);};
  },[store,scrollKey]);
  useEffect(()=>{
    if(view!=='rankings'||sort==='overview'||query.trim()||state.restoring||state.historyPending||state.selectedSnapshotId||state.refreshing||!page?.hasMore||page.pending||page.error||!marker.current)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting)){observer.disconnect();void store.loadNext(category,sort);}},{root:scroll.current,rootMargin:'400px'});
    observer.observe(marker.current);return()=>observer.disconnect();
  },[category,view,sort,query,page,state.refreshing,state.restoring,state.historyPending,state.selectedSnapshotId,store]);
  function open(item:GoodcaseItem,target:HTMLElement){trigger.current=target;if(!state.items[item.slug])store.patch({items:{...state.items,[item.slug]:item}});setCurrent(item.slug);void store.loadDetail(item.slug);}
  const q=query.trim().toLocaleLowerCase();
  function matches(x:GoodcaseItem|GoodcaseInfo){return x.category===category&&(!q||[x.title,x.text,x.summary,'creator' in x?x.creator:'','recommendedModels' in x?x.recommendedModels?.join(' '):''].join(' ').toLocaleLowerCase().includes(q));}
  const merged=(x:GoodcaseItem)=>state.selectedSnapshotId?({...state.items[x.slug],...x}):({...x,...state.items[x.slug]});
  const cardList=(items:GoodcaseItem[],type:GoodcaseSort='heat')=>{const list=items.map((x,index)=>({x:merged(x),index})).filter(({x})=>matches(x));return <div className="gc-ranking-grid">{list.length?list.map(({x,index})=><RankCard key={x.slug} item={x} index={index} type={type} onOpen={open}/>):<Empty>{state.restoring&&!snapshot?'正在恢复上次快照…':state.refreshing&&!snapshot?'正在读取作品…':'当前没有匹配的作品'}</Empty>}</div>;};
  let content:ReactNode;
  if(view==='rankings'){
    content=<><nav className="gc-subtabs" aria-label="榜单排序">{sorts.map(([id,label])=><Button variant="app-choice-chip" key={id} aria-pressed={sort===id} onClick={()=>store.navigate({sort:id})}>{label}</Button>)}</nav>{sort==='overview'?<><div className="gc-section-head"><div><h2>{categoryNames[category]} · 本周精选</h2><p className="gc-small gc-muted">官网首页精选，按当前分类展示</p></div></div><div className="gc-weekly">{snapshot?.weekly.filter(x=>matches(merged(x))).length?snapshot.weekly.filter(x=>matches(merged(x))).map((item,index)=><Button variant="app-content" className="gc-weekly-card" key={item.slug} onClick={e=>open(merged(item),e.currentTarget)}><span className="gc-thumb"><Cover key={goodcaseImage(item)} src={goodcaseImage(item)}/><span className="gc-weekly-rank">{String(index+1).padStart(2,'0')}</span></span><h3>{item.title}</h3><p className="gc-small gc-muted">{item.text?.match(/本周\s*\d+\s*人看过/)?.[0]||'站内一周热度'}</p></Button>):<Empty>本周精选暂无该分类作品</Empty>}</div><div className="gc-boards">{(['heat','stability'] as const).map(type=><Board key={type} type={type} groups={snapshot?.[type]||[]} category={category} query={matches} items={state.items} onMode={()=>store.navigate({sort:type})} onOpen={open}/>)}</div></>:<><div className="gc-section-head"><div><h2>{categoryNames[category]} · {{heat:'热度排行',stability:'稳定度排行',latest:'最新作品'}[sort]}</h2><p className="gc-small gc-muted">已加载 {page?.items.length||0}{page?` / 共 ${page.total}`:''} 条 · 按原站顺序{q?' · 搜索已加载作品':''}</p></div><GoodcaseLink className="gc-overview-link" href={rankingRoute(category,sort,1)}>原站完整列表 ↗</GoodcaseLink></div>{cardList(page?.items||[],sort)}<div ref={marker} className="gc-ranking-load" role="status"><p>{state.selectedSnapshotId?'历史快照仅展示当次采集的作品，返回最新内容可继续加载。':page?.error?'加载失败，已保留当前作品。':page?.pending?'正在读取下一批作品…':page&&!page.hasMore?'已加载全部作品':page?'向下滚动继续加载':''}</p>{page?.hasMore&&!state.selectedSnapshotId&&<Button variant="app-pill" disabled={page.pending||state.refreshing||state.restoring||state.historyPending} onClick={()=>void store.loadNext()} loading={page.pending} loadingText="加载中…">{page.error?'重试加载':'加载更多'}</Button>}{page?.error&&<p className="gc-error">{page.error}</p>}</div></>}</>;
  }else if(view==='models'){
    const list=snapshot?.models.filter(matches)||[];
    content=<><div className="gc-section-head"><div><h2>模型 · 案例覆盖</h2><p className="gc-small gc-muted">统计已发布作品的模型覆盖，不代表模型能力排名。</p></div><GoodcaseLink className="gc-overview-link" href="/models">原站模型页 ↗</GoodcaseLink></div><div className="gc-cards">{list.length?list.map(x=><Card key={x.url} className="gc-info-card gap-3 p-5"><span className="gc-eyebrow">{categoryNames[category]}</span><h3>{x.title}</h3><div className="gc-model-count">{x.text.slice(x.text.indexOf(x.title)+x.title.length).match(/(\d+)\s*个案例/)?.[1]||'—'}<small>个已发布作品</small></div><GoodcaseLink className="gc-card-link" href={x.url}>查看模型作品 ↗</GoodcaseLink></Card>):<Empty/>}</div></>;
  }else if(view==='skills'||view==='creators'){
    const list=snapshot?.[view].filter(matches)||[];
    content=<><div className="gc-section-head"><div><h2>{view==='skills'?'从作品里沉淀的方法':'值得关注的创作者'}</h2><p className="gc-small gc-muted">{list.length} 条来源记录 · {view==='skills'?'查看原站方法说明与下载':'当前分类创作者，保留原站顺序'}</p></div><GoodcaseLink className="gc-overview-link" href={`/${view}`}>原站完整列表 ↗</GoodcaseLink></div><div className="gc-cards">{list.length?list.map(x=><Card key={x.url} className="gc-info-card gap-3 p-5">{x.posterUrl&&<div className="gc-thumb"><Cover key={goodcaseImage(x)} src={goodcaseImage(x)}/></div>}<h3>{x.title}</h3><p>{x.summary}</p>{view==='skills'&&<span className="gc-small gc-muted">{x.text.match(/\d+ Cases[^→]*/)?.[0]||'原站收录'}</span>}<GoodcaseLink className="gc-card-link" href={x.url}>{view==='skills'?'查看 Skill / 下载 ↗':'查看创作者 ↗'}</GoodcaseLink></Card>):<Empty/>}</div></>;
  }else if(view==='daily')content=<><div className="gc-section-head"><div><h2>今日{categoryNames[category]}精选</h2><p className="gc-small gc-muted">GoodCase 早报中的{categoryNames[category]}作品</p></div></div>{cardList(snapshot?.dailyCases||[])}</>;
  else content=<><div className="gc-section-head"><h2>我的收藏</h2><span className="gc-small gc-muted">保存在本机，不同步原站账号</span></div>{cardList(state.favorites.items)}</>;
  return <div className="goodcase"><header className="gc-page-head"><div className="gc-page-intro"><div><h1>AI 作品</h1><p className="gc-page-sub">看作品、读提示词，发现值得复用的方法。</p></div><GoodcaseLink variant="pill" href="https://goodcase.ai/#rankings">GoodCase 原站 ↗</GoodcaseLink></div><nav className="gc-category-tabs" aria-label="作品分类">{(Object.entries(categoryNames) as [GoodcaseCategory,string][]).map(([id,label])=><Button variant="app-choice-chip" key={id} aria-pressed={category===id} onClick={()=>store.navigate({category:id,query:''})}>{label}</Button>)}</nav><nav className="gc-tabs" aria-label="内容栏目">{views.map(([id,label])=><Button variant="app-underline-tab" key={id} aria-pressed={view===id} onClick={()=>store.navigate({view:id,query:''})}>{label}{id==='favorites'&&(state.favorites.items.filter(x=>x.category===category).length||'')}</Button>)}</nav></header>
    <div className="gc-toolbar"><Input variant="app" value={query} onChange={e=>store.navigate({query:e.target.value})} aria-label="搜索当前栏目" placeholder={view==='rankings'?`搜索已加载的${categoryNames[category]}作品…`:'搜索当前栏目…'}/><label className="gc-history"><span>快照历史</span><NativeSelect variant="app" aria-label="快照历史" value={state.selectedSnapshotId} disabled={state.restoring||state.refreshing||state.historyPending} onChange={e=>{setCurrent(null);void store.selectSnapshot(e.target.value);}}><option value="">最新内容</option>{state.history.map(entry=><option key={entry.id} value={entry.id}>{new Date(entry.capturedAt).toLocaleString('zh-CN')} · {entry.itemCount} 条</option>)}</NativeSelect></label><Button variant="app-quiet" disabled={state.refreshing||state.restoring||state.historyPending} onClick={()=>{setCurrent(null);void store.refresh();}}>↻ 更新内容</Button></div>
    <div className={`gc-status${state.error?' gc-error':''}`} role="status">{state.error?`更新失败，保留上次内容。${state.error}`:state.restoring?'正在恢复上次本地快照…':state.historyPending?'正在读取历史快照…':state.refreshing?'正在更新四类榜单、Skills 与早报，现有内容保持可见…':snapshot?`原站内容快照 · ${new Date(snapshot.capturedAt).toLocaleString('zh-CN')} · ${state.selectedSnapshotId?'历史记录':'启动时自动更新'} · 保留原站排序`:''}</div>
    {state.historyError&&<div className="gc-favorite-error gc-error" role="alert">{state.historyError}</div>}
    {state.favoritesError&&!current&&<div className="gc-favorite-error" role="alert">{state.favoritesError}<Button variant="app-quiet" disabled={state.favoritesPending} onClick={()=>void store.loadFavorites()}>重新读取收藏</Button></div>}
    <div className="gc-scroll" ref={scroll} aria-label="AI 作品内容" tabIndex={0}>{content}<footer className="gc-footer">内容来自 <GoodcaseLink href="https://goodcase.ai">GoodCase.ai ↗</GoodcaseLink> · 保留原站标题、顺序和作者出处。</footer></div>
    {current&&state.items[current]&&<GoodcaseDetail key={current} item={state.items[current]} state={state} store={store} trigger={trigger.current} onClose={()=>setCurrent(null)}/>}
  </div>;
}
