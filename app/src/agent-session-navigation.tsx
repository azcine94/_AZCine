import { useId,useRef,useState } from 'react';
import { ChevronDown,ChevronLeft,ListChecks,MoreHorizontal,Pin,PinOff,Pencil,Trash2,X,Copy } from 'lucide-react';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Label } from './components/ui/label.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import { StatusDot } from './components/ui/status-dot.tsx';
import type { StatusDotTone } from './components/ui/status-dot.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { FormDialog } from './components/ui/form-dialog.tsx';
import { DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem } from './components/ui/dropdown-menu.tsx';
import { RecordContextMenu } from './components/ui/record-context-menu.tsx';
import { Tooltip,TooltipContent,TooltipProvider,TooltipTrigger } from './components/ui/tooltip.tsx';
import { PiIcon } from './pi-process-panel.tsx';
import { piError } from './pi-client.ts';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import type { ConversationDeleteTarget,RuntimeSummary } from './pi-client.ts';
import type { PiController } from './use-pi.ts';

type SessionStatus={label:string;tone:StatusDotTone;kind?:string};
type SessionRow={target:ConversationDeleteTarget;name:string;active:boolean;protected:boolean;status:SessionStatus;activityAt:number;select:()=>void};
type NamedTarget=ConversationDeleteTarget&{name:string};
function sessionStatus(row:Pick<RuntimeSummary['conversations'][number],'waiting'|'active'|'connection'|'outcome'>,unread=false):SessionStatus{
  if(row.waiting)return {label:'待你回答',tone:'warning',kind:'waiting'};
  if(row.connection==='error')return {label:'连接异常',tone:'error'};
  if(row.connection==='connecting')return {label:'连接中',tone:'neutral',kind:'running'};
  if(row.active)return {label:'运行中',tone:'active',kind:'running'};
  if(row.outcome==='error')return {label:'回复失败',tone:'error'};
  if(row.outcome==='interrupted'||row.outcome==='incomplete')return {label:'回复未完成',tone:'warning'};
  if(unread)return {label:'回复完成 · 未读',tone:'active',kind:'unread'};
  return {label:row.connection==='ready'?'空闲':'已保存',tone:'neutral',kind:'idle'};
}
const activityTime=(value?:string|null)=>value?Date.parse(value)||0:0;
const activityLabel=(time:number)=>time?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(time):'尚无对话活动';
function readGroups():Record<string,boolean>{try{return JSON.parse(localStorage.getItem('azcine.agent-session-groups')??'{}')??{};}catch{return {};}}
export function AgentSessionNavigation({model,busy,attaching,inDialog=false,onNavigate,onCollapse,returnFocus}:{model:PiController;busy:boolean;attaching:boolean;inDialog?:boolean;onNavigate:()=>void;onCollapse:()=>void;returnFocus:()=>HTMLElement|null}){
  const [query,setQuery]=useState(''),[groups,setGroups]=useState(readGroups),[managing,setManaging]=useState(false),[selected,setSelected]=useState<string[]>([]);
  const [targets,setTargets]=useState<NamedTarget[]>([]),[errors,setErrors]=useState<string[]>([]),[deleting,setDeleting]=useState(false);
  const origin=useRef<HTMLElement|null>(null),inFlight=useRef(false),manageButton=useRef<HTMLButtonElement>(null);
  const [renameTarget,setRenameTarget]=useState<NamedTarget|null>(null),[renameName,setRenameName]=useState(''),[renameError,setRenameError]=useState(''),[renaming,setRenaming]=useState(false);
  const renameOrigin=useRef<HTMLElement|null>(null),renameFlight=useRef(false);
  const renameNameId=useId(),renameErrorId=useId();
  const nativeRows=model.runtimeSummary?.conversations.filter(row=>!!row.sessionId)??[];
  const allLive=[...new Set(nativeRows.map(row=>row.sessionId))].map(id=>{const matches=nativeRows.filter(row=>row.sessionId===id);const row=matches.find(row=>row.conversationKey===model.conversationKey)??matches[0]!;return{...row,active:matches.some(row=>row.active),waiting:matches.some(row=>row.waiting),connection:matches.some(row=>row.connection==='connecting')?'connecting':row.connection};});
  const state=model.snapshot?.state;
  const activity=model.sessionActivity.entries;
  const isUnread=(id:string)=>!!activity[id]&&activity[id].replyAt>activity[id].readAt;
  const live:SessionRow[]=allLive.map(row=>{
    const session=model.sessions.find(session=>session.id===row.sessionId),saved=activity[row.sessionId!];
    return {target:{conversationKey:row.conversationKey,sessionPath:row.sessionFile,sessionId:row.sessionId!,generation:row.generation},name:row.name??session?.name??'未命名会话',active:row.conversationKey===model.conversationKey,protected:row.active||row.waiting||row.connection==='connecting',status:sessionStatus(row,isUnread(row.sessionId!)),activityAt:Math.max(saved?.activityAt??0,row.lastActivityAt??0,activityTime(session?.lastActivityAt)),select:()=>{onNavigate();void model.selectConversation(row.conversationKey);}};
  });
  const history:SessionRow[]=model.sessions.filter(session=>!allLive.some(row=>row.sessionId===session.id)).map(session=>({target:{conversationKey:null,sessionPath:session.path,sessionId:session.id,generation:null},name:session.name??'未命名会话',active:state?.sessionFile===session.path,protected:state?.sessionFile===session.path&&!!(model.snapshot?.busy||model.snapshot?.sending||model.snapshot?.stopping||model.snapshot?.connection==='connecting'||model.snapshot?.projection.activity!=='idle'),status:sessionStatus({connection:'disconnected',active:false,waiting:false,outcome:'none'},isUnread(session.id)),activityAt:Math.max(activity[session.id]?.activityAt??0,activityTime(session.lastActivityAt)),select:()=>{onNavigate();void model.selectSession(session);}}));
  const filter=(row:SessionRow)=>row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const rows=[...live,...history];
  const eligible=rows.filter(row=>!row.protected),matching=eligible.filter(filter),chosen=eligible.filter(row=>selected.includes(row.target.sessionId));
  const blocked=busy||attaching||deleting||renaming;
  const pinOrder=new Map<string,number>(model.sessionPins.map((id,index)=>[id,index]));
  const pinnedRows=rows.filter(row=>pinOrder.has(row.target.sessionId)),recentRows=rows.filter(row=>!pinOrder.has(row.target.sessionId));
  function collapse(key:string){setGroups(before=>{const next={...before,[key]:!before[key]};try{localStorage.setItem('azcine.agent-session-groups',JSON.stringify(next));}catch{/* Keep the preference in memory. */}return next;});}
  function toggleManagement(){const entering=!managing;setManaging(entering);setSelected([]);if(entering)setGroups(before=>{const next={...before,pinned:false,recent:false};try{localStorage.setItem('azcine.agent-session-groups',JSON.stringify(next));}catch{/* Keep the preference in memory. */}return next;});}
  function togglePin(row:SessionRow,trigger:HTMLElement|null){
    const body=trigger?.closest('.pi-session-body'),pinned=pinOrder.has(row.target.sessionId),destination=pinned?'recent':'pinned';
    setGroups(before=>{const next={...before,[destination]:false};try{localStorage.setItem('azcine.agent-session-groups',JSON.stringify(next));}catch{/* Keep the preference in memory. */}return next;});
    model.setSessionPinned(row.target.sessionId,!pinned);
    requestAnimationFrame(()=>Array.from(body?.querySelectorAll<HTMLButtonElement>('[data-session-pin]')??[]).find(button=>button.dataset.sessionPin===row.target.sessionId)?.focus({preventScroll:true}));
  }
  async function copySessionPath(row:SessionRow){
    const path=row.target.sessionPath;
    if(!path){notifyOperation('此会话还没有 JSONL 文件路径。',{tone:'error'});return;}
    try{await navigator.clipboard.writeText(path);notifyOperation('已复制会话 JSONL 路径。');}
    catch{notifyOperation('复制失败，请重试。',{tone:'error'});}
  }
  function confirm(rows:SessionRow[],trigger:HTMLElement|null){origin.current=trigger;setErrors([]);setTargets(rows.map(row=>({...row.target,name:row.name})));}
  function beginRename(row:SessionRow,trigger:HTMLElement|null){renameOrigin.current=trigger;setRenameTarget({...row.target,name:row.name});setRenameName(row.name);setRenameError('');}
  async function rename(){if(renameFlight.current||!renameTarget)return;renameFlight.current=true;setRenaming(true);setRenameError('');
    try{await model.renameConversation(renameTarget,renameName);setRenameTarget(null);}catch(error){setRenameError(piError(error));}finally{renameFlight.current=false;setRenaming(false);}
  }
  async function remove(){if(inFlight.current||!targets.length)return;inFlight.current=true;setDeleting(true);setErrors([]);const current=targets;
    try{const result=await model.deleteConversations(current);model.sessionActivity.forget(result.deleted);setSelected(before=>before.filter(id=>!result.deleted.includes(id)));const failed=current.filter(row=>!result.deleted.includes(row.sessionId));setTargets(failed);setErrors(result.errors.map(item=>`${current.find(row=>row.sessionId===item.sessionId)?.name??'会话'}：${item.error}`));if(!failed.length)setManaging(false);}
    catch(error){setErrors([piError(error)]);}finally{inFlight.current=false;setDeleting(false);}
  }
  function renderGroup(key:string,label:string,groupRows:SessionRow[]){
    const filtered=groupRows.filter(filter).sort((a,b)=>{
      const aOrder=pinOrder.get(a.target.sessionId)??Infinity,bOrder=pinOrder.get(b.target.sessionId)??Infinity;
      return aOrder===bOrder?b.activityAt-a.activityAt||a.target.sessionId.localeCompare(b.target.sessionId):aOrder<bOrder?-1:1;
    });
    if(!filtered.length&&key==='pinned')return null;
    return <section className="pi-session-group">
      <div className="pi-session-group-heading" data-managing={managing||undefined}>
        <Button variant="app-quiet" data-session-group={key} className="pi-session-label pi-session-group-toggle" aria-expanded={!groups[key]} onClick={()=>collapse(key)}><span>{label}<small>{filtered.length}</small></span><ChevronDown data-collapsed={!!groups[key]}/></Button>
        {key==='recent'&&<DropdownMenu><DropdownMenuTrigger asChild><Button ref={manageButton} data-session-organize variant="ghost" size="icon-xs" disabled={blocked} aria-label="管理会话" title="管理会话"><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem data-session-bulk disabled={!rows.some(filter)} onSelect={toggleManagement}><ListChecks/>{managing?'退出批量管理':'批量管理'}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
      </div>
      {!groups[key]&&<div className="pi-session-items">{filtered.map(row=>{
        const pinned=pinOrder.has(row.target.sessionId);
        return <RecordContextMenu key={row.target.sessionId} copyText={row.name} actions={[{label:'复制会话 JSONL 路径',disabled:!row.target.sessionPath,run:()=>{void copySessionPath(row);}},{label:'重命名会话',disabled:blocked||model.viewing||row.protected,run:trigger=>beginRename(row,trigger)},{label:'删除会话',destructive:true,disabled:blocked||model.viewing||row.protected,run:trigger=>confirm([row],trigger)}]}><div className="pi-session-row" data-pinned={pinned||undefined}>
          {managing&&<Checkbox className="pi-session-checkbox" aria-label={`选择会话：${row.name}`} disabled={blocked||row.protected} checked={selected.includes(row.target.sessionId)} onCheckedChange={checked=>setSelected(before=>checked===true?[...new Set([...before,row.target.sessionId])]:before.filter(id=>id!==row.target.sessionId))}/>}
          <Tooltip><TooltipTrigger asChild><Button variant="app-control" className="pi-session-item" disabled={blocked} aria-label={`${row.name}，${row.status.label}`} aria-current={row.active?'true':undefined} onClick={row.select}><StatusDot label={row.status.label} tone={row.status.tone} data-session-status={row.status.kind??row.status.tone}/><strong>{row.name}</strong></Button></TooltipTrigger><TooltipContent side="right" align="start" sideOffset={8} className="max-w-80 whitespace-normal break-words"><div className="grid gap-1"><strong>{row.name}</strong><span>{pinned?'已置顶 · ':''}{row.status.label}</span><span>最后对话：{activityLabel(row.activityAt)}</span></div></TooltipContent></Tooltip>
          <span className="pi-session-pin-slot"><Button variant="ghost" size="icon-xs" data-session-pin={row.target.sessionId} disabled={blocked} aria-label={`${pinned?'取消置顶':'置顶'}会话：${row.name}`} title={pinned?'取消置顶':'置顶'} aria-pressed={pinned} onClick={event=>togglePin(row,event.currentTarget)}>{pinned?<PinOff aria-hidden="true"/>:<Pin aria-hidden="true"/>}</Button></span>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="pi-session-menu" data-session-menu disabled={blocked} aria-label={`会话操作：${row.name}`}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={()=>togglePin(row,document.querySelector<HTMLButtonElement>('.pi-session-row:has([data-state="open"]) [data-session-menu]'))}>{pinned?<PinOff/>:<Pin/>}{pinned?'取消置顶':'置顶会话'}</DropdownMenuItem>
            <DropdownMenuItem disabled={!row.target.sessionPath} onSelect={()=>void copySessionPath(row)}><Copy/>复制会话 JSONL 路径</DropdownMenuItem>
            <DropdownMenuItem disabled={model.viewing||row.protected} onSelect={()=>beginRename(row,document.querySelector<HTMLButtonElement>('.pi-session-row:has([data-state="open"]) [data-session-menu]'))}><Pencil/>重命名会话</DropdownMenuItem>
            {row.protected&&<p className="px-2 py-1 text-xs text-muted-foreground">结束运行或等待后可删除</p>}<DropdownMenuItem variant="destructive" disabled={model.viewing||row.protected} onSelect={()=>confirm([row],document.querySelector<HTMLButtonElement>('.pi-session-row:has([data-state="open"]) [data-session-menu]'))}><Trash2/>删除会话</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </div></RecordContextMenu>;
      })}</div>}
    </section>;
  }
  return <TooltipProvider delayDuration={350}><div className="pi-session-nav-heading"><h2>会话</h2><Button variant="app-quiet" size="icon-sm" aria-label={inDialog?'关闭会话列表':'收起会话列表'} title={inDialog?'关闭会话列表':'收起会话列表'} onClick={onCollapse}>{inDialog?<X aria-hidden="true"/>:<ChevronLeft aria-hidden="true"/>}</Button></div>
    <div className="pi-session-actions"><Button variant="app-control" className="pi-new-session" disabled={blocked||!model.root} onClick={()=>{onNavigate();void model.newConversation();}}><PiIcon type="plus"/>新会话</Button></div>
    <Input className="pi-session-search" aria-label="搜索会话" placeholder="搜索会话" value={query} onChange={event=>setQuery(event.target.value)}/>
    {managing&&<div className="pi-session-management"><Button variant="app-text" size="sm" disabled={blocked} onClick={toggleManagement}>退出批量管理</Button><Button variant="app-text" size="sm" disabled={blocked||!matching.length} onClick={()=>setSelected(matching.every(row=>selected.includes(row.target.sessionId))?selected.filter(id=>!matching.some(row=>row.target.sessionId===id)):[...new Set([...selected,...matching.map(row=>row.target.sessionId)])])}>全选筛选结果</Button><Button variant="destructive" size="sm" disabled={blocked||model.viewing||!chosen.length} onClick={event=>confirm(chosen,event.currentTarget)}>删除 {chosen.length}</Button></div>}
    <div className="pi-session-body">{model.sessionError&&<Feedback tone="error">{model.sessionError}</Feedback>}{model.unreadable>0&&<p role="status">{model.unreadable} 个会话文件未能读取；原文件保留。</p>}{renderGroup('pinned','置顶',pinnedRows)}{renderGroup('recent','最近会话',recentRows)}{!rows.some(filter)&&<p className="pi-session-empty">{query?'没有匹配的会话。':'暂无已保存会话。开始聊天后会保留记录。'}</p>}</div>
    <FormDialog open={!!targets.length} onOpenChange={open=>{if(!open&&!inFlight.current){setTargets([]);setErrors([]);}}} returnFocus={origin.current?.isConnected?origin.current:returnFocus()??manageButton.current} title={targets.length>1?'批量删除会话':'删除会话'} description={`确认删除 ${targets.length} 个会话？列表与未发送草稿会移除，聊天原文件和业务草案保留。运行或等待中的会话无法删除。`}>
      <ul className="pi-session-delete-list">{targets.map(row=><li key={row.sessionId}>{row.name}</li>)}</ul>{errors.map((error,index)=><Feedback key={index} tone="error" role="alert">{error}</Feedback>)}<div className="ui-form-dialog-actions"><Button variant="ghost" disabled={deleting} onClick={()=>{setTargets([]);setErrors([]);}}>取消</Button><Button variant="destructive" data-session-delete-confirm disabled={blocked||model.viewing} onClick={()=>void remove()} loading={deleting} loadingText="正在删除…">{`删除 ${targets.length} 个会话`}</Button></div>
    </FormDialog>
    <FormDialog open={!!renameTarget} onOpenChange={open=>{if(!open&&!renameFlight.current)setRenameTarget(null);}} title="重命名会话" description="修改会话名称，聊天内容和未发送草稿保留。" returnFocus={renameOrigin.current?.isConnected?renameOrigin.current:returnFocus()}>
      <form className="min-w-0" onSubmit={event=>{event.preventDefault();void rename();}}><div className="grid min-w-0 gap-2"><Label htmlFor={renameNameId}>会话名称</Label><Input id={renameNameId} value={renameName} disabled={renaming} autoFocus onFocus={event=>event.currentTarget.select()} onChange={event=>setRenameName(event.target.value)} aria-invalid={!!renameError} aria-describedby={renameError?renameErrorId:undefined}/>
        {renameError&&<Feedback id={renameErrorId} tone="error" role="alert">{renameError}</Feedback>}</div><div className="ui-form-dialog-actions"><Button type="button" variant="ghost" disabled={renaming} onClick={()=>setRenameTarget(null)}>取消</Button><Button type="submit" disabled={renaming||!renameName.trim()} loading={!!(renaming)} loadingText="正在保存…">保存名称</Button></div>
      </form>
    </FormDialog></TooltipProvider>;
}
