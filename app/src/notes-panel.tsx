import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {BookOpen,FolderOpen,PanelLeft,PanelRight,RefreshCw,Save} from 'lucide-react';
import {Button} from './components/ui/button.tsx';
import {Input} from './components/ui/input.tsx';
import {NativeSelect} from './components/ui/native-select.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import {FormDialog} from './components/ui/form-dialog.tsx';
import {notifyOperation} from './components/ui/operation-toast.tsx';
import {isTauri} from './desktop-api.ts';
import {notesClient} from './notes-client.ts';
import {notesError} from './notes-contract.ts';
import type {Heading,NoteDocument,NotesIndex} from './notes-contract.ts';
import {NotesFileTree,type FileAction} from './notes-file-tree.tsx';
import {NotesWorkbench,defaultNotesSettings} from './notes-workbench.tsx';
import type {NotesSettings} from './notes-workbench.tsx';
import type {LocalTools} from './notes-base.tsx';
import {NotesSplit} from './notes-split.tsx';
import {focusNotesPane,isNotesPaneActive} from './notes-editor-focus.ts';
import {Button as TabButton} from './components/ui/button.tsx';
import {notesFixture} from './ui-preview/notes-fixture.ts';
import type {PlainvaEditor} from '../plainva-editor/assets/editor.js';
import '../plainva-editor/assets/editor.css';
import '../plainva-editor/assets/upstream-ui.css';
import '../plainva-editor/host.css';

