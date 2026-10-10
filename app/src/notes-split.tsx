import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Button} from './components/ui/button.tsx';
import {NativeSelect} from './components/ui/native-select.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import {notifyOperation} from './components/ui/operation-toast.tsx';
import {focusNotesPane,isNotesPaneActive} from './notes-editor-focus.ts';
import type {NotesApi,NotesIndex,NoteDocument} from './notes-contract.ts';
import {notesError} from './notes-contract.ts';
import type {PlainvaEditor,mountPlainvaEditor} from '../plainva-editor/assets/editor.js';
type Props={baseRoot:(root:HTMLDivElement|null)=>void;status:ReactNode;path:string;index:NotesIndex;api:NotesApi;active:boolean;read:(path:string)=>Promise<NoteDocument>;change:(path:string,body:string)=>void;body?:string;open:(path:string)=>Promise<void>;save:(path:string)=>Promise<void>;close:()=>void;options:Pick<Parameters<typeof mountPlainvaEditor>[1],'action'|'chooseBase'|'templateAnswers'|'templates'|'preferences'|'catalog'>};
export function NotesSplit(props:Props){
  const current=useRef(props);current.current=props;const root=useRef<HTMLDivElement>(null),editor=useRef<PlainvaEditor|null>(null);const [error,setError]=useState('');
  useEffect(()=>{let alive=true;void (async()=>{const runtime=await import('../plainva-editor/assets/editor.js');if(!alive||!root.current)return;const result=await runtime.mountPlainvaEditor(root.current,{
    ...current.current.options,files:current.current.index.files,active:()=>alive&&current.current.active&&!/\.base$/i.test(current.current.path)&&isNotesPaneActive('secondary'),connected:()=>alive,
    readNote:async path=>(await current.current.read(path)).body,readBinary:path=>current.current.api.binary(current.current.index.library!,path),writeAttachment:(path,bytes)=>current.current.api.attach(current.current.index.library!,path,bytes),
    change:(path,body)=>current.current.change(path,body),open:path=>current.current.open(path),notice:notifyOperation,openExternal:url=>{void current.current.api.external(url).catch(e=>setError(notesError(e)));},save:()=>{void current.current.save(current.current.path);},outline:()=>{},selection:()=>{},reveal:()=>{},attachmentsChanged:()=>{},
  });if(!alive){result.destroy();return;}editor.current=result;const doc=await current.current.read(current.current.path);if(alive&&!/\.base$/i.test(doc.path))result.show(doc.path,doc.body);})().catch(e=>{if(alive)setError(notesError(e));});return()=>{alive=false;editor.current?.destroy();editor.current=null;focusNotesPane('primary');};},[]);
  useEffect(()=>{let alive=true;void props.read(props.path).then(doc=>{if(alive&&!/\.base$/i.test(doc.path))editor.current?.show(doc.path,doc.body);}).catch(e=>{if(alive)setError(notesError(e));});return()=>{alive=false;};},[props.path]);
  useEffect(()=>{if(props.body!==undefined)editor.current?.replace(props.path,props.body);},[props.body,props.path]);
  useEffect(()=>{editor.current?.updateFiles(props.index.files);},[props.index]);
  return <div className="notes-secondary" data-notes-secondary onPointerDown={()=>focusNotesPane('secondary')} onFocusCapture={()=>focusNotesPane('secondary')}>
    <div className="notes-local-toolbar"><NativeSelect aria-label="分屏笔记" value={props.path} onChange={e=>{void props.open(e.target.value).catch(e=>setError(notesError(e)));}}>{props.index.files.filter(f=>f.kind!=='attachment').map(f=><option key={f.path} value={f.path}>{f.path.split('/').pop()}</option>)}</NativeSelect><Button variant="app-quiet" onClick={()=>void props.save(props.path)}>保存</Button><Button variant="app-quiet" onClick={props.close}>关闭分屏</Button></div>
    {props.status}{error&&<Feedback tone="error">{error}</Feedback>}<div className="notes-base-pane" ref={props.baseRoot} hidden={!/\.base$/i.test(props.path)}/><div className="notes-editor" ref={root} hidden={/\.base$/i.test(props.path)}><div className="plainva-chrome" data-editor-chrome/><div className="plainva-host" data-editor-mount/></div>
  </div>;
}
