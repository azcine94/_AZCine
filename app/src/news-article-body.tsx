import {useOperationNotice} from './components/ui/operation-toast.tsx';
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {invoke,isTauri} from './desktop-api.ts';
import {Button} from './components/ui/button.tsx';
import {UILink} from './components/ui/ui-link.tsx';
import {ImageViewer} from './components/ui/image-viewer.tsx';
import {Card} from './components/ui/card.tsx';
import {Disclosure} from './components/ui/disclosure.tsx';
import type {NewsController} from './use-news.ts';
import {readerInline,readMarkdownLink,repairReaderImageLinks} from './news-body-markdown.ts';
import type {ReaderInline} from './news-body-markdown.ts';
export function sourceUrl(value:string):string|null {try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.hostname.includes('.')&&!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)&&!u.hostname.endsWith('.local')?u.href:null;}catch{return null;}}
export function ReaderLink({href,news,children}:{href:string;news:NewsController;children:ReactNode}){const url=sourceUrl(href);return url?<UILink variant="text" href={url} target="_blank" rel="noopener noreferrer" onClick={e=>{if(news.connected){e.preventDefault();void news.openOriginal(url);}}}>{children}</UILink>:<span>{children}</span>;}
interface Block {kind:'heading'|'paragraph'|'code'|'list'|'quote'|'table'|'image'|'rule';text:string;depth?:number;index:number}
export function bodyBlocks(body:string):Block[]{const lines=repairReaderImageLinks(body).split('\n'),blocks:Block[]=[];let i=0;while(i<lines.length){const line=lines[i].trim();if(!line){i++;continue;}const index=blocks.length;if(line.startsWith('```')){const buffer:string[]=[];i++;while(i<lines.length&&!lines[i].trim().startsWith('```'))buffer.push(lines[i++]);if(i<lines.length)i++;blocks.push({kind:'code',text:buffer.join('\n'),index});continue;}const heading=/^(#{1,6})\s+(.+)$/.exec(line);if(heading){blocks.push({kind:'heading',text:heading[2],depth:Math.min(heading[1].length+1,6),index});i++;continue;}const image=readMarkdownLink(line,0);if(image?.image&&image.end===line.length){blocks.push({kind:'image',text:line,index});i++;continue;}if(/^(---+|\*\*\*+)$/.test(line)){blocks.push({kind:'rule',text:'',index});i++;continue;}let kind:Block['kind']=/^[-*]\s|^\d+[.)]\s/.test(line)?'list':line.startsWith('>')?'quote':line.startsWith('|')?'table':'paragraph';const buffer=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(#{1,6}\s|```|!\[)/.test(lines[i].trim())){const next=lines[i].trim();if(kind==='list'&&!/^[-*]\s|^\d+[.)]\s/.test(next)||kind==='quote'&&!next.startsWith('>')||kind==='table'&&!next.startsWith('|')||kind==='paragraph'&&/^[-*]\s|^\d+[.)]\s|^>|^\|/.test(next))break;buffer.push(next);i++;}blocks.push({kind,text:buffer.join('\n'),index});}return blocks;}
export function bodyHeadings(body:string){return bodyBlocks(body).filter(b=>b.kind==='heading').map(b=>({id:`reader-heading-${b.index}`,text:b.text,depth:b.depth??2}));}
function inline(text:string,news:NewsController):ReactNode[]{return renderInline(readerInline(text),news);}
function hasImage(parts:ReaderInline[]):boolean{return parts.some(part=>part.kind==='image'||('children' in part&&hasImage(part.children)));}
function renderInline(parts:ReaderInline[],news:NewsController,sourceHref?:string):ReactNode[]{return parts.map((part,index)=>{
  switch(part.kind){
    case 'text':return sourceHref?<ReaderLink key={index} href={sourceHref} news={news}>{part.text}</ReaderLink>:part.text;
    case 'code':return <code key={index}>{part.text}</code>;
    case 'strong':return <strong key={index}>{renderInline(part.children,news,sourceHref)}</strong>;
    case 'em':return <em key={index}>{renderInline(part.children,news,sourceHref)}</em>;
    case 'image':return <Picture key={index} src={part.url} alt={part.alt} news={news} inlineImage sourceHref={sourceHref}/>;
    case 'link':return hasImage(part.children)?<span key={index}>{renderInline(part.children,news,part.url)}</span>:<ReaderLink key={index} href={part.url} news={news}>{renderInline(part.children,news)}</ReaderLink>;
  }
});}
function inlineText(parts:ReaderInline[]):string{return parts.map(part=>'children' in part?inlineText(part.children):'text' in part?part.text:'').join('');}
function headlineKey(text:string){return text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');}

// Recognize only a leading byline + publication date, never merge arbitrary
// short paragraphs in the article. Original block indexes keep TOC links stable.
function articleHeader(blocks:Block[]):{blocks:Block[];authors?:string;date?:string;source?:string}{
  const plain=(block:Block|undefined)=>block?.kind==='paragraph'?inlineText(readerInline(block.text)).trim():'';
  let cursor=0;
  const source=blocks[0]?.kind==='paragraph'&&/^原始报道[：:]\s*\[阅读原文\]\(https?:\/\//.test(blocks[0].text)?blocks[cursor++].text:undefined;
  if(!/^by$/i.test(plain(blocks[cursor])))return {blocks};
  cursor++;
  const authors:string[]=[];
  const datePattern=/^(?:Updated\s+|Published\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}\b/i;
  while(cursor<blocks.length&&authors.length<8){
    const text=plain(blocks[cursor]);
    if(datePattern.test(text))break;
    // A name may contain a linked author, accents, punctuation and a final 'and'.
    if(!text||text.length>100||!/^\p{L}[\p{L}\p{M}\s.,'’&-]*$/u.test(text)||text.split(/\s+/).length>10)return {blocks};
    authors.push(blocks[cursor++].text);
  }
  const date=plain(blocks[cursor]);
  if(!authors.length||!datePattern.test(date))return {blocks};
  cursor++;
  const isCount=/^\d[\d,]*$/.test(plain(blocks[cursor]));
  const audioIndex=cursor+(isCount?1:0);
  const audio=plain(blocks[audioIndex]);
  const duration=/^\(\s*\d+(?:[.:]\d+)?\s*(?:min(?:ute)?s?|sec(?:ond)?s?)\s*\)$/i;
  if(/^listen$/i.test(audio)&&duration.test(plain(blocks[audioIndex+1])))cursor=audioIndex+2;
  else if(/^listen\s*\(\s*\d+(?:[.:]\d+)?\s*(?:min(?:ute)?s?|sec(?:ond)?s?)\s*\)$/i.test(audio))cursor=audioIndex+1;
  const joined=authors.reduce((text,author,index)=>text+(index&& !/(?:[,;&]|\band)\s*$/i.test(inlineText(readerInline(authors[index-1])))?', ':index?' ':'')+author,'');
  return {blocks:blocks.slice(cursor),authors:joined,date,source};
}

// Presentation only: keep the saved RSS material intact, including copy/export.
export function ArticleSummary({body,title,sourceName,href,reason,news}:{body:string;title:string;sourceName:string;href:string;reason:string|null;news:NewsController}){
  const images:Extract<ReaderInline,{kind:'image'}>[]=[];
  let attribution:ReaderInline[]=[];
  let reportHref=href;
  const withoutImages=(parts:ReaderInline[]):ReaderInline[]=>parts.flatMap((part):ReaderInline[]=>{
    if(part.kind==='image'){
      if(!images.length&&sourceUrl(part.url)&&!/(?:favicon|(?:^|[/_.-])(?:icon|pml)(?:[/_.-]|$)|\.ico(?:\?|$))/i.test(part.url)&&!/^(?:📄|文档图标|icon|favicon)$/i.test(part.alt.trim()))images.push(part);
      return [];
    }
    if('children' in part){const children=withoutImages(part.children);return children.length?[{...part,children}]:[];}
    return [part];
  });
  const paragraphs=new Map<number,ReaderInline[]>();
  const blocks=bodyBlocks(body).filter(block=>{
    if(block.kind!=='paragraph'&&block.kind!=='image')return true;
    const original=readerInline(block.text);
    let parts=withoutImages(original);
    const text=inlineText(parts).trim();
    if(!text)return false;
    if(block.index===0&&hasImage(original)&&text.length<160&&/[:：]$/.test(text)){
      attribution=parts;return false;
    }
    // Only remove a confirmed duplicate headline when an actual excerpt follows it.
    const first=parts.findIndex(part=>part.kind!=='text'||!!part.text.trim());
    const lead=parts[first];
    const link=lead?.kind==='link'?lead:lead?.kind==='strong'&&lead.children.length===1&&lead.children[0].kind==='link'?lead.children[0]:null;
    if(link){
      const headline=inlineText(link.children),key=headlineKey(headline);
      const matches=key.length>12&&(headlineKey(title)===key||headlineKey(title.replace(/\s*\([^()]*\)\s*$/,''))===key);
      const rest=parts.slice(first+1);
      if(matches&&inlineText(rest).replace(/^[\s—–:：-]+/,'').trim()){
        if(sourceUrl(link.url))reportHref=link.url;
        if(rest[0]?.kind==='text')rest[0]={...rest[0],text:rest[0].text.replace(/^[\s—–:：-]+/,'')};
        parts=rest;
      }
    }
    paragraphs.set(block.index,parts);return true;
  });
  const thumbnail=images[0];
  return <Card className="reader-summary-card">
    <header className="reader-summary-header"><div><h2>来源摘要</h2><p>当前为订阅节选，尚未取得完整正文</p></div><ReaderLink href={reportHref} news={news}>阅读报道 ↗</ReaderLink></header>
    <div className="reader-summary-content">
      {thumbnail&&<Picture src={thumbnail.url} alt={thumbnail.alt} news={news} thumbnail/>}
      <div className="reader-summary-copy">
        {attribution.length>0&&<div className="reader-summary-attribution">{renderInline(attribution,news)}</div>}
        {blocks.length?blocks.map(block=>paragraphs.has(block.index)?<div className="reader-rich-body" key={block.index}><p>{renderInline(paragraphs.get(block.index)!,news)}</p></div>:<ArticleBody key={block.index} news={news} body="" blocks={[block]}/>):<p className="reader-caption">订阅未提供更多文字，可前往来源阅读。</p>}
      </div>
    </div>
    <footer className="reader-summary-footer"><span>订阅来源 · <ReaderLink href={href} news={news}>{sourceName} ↗</ReaderLink></span>{reason&&<Disclosure><summary>正文获取说明</summary><p>{reason}</p></Disclosure>}</footer>
  </Card>;
}

function Code({text}:{text:string}){const [,setNotice]=useOperationNotice('');return <div className="reader-code"><Button variant="app-text" className="reader-code-copy" onClick={()=>{void navigator.clipboard.writeText(text).then(()=>setNotice('已复制')).catch(()=>setNotice('剪贴板受限，请手动选择复制'));}}>复制代码</Button><pre tabIndex={0}><code>{text}</code></pre></div>;}
function Picture({src,alt,news,inlineImage=false,sourceHref,thumbnail=false}:{src:string;alt:string;news:NewsController;inlineImage?:boolean;sourceHref?:string;thumbnail?:boolean}){
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[expanded,setExpanded]=useState(false),[small,setSmall]=useState(false),remote=sourceUrl(src);
  useEffect(()=>{
    setUrl('');setError('');setExpanded(false);setSmall(false);
    if(!remote||!isTauri()||document.documentElement.dataset.uiPreview==='true')return;
    let disposed=false,blob='';
    void invoke<{mime:string;bytes:number[]}>('news_reader_image',{url:remote}).then(v=>{if(disposed)return;blob=URL.createObjectURL(new Blob([new Uint8Array(v.bytes)],{type:v.mime}));setUrl(blob);}).catch(()=>{if(!disposed)setError('图片暂时无法读取');});
    return()=>{disposed=true;if(blob)URL.revokeObjectURL(blob);};
  },[remote]);
  if(thumbnail)return url&&!small&&!error?<figure className="reader-summary-thumbnail"><Button variant="ghost" className="reader-image-trigger" aria-label={`放大图片：${alt||'报道配图'}`} onClick={()=>setExpanded(true)}><img src={url} alt={alt} onLoad={event=>{if(Math.min(event.currentTarget.naturalWidth,event.currentTarget.naturalHeight)<48)setSmall(true);}} onError={()=>setError('图片暂时无法读取')}/></Button><ImageViewer open={expanded} onOpenChange={setExpanded} src={url} name={alt||'报道配图'}/></figure>:null;
  const content=<>{url?<><Button variant="ghost" className="reader-image-trigger" aria-label={`放大图片：${alt||'正文配图'}`} onClick={()=>setExpanded(true)}><img src={url} alt={alt} /></Button><ImageViewer open={expanded} onOpenChange={setExpanded} src={url} name={alt||'正文图片'}/></>:<ReaderLink href={src} news={news}>{error||(!remote?'图片地址不可用':!isTauri()?'查看图片':'正在读取图片…')}</ReaderLink>}{sourceHref&&<span className="reader-image-source"><ReaderLink href={sourceHref} news={news}>查看图片来源 ↗</ReaderLink></span>}</>;
  return inlineImage?<span className="reader-inline-image">{content}</span>:<figure className="reader-image">{content}{alt&&<figcaption>{alt}</figcaption>}</figure>;
}
export function ArticleBody({body,news,blocks}:{body:string;news:NewsController;blocks?:Block[]}){const content=articleHeader(blocks??bodyBlocks(body));return <div className="reader-rich-body">{content.authors&&<div className="reader-article-byline">{content.source&&<div className="reader-byline-source">{inline(content.source,news)}</div>}<div className="reader-byline-details"><span>作者：{inline(content.authors,news)}</span><span>{content.date}</span></div></div>}{content.blocks.map(block=>{const key=block.index;switch(block.kind){case 'heading':{const Tag=`h${block.depth}` as 'h2'|'h3'|'h4'|'h5'|'h6';return <Tag id={`reader-heading-${key}`} key={key}>{inline(block.text,news)}</Tag>;}case 'code':return <Code key={key} text={block.text}/>;case 'image':{const image=readMarkdownLink(block.text,0);return image?<Picture key={key} src={image.url} alt={image.label} news={news}/>:<p key={key}>{inline(block.text,news)}</p>;}case 'list':{const ordered=/^\d+[.)]/.test(block.text);const rows=block.text.split('\n').map((line,i)=><li key={i}>{inline(line.replace(/^([-*]|\d+[.)])\s+/,''),news)}</li>);return ordered?<ol key={key}>{rows}</ol>:<ul key={key}>{rows}</ul>;}case 'quote':return <blockquote key={key}>{inline(block.text.replace(/^>\s?/gm,''),news)}</blockquote>;case 'table':{const rows=block.text.split('\n').filter(line=>!/^\|?\s*:?-+/.test(line)).map(line=>line.replace(/^\||\|$/g,'').split('|').map(v=>v.trim()));return <div className="reader-table" key={key} tabIndex={0}><table><thead><tr>{rows[0]?.map((cell,i)=><th key={i}>{inline(cell,news)}</th>)}</tr></thead><tbody>{rows.slice(1).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{inline(cell,news)}</td>)}</tr>)}</tbody></table></div>;}case 'rule':return <hr key={key}/>;default:return <p key={key}>{inline(block.text,news)}</p>;}})}</div>;}
