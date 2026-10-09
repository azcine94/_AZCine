import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog.tsx';
import { Button } from './components/ui/button.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { GoodcaseLink } from './goodcase-shared.tsx';
import { goodcaseImage, goodcaseUrl } from './goodcase-source.ts';
import type { GoodcaseItem, GoodcaseRetests } from './goodcase-types.ts';
import type { GoodcaseStore, GoodcaseState } from './goodcase-store.ts';

function retestText(data:GoodcaseRetests|undefined,error:string|undefined){
  if(!data)return error||'点击“读取复测记录”，查看原站的逐模型结果。';
  if(!data.byModel?.length)return '原站暂未提供逐模型复测记录。';
  return `共 ${data.count??'—'} 条记录\n评审分与稳定分分别展示。\n\n`+data.byModel.map(x=>{
    const t=x.latest||{},verdict=({reproduced:'复现成功',degraded:'效果下降',failed:'复现失败'} as Record<string,string>)[t.verdict||'']||(t.automaticOnly?'自动评审，尚未人工判定':'尚未判定');
    return [x.model,verdict,`评审分：${t.finalScore??'—'}`,`日期：${t.testedAt?.slice(0,10)||'—'}`,t.failureReason?`失败原因：${t.failureReason}`:''].filter(Boolean).join('\n');
  }).join('\n\n──────────\n\n');
}
function Media({item}:{item:GoodcaseItem}){
  const [failed,setFailed]=useState(false),video=item.mediaType==='video'&&goodcaseUrl(item.mediaUrl),image=goodcaseImage(item);
  const player=useRef<HTMLVideoElement>(null);
  useEffect(()=>{const element=player.current;return()=>{element?.pause();};},[]);
  return <div className="gc-media">{video?<video ref={player} className="gc-detail-media" controls playsInline preload="metadata" src={video} poster={image||undefined} onError={()=>setFailed(true)}/>:image?<img className="gc-detail-media" src={image} alt={item.title} onError={()=>setFailed(true)}/>:<span className="gc-small gc-muted">暂无可预览的媒体</span>}{failed&&<p className="gc-media-error" role="status">媒体暂不可用，请通过原站详情或作者原帖查看。</p>}</div>;
}
export function GoodcaseDetail({item,state,store,onClose,trigger}:{item:GoodcaseItem;state:GoodcaseState;store:GoodcaseStore;onClose:()=>void;trigger:HTMLElement|null}){
  const [reader,setReader]=useState<'prompt'|'info'|'retests'>('prompt'),[lang,setLang]=useState<'original'|'zh'>('zh'),[hidden,setHidden]=useState(false);
  const textarea=useRef<HTMLTextAreaElement>(null),saved=state.favorites.items.some(x=>x.slug===item.slug);
  const complete=state.detailLoaded[item.slug],translated=complete&&!!item.promptTranslationZh?.trim();
  const models=(item.recommendedModels||[item.model]).filter(Boolean).join(' / '),caption=[item.creator,models].filter(Boolean).join(' · ');
  const prompt=(lang==='zh'&&translated?item.promptTranslationZh:item.promptFull||item.promptPreview)||'';
  const info=[item.title,`作者：${item.creator||'原站未提供'}`,`来源：${item.source||'GoodCase'}`,`使用模型：${models||'原站未提供'}`,`稳定度：${(item.stabilityScore??0)>0?item.stabilityScore+'%':'待复测'}`,`成本档：${({low:'低',medium:'中',high:'高'} as Record<string,string>)[item.costBand||'']||'—'}`,`证据等级：${item.evidenceLevel||'—'}`,item.summary,item.provenance?.verifiedAgainstSource?'提示词来源已由原站核对。':''].filter(Boolean).join('\n\n');
  const content=reader==='prompt'?prompt:reader==='info'?info:retestText(state.retests[item.slug],state.retestErrors[item.slug]);
  useEffect(()=>{if(textarea.current)textarea.current.scrollTop=0;},[content]);
  const status=reader==='prompt'?(lang==='zh'?(translated?'中文译文 · 来自 GoodCase 原站':complete?'原站暂无中文译文，暂显示原文。':'正在读取中文译文，暂显示已有原文。'):(item.promptFull?'原始提示词 · 保留来源语言':'原始提示词摘要 · 等待详情补全')):reader==='retests'?'结果来自原站复测，不代表本地验证。':'作品信息与作者出处来自 GoodCase。';
  async function copy(){try{await navigator.clipboard.writeText(content);notifyOperation(reader==='prompt'?'已复制完整提示词':'已复制全部内容');}catch{textarea.current?.focus();textarea.current?.select();notifyOperation('已选中全文，请按 Ctrl+C 复制');}}
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent layout="form" showCloseButton={false} className="gc-detail-dialog" aria-describedby={undefined} data-reader-hidden={hidden} onCloseAutoFocus={event=>{event.preventDefault();if(trigger?.isConnected)trigger.focus();}}>
    <header className="gc-dialog-head"><DialogTitle>{item.title}</DialogTitle><Button variant="app-quiet" aria-expanded={!hidden} aria-controls="gc-reader" onClick={()=>setHidden(!hidden)}>{hidden?'展开提示词':'收起提示词'}</Button><Button variant="app-pill" aria-pressed={saved} disabled={!state.favoritesLoaded||state.favoriteSaving||state.favoritesPending} onClick={()=>{void store.favorite(item,!saved).then(ok=>{if(ok)notifyOperation(saved?'已取消收藏':'已收藏');});}}>{saved?'已收藏':'收藏'}</Button><Button variant="app-quiet" aria-label="关闭详情" onClick={onClose}><X/></Button></header>
    {state.favoritesError&&<div className="gc-favorite-error" role="alert">{state.favoritesError}<Button variant="app-quiet" disabled={state.favoritesPending} onClick={()=>void store.loadFavorites()}>重新读取收藏</Button></div>}
    <div className="gc-dialog-body"><section className="gc-video-panel" aria-label="作品预览"><Media key={`${item.slug}|${item.mediaType}|${item.mediaUrl||goodcaseImage(item)}`} item={item}/><footer className="gc-video-caption"><div className="gc-caption-text"><p className="gc-detail-meta" title={caption}>{caption}</p><p className="gc-media-note">{item.mediaType==='video'?'原作者作品 · 联网播放':'原作者作品'}</p></div><div className="gc-detail-links"><GoodcaseLink variant="pill" href={item.url||`/cases/${item.slug}`}>原站详情 ↗</GoodcaseLink>{item.sourceUrl&&<GoodcaseLink variant="pill" href={item.sourceUrl}>作者原帖 ↗</GoodcaseLink>}</div></footer></section>
    <aside id="gc-reader" className="gc-reader-panel" aria-label="辅助内容" hidden={hidden}><nav className="gc-reader-tabs" aria-label="作品辅助信息">{([['prompt','提示词'],['info','作品信息'],['retests','复测记录']] as const).map(([id,title])=><Button key={id} variant="app-underline-tab" aria-pressed={reader===id} onClick={()=>setReader(id)}>{title}</Button>)}</nav>
      <div className="gc-prompt-toolbar">{reader==='prompt'&&<><Button variant="app-choice-chip" aria-pressed={lang==='original'} onClick={()=>setLang('original')}>原文</Button><Button variant="app-choice-chip" aria-pressed={lang==='zh'} onClick={()=>setLang('zh')}>中文翻译</Button></>}{reader==='retests'&&<Button variant="app-quiet" disabled={state.retestPending[item.slug]} onClick={()=>void store.loadRetests(item.slug)} loading={!!state.retestPending[item.slug]} loadingText="读取中…">{state.retests[item.slug]?'更新复测记录':'读取复测记录'}</Button>}<Button variant="app-primary" disabled={!content} onClick={()=>void copy()}>复制全文</Button></div>
      <Textarea ref={textarea} variant="app" className="gc-preview-text" value={content||(reader==='prompt'?'暂未取得提示词，可通过原站详情查看。':'暂无信息')} readOnly spellCheck={false} aria-label={reader==='prompt'?'完整提示词':reader==='info'?'作品信息':'逐模型复测记录'}/>
      <footer className="gc-reader-foot"><p>{status}</p>{state.detailPending[item.slug]&&<p role="status">正在读取完整原文与中文译文…</p>}{state.detailErrors[item.slug]&&<p role="alert">详情读取失败，已有内容保留。{state.detailErrors[item.slug]}</p>}{reader==='retests'&&state.retests[item.slug]&&state.retestErrors[item.slug]&&<p role="alert">复测更新失败，旧记录已保留。</p>}<div className="gc-reader-actions">{reader!=='retests'?<><Button variant="app-quiet" disabled={state.detailPending[item.slug]} onClick={()=>void store.loadDetail(item.slug,true)}>重新读取</Button><span>{item.provenance?.verifiedAgainstSource?'原站已核对来源':''}</span></>:<GoodcaseLink href={item.url||`/cases/${item.slug}`}>原站复测 ↗</GoodcaseLink>}</div></footer>
    </aside></div>
  </DialogContent></Dialog>;
}
