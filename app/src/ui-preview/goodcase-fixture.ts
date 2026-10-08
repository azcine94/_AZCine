import { GoodcaseStore } from '../goodcase-store.ts';
import type { GoodcaseFavorites } from '../goodcase-store.ts';
import type { GoodcaseCategory,GoodcaseSort,GoodcaseItem,GoodcaseSnapshot,GoodcaseRanking } from '../goodcase-types.ts';
import { categoryNames } from '../goodcase-types.ts';
import { attachmentImageData } from './data.ts';

// Explicit fictional UI data. No GoodCase requests, desktop IPC, or real favorites.
export function goodcaseFixture(mode:string){
  const categories=Object.keys(categoryNames) as GoodcaseCategory[],sorts:GoodcaseSort[]=['heat','stability','latest'];
  const image=`data:image/png;base64,${attachmentImageData}`;
  function item(category:GoodcaseCategory,index:number):GoodcaseItem{return {
    slug:`fixture-${category}-${index}`,category,title:`虚构${categoryNames[category]}作品 ${index+1}${mode==='long'?' · 用于核对标题截断与卡片等高的长标题'.repeat(7):' · 空间与光的练习'}`,
    mediaType:category==='video'||category==='hardware'?'video':'image',posterUrl:mode==='works-media-error'?'':image,
    creator:'UI 虚构创作者',source:'虚构来源',model:'演示模型',recommendedModels:['演示模型'],sourceHeatScore:85-index,
    stabilityScore:92,createdAt:'2026-10-09T01:00:00+08:00',summary:'明确标注的 UI 示例，不代表真实作品或模型结果。',promptPreview:'虚构提示词摘要。',
    promptFull:'Fictional UI example. Describe a quiet room with soft light.\n'.repeat(mode==='works-detail-long'?200:5),
    promptTranslationZh:mode==='works-translation-missing'?'':'虚构中文译文：用柔和的光描绘一间安静的房间。\n'.repeat(mode==='works-detail-long'?200:5),
    sourceUrl:'https://goodcase.ai',retest:{total:3,reproduced:2},provenance:{verifiedAgainstSource:true},
  };}
  function page(category:GoodcaseCategory,sort:GoodcaseSort,page:number):GoodcaseRanking{
    const total=mode==='empty'?0:category==='hardware'?10:72,start=(page-1)*24;
    return {category,sort,page,total,hasMore:start+24<total,url:'https://goodcase.ai',items:Array.from({length:Math.max(0,Math.min(24,total-start))},(_,i)=>item(category,start+i))};
  }
  const rankings={} as GoodcaseSnapshot['rankings'];for(const c of categories){rankings[c]={} as Record<GoodcaseSort,GoodcaseRanking>;for(const s of sorts)rankings[c][s]=page(c,s,1);}
  const cases=categories.flatMap(c=>rankings[c].heat.items);
  const groups=categories.map(c=>({key:c,label:`虚构${categoryNames[c]}榜`,rows:rankings[c].heat.items.slice(0,5).map(x=>({media:x,href:`/cases/${x.slug}`,subline:'虚构来源记录'}))}));
  const info=categories.map(c=>({title:`虚构${categoryNames[c]}方法`,category:c,url:`https://goodcase.ai/models/fixture-${c}`,text:`${categoryNames[c]}虚构${categoryNames[c]}方法12 个案例`,summary:'仅用于展示原型布局的虚构说明。',posterUrl:image}));
  const snapshot:GoodcaseSnapshot={capturedAt:'2026-10-09T01:00:00+08:00',heat:groups,stability:groups,weekly:cases.filter((_,i)=>i%5===0),models:mode==='empty'?[]:info,skills:mode==='empty'?[]:info,creators:mode==='empty'?[]:info,dailyCases:cases.slice(0,6),cases,rankings};
  let favorites:GoodcaseFavorites={revision:0,items:mode==='empty'?[]:cases.slice(0,3)};
  const older={...snapshot,capturedAt:'2026-10-08T19:00:00+08:00'};
  const archived=new Map([['fixture-current',snapshot],['fixture-previous',older]]);
  let history=Array.from(archived,([id,value])=>({id,capturedAt:value.capturedAt,itemCount:value.cases.length}));
  const wait=async()=>new Promise<void>(resolve=>setTimeout(resolve,450));
  const store=new GoodcaseStore({
    collect:async()=>{await wait();if(mode==='error')throw Error('虚构更新失败，旧内容保留');return snapshot;},
    ranking:async(c,s,p)=>{await wait();if(mode==='works-page-error')throw Error('虚构下一页读取失败');return page(c,s,p);},
    detail:async slug=>{await wait();if(mode==='works-detail-error')throw Error('虚构详情读取失败');return cases.find(x=>x.slug===slug)!;},
    retests:async()=>{await wait();return {count:1,byModel:[{model:'虚构模型',latest:{verdict:'reproduced',finalScore:88,testedAt:'2026-10-09'}}]};},
    favorites:async()=>favorites,
    save:async(x,saved,revision)=>{await wait();if(mode==='works-favorite-error')throw Error('虚构收藏保存失败');favorites={revision:revision+1,items:saved?[...favorites.items.filter(v=>v.slug!==x.slug),x]:favorites.items.filter(v=>v.slug!==x.slug)};return favorites;},
    history:async()=>history,
    readSnapshot:async id=>{await wait();const saved=archived.get(id);if(!saved)throw Error('虚构快照不存在');return saved;},
    saveSnapshot:async value=>{await wait();if(mode==='works-snapshot-error')throw Error('虚构快照写入失败');const id=`fixture-${history.length}`,entry={id,capturedAt:value.capturedAt,itemCount:value.cases.length};archived.set(id,value);history=[entry,...history];return entry;},
  });
  store.start=()=>{};
  const listing=Object.fromEntries(categories.flatMap(c=>sorts.map(s=>[`${c}:${s}`,{...rankings[c][s],pending:false,error:mode==='works-page-error'?'虚构下一页失败':''}])));
  const selected=cases[0];
  store.patch({snapshot:mode==='loading'?null:snapshot,rankings:mode==='loading'?{}:listing,items:Object.fromEntries(cases.map(x=>[x.slug,x])),favorites,favoritesLoaded:true,
    category:mode==='works-image'?'image':mode==='works-web'?'web':mode==='works-hardware'?'hardware':'video',
    view:mode==='works-models'?'models':mode==='works-skills'?'skills':mode==='works-creators'?'creators':mode==='works-daily'?'daily':mode==='works-favorites'?'favorites':'rankings',
    sort:mode==='works-overview'?'overview':mode==='works-stability'?'stability':mode==='works-latest'?'latest':'heat',
    refreshing:mode==='loading'||mode==='works-refresh',error:mode==='error'?'虚构网络错误，旧内容保留':'',
    detailLoaded:selected?{[selected.slug]:mode!=='works-detail-error'}:{},detailErrors:mode==='works-detail-error'&&selected?{[selected.slug]:'虚构详情失败，已保留摘要'}:{},
    favoritesError:mode==='works-favorite-error'?'虚构收藏保存失败，旧收藏保留':'',
    history,historyError:mode==='works-snapshot-error'?'本次作品已读取，但快照未能保存。虚构存储错误':'',restoring:mode==='works-restore',
  });
  if(mode==='works-history')store.patch({snapshot:older,selectedSnapshotId:'fixture-previous'});
  return {store,detailSlug:selected&&['works-detail','works-detail-long','works-detail-error','works-translation-missing','works-media-error','works-favorite-error'].includes(mode)?selected.slug:undefined};
}
