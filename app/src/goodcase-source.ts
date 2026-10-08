// Port of design/goodcase-demo.py. Keep its source routes, HTML/Flight extraction,
// four categories × three first pages, and the three-page creator scope.
import { invoke } from './desktop-api.ts';
import { categoryNames } from './goodcase-types.ts';
import type { GoodcaseCategory, GoodcaseSort, GoodcaseItem, GoodcaseInfo, GoodcaseGroup, GoodcaseRanking, GoodcaseSnapshot, GoodcaseRetests } from './goodcase-types.ts';
export const GOODCASE_ORIGIN='https://goodcase.ai';
export function goodcaseUrl(value:unknown) {
  if(typeof value!=='string'||!value.trim()||value.startsWith('$'))return '';
  try{const u=new URL(value,GOODCASE_ORIGIN);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
export function goodcaseImage(x:GoodcaseItem|GoodcaseInfo) {
  if(document.documentElement.dataset.uiPreview==='true'&&x.posterUrl?.startsWith('data:image/png;base64,'))return x.posterUrl;
  return [x.posterUrl,'thumbnailUrl' in x?x.thumbnailUrl:'','mediaType' in x&&x.mediaType==='image'?x.mediaUrl:''].map(goodcaseUrl).find(Boolean)||'';
}
const clean=(v:unknown):unknown=>typeof v==='string'&&/^\$(?:undefined|[L@][\da-f]+)$/i.test(v)?undefined:Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clean(x)])):v;
export function asItem(value:unknown):GoodcaseItem|null {
  if(!value||typeof value!=='object')return null;
  const x=clean(value) as GoodcaseItem;
  if(typeof x.slug!=='string'||!/^[a-zA-Z0-9_-]{1,300}$/.test(x.slug)||typeof x.title!=='string'||!Object.hasOwn(categoryNames,x.category))return null;
  for(const key of ['mediaType','mediaUrl','posterUrl','thumbnailUrl','url','sourceUrl','creator','source','model','summary','text','promptFull','promptPreview','promptTranslationZh','createdAt','evidenceLevel','costBand'] as const){if(typeof x[key]!=='string')delete x[key];}
  for(const key of ['currentHeatScore','sourceHeatScore','stabilityScore'] as const){if(typeof x[key]!=='number'||!Number.isFinite(x[key]))delete x[key];}
  if(x.retest&&(typeof x.retest.total!=='number'||typeof x.retest.reproduced!=='number'))delete x.retest;
  if(x.provenance)x.provenance={verifiedAgainstSource:x.provenance.verifiedAgainstSource===true};
  if(x.recommendedModels&&!Array.isArray(x.recommendedModels))x.recommendedModels=undefined;
  else if(x.recommendedModels)x.recommendedModels=x.recommendedModels.filter((v):v is string=>typeof v==='string');
  return x;
}
export function rankingRoute(category:GoodcaseCategory,sort:GoodcaseSort,page:number) {
  return `/cases?filter=${category}${sort==='heat'?'':`&sort=${sort}`}&page=${page}`;
}
const cache=new Map<string,{at:number;body:string}>();
const pending=new Map<string,Promise<string>>();
async function source(route:string,ttl=0,force=false):Promise<string> {
  const prior=cache.get(route);if(!force&&prior&&Date.now()-prior.at<ttl)return prior.body;
  const running=pending.get(route);if(running)return running;
  const request=invoke<string>('goodcase_fetch',{route}).then(body=>{cache.set(route,{at:Date.now(),body});return body;}).finally(()=>pending.delete(route));
  pending.set(route,request);return request;
}
function flight(raw:string) {
  return Array.from(raw.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g),m=>JSON.parse(m[1]) as string).join('');
}
// JSONDecoder.raw_decode equivalent: stop at the end of this JSON value,
// not at the end of the surrounding Next Flight record. Never evaluate scripts.
function jsonAt(text:string,start:number):unknown {
  while(/\s/.test(text[start]||'')&&start<text.length)start++;
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<text.length;i++){
    const c=text[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"'){quoted=false;if(depth===0)return JSON.parse(text.slice(start,i+1));}continue;}
    if(c==='"'){quoted=true;continue;}
    if(c==='{'||c==='[')depth++;
    else if(c==='}'||c===']'){if(--depth===0)return JSON.parse(text.slice(start,i+1));if(depth<0)break;}
    else if(depth===0&&/[\s,]/.test(c))return JSON.parse(text.slice(start,i));
  }
  throw Error('来源 JSON 结构变化');
}
function values(text:string,key:string) {
  const out:unknown[]=[];const re=new RegExp(`"${key}":`,'g');for(const match of text.matchAll(re)){try{out.push(jsonAt(text,match.index!+match[0].length));}catch{/* Other Flight references are not JSON objects. */}}return out;
}
function unique<T>(items:T[],key:(x:T)=>string):T[]{const seen=new Set<string>();return items.filter(x=>{const k=key(x);if(!k||seen.has(k))return false;seen.add(k);return true;});}
const cases=(raw:string)=>unique(values(flight(raw),'item').map(asItem).filter((x):x is GoodcaseItem=>!!x),x=>x.slug);
// Parse into an inert template; source scripts, iframes and media never join the live DOM.
function doc(raw:string){const t=document.createElement('template');t.innerHTML=raw;return t.content;}
const text=(n:Node|null)=>n?.textContent?.trim()||'';
function image(n:ParentNode){let src=goodcaseUrl(n.querySelector('img')?.getAttribute('src'));if(src){const u=new URL(src);if(u.pathname==='/_next/image')src=goodcaseUrl(u.searchParams.get('url'));}return src;}
function categoryOf(n:ParentNode){const labels:Record<string,string>={'AI 视频':'video','AI 图像':'image','AI 编程(UI)':'web','AI 硬件':'hardware'};for(const x of n.querySelectorAll('*')){if(labels[text(x)])return labels[text(x)];}return '';}
export function parseRanking(raw:string,category:GoodcaseCategory,sort:GoodcaseSort,page:number):GoodcaseRanking {
  const root=doc(raw),items=cases(raw).filter(x=>x.category===category);
  let count:string|undefined;
  for(const p of root.querySelectorAll('p')){const m=text(p).match(/第\s*[\d,]+\s*[–—-]\s*[\d,]+\s*条[，,]\s*共\s*([\d,]+)\s*条/);if(m){count=m[1];break;}}
  count??=text(root).match(/当前结果\s*([\d,]+)\s*案例/)?.[1];
  if(count===undefined||(+count.replaceAll(',','')>0&&!items.length))throw Error('GoodCase 榜单结构变化，已有作品已保留。');
  const total=Number(count.replaceAll(',',''));
  const hasMore=Array.from(root.querySelectorAll('a[href]')).some(a=>{const u=new URL(a.getAttribute('href')!,GOODCASE_ORIGIN);return u.pathname==='/cases'&&u.searchParams.get('filter')===category&&(u.searchParams.get('sort')||'heat')===sort&&u.searchParams.get('page')===String(page+1);});
  return {category,sort,page,items,total,hasMore,url:GOODCASE_ORIGIN+rankingRoute(category,sort,page)};
}
export async function fetchRanking(category:GoodcaseCategory,sort:GoodcaseSort,page:number){return parseRanking(await source(rankingRoute(category,sort,page),60000),category,sort,page);}
function groups(raw:string):GoodcaseGroup[][] {
  return values(flight(raw),'tabs').filter((v):v is unknown[]=>Array.isArray(v)&&v.length>0&&typeof v[0]==='object'&&v[0]!==null&&'rows' in v[0]).map(tabs=>tabs.map(value=>{
    const tab=value as {key:string;label:string;rows:{media:unknown;href:string;subline:string}[]};
    if(typeof tab.key!=='string'||typeof tab.label!=='string'||!Array.isArray(tab.rows))throw Error('GoodCase 首页榜单结构变化');
    return {key:tab.key,label:tab.label,rows:tab.rows.flatMap(row=>{const media=asItem(row.media);return media?[{media,href:goodcaseUrl(row.href),subline:typeof row.subline==='string'?row.subline:''}]:[]})};
  }));
}
export async function collectGoodcase():Promise<GoodcaseSnapshot> {
  const categories=Object.keys(categoryNames) as GoodcaseCategory[],sorts:GoodcaseSort[]=['heat','stability','latest'];
  const routes=['/','/models','/skills','/daily','/creators',...categories.flatMap(c=>sorts.map(s=>rankingRoute(c,s,1))),'/creators?page=2','/creators?page=3'];
  const pages=new Map<string,string>();let next=0;let failure:unknown;
  await Promise.all(Array.from({length:4},async()=>{while(next<routes.length&&!failure){const route=routes[next++];try{pages.set(route,await source(route,0,true));}catch(e){failure=e;}}}));
  if(failure)throw failure;
  const [heat,stability]=groups(pages.get('/')!);if(!heat||!stability)throw Error('GoodCase 首页榜单结构变化，旧内容已保留。');
  const rankings={} as GoodcaseSnapshot['rankings'];
  const all:GoodcaseItem[]=[...heat,...stability].flatMap(g=>g.rows.map(r=>({...r.media,url:r.href})));
  for(const category of categories){rankings[category]={} as Record<GoodcaseSort,GoodcaseRanking>;for(const sort of sorts){const listing=parseRanking(pages.get(rankingRoute(category,sort,1))!,category,sort,1);rankings[category][sort]=listing;all.push(...listing.items);}}
  const dailyCases=cases(pages.get('/daily')!);all.push(...dailyCases);
  const index=new Map<string,GoodcaseItem>();for(const x of all)index.set(x.slug,{...index.get(x.slug),...Object.fromEntries(Object.entries(x).filter(([,v])=>v!==null&&v!==undefined&&v!==''))} as GoodcaseItem);
  const weekly:GoodcaseItem[]=[];
  for(const n of doc(pages.get('/')!).querySelectorAll('a[href^="/cases/"]')){if(!/本周\s*\d+\s*人看过/.test(text(n)))continue;const href=n.getAttribute('href')!,slug=href.split('/').pop()!,prior=index.get(slug);if(!prior)continue;weekly.push({...prior,url:goodcaseUrl(href),title:text(n.querySelector('h3'))||prior.title,text:text(n),posterUrl:image(n)||prior.posterUrl});}
  const models:GoodcaseInfo[]=Array.from(doc(pages.get('/models')!).querySelectorAll('a[href^="/models/"]')).filter(n=>text(n.querySelector('h2'))).map(n=>({title:text(n.querySelector('h2')),text:text(n),url:goodcaseUrl(n.getAttribute('href')),category:[['视频','video'],['图像','image'],['网页','web'],['硬件','hardware']].find(([label])=>text(n).startsWith(label))?.[1]||''}));
  const skills:GoodcaseInfo[]=Array.from(doc(pages.get('/skills')!).querySelectorAll('article')).flatMap(n=>{const a=n.querySelector('h3 a[href]');return a?[{title:text(n.querySelector('h3')),url:goodcaseUrl(a.getAttribute('href')),summary:text(n.querySelector('p')),text:text(n),posterUrl:image(n),category:categoryOf(n)}]:[];});
  const creators:GoodcaseInfo[]=['/creators','/creators?page=2','/creators?page=3'].flatMap(route=>Array.from(doc(pages.get(route)!).querySelectorAll('article')).flatMap(n=>{const a=n.querySelector('a[href^="/creators/"]');return a?[{title:text(n.querySelector('h2,h3'))||text(a),url:goodcaseUrl(a.getAttribute('href')),summary:text(n.querySelector('p'))||text(n),text:text(n),posterUrl:image(n),category:categoryOf(n)}]:[];}));
  return {capturedAt:new Date().toISOString(),heat,stability,weekly:unique(weekly,x=>x.slug),models:unique(models,x=>x.url),skills:unique(skills,x=>x.url),creators:unique(creators,x=>x.url),dailyCases,cases:[...index.values()],rankings};
}
export async function fetchGoodcaseDetail(slug:string,force=false):Promise<GoodcaseItem>{
  const raw=JSON.parse(await source(`/api/public/cases/${slug}?locale=zh-CN`,300000,force));const value=raw.item||raw.case||raw.data||raw;
  const item=asItem(value);if(!item||typeof item.promptFull!=='string')throw Error('详情来源格式变化，已保留已有内容。');return item;
}
export async function fetchGoodcaseRetests(slug:string):Promise<GoodcaseRetests>{
  const data=JSON.parse(await source(`/api/public/cases/${slug}/retests?locale=zh-CN`));
  if(!data||typeof data!=='object'||(data.byModel!==undefined&&!Array.isArray(data.byModel)))throw Error('复测记录格式变化');
  if(data.byModel?.some((row:unknown)=>!row||typeof row!=='object'||typeof (row as {model?:unknown}).model!=='string'))throw Error('复测记录格式变化');
  return data;
}
