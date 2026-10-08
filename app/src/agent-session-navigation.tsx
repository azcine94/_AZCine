import { useId,useRef,useState } from 'react';
import { ChevronDown,ChevronLeft,ListChecks,MoreHorizontal,Pin,PinOff,Pencil,Trash2,X } from 'lucide-react';
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
import { PiIcon } from './pi-process-panel.tsx';
import { piError } from './pi-client.ts';
import type { ConversationDeleteTarget,RuntimeSummary } from './pi-client.ts';
import type { PiController } from './use-pi.ts';

type SessionStatus={label:string;tone:StatusDotTone};
type SessionRow={target:ConversationDeleteTarget;name:string;active:boolean;protected:boolean;status:SessionStatus;details?:string;select:()=>void};
type NamedTarget=ConversationDeleteTarget&{name:string};
function sessionStatus(row:Pick<RuntimeSummary['conversations'][number],'waiting'|'active'|'connection'>):SessionStatus{
  if(row.waiting)return {label:'待回答',tone:'warning'};
  if(row.connection==='error')return {label:'连接异常',tone:'error'};
  if(row.connection==='connecting')return {label:'连接中',tone:'warning'};
  if(row.active)return {label:'运行中',tone:'active'};
  if(row.connection==='ready')return {label:'空闲',tone:'success'};
  return {label:'未连接',tone:'neutral'};
}
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
  const live:SessionRow[]=allLive.map(row=>({target:{conversationKey:row.conversationKey,sessionPath:row.sessionFile,sessionId:row.sessionId!,generation:row.generation},name:row.name??'未命名会话',active:row.conversationKey===model.conversationKey,protected:row.active||row.waiting||row.connection==='connecting',status:sessionStatus(row),select:()=>{onNavigate();void model.selectConversation(row.conversationKey);}}));
  const history:SessionRow[]=model.sessions.filter(session=>!allLive.some(row=>row.sessionId===session.id)).map(session=>({target:{conversationKey:null,sessionPath:session.path,sessionId:session.id,generation:null},name:session.name??'未命名会话',active:state?.sessionFile===session.path,protected:state?.sessionFile===session.path&&!!(model.snapshot?.busy||model.snapshot?.sending||model.snapshot?.stopping||model.snapshot?.connection==='connecting'||model.snapshot?.projection.activity!=='idle'),status:{label:'已保存',tone:'neutral'},details:`${session.updatedAt.slice(0,10)} · ${session.messageCount} 条消息`,select:()=>{onNavigate();void model.selectSession(session);}}));
  const filter=(row:SessionRow)=>row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const rows=[...live,...history];
  const eligible=rows.filter(row=>!row.protected),matching=eligible.filter(filter),chosen=eligible.filter(row=>selected.includes(row.target.sessionId));
  const blocked=busy||attaching||deleting||renaming;
  const pinOrder=new Map<string,number>(model.sessionPins.map((id,index)=>[id,index]));
  const pinnedRows=rows.filter(row=>pinOrder.has(row.target.sessionId)),recentRows=rows.filter(row=>!pinOrder.has(row.target.sessionId));
  function collapse(key:string){setGroups(before=>{const next={...before,[key]:!before[key]};try{localStorage.setItem('azcine.agent-session-groups',JSON.stringify(next));}catch{/* Keep the preference in memory. */}return next;});}
  function toggleManagement(){const entering=!managing;setManaging(entering);setSelected([]);if(entering)setGroups(before=>{const next={...before,pinned:false,recent:false};try{localStorage.setItem('azcine.agent-session-groups',JSON.stringify(next));}catch{/* Keep the preference in memory. */}return next;});}
  function togglePin(row:SessionRow,trigger:HTMLButtonElement){
    const body=trigger.closest('.pi-session-body'),pinned=pinOrder.has(row.target.sessionId),destination=pinned?'recent':'pinned';
    setGroups(before=>{const next={...before,[destination]:false};try{localStorage.setItem('azcine.agent-session-groups',JSON.stringify(next));}catch{/* Keep the preference in memory. */}return next;});
    model.setSessionPinned(row.target.sessionId,!pinned);
    requestAnimationFrame(()=>Array.from(body?.querySelectorAll<HTMLButtonElement>('[data-session-pin]')??[]).find(button=>button.dataset.sessionPin===row.target.sessionId)?.focus({preventScroll:true}));
  }
  function confirm(rows:SessionRow[],trigger:HTMLElement|null){origin.current=trigger;setErrors([]);setTargets(rows.map(row=>({...row.target,name:row.name})));}
  function beginRename(row:SessionRow,trigger:HTMLElement|null){renameOrigin.current=trigger;setRenameTarget({...row.target,name:row.name});setRenameName(row.name);setRenameError('');}
  async function rename(){if(renameFlight.current||!renameTarget)return;renameFlight.current=true;setRenaming(true);setRenameError('');
    try{await model.renameConversation(renameTarget,renameName);setRenameTarget(null);}catch(error){setRenameError(piError(error));}finally{renameFlight.current=false;setRenaming(false);}
  }
  async function remove(){if(inFlight.current||!targets.length)return;inFlight.current=true;setDeleting(true);setErrors([]);const current=targets;
    try{const result=await model.deleteConversations(current);setSelected(before=>before.filter(id=>!result.deleted.includes(id)));const failed=current.filter(row=>!result.deleted.includes(row.sessionId));setTargets(failed);setErrors(result.errors.map(item=>`${current.find(row=>row.sessionId===item.sessionId)?.name??'会话'}：${item.error}`));if(!failed.length)setManaging(false);}
    catch(error){setErrors([piError(error)]);}finally{inFlight.current=false;setDeleting(false);}
  }
  function renderGroup(key:string,label:string,groupRows:SessionRow[]){
    const filtered=groupRows.filter(filter).sort((a,b)=>{
      const aOrder=pinOrder.get(a.target.sessionId)??Infinity,bOrder=pinOrder.get(b.target.sessionId)??Infinity;
      return aOrder===bOrder?0:aOrder<bOrder?-1:1;
    });
    if(!filtered.length&&key==='pinned')return null;
    return <section className="pi-session-group">
      <div className="pi-session-group-heading" data-managing={managing||undefined}>
        <Button variant="app-quiet" data-session-group={key} className="pi-session-label pi-session-group-toggle" aria-expanded={!groups[key]} onClick={()=>collapse(key)}><span>{label}<small>{filtered.length}</small></span><ChevronDown data-collapsed={!!groups[key]}/></Button>
        {key==='recent'&&<span className="pi-session-bulk-slot"><Button ref={manageButton} data-session-bulk variant="ghost" size="icon-xs" className="pi-session-bulk-trigger" disabled={blocked||!rows.some(filter)} aria-label={managing?'退出批量管理':'批量管理'} title={managing?'退出批量管理':'批量管理'} aria-pressed={managing} onClick={toggleManagement}><ListChecks aria-hidden="true"/></Button></span>}
      </div>
      {!groups[key]&&<div className="pi-session-items">{filtered.map(row=>{
        const pinned=pinOrder.has(row.target.sessionId);
        return <RecordContextMenu key={row.target.sessionId} copyText={row.name} actions={[{label:'重命名会话',disabled:blocked||model.viewing||row.protected,run:trigger=>beginRename(row,trigger)},{label:'删除会话',destructive:true,disabled:blocked||model.viewing||row.protected,run:trigger=>confirm([row],trigger)}]}><div className="pi-session-row" data-pinned={pinned||undefined}>
          {managing&&<Checkbox className="pi-session-checkbox" aria-label={`选择会话：${row.name}`} disabled={blocked||row.protected} checked={selected.includes(row.target.sessionId)} onCheckedChange={checked=>setSelected(before=>checked===true?[...new Set([...before,row.target.sessionId])]:before.filter(id=>id!==row.target.sessionId))}/>}
          <Button variant="app-control" className="pi-session-item" title={`${row.name}\n${pinned?'已置顶 · ':''}${row.status.label}${row.details?` · ${row.details}`:''}`} disabled={blocked} aria-current={row.active?'true':undefined} onClick={row.select}><StatusDot label={row.status.label} tone={row.status.tone}/><strong>{row.name}</strong></Button>
          <span className="pi-session-pin-slot"><Button variant="ghost" size="icon-xs" data-session-pin={row.target.sessionId} disabled={blocked} aria-label={`${pinned?'取消置顶':'置顶'}会话：${row.name}`} title={pinned?'取消置顶':'置顶'} aria-pressed={pinned} onClick={event=>togglePin(row,event.currentTarget)}>{pinned?<PinOff aria-hidden="true"/>:<Pin aria-hidden="true"/>}</Button></span>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="pi-session-menu" data-session-menu disabled={blocked} aria-label={`会话操作：${row.name}`}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem disabled={model.viewing||row.protected} onSelect={()=>beginRename(row,document.querySelector<HTMLButtonElement>('.pi-session-row:has([data-state="open"]) [data-session-menu]'))}><Pencil/>重命名会话</DropdownMenuItem>
            {row.protected&&<p className="px-2 py-1 text-xs text-muted-foreground">结束运行或等待后可删除</p>}<DropdownMenuItem variant="destructive" disabled={model.viewing||row.protected} onSelect={()=>confirm([row],document.querySelector<HTMLButtonElement>('.pi-session-row:has([data-state="open"]) [data-session-menu]'))}><Trash2/>删除会话</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </div></RecordContextMenu>;
      })}</div>}
    </section>;
  }
  return <><div className="pi-session-nav-heading"><h2>会话</h2><Button variant="app-quiet" size="icon-sm" aria-label={inDialog?'关闭会话列表':'收起会话列表'} title={inDialog?'关闭会话列表':'收起会话列表'} onClick={onCollapse}>{inDialog?<X aria-hidden="true"/>:<ChevronLeft aria-hidden="true"/>}</Button></div>
    <div className="pi-session-actions"><Button variant="app-control" className="pi-new-session" disabled={blocked||!model.root} onClick={()=>{onNavigate();void model.newConversation();}}><PiIcon type="plus"/>新会话</Button></div>
    <Input className="pi-session-search" aria-label="搜索会话" placeholder="搜索会话" value={query} onChange={event=>setQuery(event.target.value)}/>
    {managing&&<div className="pi-session-management"><Button variant="app-text" size="sm" disabled={blocked} onClick={toggleManagement}>退出批量管理</Button><Button variant="app-text" size="sm" disabled={blocked||!matching.length} onClick={()=>setSelected(matching.every(row=>selected.includes(row.target.sessionId))?selected.filter(id=>!matching.some(row=>row.target.sessionId===id)):[...new Set([...selected,...matching.map(row=>row.target.sessionId)])])}>全选筛选结果</Button><Button variant="destructive" size="sm" disabled={blocked||model.viewing||!chosen.length} onClick={event=>confirm(chosen,event.currentTarget)}>删除 {chosen.length}</Button></div>}
    <div className="pi-session-body">{model.sessionError&&<Feedback tone="error">{model.sessionError}</Feedback>}{model.unreadable>0&&<p role="status">{model.unreadable} 个会话文件未能读取；原文件保留。</p>}{renderGroup('pinned','置顶',pinnedRows)}{renderGroup('recent','最近会话',recentRows)}{!rows.some(filter)&&<p className="pi-session-empty">{query?'没有匹配的会话。':'暂无已保存会话。开始聊天后会保留记录。'}</p>}</div>
    <FormDialog open={!!targets.length} onOpenChange={open=>{if(!open&&!inFlight.current){setTargets([]);setErrors([]);}}} returnFocus={origin.current?.isConnected?origin.current:returnFocus()??manageButton.current} title={targets.length>1?'批量删除会话':'删除会话'} description={`确认删除 ${targets.length} 个会话？列表与未发送草稿会移除，聊天原文件和业务草案保留。运行或等待中的会话无法删除。`}>
      <ul className="pi-session-delete-list">{targets.map(row=><li key={row.sessionId}>{row.name}</li>)}</ul>{errors.map((error,index)=><Feedback key={index} tone="error" role="alert">{error}</Feedback>)}<div className="ui-form-dialog-actions"><Button variant="ghost" disabled={deleting} onClick={()=>{setTargets([]);setErrors([]);}}>取消</Button><Button variant="destructive" data-session-delete-confirm disabled={blocked||model.viewing} onClick={()=>void remove()}>{deleting?'正在删除…':`删除 ${targets.length} 个会话`}</Button></div>
    </FormDialog>
    <FormDialog open={!!renameTarget} onOpenChange={open=>{if(!open&&!renameFlight.current)setRenameTarget(null);}} title="重命名会话" description="修改会话名称，聊天内容和未发送草稿保留。" returnFocus={renameOrigin.current?.isConnected?renameOrigin.current:returnFocus()}>
      <form className="min-w-0" onSubmit={event=>{event.preventDefault();void rename();}}><div className="grid min-w-0 gap-2"><Label htmlFor={renameNameId}>会话名称</Label><Input id={renameNameId} value={renameName} disabled={renaming} autoFocus onFocus={event=>event.currentTarget.select()} onChange={event=>setRenameName(event.target.value)} aria-invalid={!!renameError} aria-describedby={renameError?renameErrorId:undefined}/>
        {renameError&&<Feedback id={renameErrorId} tone="error" role="alert">{renameError}</Feedback>}</div><div className="ui-form-dialog-actions"><Button type="button" variant="ghost" disabled={renaming} onClick={()=>setRenameTarget(null)}>取消</Button><Button type="submit" disabled={renaming||!renameName.trim()}>{renaming?'正在保存…':'保存名称'}</Button></div>
      </form>
    </FormDialog></>;
}
