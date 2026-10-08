// The reader accepts text/Markdown only; external HTML is never mounted.
export interface MarkdownLink {image:boolean;label:string;url:string;end:number}
export function readMarkdownLink(text:string,start:number):MarkdownLink|null {
  const image=text.startsWith('![',start),open=start+(image?1:0);
  if(text[open]!=='[')return null;
  let depth=1,index=open+1;
  for(;index<text.length;index++){
    if(text[index]==='\\'){index++;continue;}
    if(text[index]==='[')depth++;
    if(text[index]===']'&&--depth===0)break;
  }
  if(index>=text.length||text[index+1]!=='(')return null;
  const label=text.slice(open+1,index),urlStart=index+2;
  depth=1;index=urlStart;
  for(;index<text.length;index++){
    if(text[index]==='\\'){index++;continue;}
    if(text[index]==='(')depth++;
    if(text[index]===')'&&--depth===0)break;
  }
  if(depth!==0)return null;
  const destination=text.slice(urlStart,index).trim();
  const url=/^(?:<([^<>\n]+)>|([^\s]+?))(?:\s+["'][^\n]*["'])?$/.exec(destination);
  if(!url)return null;
  return {image,label,url:(url[1]??url[2]).replace(/\\([\\()])/g,'$1'),end:index+1};
}

// Compatibility for already saved output from the old HTML converter. Only
// join the known broken image-link form, outside fenced/indented code.
export function repairReaderImageLinks(body:string):string {
  const lines=body.replace(/\r\n?/g,'\n').split('\n');
  let fenced=false;
  for(let index=0;index<lines.length;index++){
    if(/^\s*```/.test(lines[index])){fenced=!fenced;continue;}
    if(fenced||!lines[index].endsWith('[')||/^ {4}|^\t/.test(lines[index]))continue;
    let imageLine=index+1;
    while(imageLine<lines.length&&!lines[imageLine].trim())imageLine++;
    const imageText=lines[imageLine]?.trim()??'',image=readMarkdownLink(imageText,0);
    if(!image?.image||image.end!==imageText.length)continue;
    let closeLine=imageLine+1;
    while(closeLine<lines.length&&!lines[closeLine].trim())closeLine++;
    if(!lines[closeLine]?.trimStart().startsWith(']('))continue;
    lines[index]+=imageText+lines[closeLine].trimStart();
    lines.splice(index+1,closeLine-index);
    index--; // Adjacent linked thumbnails can have the same old formatting.
  }
  return lines.join('\n');
}

export type ReaderInline = {kind:'text'|'code';text:string}|{kind:'image';alt:string;url:string}|{kind:'link';url:string;children:ReaderInline[]}|{kind:'strong'|'em';children:ReaderInline[]};
export function readerInline(text:string,depth=0):ReaderInline[]{
  if(depth>=12)return [{kind:'text',text}];
  const parts:ReaderInline[]=[];let plain='';
  const flush=()=>{if(plain){parts.push({kind:'text',text:plain});plain='';}};
  for(let index=0;index<text.length;){
    const char=text[index];
    if(char==='\\'&&/[\\`*\[\]()!_]/.test(text[index+1]??'')){plain+=text[index+1];index+=2;continue;}
    if(char==='['||text.startsWith('![',index)){
      const link=readMarkdownLink(text,index);
      if(link){flush();parts.push(link.image?{kind:'image',alt:link.label,url:link.url}:{kind:'link',url:link.url,children:readerInline(link.label,depth+1)});index=link.end;continue;}
    }
    if(char==='`'||char==='*'){
      const delimiter=text.startsWith('**',index)?'**':char;
      let end=index+delimiter.length;
      while((end=text.indexOf(delimiter,end))>=0){
        let slashes=0;for(let before=end-1;before>=0&&text[before]==='\\';before--)slashes++;
        if(slashes%2===0)break;end+=delimiter.length;
      }
      if(end>index+delimiter.length){flush();const content=text.slice(index+delimiter.length,end);parts.push(char==='`'?{kind:'code',text:content}:{kind:delimiter==='**'?'strong':'em',children:readerInline(content,depth+1)});index=end+delimiter.length;continue;}
    }
    plain+=char;index++;
  }
  flush();return parts;
}
