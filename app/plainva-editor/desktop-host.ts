// AZCine platform adapter. Editor session, renderers, formatting commands,
// toolbar and selection behavior are the pinned, unmodified Plainva sources.
import {createEditorSession,type EditorSession} from './vendor/packages/ui/src/components/editorSession';
import {setUnavailableSlashCommands} from './vendor/packages/ui/src/components/SlashCommandPlugin';
import {buildWikiTargetSet,wikiTargetPath} from './vendor/packages/ui/src/lib/wikiResolver';
import {parseHeadings} from './vendor/packages/ui/src/lib/outline';
import {consumePendingAnchorJump,ANCHOR_JUMP_EVENT} from './vendor/packages/ui/src/lib/anchorJump';
import {setPlatformServices} from './vendor/packages/ui/src/platform/services';
import {importAttachment} from './vendor/packages/ui/src/lib/importAttachment';
import {planPaste} from './vendor/packages/ui/src/lib/smartPaste';
import {EditorView} from '@codemirror/view';
import {noteEmbedPlugin} from './vendor/apps/desktop/src/components/NoteEmbedPlugin';
import {createEditorUI} from './editor-ui';
import {setReaderEnvironment,setExternalOpener} from './reader-adapter';
import {setTemplateProvider} from './template-adapter';
import i18n,{i18nReady} from './i18n-adapter';
export {createVaultTree} from './file-tree';
import {localTools} from './local-runtime';
export {localTools};