type Draft=NoteDocument&{saved:string;saving:boolean;error:string;external:NoteDocument|null;missing:boolean};
const blank:NotesIndex={library:null,name:'',files:[],directories:[]};
export function NotesPanel({root,active,previewState,initialPath}:{root:string;active:boolean;previewState?:string;initialPath?:string}){
  const preview=document.documentElement.dataset.uiPreview==='true';
  const api=useRef(preview?notesFixture(previewState):notesClient(root)).current;
  const boundRoot=useRef(root).current;
  const enabled=useRef(active);enabled.current=active;
  const editorRoot=useRef<HTMLDivElement>(null);
  const moduleRoot=useRef<HTMLElement>(null);
  const [sidebarWidth,setSidebarWidth]=useState<number|null>(null),[graphOpen,setGraphOpen]=useState(false),[graphTab,setGraphTab]=useState(false),[graphMount,setGraphMount]=useState<HTMLDivElement|null>(null);
  function showGraph(value:boolean){setGraphOpen(value);if(value)setGraphTab(true);}
  function resizeSidebar(value:number){const width=moduleRoot.current?.clientWidth??900;setSidebarWidth(Math.max(170,Math.min(value,Math.min(520,width-400))));}
  const tabsRoot=useRef<HTMLDivElement>(null);
  const editor=useRef<PlainvaEditor|null>(null);
  const drafts=useRef(new Map<string,Draft>()),indexRef=useRef<NotesIndex>(blank),currentRef=useRef('');
  const alive=useRef(true),epoch=useRef(0),request=useRef(0),loadingRef=useRef(false);
  const [index,setIndex]=useState(blank),[current,setCurrent]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const [query,setQuery]=useState(''),[headings,setHeadings]=useState<Heading[]>([]),[showFiles,setShowFiles]=useState(true),[showOutline,setShowOutline]=useState(true);
  const [,update]=useState(0),[compare,setCompare]=useState<{path:string;disk:NoteDocument}|null>(null);
  const [revealTick,setRevealTick]=useState(0),[baseMount,setBaseMount]=useState<HTMLDivElement|null>(null),[splitBaseMount,setSplitBaseMount]=useState<HTMLDivElement|null>(null);
  const [selection,setSelection]=useState<{chars:number;words:number}|null>(null);
  const [tools,setTools]=useState<LocalTools|null>(null),[fileAction,setFileAction]=useState<FileAction|null>(null),[tabs,setTabs]=useState<string[]>([]),[split,setSplit]=useState<{mode:'horizontal'|'vertical';path:string}|null>(null);
  useEffect(()=>{const strip=tabsRoot.current,node=strip?.querySelector<HTMLElement>('[data-active="true"]');if(!strip||!node)return;const box=strip.getBoundingClientRect(),tab=node.getBoundingClientRect();if(tab.left<box.left)strip.scrollLeft+=tab.left-box.left;else if(tab.right>box.right)strip.scrollLeft+=tab.right-box.right;},[current,tabs,graphOpen]);
  const settings=useRef<NotesSettings>(defaultNotesSettings),session=useRef(crypto.randomUUID()),draftRevisions=useRef(new Map<string,number>()),timers=useRef(new Map<string,ReturnType<typeof setTimeout>>()),persistTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  const workspaceRevision=useRef(0),workspaceReady=useRef(false),workspaceQueue=useRef(Promise.resolve());
  const refreshQueue=useRef(Promise.resolve()),openedInitially=useRef(false);
  const [basePicker,setBasePicker]=useState<'select'|'create'|null>(null),[baseName,setBaseName]=useState('未命名.base'),[baseError,setBaseError]=useState('');const baseResolver=useRef<((path:string|null)=>void)|null>(null);
  function chooseBase(create:boolean){setBaseError('');setBasePicker(create?'create':'select');return new Promise<string|null>(resolve=>{baseResolver.current?.(null);baseResolver.current=resolve;});}
  function finishBase(path:string|null){baseResolver.current?.(path);baseResolver.current=null;setBasePicker(null);}
  const [questions,setQuestions]=useState<ReturnType<LocalTools['template']>['requests']|null>(null),[questionValues,setQuestionValues]=useState<Record<string,string>>({});const answerResolver=useRef<((value:Record<string,string>|null)=>void)|null>(null);
  function askTemplate(fields:ReturnType<LocalTools['template']>['requests']){setQuestions(fields);setQuestionValues(Object.fromEntries(fields.map(f=>[f.label,f.defaultValue??f.options?.[0]??''])));return new Promise<Record<string,string>|null>(resolve=>{answerResolver.current?.(null);answerResolver.current=resolve;});}
  function finishQuestions(value:Record<string,string>|null){answerResolver.current?.(value);answerResolver.current=null;setQuestions(null);}
  function editorAction(operation:string,path:string){if(operation==='window'){const library=indexRef.current.library;if(library)void api.local(library,'window',{path}).catch(e=>notice(notesError(e)));}else if(operation.startsWith('split-'))setSplit({mode:operation==='split-horizontal'?'horizontal':'vertical',path});else if(operation==='bookmark')window.dispatchEvent(new CustomEvent('azcine-notes-bookmark',{detail:{path}}));else setFileAction({operation,paths:[path]});}
  const dirty=(draft:Draft)=>draft.body!==draft.saved;
  const hasDirty=()=>[...drafts.current.values()].some(d=>dirty(d)||d.saving);
  const notice=(text:string)=>{if(alive.current)notifyOperation(text);};
  async function persistDraft(draft:Draft,clear=false){const library=indexRef.current.library;if(!library)return;const revision=(draftRevisions.current.get(draft.path)??0)+1;draftRevisions.current.set(draft.path,revision);try{await api.local(library,clear?'draft-clear':'draft-put',{path:draft.path,body:draft.body,version:draft.version,session:session.current,revision});}catch(e){draft.error='草稿恢复记录写入失败：'+notesError(e);changed();}}
  function editBody(path:string,body:string){const draft=drafts.current.get(path);if(!draft||draft.body===body)return;draft.body=body;draft.error='';editor.current?.replace(path,body);changed();clearTimeout(persistTimers.current.get(path));persistTimers.current.set(path,setTimeout(()=>void persistDraft(draft),200));clearTimeout(timers.current.get(path));if(settings.current.autosave)timers.current.set(path,setTimeout(()=>void save(path,true),800));}
  function replaceBody(body:string,path=currentRef.current){const draft=drafts.current.get(path);if(!draft)return;editBody(path,body);editor.current?.replace(path,body);}
  async function readDraft(path:string){const existing=drafts.current.get(path);if(existing)return {path,body:existing.body,version:existing.version};const library=indexRef.current.library;if(!library)throw Error('请先选择笔记库');const doc=await api.read(library,path);if(indexRef.current.library!==library)throw Error('笔记库已切换');if(!drafts.current.has(path)){drafts.current.set(path,{...doc,saved:doc.body,saving:false,error:'',external:null,missing:false});changed();}return doc;}
  async function editNote(path:string,transform:(body:string)=>string){const library=indexRef.current.library;if(!library)throw Error('请先选择笔记库');let draft=drafts.current.get(path);if(!draft){const doc=await api.read(library,path);draft={...doc,saved:doc.body,saving:false,error:'',external:null,missing:false};drafts.current.set(path,draft);}if(draft.saving||draft.external||draft.missing)throw Error('笔记正在保存或有外部冲突，请先核对。');const next=transform(draft.body);replaceBody(next,path);await save(path,true);if(dirty(draft))throw Error(draft.error||'笔记尚未保存，操作未完成。');}
  async function flush(){for(const draft of drafts.current.values()){if(draft.saving)throw Error('有笔记正在保存，请稍后重试。');if(dirty(draft)){await save(draft.path,true);if(dirty(draft))throw Error(draft.error||'存在待核对的草稿，请先保存。');}}}
  function remap(from:string,to?:string){editor.current?.retarget(from,to);const mapped=(path:string)=>path===from||path.startsWith(from+'/');const next=(path:string)=>to?to+path.slice(from.length):'';for(const path of [...drafts.current.keys()])if(mapped(path)){const draft=drafts.current.get(path)!;clearTimeout(timers.current.get(path));clearTimeout(persistTimers.current.get(path));void persistDraft(draft,true);drafts.current.delete(path);if(to){draft.path=next(path);drafts.current.set(draft.path,draft);}}setTabs(t=>t.flatMap(path=>mapped(path)?to?[next(path)]:[]:[path]));setSplit(s=>s&&mapped(s.path)?to?{...s,path:next(s.path)}:null:s);if(mapped(currentRef.current)){currentRef.current=next(currentRef.current);setCurrent(currentRef.current);if(currentRef.current){const draft=drafts.current.get(currentRef.current);if(draft&&!/\.base$/i.test(draft.path))editor.current?.show(draft.path,draft.body);}}}
  function changed(){if(!alive.current)return;update(n=>n+1);const draft=drafts.current.get(currentRef.current);if(draft)editor.current?.status(draft.saving?'正在保存':draft.missing?'源文件不可用':draft.external?'外部修改待核对':dirty(draft)?'有未保存修改':'已保存',draft.saving,draft.error||null);}
  async function open(path:string,line?:number){
    const library=indexRef.current.library;if(!library)return;
    setGraphOpen(false);
    const token=++request.current;
    if(indexRef.current.files.find(f=>f.path===path)?.kind==='attachment'){
      try{const bytes=await api.binary(library,path);const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)]));const a=document.createElement('a');a.href=url;a.download=path.split('/').pop()!;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(notesError(e));}return;
    }
    try{
      if(!drafts.current.has(path)&&!indexRef.current.files.some(f=>f.path===path)&&(!path.split('/').pop()!.includes('.')||/\.(md|markdown)$/i.test(path))&&!await api.local(library,'exists',{path})){setFileAction({operation:'create',paths:[],target:/\.(md|markdown)$/i.test(path)?path:path+'.md'});return;}
      let draft=drafts.current.get(path);
      if(!draft){const doc=await api.read(library,path);if(!alive.current||token!==request.current)return;draft={...doc,saved:doc.body,saving:false,error:'',external:null,missing:false};
        if(preview&&(previewState==='dirty'||previewState==='conflict'))draft.body+='\n\n未保存的虚构补充。';
        if(preview&&previewState==='conflict')draft.external={...doc,version:'fixture-external',body:doc.body+'\n\n来自外部的虚构修改。'};
        drafts.current.set(path,draft);}
      if(!alive.current||token!==request.current)return;
      currentRef.current=path;setCurrent(path);setError('');if(!/\.base$/i.test(path))editor.current?.show(path,draft.body);if(line)editor.current?.jump(line,'');changed();
      setTabs(t=>t.includes(path)?t:[...t,path]);
    }catch(e){if(alive.current&&token===request.current)setError(notesError(e));}
  }
  async function inspect(draft:Draft){
    const library=indexRef.current.library;if(!library||draft.saving)return;
    const started=epoch.current,baseline=draft.version;
    try{
      const disk=await api.read(library,draft.path);if(!alive.current||started!==epoch.current||draft.saving||draft.version!==baseline)return;
      draft.missing=false;
      if(disk.version!==draft.version){
        if(dirty(draft)){draft.external=disk;}
        else{draft.body=disk.body;draft.saved=disk.body;draft.version=disk.version;draft.external=null;draft.error='';editor.current?.replace(draft.path,disk.body);}
      }
    }catch(e){if(started===epoch.current)draft.error=notesError(e);}
  }
  function refresh(){const next=refreshQueue.current.then(refreshNow);refreshQueue.current=next.catch(()=>{});return next;}
  async function refreshNow(){
    if(loadingRef.current)return;
    const started=epoch.current;
    loadingRef.current=true;
    try{
      const next=await api.index();if(!alive.current||started!==epoch.current)return;
      if(indexRef.current.library&&next.library!==indexRef.current.library){setError('笔记库连接已改变，当前草稿保留；请先导出或保存草稿后重新打开模块。');return;}
      indexRef.current=next;setIndex(next);editor.current?.updateFiles(next.files);
      for(const draft of drafts.current.values())draft.missing=!next.files.some(f=>f.path===draft.path);
      if(currentRef.current){const draft=drafts.current.get(currentRef.current);if(draft&&!draft.missing)await inspect(draft);}
      else if(!openedInitially.current){openedInitially.current=true;const first=next.files.find(f=>f.path===initialPath)||next.files.find(f=>previewState==='base'||previewState?.startsWith('notes-base-')?f.kind==='base':f.kind==='note');if(first)await open(first.path);}
      if(started===epoch.current){setError('');changed();}
    }catch(e){if(alive.current&&started===epoch.current)setError(notesError(e));}
    finally{if(started===epoch.current){loadingRef.current=false;if(alive.current)setLoading(false);}}
  }
  async function choose(){
    if(hasDirty()){notice('请先保存未保存的笔记，再切换笔记库。');return;}
    if(root!==boundRoot){notice('AZCine 数据目录已改变，请重新打开应用后选择笔记库。');return;}
    try{
      const path=await api.pick();if(!path||!alive.current)return;
      if(hasDirty()){notice('当前有未保存修改，笔记库未切换。请先保存草稿。');return;}
      ++epoch.current;++request.current;
      setLoading(true);loadingRef.current=true;
      const next=await api.select(path);if(!alive.current)return;openedInitially.current=false;
      // Recreate the editor to release old-vault sessions and their media URLs.
      for(const timer of timers.current.values())clearTimeout(timer);for(const timer of persistTimers.current.values())clearTimeout(timer);timers.current.clear();persistTimers.current.clear();draftRevisions.current.clear();setTabs([]);setSplit(null);
      drafts.current.clear();currentRef.current='';setCurrent('');indexRef.current=next;setIndex(next);setHeadings([]);setError('');
      editor.current?.destroy();editor.current=null;setReady(false);
      await initialize();const first=next.files.find(f=>f.kind==='note');if(first)await open(first.path);
    }catch(e){if(alive.current)setError(notesError(e));}
    finally{loadingRef.current=false;if(alive.current)setLoading(false);}
  }
  async function save(path=currentRef.current,quiet=false){
    const draft=drafts.current.get(path),library=indexRef.current.library;
    if(!draft||!library||root!==boundRoot||draft.saving||!dirty(draft)||draft.external||draft.missing)return;
    const captured={path:draft.path,body:draft.body,version:draft.version};draft.saving=true;draft.error='';changed();
    try{
      const result=await api.save(library,captured);
      draft.saved=result.body;draft.version=result.version;draft.external=null;
      clearTimeout(persistTimers.current.get(path));await persistDraft(draft,!dirty(draft));
      if(!quiet)notice('已保存到原笔记库。');
    }catch(e){draft.error=notesError(e);draft.saving=false;await inspect(draft);}
    finally{draft.saving=false;changed();if(settings.current.autosave&&dirty(draft)&&!draft.error&&!draft.external&&!draft.missing){clearTimeout(timers.current.get(path));timers.current.set(path,setTimeout(()=>void save(path,true),800));}}
  }
  async function initialize(){
    const started=epoch.current;
    const runtime=await import('../plainva-editor/assets/editor.js');if(!alive.current||started!==epoch.current||!editorRoot.current)return;
    setTools(runtime.localTools);

    const library=indexRef.current.library;
    if(library){const stored=await api.local<{value:Partial<NotesSettings>}|null>(library,'state-get',{key:'settings'});if(!alive.current||started!==epoch.current)return;if(stored?.value)settings.current={...defaultNotesSettings,...stored.value};}
    const result=await runtime.mountPlainvaEditor(editorRoot.current,{
      files:indexRef.current.files,active:()=>enabled.current&&!/\.base$/i.test(currentRef.current)&&isNotesPaneActive('primary'),connected:()=>alive.current&&started===epoch.current,
      readNote:async path=>{const local=drafts.current.get(path);if(local)return local.body;if(!indexRef.current.library)throw Error('尚未连接笔记库');return (await api.read(indexRef.current.library,path)).body;},
      readBinary:async path=>{if(!indexRef.current.library)throw Error('尚未连接笔记库');return api.binary(indexRef.current.library,path);},
      writeAttachment:async(path,bytes)=>{if(!indexRef.current.library||indexRef.current.library!==library)throw Error('笔记库已切换，附件未写入。');await api.attach(indexRef.current.library,path,bytes);},
      change:editBody,
      open:path=>open(path),notice,openExternal:url=>{void api.external(url).catch(e=>notice(notesError(e)));},save:()=>{void save();},
      outline:next=>{if(alive.current)setHeadings(next);},reveal:()=>{setShowFiles(true);setQuery('');setRevealTick(n=>n+1);},attachmentsChanged:()=>{void refresh();},
      selection:stats=>{if(alive.current)setSelection(stats);},
      action:editorAction,chooseBase,templateAnswers:askTemplate,preferences:()=>settings.current,templates:()=>settings.current.templates,catalog:async()=>indexRef.current.library?api.local(indexRef.current.library,'catalog'):[],
    });
    if(!alive.current||started!==epoch.current){result.destroy();return;}editor.current=result;setReady(true);
    if(currentRef.current){const draft=drafts.current.get(currentRef.current);if(draft&&!/\.base$/i.test(draft.path))result.show(draft.path,draft.body);}changed();
  }
  useEffect(()=>{
    alive.current=true;loadingRef.current=false;const started=++epoch.current;
    if(!preview&&!isTauri()){setError('请在 AZCine 桌面应用中打开笔记模块。');setLoading(false);return;}
    void (async()=>{await refresh();if(alive.current&&started===epoch.current)await initialize();})().catch(e=>{if(alive.current&&started===epoch.current){setError(notesError(e));setLoading(false);}});
    const poll=setInterval(()=>{if(enabled.current)void refresh();},5000);
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(hasDirty()){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',beforeUnload);
    return()=>{alive.current=false;baseResolver.current?.(null);answerResolver.current?.(null);++epoch.current;++request.current;clearInterval(poll);for(const timer of timers.current.values())clearTimeout(timer);for(const timer of persistTimers.current.values())clearTimeout(timer);for(const draft of drafts.current.values())if(dirty(draft))void persistDraft(draft);window.removeEventListener('beforeunload',beforeUnload);editor.current?.destroy();editor.current=null;};
  },[]);
  useEffect(()=>{if(!index.library||initialPath)return;const library=index.library;workspaceReady.current=false;let cancelled=false;void api.local<{revision:number;value:{tabs:string[];current:string;split:typeof split;sidebarWidth?:number}}|null>(library,'state-get',{key:'workspace'}).then(result=>{if(cancelled)return;workspaceRevision.current=result?.revision??0;if(result?.value){if(typeof result.value.sidebarWidth==='number')resizeSidebar(result.value.sidebarWidth);setTabs((result.value.tabs??[]).filter(path=>indexRef.current.files.some(f=>f.path===path)));if(result.value.split&&indexRef.current.files.some(f=>f.path===result.value!.split!.path))setSplit(result.value.split);const selected=initialPath||result.value.current;if(selected&&indexRef.current.files.some(f=>f.path===selected))void open(selected);}workspaceReady.current=true;}).catch(e=>notice(notesError(e)));return()=>{cancelled=true;};},[index.library]);
  useEffect(()=>{if(initialPath||!workspaceReady.current||!index.library)return;const library=index.library;const timer=setTimeout(()=>{workspaceQueue.current=workspaceQueue.current.catch(()=>{}).then(async()=>{const result=await api.local<{revision:number}>(library,'state-put',{key:'workspace',revision:workspaceRevision.current,value:{tabs,current,split,sidebarWidth}});workspaceRevision.current=result.revision;}).catch(e=>notice(notesError(e)));},500);return()=>clearTimeout(timer);},[tabs,current,split,sidebarWidth,index.library]);
  useEffect(()=>{if(!active)editor.current?.suspend();else if(ready)changed();},[active,ready]);
  const draft=drafts.current.get(current);
  function resolveConflict(useDisk:boolean){
    if(!compare)return;const item=drafts.current.get(compare.path);if(!item)return;
    item.saved=compare.disk.body;item.version=compare.disk.version;
    if(useDisk){item.body=compare.disk.body;editor.current?.replace(item.path,item.body);}
    item.external=null;item.error='';setCompare(null);void persistDraft(item,!dirty(item));changed();
  }
  return <section ref={moduleRoot} className="notes-module" aria-label="笔记库" data-files={showFiles} data-outline={showOutline&&!graphOpen} style={sidebarWidth?{'--notes-sidebar-width':`${sidebarWidth}px`} as CSSProperties:undefined}>
    <aside className="notes-files" hidden={!showFiles}>
      <div className="notes-library"><BookOpen aria-hidden="true"/><strong title={index.library??''}>{index.name||'笔记库'}</strong><Button variant="app-quiet" size="icon-sm" aria-label="选择笔记库目录" title="选择笔记库目录" disabled={loading||!!initialPath} onClick={()=>void choose()}><FolderOpen/></Button></div>
      <Input type="search" aria-label="搜索笔记" placeholder="搜索笔记…" value={query} onChange={event=>setQuery(event.target.value)}/>
      <div className="notes-tree-caption"><span>文件</span><span>{index.files.filter(f=>f.kind==='note').length} 篇</span></div>
      <NotesFileTree revealTick={revealTick} index={index} current={current} query={query} dirty={path=>{const draft=drafts.current.get(path);return !!draft&&dirty(draft);}} open={path=>void open(path)} action={setFileAction}/>
      <div className="notes-library-path" title={index.library??''}>{index.library||'未选择目录'}</div>
      <div className="notes-sidebar-resizer" role="separator" aria-label="调整笔记侧栏宽度" aria-orientation="vertical" aria-valuemin={170} aria-valuemax={520} aria-valuenow={sidebarWidth??220} tabIndex={0} onDoubleClick={()=>setSidebarWidth(null)} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();resizeSidebar((sidebarWidth??e.currentTarget.parentElement!.clientWidth)+(e.key==='ArrowLeft'?-20:20));}}} onPointerDown={e=>{e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))resizeSidebar(e.clientX-(moduleRoot.current?.getBoundingClientRect().left??0));}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}/>
    </aside>
    <div className="notes-document">
      <div ref={tabsRoot} className="notes-tabs" role="tablist" aria-label="已打开笔记">{tabs.map((path,i)=><div key={path} className="notes-tab" data-active={!graphOpen&&path===current} draggable onDragStart={e=>e.dataTransfer.setData('application/azcine-tab',path)} onDragOver={e=>e.preventDefault()} onDrop={e=>{const dragged=e.dataTransfer.getData('application/azcine-tab');if(tabs.includes(dragged)){const next=tabs.filter(p=>p!==dragged);next.splice(i,0,dragged);setTabs(next);}}}><TabButton variant="app-quiet" className="notes-tab-title" role="tab" aria-selected={!graphOpen&&path===current} title={path} onClick={()=>void open(path)} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=tabs[(i+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length];void open(next);}}}><span>{path.split('/').pop()}</span>{drafts.current.has(path)&&dirty(drafts.current.get(path)!)&&<span aria-label="未保存">•</span>}</TabButton><TabButton variant="app-quiet" className="notes-tab-close" aria-label={`关闭 ${path}`} onClick={()=>{const next=tabs.filter(p=>p!==path);setTabs(next);if(path===current){if(next.length)void open(next[Math.max(0,i-1)]??next[0]);else{currentRef.current='';setCurrent('');}}}}>×</TabButton></div>)}{graphTab&&<div className="notes-tab" data-active={graphOpen}><TabButton variant="app-quiet" role="tab" className="notes-tab-title" aria-selected={graphOpen} onClick={()=>setGraphOpen(true)}><span>关系图谱</span></TabButton><TabButton variant="app-quiet" className="notes-tab-close" aria-label="关闭关系图谱" onClick={()=>{setGraphTab(false);setGraphOpen(false);}}>×</TabButton></div>}</div>

      <div className="notes-actions" hidden={graphOpen}><Button variant="app-quiet" size="icon-sm" aria-label={showFiles?'收起文件目录':'展开文件目录'} aria-expanded={showFiles} onClick={()=>setShowFiles(value=>!value)}><PanelLeft/></Button><span className="notes-location" title={current}>{current ? current.split('/').pop() : '笔记'}</span><Button variant="app-quiet" size="icon-sm" aria-label="刷新笔记库" title="刷新笔记库" disabled={loading} onClick={()=>void refresh()}><RefreshCw/></Button><Button variant="app-primary" disabled={!draft||!dirty(draft)||draft.saving||!!draft.external||draft.missing||root!==boundRoot} onClick={()=>void save()}><Save/>{draft?.saving?'保存中…':'保存'}</Button><Button variant="app-quiet" size="icon-sm" aria-label={showOutline?'收起大纲':'展开大纲'} aria-expanded={showOutline} onClick={()=>setShowOutline(value=>!value)}><PanelRight/></Button></div>
      {(error||root!==boundRoot)&&<Feedback tone="error">{root!==boundRoot?'AZCine 数据目录已改变，当前草稿保留，请先导出未保存内容。':error}</Feedback>}
      {draft?.external&&<Feedback tone="conflict">原文件已被外部修改，当前草稿保留。<Button variant="app-quiet" onClick={()=>setCompare({path:draft.path,disk:draft.external!})}>核对两份内容</Button></Feedback>}
      {draft?.error&&!draft.external&&<Feedback tone="error">{draft.error}</Feedback>}
      {draft?.missing&&<Feedback tone="error">源文件已移动或删除，未保存的草稿仍保留。可通过文档菜单导出 Markdown。</Feedback>}
      {tools&&<NotesWorkbench graphMount={graphMount} graphOpen={graphOpen} showGraph={showGraph} basePanes={[...(baseMount&&/\.base$/i.test(current)?[{path:current,body:draft?.body??'',mount:baseMount}]:[]),...(splitBaseMount&&split&&/\.base$/i.test(split.path)?[{path:split.path,body:drafts.current.get(split.path)?.body??'',mount:splitBaseMount}]:[])]} previewState={previewState} askTemplate={askTemplate} api={api} index={index} tools={tools} current={current} body={draft?.body??''} active={active} action={fileAction} clearAction={()=>setFileAction(null)} fileAction={setFileAction} open={open} read={readDraft} edit={editNote} replace={replaceBody} refresh={refresh} flush={flush} remap={remap} settings={value=>{settings.current=value;if(!value.autosave){for(const timer of timers.current.values())clearTimeout(timer);timers.current.clear();}}} split={mode=>setSplit(s=>s?.mode===mode?null:{mode,path:current})} newWindow={()=>{if(index.library)void api.local(index.library,'window',{path:current}).catch(e=>notice(notesError(e)));}}/>}
      <div className="notes-graph-page" hidden={!graphOpen} ref={setGraphMount}/>
      <div className="notes-panes" data-split={split?.mode} hidden={!current||graphOpen}>
      <div className="notes-base-pane" ref={setBaseMount} hidden={!current||!/\.base$/i.test(current)}/>
      <div className="notes-editor" ref={editorRoot} hidden={!current||/\.base$/i.test(current)} onPointerDown={()=>focusNotesPane('primary')} onFocusCapture={()=>focusNotesPane('primary')}>
        <div className="plainva-chrome" data-editor-chrome/>
        <div className="plainva-host" data-editor-mount/>
      </div>
      {split&&index.library&&<NotesSplit key={split.path} baseRoot={setSplitBaseMount} status={(()=>{const d=drafts.current.get(split.path);return d?.external?<Feedback tone="conflict">分屏笔记有外部修改<Button variant="app-quiet" onClick={()=>setCompare({path:d.path,disk:d.external!})}>核对内容</Button></Feedback>:d?.error?<Feedback tone="error">{d.error}</Feedback>:null;})()} options={{action:editorAction,chooseBase,templateAnswers:askTemplate,preferences:()=>settings.current,templates:()=>settings.current.templates,catalog:async()=>indexRef.current.library?api.local(indexRef.current.library,'catalog'):[]}} path={split.path} index={index} api={api} active={active} read={readDraft} change={editBody} body={drafts.current.get(split.path)?.body} open={async path=>{if(index.files.find(f=>f.path===path)?.kind==='attachment'){await open(path);return;}await readDraft(path);setSplit(s=>s?{...s,path}:s);}} save={path=>save(path)} close={()=>setSplit(null)}/>}
      </div>
      {!current&&!graphOpen&&<div className="notes-empty"><BookOpen/><h2>{loading?'正在读取笔记库…':index.library?'选择一篇笔记':'打开现有笔记库'}</h2><p>{index.library?'从左侧目录打开 Markdown 笔记。':'选择你在 Obsidian 中使用的文件夹，两个应用维护同一份文件。'}</p>{!index.library&&<Button variant="app-primary" disabled={loading||!!initialPath} onClick={()=>void choose()}>选择笔记文件夹</Button>}</div>}
      {current&&!ready&&<Feedback tone="pending">正在加载 Plainva 编辑器…</Feedback>}
      <footer className="notes-status"><span>{draft?.saving?'正在写入原文件':draft&&dirty(draft)?'有未保存修改 · Ctrl+S 保存':'与 Obsidian 共用原文件'}</span><span>{selection?`已选 ${selection.chars} 字符`:`${draft?.body.replace(/\s/g,'').length??0} 字符`}</span><span>{current.endsWith('.base')?'数据库 · YAML':'Markdown · UTF-8'}</span></footer>
    </div>
    <aside className="notes-outline" hidden={!showOutline||graphOpen}><strong>大纲</strong><nav aria-label="笔记大纲">{headings.map((heading,i)=><Button key={`${heading.slug}-${i}`} variant="app-quiet" onClick={()=>editor.current?.jump(heading.line,heading.slug)}>{heading.text}</Button>)}</nav></aside>
    <FormDialog className="notes-dialog" open={!!compare} onOpenChange={open=>{if(!open)setCompare(null);}} title="核对外部修改" description="两份内容均保留。选择保留草稿后，再点保存才会写回原文件；若原文件又改变，将再次提示。" wide footer={<><Button variant="app-quiet" onClick={()=>setCompare(null)}>返回编辑</Button><Button variant="app-quiet" onClick={()=>resolveConflict(true)}>采用磁盘版本</Button><Button variant="app-primary" onClick={()=>resolveConflict(false)}>保留我的草稿</Button></>}>
      <div className="notes-compare"><div><h3>当前草稿</h3><pre>{compare?drafts.current.get(compare.path)?.body:''}</pre></div><div><h3>磁盘版本</h3><pre>{compare?.disk.body}</pre></div></div>
    </FormDialog>
    <FormDialog className="notes-dialog" open={!!basePicker} onOpenChange={open=>{if(!open)finishBase(null);}} title={basePicker==='create'?'创建并嵌入数据库':'嵌入数据库'} description="数据库定义保存在 .base 文件中，原笔记通过链接嵌入。">
      {basePicker==='select'?index.files.filter(f=>f.kind==='base').map(f=><Button key={f.path} variant="app-quiet" onClick={()=>finishBase(f.path)}>{f.path}</Button>):<><Input aria-label="数据库路径" value={baseName} onChange={e=>setBaseName(e.target.value)}/><Button onClick={()=>{const library=indexRef.current.library;if(!library||!tools)return;const path=baseName.endsWith('.base')?baseName:baseName+'.base';void api.local(library,'create',{path,body:tools.serializeBase({views:[{type:'table',name:'表格',order:['file.name']}]})}).then(async()=>{await refresh();finishBase(path);}).catch(e=>setBaseError(notesError(e)));}}>创建并插入</Button></>}{baseError&&<Feedback tone="error">{baseError}</Feedback>}
    </FormDialog>
    <FormDialog className="notes-dialog" open={!!questions} onOpenChange={open=>{if(!open)finishQuestions(null);}} title="填写模板" description="填写后应用；取消会保留原笔记。" footer={<><Button variant="app-quiet" onClick={()=>finishQuestions(null)}>取消</Button><Button onClick={()=>finishQuestions(questionValues)}>应用</Button></>}>
      {questions?.map(q=><label key={q.label}>{q.label}{q.kind==='select'?<NativeSelect value={questionValues[q.label]??''} onChange={e=>setQuestionValues(v=>({...v,[q.label]:e.target.value}))}>{q.options?.map(option=><option key={option}>{option}</option>)}</NativeSelect>:<Input type={q.kind==='date'?'date':'text'} value={questionValues[q.label]??''} onChange={e=>setQuestionValues(v=>({...v,[q.label]:e.target.value}))}/>}</label>)}
    </FormDialog>
  </section>;
}
