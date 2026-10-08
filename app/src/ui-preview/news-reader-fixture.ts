import {useState} from 'react';
import {useNewsReader} from '../use-news-reader.ts';
import type {Article,ArticleDetail,Brief,ReaderSnapshot} from '../news-reader-contract.ts';
import {materials,uuid} from './data.ts';
import {dailyCutoffDate} from '../news-daily.ts';
export const readerArticleId='aaccee00112233445566778899001122',readerStoryId='c'.repeat(64);
const categories=[['ai-models','模型'],['ai-products','产品'],['industry','行业'],['paper','论文'],['tip','教程'],['opinion','观点']].map(([key,label])=>({key,label,section:label,guide:'明确标记的 UI 虚构类别'}));
export const readerArticle:Article={id:readerArticleId,material:{...materials[0],id:readerArticleId,title:'Explicit UI fixture',publishedAt:'2026-10-05T02:00:00Z'},titleZh:'UI虚构示例：产品开放公开预览，读取免费，导出仍消耗额度',summaryZh:'这款虚构产品开放公开预览。读取功能免费，导出仍需要消耗额度，两项操作分别保留适用条件。此示例只展示共用 UI 组件和布局，不代表真实新闻。',reason:'公开范围与收费条件分别说明，便于确认适用对象。',category:'ai-products',tags:['产品更新'],subjects:[],scope:'single',fact:null,scoreFirst:80,scoreSecond:90,score:85,tier:'T1',selected:true,addsValue:true,selectionReason:'',occurrenceId:readerStoryId,storyId:readerStoryId,originalBody:'## 公开范围\n\n这段正文是 UI 虚构资料。页面沿用统一亮暗主题和通用控件，使用右侧容器全部宽度。\n\n## 价格与限制\n\n读取免费，导出消耗额度。两项操作的条件分别展示。\n\n- 免费范围仅包含读取。\n- 导出仍需消耗额度。\n\n```js\nconst count = 2;\n```\n\n| 操作 | 条件 |\n| --- | --- |\n| 读取 | 免费 |\n| 导出 | 消耗额度 |',translatedBody:null,bodyKind:'feed',bodyError:null,displayBody:true,status:'ready',processedAt:'2026-10-05T03:00:00Z',configRevision:1,upstream:'explicit-ui-fixture'};
export function usePreviewReader(state:string,daily=false){
 const longArticle=state==='long'?{...readerArticle,titleZh:readerArticle.titleZh.repeat(6),summaryZh:readerArticle.summaryZh.repeat(10),material:{...readerArticle.material,sourceName:'虚构长信源名称'.repeat(20)}}:readerArticle;
 const todayMany=state==='today-news-many'||state==='today-news-long';
 const baseline=useNewsReader(null,false),[items,setItems]=useState<Article[]>(todayMany?Array.from({length:12},(_,index)=>({...readerArticle,id:(index+1).toString(16).padStart(32,'0'),titleZh:`UI虚构资讯 ${index+1}：${state==='today-news-long'?'很长的产品与发布标题，用于检查换行和内部滚动，'.repeat(8):'日报看点与快讯均显示在今日资讯列表'}`})):[longArticle,{...readerArticle,id:'bb'.repeat(16),titleZh:'UI虚构示例：后续报道说明开放范围',selected:false,material:{...readerArticle.material,sourceName:'第二测试信源'}}]);
 const [tab,setTab]=useState<typeof baseline.tab>(state==='hot'?'hot':state==='daily'?'daily':state==='bookmarks'?'bookmarks':state==='featured'?'featured':'all'),[category,setCategory]=useState(''),[query,setQuery]=useState(''),[limit,setLimit]=useState(100),[editionId,setEditionId]=useState('');
 const brief=(a:Article):Brief=>({id:a.id,titleZh:a.titleZh,summaryZh:a.summaryZh,sourceName:a.material.sourceName,publishedAt:a.material.publishedAt,storyId:a.storyId,occurrenceId:a.occurrenceId,url:a.material.url});
 const filtered=state==='empty'||state==='filtered'?[]:items.filter(a=>(tab!=='featured'||a.selected)&&(tab!=='bookmarks'||a.bookmarked)&&(!category||a.category===category||a.tags.includes(category))&&(!query||a.titleZh.includes(query)));
 const snapshot:ReaderSnapshot={items:filtered,total:filtered.length,taxonomy:{categories,topicTags:['产品更新']},upstream:'explicit-ui-fixture',stories:[{id:readerStoryId,title:readerArticle.titleZh,digest:{title:'UI虚构事件概览',digest:'示例事件开放预览，后续报道补充适用条件。此文字用于展示排版。'},heat:1.7,sources:2,latestAt:readerArticle.material.publishedAt,articles:items.map(brief)}],editions:state==='today-news-loading'?[]:[{id:uuid(311),kind:'daily',date:'2026-10-05',windowStart:'2026-10-04T00:00:00Z',windowEnd:'2026-10-05T00:00:00Z',generatedAt:'2026-10-05T00:01:00Z',overview:'UI虚构日报：本期展示公开范围和收费条件。',sections:{},main:state==='today-news-empty'?[]:todayMany?items.slice(0,1).map(brief):items.map(brief),flashes:todayMany?[...items.slice(1).map(brief),brief(items[0])]:[],gaps:state==='incomplete'?['测试信源：本窗口无成功采集']:[],upstream:'explicit-ui-fixture'}]};
 if(daily){
   const cutoff=dailyCutoffDate(),previous=dailyCutoffDate(Date.now()-86400000);
   const sample=snapshot.editions[0];
   if(sample){
     sample.date=cutoff;sample.windowStart=`${previous}T00:00:00Z`;sample.windowEnd=`${cutoff}T00:00:00Z`;sample.generatedAt=`${cutoff}T01:00:00Z`;
     sample.overview='';sample.selection={readyInWindow:12,pendingAtGeneration:3,afterCutoff:2,excludedArticles:1,belowSelectionStories:3,repeatedStories:2};
     if(state==='long'){sample.main=sample.main.map(a=>({...a,titleZh:a.titleZh.repeat(4),summaryZh:a.summaryZh.repeat(4)}));}
     if(state==='daily-empty'){sample.main=[];sample.flashes=[];sample.selection.readyInWindow=0;}
     if(state==='daily-versions'){snapshot.editions=[{...sample,id:uuid(313),generatedAt:`${cutoff}T03:00:00Z`},sample,{...sample,id:uuid(312),date:previous,windowEnd:`${previous}T00:00:00Z`,windowStart:`${dailyCutoffDate(Date.now()-2*86400000)}T00:00:00Z`,generatedAt:`${previous}T01:00:00Z`}];}
     if(['daily-failed','daily-running','daily-waiting'].includes(state)){sample.date=previous;sample.windowEnd=`${previous}T00:00:00Z`;sample.windowStart=`${dailyCutoffDate(Date.now()-2*86400000)}T00:00:00Z`;sample.generatedAt=`${previous}T01:00:00Z`;}
   }
   if(state==='empty'||state==='loading')snapshot.editions=[];
 }
 const article={...readerArticle,titleZh:state==='long'?readerArticle.titleZh.repeat(3):readerArticle.titleZh,originalBody:state==='long'?readerArticle.originalBody+'\n\n'+('长文本 UI 示例，核对断行和容器宽度。'.repeat(140)):readerArticle.originalBody};
 if(['reader-byline-single','reader-byline-multiple'].includes(state)){
   article.bodyKind='web';article.titleZh='UI 虚构示例：文章作者与时间信息';
   const byline=state==='reader-byline-single'?'[Example Author](https://example.org/author)':'[Example One](https://example.org/one),\n\n[Example Two](https://example.org/two) and\n\n[Example Three](https://example.org/three)';
   article.originalBody=`原始报道：[阅读原文](https://example.org/article)\n\nBy\n\n${byline}\n\nUpdated Oct. 7, 2026 7:46 pm ET\n\n[146](https://example.org/article#comments)\n\nListen\n\n(2 min)\n\n![明确标记的虚构配图](https://example.org/image.png)\n\n这是正常的正文段落，应保留正常段落间距。\n\n## 正文章节\n\n10\n\nListen\n\n这两个短段落位于正文中，必须保留，不能被当作页面控件删除。`;
 }
 if(['reader-linked-images','reader-summary-long','reader-summary-empty'].includes(state)){
   article.titleZh='UI 虚构示例：订阅中的链接缩略图与粗体标题';
   article.material={...article.material,title:'带有换行的标题 仍应完整呈现为链接 (示例来源)'};
   article.bodyKind='summary';article.bodyError='显式虚构错误：公开页面没有可辨认的正文区域。';
   article.originalBody='[\n\n![示例缩略图](https://example.org/image.png)\n\n](https://example.org/article)[\n\n![文档图标](https://example.org/icon.png)\n\n](https://example.org/discussion) 作者 / [示例来源](https://example.org):\n\n**[带有换行的标题\n仍应完整呈现为链接](https://example.org/article)** — 此内容为 UI 虚构资料，不代表真实报道。\n\n[**链接内的粗体**与普通文字](https://example.org/path_(example))。\n\n```md\n[\n\n![代码中的图片语法](https://example.org/code.png)\n\n](https://example.org/code)\n```';
   if(state==='reader-summary-long'){
     article.originalBody+='\n\n'+('这是一段虚构的长订阅摘要，用于检查正常换行和阅读宽度。'.repeat(25));
     article.material.sourceName='用于展示长信源名称自动换行的虚构订阅来源'.repeat(4);
     article.bodyError='虚构说明：公开页面暂未提供可提取的完整正文。'.repeat(20);
   }
   if(state==='reader-summary-empty')article.originalBody='';
 }
 const detail:ArticleDetail={article,bookmarked:state==='bookmarks',position:0,related:[],steps:[]};
 return {reader:{...baseline,snapshot:daily&&state==='loading'?null:snapshot,tab,setTab,category,setCategory,query,setQuery,limit,setLimit,editionId,setEditionId,loading:state==='loading'||state==='daily-refreshing'||state==='today-news-loading',error:state==='error'||state==='today-news-error'?'UI示例读取失败，已保留内容':'',bookmark:async(id:string,value:boolean)=>setItems(before=>before.map(a=>a.id===id?{...a,bookmarked:value}:a)),refresh:async()=>{}},detail};
}
