import { useState } from 'react';
import { Button } from './components/ui/button.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Disclosure } from './components/ui/disclosure.tsx';
import { Table,TableHeader,TableBody,TableHead,TableRow,TableCell,TableCaption } from './components/ui/table.tsx';
import { draftChanges,draftColumnKind,draftFieldsWithoutTables,draftTableReviews,type DraftChange,type DraftTableReview } from './agent-draft-review.ts';

function Changes({changes,created=false}:{changes:DraftChange[];created?:boolean}) {
  return <>{changes.map((change,index)=><div className="agent-draft-change" key={index}>
    <p className="meta">{change.field}</p><div className={`agent-draft-values${created?' agent-draft-values--new':''}`}>
      {!created&&<div><span className="meta">原值</span><p className="agent-review-value">{change.before}</p></div>}
      <div><span className="meta">{created?'建议内容':'建议值'}</span><p className="agent-review-value">{change.after}</p></div>
    </div>
  </div>)}</>;
}
const modeLabels={added:'新增',removed:'移除',updated:'修改'};
function DraftTable({value}:{value:DraftTableReview}) {
  const [requestedPage,setPage]=useState(0),pageSize=40;
  const pages=Math.max(1,Math.ceil(value.rows.length/pageSize)),page=Math.min(requestedPage,pages-1),rows=value.rows.slice(page*pageSize,(page+1)*pageSize);
  return <section className="agent-draft-table" aria-label={`${value.title}表格预览`}>
    <div className="agent-draft-table-heading"><strong>{value.title}</strong><Badge variant="secondary">{modeLabels[value.mode]}表格</Badge></div>
    <p className="meta">{value.mode==='updated'?`${value.beforeCount} → ${value.afterCount} 行 · ${value.rows.length} 行内容有变化`:`${value.mode==='removed'?value.beforeCount:value.afterCount} 行`}{' · '}{value.columns.length} 列 · {value.included?'参与交付汇总':'不参与交付汇总'}</p>
    {value.mode==='updated'&&value.structureChanges.length>0&&<Disclosure><summary>表格结构变化 · {value.structureChanges.length}</summary><Changes changes={value.structureChanges}/></Disclosure>}
    {value.columns.length>0?<Table containerProps={{tabIndex:0,role:'region','aria-label':`${value.title}表格，可横向滚动`}} style={{minWidth:Math.max(400,value.columns.length*168+96)}}>
      <TableCaption>{value.title} · {value.mode==='updated'?'仅列出新增、移除或内容变化的行':'完整建议表格'}{rows.length?` · 第 ${page*pageSize+1}–${Math.min((page+1)*pageSize,value.rows.length)} 行`:''}</TableCaption>
      <TableHeader><TableRow><TableHead scope="col">行 / 变更</TableHead>{value.columns.map(column=><TableHead scope="col" key={column.id}><span>{column.previous&&column.previous.name!==column.name?`${column.previous.name} → ${column.name}`:column.name}</span><small>{column.previous&&column.previous.kind!==column.kind?`${draftColumnKind(column.previous.kind)} → ${draftColumnKind(column.kind)}`:draftColumnKind(column.kind)}{value.mode==='updated'&&column.change!=='unchanged'?` · ${modeLabels[column.change]}列`:''}</small></TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map(row=><TableRow key={row.id} data-change={row.mode}>
        <TableCell><span>{row.index}</span><small>{modeLabels[row.mode]}</small></TableCell>
        {row.cells.map((cell,index)=><TableCell key={value.columns[index].id} data-changed={cell.changed}>
          {row.mode==='updated'&&cell.changed?<><span className="agent-draft-cell-label">原值</span><div className="agent-draft-cell-value agent-draft-cell-before">{cell.before}</div><span className="agent-draft-cell-label">建议值</span><div className="agent-draft-cell-value">{cell.after}</div></>
            :<div className="agent-draft-cell-value">{row.mode==='removed'?cell.before:cell.after}</div>}
        </TableCell>)}
      </TableRow>)}{!rows.length&&<TableRow><TableCell colSpan={value.columns.length+1}>{value.mode==='updated'?'单元格内容没有变化，见上方表格结构变化。':'空表格。'}</TableCell></TableRow>}</TableBody>
    </Table>:<p className="meta">{value.mode==='updated'?'单元格内容没有变化。':'空表格。'}</p>}
    {pages>1&&<div className="agent-draft-table-pages"><span className="meta">{page+1} / {pages} 页</span><Button variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(page-1)}>上一页</Button><Button variant="outline" size="sm" disabled={page===pages-1} onClick={()=>setPage(page+1)}>下一页</Button></div>}
  </section>;
}
export function AgentDraftPreview({item}:{item:Record<string,unknown>}) {
  const proposed=item.after??item.proposed,tables=draftTableReviews(item.before,proposed);
  const changes=draftChanges(tables.length?draftFieldsWithoutTables(item.before):item.before,tables.length?draftFieldsWithoutTables(proposed):proposed);
  return <div className="agent-draft-item"><h3>{String(item.title??'业务记录')} · {String(item.actionLabel??'建议变更')}</h3>
    <Changes changes={changes} created={item.before==null}/>{tables.map(table=><DraftTable key={table.id} value={table}/>)}
    {!tables.length&&!changes.length&&<p className="meta">没有内容变化。</p>}
  </div>;
}
