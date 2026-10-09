import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { Button } from './components/ui/button.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { StatusBadge } from './components/ui/status-badge.tsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table.tsx';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { processFixture } from './ui-preview/process-monitor-fixture.ts';

export interface ProcessInfo {
  id:string; pid:number; source:string; status:string; context:string|null; startedAt:number; endedAt:number|null;
  lastActivityAt:number; pending:number; activeProcesses:number|null; error:string|null;
}
const labels:Record<string,string>={idle:'空闲',running:'执行中',requesting:'等待响应',waiting:'等待用户',failed:'异常',stopped:'已停止',exited:'已退出'};
function duration(ms:number){const seconds=Math.max(0,Math.floor(ms/1000));return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;}
const message=(error:unknown)=>typeof error==='object'&&error!==null&&'message' in error?String(error.message):'进程操作失败，请重试。';
const active=(row:ProcessInfo)=>row.activeProcesses!==0;

export function ProcessMonitorPanel({preview}:{preview?:string}) {
  const [rows,setRows]=useState<ProcessInfo[]>(()=>preview?processFixture(preview):[]);
  const [loading,setLoading]=useState(!preview||preview==='loading');
  const [error,setError]=useState(preview==='error'?'示例：无法读取进程状态，保留上次结果。':'');
  const [auto,setAuto]=useState(true),[filter,setFilter]=useState('active');
  const [selected,setSelected]=useState<ProcessInfo|null>(null),[stopping,setStopping]=useState(false),[stopError,setStopError]=useState('');
  const [checkedAt,setCheckedAt]=useState<number|null>(preview?Date.now():null);
  const mounted=useRef(false),reading=useRef(false);
  useEffect(()=>{
    if(!preview)return;
    const sample=processFixture(preview);setRows(sample);setLoading(preview==='loading');
    setError(preview==='error'?'示例：无法读取进程状态，保留上次结果。':'');
    setSelected(preview.startsWith('process-stop-')?sample[1]??null:null);
    setStopError(preview==='process-stop-error'?'示例：停止未确认，请刷新查看进程是否仍存活。':'');
  },[preview]);
  const refresh=useCallback(async()=>{
    if(preview||reading.current)return;
    if(!isTauri()){setError('请在桌面应用中查看进程。');setLoading(false);return;}
    reading.current=true;
    try {const result=await invoke<ProcessInfo[]>('pi_processes');if(mounted.current){setRows(result);setCheckedAt(Date.now());setError('');}}
    catch(e){if(mounted.current)setError(message(e));}
    finally{reading.current=false;if(mounted.current)setLoading(false);}
  },[preview]);
  useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;};},[refresh]);
  useEffect(()=>{if(!auto||preview)return;const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},3000);return()=>clearInterval(timer);},[auto,preview,refresh]);
  async function stop(){
    if(!selected||stopping)return;setStopping(true);setStopError('');
    try {
      if(preview)setRows(old=>old.map(row=>row.id===selected.id?{...row,status:'stopped',endedAt:Date.now(),activeProcesses:0,pending:0}:row));
      else await invoke('pi_stop_process',{id:selected.id});
      if(mounted.current){setSelected(null);notifyOperation('进程已停止，输入和已有结果保留。');await refresh();}
    }catch(e){if(mounted.current)setStopError(message(e));}
    finally{if(mounted.current)setStopping(false);}
  }
  const shown=rows.filter(row=>filter==='all'||(filter==='active'?active(row):row.status==='failed'));
  const now=Date.now();
  return <section className="settings-page process-monitor">
    <header className="settings-page-header"><h2>进程监控</h2><p className="subtle">查看本应用的 Agent 进程。停止后，对应任务会中断，输入与已有结果保留。</p></header>
    <div className="process-monitor-toolbar">
      <div className="check-actions">{[['active','存活进程'],['all','全部记录'],['failed','异常记录']].map(([value,label])=><Button key={value} variant="outline" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label} {rows.filter(row=>value==='all'||(value==='active'?active(row):row.status==='failed')).length}</Button>)}</div>
      <div className="check-actions"><Button variant="outline" aria-pressed={auto} onClick={()=>setAuto(!auto)}>{auto?'自动刷新 · 3 秒':'自动刷新已暂停'}</Button><Button variant="outline" onClick={()=>void refresh()} disabled={loading}>刷新</Button></div>
    </div>
    <p className="meta">{checkedAt?`最近刷新 ${new Date(checkedAt).toLocaleTimeString('zh-CN')}`:'尚未读取'} · 显示本次应用启动后的进程，保留最近 100 条已释放记录。长时间没有新活动不一定是异常。</p>
    {error&&<Feedback tone="error" role="alert">{error}</Feedback>}
    <Table variant="records" density="compact" containerProps={{className:'process-monitor-table'}}>
      <TableHeader><TableRow><TableHead>来源 / PID</TableHead><TableHead>状态</TableHead><TableHead>运行时长</TableHead><TableHead>最近活动</TableHead><TableHead>待响应 / 存活数</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
      <TableBody>{shown.map(row=><TableRow key={row.id}>
        <TableCell><strong>{row.source}</strong><div className="meta">PID {row.pid}</div>{row.context&&<div className="meta process-monitor-detail">{row.context}</div>}{row.error&&<p className="meta process-monitor-detail">{row.error}</p>}</TableCell>
        <TableCell><StatusBadge tone={row.status==='failed'?'error':row.status==='waiting'?'warning':'neutral'}>{labels[row.status]??'状态未知'}</StatusBadge>{row.endedAt!==null&&active(row)&&<div className="meta">{row.activeProcesses===null?'退出状态待确认':'进程树清理中'}</div>}</TableCell>
        <TableCell>{duration((row.endedAt??now)-row.startedAt)}<div className="meta" title={new Date(row.startedAt).toLocaleString('zh-CN')}>{new Date(row.startedAt).toLocaleTimeString('zh-CN')} 启动</div></TableCell>
        <TableCell>{duration(now-row.lastActivityAt)}前</TableCell>
        <TableCell>{row.pending} / {row.activeProcesses??'未知'}</TableCell>
        <TableCell><Button variant="outline" disabled={!active(row)||stopping} onClick={()=>{setSelected(row);setStopError('');}}>停止进程</Button></TableCell>
      </TableRow>)}{!shown.length&&<TableRow><TableCell colSpan={6}>{loading?'正在读取进程状态…':error?'暂无可显示的进程状态。':'没有符合条件的进程。'}</TableCell></TableRow>}</TableBody>
    </Table>
    <p className="meta">“待响应”指尚未收到回执的请求；“存活数”包含该进程启动的子进程。状态来自实际进程与通信事件。</p>
    <FormDialog open={!!selected} onOpenChange={open=>{if(!open&&!stopping)setSelected(null);}} title="停止进程" description={`停止 ${selected?.source??''}（PID ${selected?.pid??''}）及其子进程，当前未完成的任务会中断。`}>
      {stopError&&<Feedback tone="error" role="alert">{stopError}</Feedback>}
      <div className="ui-form-dialog-actions"><Button variant="outline" disabled={stopping} onClick={()=>setSelected(null)}>返回</Button><Button disabled={stopping} onClick={()=>void stop()} loading={!!(stopping)} loadingText="正在停止…">停止进程</Button></div>
    </FormDialog>
  </section>;
}
