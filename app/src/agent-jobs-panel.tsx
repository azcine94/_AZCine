import {AgentObjectPicker} from './agent-object-picker.tsx';
import {Button} from './components/ui/button.tsx';
import {Textarea} from './components/ui/textarea.tsx';
import {NativeSelect} from './components/ui/native-select.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import {Disclosure} from './components/ui/disclosure.tsx';
import type {AgentJobsController} from './use-agent-jobs.ts';
import {RecordContextMenu} from './components/ui/record-context-menu.tsx';
const labels:Record<string,string>={queued:'等待名额',running:'正在整理',waitingChildren:'等待分段结果',cancelling:'正在取消',cancelled:'已取消',completed:'已完成',failed:'未完成',interrupted:'上次运行中断'};
export function AgentJobsPanel({model}:{model:AgentJobsController}){
  const snapshot=model.snapshot;
  return <section className="panel agent-jobs" aria-label="Agent后台任务"><header><h2>Agent后台整理</h2><p className="meta">{snapshot?`${snapshot.slots.active.length} / ${snapshot.slots.limit} 个后台名额使用中 · ${snapshot.slots.queued.length} 个等待`:'正在读取任务记录'} · 与资讯共用后台名额</p></header>
    {model.error&&<Feedback tone="error">{model.error}</Feedback>}
    <AgentObjectPicker model={model.objects}/><form onSubmit={e=>{e.preventDefault();void model.submit();}}><label>整理方式<NativeSelect value={model.template} onChange={e=>model.setTemplate(e.target.value)}><option value="summarize-text">整理一份正文</option><option value="summarize-batch">逐段整理 · 空行分段</option><option value="draft-objects">生成附加对象的业务草案</option></NativeSelect></label><Textarea aria-label="后台任务正文" placeholder="粘贴需要整理的正文；分段任务以空行分隔，最多16段。" value={model.content} onChange={e=>model.setContent(e.target.value)} rows={4}/><div><Button disabled={model.busy||!model.content.trim()} type="submit">{model.busy?'正在保存任务…':'加入后台队列'}</Button><Button type="button" variant="outline" onClick={()=>void model.objects.show()}>附加对象 · {model.objects.objects.length}</Button></div><p className="meta">结果留在任务记录中。后台仅在电脑和应用运行时执行；重启后中断任务保留，不自动重发。</p></form>
    {!snapshot?.jobs.length&&<p className="meta">还没有Agent后台任务。</p>}
    {snapshot?.jobs.map(job=><RecordContextMenu key={job.id} copyText={job.output??job.input} actions={['queued','running','waitingChildren'].includes(job.status)?[{label:'取消任务',disabled:model.busy,run:()=>{void model.cancel(job.id);}}]:[]}><article className="agent-job-row" key={job.id}><div><p>{job.parentId?'分段 · ':''}{job.template==='summarize-batch'?'逐段整理':'正文整理'} · {labels[job.status]??job.status}</p><p className="meta">{new Date(job.createdAt).toLocaleString('zh-CN')}</p>{job.error&&<Feedback tone={job.status==='cancelled'?'info':'error'}>{job.error}</Feedback>}<Disclosure><summary>原始输入{job.output?'与实际结果':''}</summary><pre>{job.input}</pre>{job.output&&<pre>{job.output}</pre>}</Disclosure><Disclosure><summary>运行日志</summary>{snapshot.logs?.filter(log=>log.jobId===job.id).slice().reverse().map((log,index)=><p className="meta" key={index}>{new Date(log.at).toLocaleTimeString('zh-CN')} · {log.message}</p>)}</Disclosure></div>{['queued','running','waitingChildren'].includes(job.status)&&<Button size="sm" variant="outline" onClick={()=>void model.cancel(job.id)}>取消</Button>}</article></RecordContextMenu>)}
  </section>;
}
