import type { ReactNode } from 'react';
import { Table,TableHeader,TableBody,TableRow,TableHead,TableCell } from './table.tsx';

// A deliberately small renderer: React escapes all text, HTML stays text, and
// links accept only explicit HTTP(S). Code is never evaluated or highlighted as HTML.
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(end, match.index));
    const token = match[0], key = match.index;
    if (token.startsWith('`')) parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**')) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else { const split = token.indexOf(']('); parts.push(<a key={key} href={token.slice(split + 2, -1)} target="_blank" rel="noreferrer noopener">{token.slice(1, split)}</a>); }
    end = match.index + token.length;
  }
  parts.push(text.slice(end));
  return parts;
}

// Split Markdown table cells only at unescaped pipes outside inline code.
function tableCells(line:string):string[]|null {
  const cells:string[]=[];let value='',ticks=0,delimiters=0;
  for(let index=0;index<line.length;index++){
    const char=line[index];
    if(char==='\\'&&index+1<line.length){const next=line[++index];value+=next==='|'?'|':'\\'+next;continue;}
    if(char==='`'){let count=1;while(line[index+1]==='`'){count++;index++;}if(ticks===0)ticks=count;else if(ticks===count)ticks=0;value+='`'.repeat(count);continue;}
    if(char==='|'&&ticks===0){cells.push(value.trim());value='';delimiters++;}else value+=char;
  }
  if(!delimiters)return null;cells.push(value.trim());
  if(line.trimStart().startsWith('|'))cells.shift();if(line.trimEnd().endsWith('|')&&cells.at(-1)==='')cells.pop();
  return cells;
}
function tableStart(lines:string[],index:number) {
  const header=tableCells(lines[index]??''),separator=tableCells(lines[index+1]??'');
  return header&&separator&&header.length===separator.length&&separator.every(cell=>/^:?-{3,}:?$/.test(cell))?{header,separator}:null;
}

export function MessageMarkdown({text}: {text: string}) {
  const lines = text.replace(/\r\n/g, '\n').split('\n'), blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index], key = index;
    if (!line.trim()) { index++; continue; }
    const fence = line.match(/^\s*```([\w-]*)\s*$/);
    if (fence) {
      const body: string[] = []; index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={key} tabIndex={0} aria-label={fence[1]?`${fence[1]} 代码`:'代码'}><code>{body.join('\n')}</code></pre>); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { blocks.push(<p key={key} className="pi-markdown-heading">{inline(heading[2])}</p>); index++; continue; }
    const table=tableStart(lines,index);
    if(table){
      const rows:string[][]=[];index+=2;
      while(index<lines.length&&lines[index].trim()){const cells=tableCells(lines[index]);if(!cells)break;rows.push(cells);index++;}
      const alignments=table.separator.map(cell=>cell.startsWith(':')&&cell.endsWith(':')?'center':cell.endsWith(':')?'right':'left');
      blocks.push(<div className="pi-markdown-table" key={key}><Table className="table-fixed" style={{minWidth:table.header.length*160}} aria-label="回复中的表格" containerProps={{tabIndex:0,role:'region','aria-label':'回复表格，可横向滚动'}}>
        <TableHeader><TableRow>{table.header.map((cell,column)=><TableHead className="whitespace-normal align-top [overflow-wrap:anywhere]" key={column} scope="col" style={{textAlign:alignments[column] as 'left'|'center'|'right'}}>{inline(cell)}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map((row,rowIndex)=><TableRow key={rowIndex}>{table.header.map((_,column)=><TableCell className="whitespace-normal align-top [overflow-wrap:anywhere]" key={column} style={{textAlign:alignments[column] as 'left'|'center'|'right'}}>{inline(row[column]??'')}</TableCell>)}</TableRow>)}</TableBody>
      </Table></div>);continue;
    }
    const list = line.match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = !list[1], entries: ReactNode[] = [];
      while (index < lines.length) {
        const next = lines[index].match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/);
        if (!next || !next[1] !== ordered) break;
        entries.push(<li key={index}>{inline(next[2])}</li>); index++;
      }
      blocks.push(ordered?<ol key={key}>{entries}</ol>:<ul key={key}>{entries}</ul>); continue;
    }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !tableStart(lines,index) && !/^\s*```|^#{1,6}\s|^\s*(?:[-+*]|\d+[.)])\s/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="pi-message-markdown">{blocks}</div>;
}