type Entry={path:string;kind:string};
type Options={
  files:Entry[]; active():boolean; connected():boolean; readNote(path:string):Promise<string>;
  readBinary(path:string):Promise<Uint8Array>; writeAttachment(path:string,bytes:Uint8Array):Promise<void>;
  change(path:string,body:string):void; open(path:string):Promise<void>; notice(text:string):void;
  openExternal(url:string):void; save():void; outline(headings:ReturnType<typeof parseHeadings>):void;
  reveal(path:string):void; attachmentsChanged():void;
  selection(stats:{chars:number;words:number}|null):void;
  action?(operation:string,path:string):void;templates?():string;
  catalog?():Promise<{path:string;body:string;version:string;mtime?:number}[]>;
  chooseBase?(create:boolean):Promise<string|null>;
  templateAnswers?(fields:{label:string;kind:string;defaultValue?:string;options?:string[]}[]):Promise<Record<string,string>|null>;
  preferences?():{mode:'live'|'source'|'read';width:'narrow'|'full'};
};
export async function mountPlainvaEditor(root:HTMLElement,options:Options){
  await i18nReady;
  if(!options.connected())throw new Error('Editor mount cancelled');
  let files=options.files,index=buildWikiTargetSet(files),current='',mode:'live'|'source'|'read'=options.preferences?.().mode??'live',lastMode:'live'|'source'='live';
  let width:'narrow'|'full'=options.preferences?.().width??'narrow',message='',saving=false,saveError:string|null=null,disposed=false,applying=false;
  const sessions=new Map<string,{session:EditorSession;mount:HTMLElement}>();
  const history:string[]=[];let historyIndex=-1;
  const mount=root.querySelector<HTMLElement>('[data-editor-mount]')!;
  const content=()=>current?sessions.get(current)!.session.view.state.doc.toString():'';
  const active=()=>!disposed&&!!current&&options.active();
  const clean=(path:string)=>path.replace(/^\/vault\//,'');
  const queryService={
    findByFileName:async(name:string)=>files.find(f=>f.path===name)?.path??files.find(f=>f.path.split('/').pop()===name)?.path??null,
    resolveNotePath:async(target:string,from?:string)=>wikiTargetPath(target,index,from),
    getAllTags:async()=>{const docs=options.catalog?localTools.analyze(await options.catalog()):[];const counts=new Map<string,number>();for(const d of docs)for(const tag of d.tags)counts.set(tag,(counts.get(tag)??0)+1);return [...counts].map(([name,count])=>({tag:name,count}));},
    db:{query:async(sql:string,params:unknown[]=[])=>{
      if(sql.includes("path LIKE '%.base'"))return files.filter(f=>f.kind==='base').map(f=>({path:f.path,title:f.path.split('/').pop()!.replace(/\.base$/i,'')}));
      const term=String(params[0]??'').replaceAll('%','').toLowerCase();
      return files.filter(f=>!term||f.path.toLowerCase().includes(term)).map(f=>({path:f.path,title:f.path.split('/').pop()!.replace(/\.md$/i,''),is_attachment:f.kind==='attachment'?1:0}));
    }},
  };
  const environment={vaultPath:'/vault',linkResolver:index,queryService,fileTreeVersion:0,openPath:options.open,baseData:async(path:string)=>{const config=localTools.parseBase(await options.readNote(clean(path)));const catalog=await options.catalog?.()??[];const docs=localTools.analyze(catalog);return {rows:localTools.baseRows(docs,config,config.views?.[0],Object.fromEntries(catalog.filter(d=>d.path.endsWith('.base')).map(d=>[d.path,d.body]))),config};},vaultAdapter:{
    readTextFile:(path:string)=>options.readNote(clean(path)),
    readBinaryFile:(path:string)=>options.readBinary(clean(path)),
    exists:async(path:string)=>files.some(f=>f.path===clean(path)),
  }};
  function syncEnvironment(){index=buildWikiTargetSet(files);environment.linkResolver=index;environment.fileTreeVersion++;setReaderEnvironment({...environment},files.map(f=>({path:f.path,title:f.path.split('/').pop()!.replace(/\.md$/i,'')})),options.notice);}
  async function openNote(target:string,_newTab=false,_kind?:unknown,anchor?:string|null){
    const path=target?(wikiTargetPath(target,index,current)??target):current;
    if(!path)return;
    await options.open(path);
    if(disposed||current!==path)return;
    const destination=anchor||consumePendingAnchorJump(path);
    if(destination)jumpAnchor(destination);
  }
  function jump(line:number,slug:string){if(!current)return;if(mode==='read'&&slug){ui.scrollToHeading(slug);return;}if(mode==='read')setMode('source');const view=sessions.get(current)!.session.view;const pos=view.state.doc.line(Math.max(1,Math.min(line,view.state.doc.lines))).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'start'})});view.focus();}
  function jumpAnchor(anchor:string){const heading=parseHeadings(content()).find(h=>h.slug===anchor||h.text===anchor);if(heading)jump(heading.line,heading.slug);}
  setExternalOpener(options.openExternal);
  setPlatformServices({openExternal:async url=>options.openExternal(url),loadSettings:async()=>({}),credentials:{} as never});
  setUnavailableSlashCommands(options.chooseBase?[]:['embedbase','newbase']);
  setTemplateProvider(async()=>Promise.all(files.filter(f=>f.kind==='note'&&f.path.startsWith((options.templates?.()??'Templates')+'/')).map(async f=>({path:f.path,title:f.path.split('/').pop()!.replace(/\.md$/i,''),body:await options.readNote(f.path)}))));
  syncEnvironment();
  const ui=createEditorUI({root,active,key:()=>current,view:()=>sessions.get(current)!.session.view,editable:()=>active()&&mode!=='read',notice:options.notice,openNote,environment:()=>environment,templateAnswers:options.templateAnswers});
  let importQueue=Promise.resolve();
  function importFiles(items:File[],view:EditorView,path:string){
    importQueue=importQueue.then(async()=>{for(const file of items){
      try {
        const result=await importAttachment({name:file.name,mime:file.type,bytes:new Uint8Array(await file.arrayBuffer())},{configuredFolder:'Attachments',noteFolder:path.includes('/')?path.slice(0,path.lastIndexOf('/')):''},{
          exists:async target=>files.some(f=>f.path===target),createDir:async()=>{},writeBinaryFile:options.writeAttachment,
        });
        if(disposed)return;
        if(!files.some(f=>f.path===result.path))files=[...files,{path:result.path,kind:'attachment'}];syncEnvironment();
        const selection=view.state.selection.main;view.dispatch({changes:{from:selection.from,to:selection.to,insert:result.insert},selection:{anchor:selection.from+result.insert.length},userEvent:'input'});options.attachmentsChanged();
      }catch(error){options.notice(error instanceof Error?error.message:'附件未能写入笔记库，草稿保留。');}
    }}).catch(()=>options.notice('附件导入未完成，草稿保留。'));
  }
  function pick(){if(!active())return;const view=sessions.get(current)!.session.view,path=current;if(mode==='read')setMode('live');const input=document.createElement('input');input.type='file';input.multiple=true;input.onchange=()=>importFiles(Array.from(input.files??[]),view,path);input.click();}
  function render(){
    if(disposed)return;
    mount.classList.toggle('pv-cm-narrow',width==='narrow');
    for(const [path,entry] of sessions)entry.mount.hidden=path!==current||mode==='read';
    root.querySelector<HTMLElement>('[data-editor-chrome]')!.hidden=!current;
    if(!current){ui.read('','',false);return;}
    const entry=sessions.get(current)!;entry.session.setMode(mode==='source'?'source':'live');entry.session.setEditable(mode!=='read');entry.session.view.requestMeasure();
    ui.read(content(),current,mode==='read');options.outline(parseHeadings(content()));
    ui.chrome({activePath:current,viewMode:mode,setViewMode:setMode,editorWidth:width,toggleWidth:()=>{width=width==='narrow'?'full':'narrow';render();},
      status:message,isSaving:saving,saveError,canGoBack:historyIndex>0,canGoForward:historyIndex<history.length-1,
      onNavigateBack:()=>{if(historyIndex>0)options.open(history[--historyIndex]);},onNavigateForward:()=>{if(historyIndex<history.length-1)options.open(history[++historyIndex]);},
      handleMenuCopyPath:()=>{void navigator.clipboard.writeText(current).then(()=>options.notice('已复制库内路径。')).catch(()=>options.notice('复制失败，请从顶部路径手动复制。'));},
      handleMenuRevealInTree:()=>options.reveal(current),attachFile:pick,
      handleMenuRename:()=>options.action?.('rename',current),handleMenuDuplicate:()=>options.action?.('copy',current),onDelete:()=>options.action?.('trash',current),
      onToggleBookmark:()=>options.action?.('bookmark',current),onSplit:(direction:string)=>options.action?.(direction==='horizontal'?'split-horizontal':'split-vertical',current),
      handleMenuOpenInNewWindow:()=>options.action?.('window',current),handleMenuReveal:()=>options.action?.('reveal',current),handleMenuOpenInDefaultApp:()=>options.action?.('open',current),
      handleMenuPrint:()=>{setMode('read');requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));},
      handleMenuExportMarkdown:()=>{const url=URL.createObjectURL(new Blob([content()],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=current.split('/').pop()!;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
    });
  }
  function setMode(value:typeof mode){ui.reset();mode=value;if(value!=='read')lastMode=value;render();}
  function show(path:string,body:string){
    ui.reset();current=path;options.selection(null);
    if(path!==history[historyIndex]){history.splice(historyIndex+1);history.push(path);historyIndex=history.length-1;}
    if(!sessions.has(path)){
      const element=document.createElement('div');element.className='plainva-session';mount.append(element);
      const session=createEditorSession({parent:element,doc:body,mode:'live',editable:true,vaultPath:'/vault',i18n,
        headerTexts:{addIcon:'添加图标',addColor:'添加颜色',changeIcon:'修改图标',changeColor:'修改颜色'},headerAddActions:true,
        deps:{current:{queryService,vaultContext:environment,hostPath:path,readBinaryFile:environment.vaultAdapter.readBinaryFile,
          readNote:async p=>{try{return await options.readNote(clean(p));}catch{return null;}},imageLookup:()=>({notePath:path,resolveByName:name=>queryService.findByFileName(name)}),
          buildNoteEmbedExtension:noteEmbedPlugin,openWikiTarget:openNote,onOpenPath:openNote,openExternalUrl:options.openExternal,
          handlePaste:(event,view)=>{const data=event.clipboardData;if(!data)return false;const s=view.state.selection.main;const plan=planPaste(Array.from(data.files),data.getData('text/plain'),{empty:s.empty,text:view.state.sliceDoc(s.from,s.to)});if(plan.kind==='file'){event.preventDefault();importFiles([plan.file],view,path);return true;}if(plan.kind==='link'){event.preventDefault();view.dispatch({changes:{from:s.from,to:s.to,insert:plan.insert},selection:{anchor:s.from+plan.insert.length},userEvent:'input'});return true;}return false;},
          handleDrop:(event,view)=>{const items=Array.from(event.dataTransfer?.files??[]);if(!items.length)return false;event.preventDefault();importFiles(items,view,path);return true;},
          onDocChanged:view=>{if(applying||disposed)return;options.change(path,view.state.doc.toString());if(path===current){options.outline(parseHeadings(view.state.doc.toString()));}},
          onSelectionToolbar:position=>{if(path===current)ui.selection(position);},onSelectionStats:stats=>{if(path===current&&!disposed)options.selection(stats);},onPickIcon:anchor=>ui.pickIcon(anchor),onPickColor:anchor=>ui.pickColor(anchor),
        }},
      });sessions.set(path,{session,mount:element});
    }else replace(path,body);
    render();
  }
  function replace(path:string,body:string){const entry=sessions.get(path);if(!entry)return;if(entry.session.view.state.doc.toString()===body)return;applying=true;try{entry.session.applyExternalText(body);}finally{applying=false;}if(current===path)render();}
  const keyboard=(event:KeyboardEvent)=>{
    if(!active()||document.querySelector('[role="dialog"]'))return;
    if(event.key==='Tab')document.documentElement.dataset.modality='keyboard';
    if(!(event.ctrlKey||event.metaKey))return;
    if(event.key.toLowerCase()==='s'){event.preventDefault();options.save();}
    if(event.key.toLowerCase()==='e'){event.preventDefault();setMode(event.shiftKey?(mode==='source'?'live':'source'):(mode==='read'?lastMode:'read'));}
  };
  const pointer=()=>{if(active())document.documentElement.dataset.modality='pointer';};
  const toggle=(event:Event)=>{if(active()){const axis=(event as CustomEvent).detail?.axis;setMode(axis==='source'?(mode==='source'?'live':'source'):(mode==='read'?lastMode:'read'));}};
  const anchorJump=(event:Event)=>{const detail=(event as CustomEvent).detail;if(active()&&detail?.path===current){consumePendingAnchorJump(current);jumpAnchor(detail.anchor);}};
  const insertBase=async(event:Event)=>{if(!active()||!options.chooseBase)return;const view=sessions.get(current)!.session.view,before=view.state.doc.toString(),position=view.state.selection.main.head;try{const path=await options.chooseBase(event.type==='plainva-create-inline-base');if(!path||disposed)return;if(view.state.doc.toString()!==before){options.notice('笔记在选择期间改变，数据库已保留，请重新插入。');return;}const text=`![[${path}]]`;view.dispatch({changes:{from:position,insert:text},selection:{anchor:position+text.length},userEvent:'input'});}catch(e){options.notice(String(e));}};
  window.addEventListener('plainva-open-base-picker',insertBase);window.addEventListener('plainva-create-inline-base',insertBase);
  document.addEventListener('keydown',keyboard);root.addEventListener('pointerdown',pointer,true);window.addEventListener('plainva-toggle-view-mode',toggle);window.addEventListener(ANCHOR_JUMP_EVENT,anchorJump);
  return {show,replace,updateFiles(next:Entry[]){files=next;syncEnvironment();},status(next:string,pending=false,error:string|null=null){message=next;saving=pending;saveError=error;render();},
    jump,
    retarget(from:string,to?:string){
      const matches=(path:string)=>path===from||path.startsWith(from+'/');
      const next=(path:string)=>to?to+path.slice(from.length):'';
      for(const [path,entry] of sessions)if(matches(path)){entry.session.destroy();entry.mount.remove();sessions.delete(path);}
      const previous=history[historyIndex];const rewritten=history.flatMap(path=>matches(path)?to?[next(path)]:[]:[path]);history.splice(0,history.length,...rewritten);historyIndex=Math.max(-1,history.indexOf(matches(previous??'')?next(previous):previous));
      if(matches(current)){current='';ui.reset();ui.read('','',false);}options.outline([]);
    },
    suspend(){ui.reset();},
    destroy(){disposed=true;window.removeEventListener('plainva-open-base-picker',insertBase);window.removeEventListener('plainva-create-inline-base',insertBase);document.removeEventListener('keydown',keyboard);root.removeEventListener('pointerdown',pointer,true);window.removeEventListener('plainva-toggle-view-mode',toggle);window.removeEventListener(ANCHOR_JUMP_EVENT,anchorJump);ui.destroy();for(const entry of sessions.values()){entry.session.destroy();entry.mount.remove();}sessions.clear();},
  };
}
