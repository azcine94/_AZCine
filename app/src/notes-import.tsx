import {useRef,useState} from 'react';
import {Button} from './components/ui/button.tsx';
import {Input} from './components/ui/input.tsx';
import {Checkbox} from './components/ui/checkbox.tsx';
import {NativeSelect} from './components/ui/native-select.tsx';
import {Feedback} from './components/ui/feedback.tsx';
import {FormDialog} from './components/ui/form-dialog.tsx';
import type {NotesApi} from './notes-contract.ts';
import {notesError} from './notes-contract.ts';
import type {ImportEntry,ImportPreview} from '../plainva-editor/assets/editor.js';
import type {LocalTools} from './notes-base.tsx';
export function NotesImport({api,library,tools,close,refresh}:{api:NotesApi;library:string;tools:LocalTools;close:()=>void;refresh:()=>Promise<void>}){
  const sources=tools.importSources();const [source,setSource]=useState(sources[0]?.id??'generic_markdown'),[folder,setFolder]=useState(`Import-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  const [entries,setEntries]=useState<ImportEntry[]>([]),bytes=useRef(new Map<string,Uint8Array>()),[plan,setPlan]=useState<ImportPreview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[report,setReport]=useState(''),[warnings,setWarnings]=useState<string[]>([]);
  const [preserve,setPreserve]=useState(true),[trash,setTrash]=useState(false);const cancel=useRef<AbortController|null>(null),generation=useRef(0);
  const options=()=>({targetVaultPath:'/vault',targetSubfolder:folder,stampOkfMetadata:false,preserveTimestamps:preserve,includeTrashed:trash});
  const supported=sources.find(s=>s.id===source)?.options??[];
  async function pick(files:FileList|null){if(!files)return;const token=++generation.current;setBusy(true);setError('');setPlan(null);try{const result=await tools.unpack(Array.from(files));if(token!==generation.current)return;bytes.current=result.bytes;setEntries(result.entries);setWarnings(result.warnings);}catch(e){setError(notesError(e));}finally{setBusy(false);}}
  async function preview(){setBusy(true);setError('');try{const preview=await tools.importAnalyze(source,entries,options());setPlan({...preview,warnings:[...warnings,...preview.warnings]});}catch(e){setError(notesError(e));}finally{setBusy(false);}}
  async function run(){
    if(!plan)return;setBusy(true);setError('');cancel.current=new AbortController();
    // Upstream ImportWriter passes vault-relative paths. Keep every write in
    // this import's new folder, including sources which pass a /vault/ prefix.
    const clean=(path:string)=>{const relative=path.startsWith('/vault/')?path.slice(7):path;if((relative!==folder&&!relative.startsWith(folder+'/'))||relative.includes('\\')||relative.includes(':')||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('导入路径不在本次导入目录内');return relative;};
    try{
      if(await api.local(library,'exists',{path:folder}))throw Error('导入文件夹已存在，请换一个新名称。');
      const result=await tools.importRun(source,entries,{...options(),signal:cancel.current.signal,readSourceBytes:async(path:string)=>bytes.current.get(path)??null,vaultAdapter:{
        exists:async(path:string)=>path==='/vault'||await api.local(library,'exists',{path:clean(path)}),
        createDir:async(path:string)=>{if(path!=='/vault')await api.local(library,'mkdir',{path:clean(path)});},
        writeTextFile:async(path:string,body:string)=>{await api.local(library,'import-file',{path:clean(path),bytes:Array.from(new TextEncoder().encode(body))});},
        writeBinaryFile:async(path:string,data:Uint8Array)=>{await api.local(library,'import-file',{path:clean(path),bytes:Array.from(data)});},
        setFileTimes:async(path:string,times:Record<string,number>)=>{await api.local(library,'file-times',{path:clean(path),...times});},
      }},(percent,text)=>setProgress(`${Math.round(percent)}% · ${text}`));
      setReport(result.summaryMarkdown);setPlan(null);setProgress(cancel.current.signal.aborted?'导入已停止，已写入内容及报告保留。':`已导入 ${result.importedNotesCount} 篇，跳过 ${result.skippedCount} 项，不完整 ${result.degradedCount} 项。`);await refresh();
    }catch(e){setError(notesError(e)+' 已写入的内容保留在导入目录中，可在文件树移入回收站。');await refresh();}finally{setBusy(false);cancel.current=null;}
  }
  return <FormDialog className="notes-dialog" open onOpenChange={v=>{if(!v&&!busy)close();}} title="导入本地笔记" description="选择导出文件、ZIP 或目录。先预览，再写入新的子目录；原件不会修改，同名内容不覆盖。" wide footer={<><Button variant="app-quiet" disabled={!busy||!cancel.current} onClick={()=>cancel.current?.abort()}>停止导入</Button><Button variant="app-quiet" disabled={busy||!entries.length} onClick={()=>void preview()}>预览导入</Button><Button variant="app-primary" disabled={busy||!plan} onClick={()=>void run()}>开始导入</Button></>}>
    <label>来源<NativeSelect disabled={busy} value={source} onChange={e=>{setSource(e.target.value);setPlan(null);}}>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label>
    <label>导入目录<Input disabled={busy} value={folder} onChange={e=>{setFolder(e.target.value);setPlan(null);}}/></label>
    <div className="notes-local-toolbar"><label>选择文件<Input type="file" multiple disabled={busy} onChange={e=>void pick(e.target.files)}/></label><label>选择文件夹<Input type="file" multiple {...{webkitdirectory:''} as Record<string,string>} disabled={busy} onChange={e=>void pick(e.target.files)}/></label></div>
    {supported.some(o=>o.key==='preserveTimestamps')&&<label><Checkbox checked={preserve} disabled={busy} onCheckedChange={v=>{setPreserve(v===true);setPlan(null);}}/>保留来源修改时间</label>}
    {supported.some(o=>o.key==='includeTrashed')&&<label><Checkbox checked={trash} disabled={busy} onCheckedChange={v=>{setTrash(v===true);setPlan(null);}}/>包含来源回收站中的笔记</label>}
    <p>已选择 {entries.length} 个文件。</p>
    {plan&&<><p>{plan.totalNotes} 篇笔记 · {plan.totalAttachments} 个附件 · {plan.totalDatabases} 个数据库</p>{plan.warnings.map((w,i)=><Feedback key={i} tone="pending">{w}</Feedback>)}</>}
    {progress&&<p role="status">{progress}</p>}{error&&<Feedback tone="error">{error}</Feedback>}{report&&<pre className="notes-import-report">{report}</pre>}
  </FormDialog>;
}
