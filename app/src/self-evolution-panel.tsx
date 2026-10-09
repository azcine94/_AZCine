import {useEffect,useRef,useState} from 'react';
import {Sparkles,Clock,FileText,ChevronLeft,ChevronRight,ExternalLink,Search} from 'lucide-react';
import {LoadingStatus} from './components/ui/loading-status.tsx';
import {Button} from './components/ui/button.tsx';
import {Input} from './components/ui/input.tsx';
import {Textarea} from './components/ui/textarea.tsx';
import {Checkbox} from './components/ui/checkbox.tsx';
import {NativeSelect} from './components/ui/native-select.tsx';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from './components/ui/table.tsx';
import {Card} from './components/ui/card.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import {FormDialog} from './components/ui/form-dialog.tsx';
import {Disclosure} from './components/ui/disclosure.tsx';
import {RecordPagination,recordPage} from './components/ui/record-pagination.tsx';
import {piError} from './pi-client.ts';
import {selectRange} from './self-evolution-types.ts';
import type {EvolutionController} from './use-self-evolution.ts';
import type {EvolutionCandidate} from './self-evolution-types.ts';

const statusNames:Record<string,string>={pending:'待批准',written:'已写入',dismissed:'不记住',reverted:'已撤销',conflict:'文件冲突',running:'提取中',completed:'已完成',failed:'失败',interrupted:'中断',cancelled:'已取消'};
function date(text:string){return text?new Date(text).toLocaleString('zh-CN',{hour12:false}):'未记录时间';}
export function SelfEvolutionPanel({model:m}:{model:EvolutionController}){
  const [settingsOpen,setSettingsOpen]=useState(false),[historyOpen,setHistoryOpen]=useState(false),[source,setSource]=useState<{id:string;messages:Array<{role:string;content:Array<{type:string;text?:string}>}>}|null>(null),[sourceBusy,setSourceBusy]=useState(false);
  const [resourceQuery,setResourceQuery]=useState(''),[models,setModels]=useState<Array<{provider:string;id:string;name?:string}>>([]);
  const [modelsError,setModelsError]=useState(''),[modelsLoading,setModelsLoading]=useState(false);
  const modelsRequest=useRef(0);
  useEffect(()=>()=>{modelsRequest.current+=1;},[m.root]);
  const anchor=useRef<{id:string;scope:string}|null>(null),sourceRequest=useRef(0),reviewBody=useRef<HTMLDivElement>(null);
  const snapshot=m.snapshot,state=snapshot?.state,busy=m.working||!!snapshot?.busy;
  const all=state?.candidates??[],resources=snapshot?.resources??[];
  const inTab=(c:EvolutionCandidate)=>c.status===m.tab;
  const filtered=all.filter(inTab).filter(c=>(m.target==='all'||c.target===m.target)&&(m.kind==='all'||c.kind===m.kind)&&[c.title,c.after,c.before,c.source.title,c.source.quote,c.target].join(' ').toLowerCase().includes(m.query.trim().toLowerCase()));
  const range=recordPage(filtered.length,m.page,m.pageSize),rows=filtered.slice(range.start,range.end),ids=rows.map(c=>c.id),scope=ids.join('|');
  const current=filtered.find(c=>c.id===m.active),resource=resources.find(r=>r.id===current?.target),change=state?.changes.slice().reverse().find(w=>w.candidates.includes(current?.id??''));
  const pending=all.filter(c=>c.status==='pending'),chosen=pending.filter(c=>m.selected.has(c.id)),draft=current?m.drafts[current.id]:undefined;
  const conflict=current&&resource&&current.baseHash!==resource.hash;
  function review(id:string){m.setActive(id);anchor.current={id,scope};reviewBody.current?.scrollTo({top:0});}
  function pick(id:string,checked:boolean,shift=false){
    if(busy||m.tab!=='pending')return;const start=anchor.current?.scope===scope?anchor.current.id:null;
    m.setSelected(previous=>selectRange(previous,ids,start,id,checked,shift));if(!shift||!start)anchor.current={id,scope};
  }
  function rowClick(c:EvolutionCandidate,event:{shiftKey:boolean;ctrlKey:boolean;metaKey:boolean}){
    if(event.shiftKey&&m.tab==='pending')pick(c.id,true,true);
    else if((event.ctrlKey||event.metaKey)&&m.tab==='pending')pick(c.id,!m.selected.has(c.id));
    else review(c.id);
  }
  async function loadModels(){
    const ticket=++modelsRequest.current;setModelsLoading(true);setModelsError('');
    try{const rows=await m.models();if(ticket===modelsRequest.current)setModels(rows);}
    catch(e){if(ticket===modelsRequest.current)setModelsError(piError(e));}
    finally{if(ticket===modelsRequest.current)setModelsLoading(false);}
  }
  function openSettings(){if(!m.settingsDraft&&state)m.setSettingsDraft(structuredClone(state.settings));setSettingsOpen(true);void loadModels();}
  async function showSource(c:EvolutionCandidate){const ticket=++sourceRequest.current;setSourceBusy(true);try{const value=await m.source(c.id);if(sourceRequest.current===ticket)setSource({id:c.id,messages:value.messages});}catch(e){m.setError(piError(e));}finally{if(sourceRequest.current===ticket)setSourceBusy(false);}}
  async function openRaw(id:string){try{await m.openSource(id);}catch(e){m.setError(piError(e));}}
  function clearFilters(){m.setQuery('');m.setTarget('all');m.setKind('all');m.setPage(1);}
  const settings=m.settingsDraft;
  return <section className="evolution-page" aria-label="自进化">
    <header className="evolution-toolbar"><div><p className="subtle">从日常对话提取候选，批准后更新 AGENTS.md 或对应 Skill。</p><p className="meta"><Clock size={14}/>{state?.settings.automatic?`每天 ${state.settings.time} 自动提取`:'手动提取'} · 只提候选，写入始终由你批准</p></div>
      <div className="evolution-actions"><Button variant="outline" size="sm" onClick={()=>void m.refresh()} disabled={m.working}>刷新</Button><Button variant="outline" size="sm" onClick={()=>void openSettings()} disabled={!state||busy}>提取设置</Button><Button size="sm" disabled={!state||m.working} onClick={()=>void m.extract(!!snapshot?.busy)}><Sparkles/>{snapshot?.busy?'取消提取':'立即提取'}</Button></div>
    </header>
    {m.error&&<Feedback tone="error" role="alert">{m.error}</Feedback>}
    <div className="evolution-tabs">{[['pending','待批准'],['written','已写入'],['reverted','已撤销'],['dismissed','不记住'],...((all.some(c=>c.status==='conflict')||m.tab==='conflict')?[['conflict','文件冲突']]:[])].map(([key,label])=><Button variant="app-underline-tab" key={key} aria-pressed={m.tab===key} onClick={()=>{m.setTab(key);m.setPage(1);}}>{label} <span className="meta">{all.filter(c=>c.status===key).length}</span></Button>)}<Button variant="outline" size="sm" onClick={()=>setHistoryOpen(true)}>提取记录</Button></div>
    <div className="evolution-filters"><label className="evolution-search"><Search size={16}/><Input className="pl-9" aria-label="搜索候选或来源会话" placeholder="搜索候选内容或来源会话…" value={m.query} onChange={e=>{m.setQuery(e.target.value);m.setPage(1);}}/></label><NativeSelect size="sm" aria-label="写入位置筛选" value={m.target} onChange={e=>{m.setTarget(e.target.value);m.setPage(1);}}><option value="all">全部写入位置</option>{resources.map(r=><option key={r.id} value={r.id}>{r.id}</option>)}</NativeSelect><NativeSelect size="sm" aria-label="修改类型筛选" value={m.kind} onChange={e=>{m.setKind(e.target.value);m.setPage(1);}}><option value="all">全部修改类型</option>{['新增规则','修订方法','移除旧规则'].map(k=><option key={k}>{k}</option>)}</NativeSelect><Button variant="outline" size="sm" onClick={clearFilters}>清除筛选</Button><span className="meta">{filtered.length} 条结果</span></div>
    <div className="evolution-columns">
      <Card className="evolution-list gap-0 py-0">
        <Table variant="records" containerProps={{className:'evolution-table-scroll'}}><TableHeader><TableRow><TableHead className="evolution-check">{m.tab==='pending'&&<Checkbox aria-label="选择当前页" disabled={busy||!rows.length} checked={rows.length>0&&rows.every(c=>m.selected.has(c.id))?true:rows.some(c=>m.selected.has(c.id))?'indeterminate':false} onCheckedChange={value=>m.setSelected(previous=>{const next=new Set(previous);ids.forEach(id=>value===true?next.add(id):next.delete(id));return next;})}/>}</TableHead><TableHead>候选内容</TableHead><TableHead className="evolution-operation">操作</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map(c=><TableRow key={c.id} tabIndex={0} aria-label={`审阅：${c.title}`} data-active={m.active===c.id} data-state={m.selected.has(c.id)?'selected':undefined} onMouseDown={e=>{if(e.shiftKey&&!(e.target as HTMLElement).closest('button,input,a'))e.preventDefault();}} onClick={e=>{if((e.target as HTMLElement).closest('button,input,a,label'))return;if(!e.shiftKey&&window.getSelection()?.toString())return;rowClick(c,e);}} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();rowClick(c,e);}}}>
          <TableCell className="evolution-check">{m.tab==='pending'&&<Checkbox aria-label={`勾选：${c.title}`} disabled={busy} checked={m.selected.has(c.id)} onClick={e=>{e.stopPropagation();pick(c.id,!m.selected.has(c.id),e.shiftKey);}}/>}</TableCell><TableCell><strong>{c.title}</strong><p>{c.after||`移除：${c.before}`}</p><small>{c.kind} · {c.target}{c.status!=='pending'?` · ${statusNames[c.status]??c.status}`:''}</small></TableCell><TableCell><Button variant="outline" size="sm" aria-pressed={m.active===c.id} onClick={()=>review(c.id)}>{m.active===c.id?'审阅中':'审阅'}</Button></TableCell>
        </TableRow>)}</TableBody></Table>
        {!rows.length&&<div className="evolution-empty"><FileText/><p>{!snapshot?'正在读取…':all.length?'没有匹配的候选':'还没有候选，点击「立即提取」开始。'}</p></div>}
        <RecordPagination label="候选" total={filtered.length} page={range.page} pageSize={m.pageSize} onPageChange={m.setPage} onPageSizeChange={size=>{m.setPageSize(size);m.setPage(1);}}/>
      </Card>
      <Card className="evolution-review gap-0 py-0" aria-label="审阅区">
        <header><div><p className="meta">{current?`${current.kind} · ${statusNames[current.status]??current.status}`:'审阅区'}</p><h2>{current?.title??'选择一条候选'}</h2></div><div className="evolution-actions"><Button variant="ghost" size="icon-sm" aria-label="上一条候选" disabled={!current||filtered.findIndex(c=>c.id===current.id)<=0} onClick={()=>review(filtered[filtered.findIndex(c=>c.id===current?.id)-1].id)}><ChevronLeft/></Button><Button variant="ghost" size="icon-sm" aria-label="下一条候选" disabled={!current||filtered.findIndex(c=>c.id===current.id)<0||filtered.findIndex(c=>c.id===current.id)>=filtered.length-1} onClick={()=>review(filtered[filtered.findIndex(c=>c.id===current?.id)+1].id)}><ChevronRight/></Button></div></header>
        <div className="evolution-review-body" ref={reviewBody}>{current?<>
          <section><h3>{current.kind==='移除旧规则'?'准备移除的内容':'准备沉淀的内容'}</h3>{draft===undefined?<p className="evolution-rule">{current.after||current.before}</p>:<><Textarea aria-label="改写候选" value={draft} onChange={e=>m.setDrafts(v=>({...v,[current.id]:e.target.value}))}/><div className="evolution-actions"><Button size="sm" variant="outline" onClick={()=>m.setDrafts(v=>{const next={...v};delete next[current.id];return next;})}>取消改写</Button><Button size="sm" disabled={busy||!draft.trim()} onClick={async()=>{if(await m.mutate('edit',{id:current.id,content:draft}))m.setDrafts(v=>{const next={...v};delete next[current.id];return next;});}}>保存候选</Button></div></>}</section>
          <section><h3>写入位置</h3><div className="evolution-path"><FileText size={16}/><span>{current.target}</span></div><p className="meta">{current.status==='reverted'?'这次写入已撤销。放回候选后需重新核对并批准。':'批准后下次新对话读取；当前对话需重新连接。'}</p><Disclosure><summary>查看修改前后</summary><h4>修改前</h4><pre>{current.before||'尚无这条规则'}</pre><h4>修改后</h4><pre>{current.after||'移除此条规则'}</pre></Disclosure><Disclosure><summary>查看当前文件</summary><pre>{resource?.content||'文件尚未创建或内容为空。'}</pre></Disclosure>{conflict&&current.status==='pending'&&<Feedback tone="conflict">文件已变化，请对照当前内容核对。<Button variant="outline" size="sm" disabled={busy} onClick={()=>void m.mutate('rebase',{id:current.id})}>已核对，更新候选对照</Button></Feedback>}</section>
          <section><h3>来源会话</h3><div className="evolution-source"><strong>{current.source.title||current.source.session}</strong><p className="meta">{date(current.source.timestamp)} · 第 {current.source.ordinal} 条 · {current.source.message}</p><blockquote>{current.source.quote}</blockquote><div className="evolution-actions"><Button variant="outline" size="sm" disabled={sourceBusy} onClick={()=>void showSource(current)}>查看原文及前后文</Button><Button variant="outline" size="sm" onClick={()=>void openRaw(current.id)}>打开原文件<ExternalLink size={14}/></Button></div><p className="evolution-filename">{current.source.path}</p></div>{source?.id===current.id&&<Disclosure open><summary>会话原文</summary><div className="evolution-transcript">{source.messages.filter(message=>['user','assistant'].includes(message.role)).map((message,index)=><article key={index}><strong>{message.role==='user'?'你':'Agent'}</strong><p>{message.content.filter(part=>part.type==='text').map(part=>part.text??'').join('\n')}</p></article>)}</div></Disclosure>}</section>
          {change&&<p className="meta">最近写入：{date(change.at)} · {statusNames[change.status]??change.status}</p>}
        </>:<div className="evolution-empty"><FileText/><p>点击左侧候选，在这里核对内容和来源。</p></div>}</div>
        <footer>{current?.status==='pending'?<><label><Checkbox checked={m.selected.has(current.id)} disabled={busy} onCheckedChange={value=>m.setSelected(v=>{const next=new Set(v);value===true?next.add(current.id):next.delete(current.id);return next;})}/>加入批量批准</label><div className="evolution-actions">{current.kind!=='移除旧规则'&&<Button variant="outline" size="sm" disabled={busy||draft!==undefined} onClick={()=>m.setDrafts(v=>({...v,[current.id]:current.after}))}>改写</Button>}<Button variant="outline" size="sm" disabled={busy||draft!==undefined} onClick={()=>void m.mutate('dismiss',{id:current.id})}>不记住</Button></div></>:(current?.status==='dismissed'||current?.status==='reverted')?<Button size="sm" disabled={busy} onClick={async()=>{if(await m.mutate('restore',{id:current.id})){m.setTab('pending');m.setPage(1);}}}>放回候选</Button>:change?.status==='written'?<Button variant="outline" size="sm" disabled={busy} onClick={()=>void m.mutate('undo',{id:change.id})}>撤销这次文件写入</Button>:<span className="meta">核对后再批准写入</span>}</footer>
      </Card>
    </div>
    <footer className="evolution-batch"><div><strong>已选 {chosen.length} 项</strong><p className="meta">点行审阅 · Shift 连选当前页 · Ctrl 增减选择 · 批准包含跨页已选项</p></div><div className="evolution-actions"><Button variant="outline" size="sm" disabled={!chosen.length} onClick={()=>m.setSelected(new Set())}>清空选择</Button><Button size="sm" disabled={busy||!chosen.length||chosen.some(c=>m.drafts[c.id]!==undefined)} onClick={()=>void m.mutate('approve',{ids:chosen.map(c=>c.id)})}>批准已选{chosen.length?`（${chosen.length}）`:''}</Button></div></footer>
    <FormDialog open={settingsOpen} onOpenChange={setSettingsOpen} title="提取设置" description="仅分析工作台对话；自动提取不会自动批准。应用实际运行时执行，关闭后不运行。" footer={<Button disabled={busy||!settings} onClick={async()=>{if(await m.mutate('settings',{settings})){setSettingsOpen(false);m.setSettingsDraft(null);}}}>保存设置</Button>}>
      {settings&&<div className="evolution-settings"><label><Checkbox checked={settings.automatic} onCheckedChange={value=>m.setSettingsDraft({...settings,automatic:value===true})}/>每天自动提取（北京时间）</label><label>执行时间<Input type="time" value={settings.time} onChange={e=>m.setSettingsDraft({...settings,time:e.target.value})}/></label><label>每轮新增字符上限<Input type="number" min={4000} max={100000} value={settings.budget} onChange={e=>m.setSettingsDraft({...settings,budget:Number(e.target.value)})}/></label><label>分析模型<NativeSelect disabled={modelsLoading} aria-describedby={modelsError?'evolution-model-error':undefined} value={settings.model?JSON.stringify(settings.model):''} onChange={e=>m.setSettingsDraft({...settings,model:e.target.value?JSON.parse(e.target.value):null})}><option value="">使用 Pi 当前默认模型</option>{settings.model&&!models.some(model=>model.provider===settings.model?.provider&&model.id===settings.model?.id)&&<option value={JSON.stringify(settings.model)}>{settings.model.provider} / {settings.model.id}（当前选择）</option>}{models.map(model=><option key={model.provider+model.id} value={JSON.stringify({provider:model.provider,id:model.id})}>{model.provider} / {model.name??model.id}</option>)}</NativeSelect></label><LoadingStatus active={modelsLoading}>正在读取模型选项…</LoadingStatus>{modelsError&&<Feedback id="evolution-model-error" tone="error" role="alert">{modelsError}<p>模型选项暂未读到，已生成的候选和当前模型设置保留。</p><Button variant="outline" size="sm" disabled={modelsLoading} onClick={()=>void loadModels()}>重试读取模型选项</Button></Feedback>}<h3>允许写入的自有文件</h3><Input placeholder="搜索文件…" aria-label="搜索允许写入文件" value={resourceQuery} onChange={e=>setResourceQuery(e.target.value)}/><div className="evolution-resource-options">{resources.filter(r=>r.id.toLowerCase().includes(resourceQuery.toLowerCase())).map(r=><label key={r.id}><Checkbox checked={settings.allowed.includes(r.id)} onCheckedChange={value=>m.setSettingsDraft({...settings,allowed:value===true?[...settings.allowed,r.id]:settings.allowed.filter(id=>id!==r.id)})}/><span>{r.id}</span></label>)}</div><p className="meta">APPEND_SYSTEM.md 保留原样，不属于自进化写入目标。</p></div>}
    </FormDialog>
    <FormDialog open={historyOpen} onOpenChange={setHistoryOpen} title="提取记录" description="仅完成并保存的批次推进读取进度，失败或取消可以继续提取。">{state?.runs.slice().reverse().map(run=><article className="evolution-run" key={run.id}><strong>{run.trigger}提取 · {statusNames[run.status]??run.status}</strong><p className="meta">{date(run.startedAt)} · {run.messages} 条消息 · {run.candidates} 条候选</p>{run.error&&<p>{run.error}</p>}</article>)}</FormDialog>
  </section>;
}
