import type {NotesApi,NotesIndex,NoteDocument} from '../notes-contract.ts';
export function notesFixture(state='normal'):NotesApi {
  const documents=new Map<string,NoteDocument>([['10-Projects/Film/镜头笔记.md',{path:'10-Projects/Film/镜头笔记.md',version:'fixture-1',body:'# 镜头笔记\n\n> [!note] 构图方向\n> 这是 UI 总览中的虚构资料，可体验原版编辑器。\n\n## 制作清单\n\n- [ ] 灯光调整\n- [x] 场景搭建\n\n**选中文字** 可显示格式浮条。\n'}],['00-Inbox/长标题笔记.md',{path:'00-Inbox/长标题笔记.md',version:'fixture-1',body:'# 虚构笔记\n\n页面切换保留编辑草稿。\n'}]]);
  let selected=state!=='empty',revision=1;
  const folders=new Set(['00-Inbox','10-Projects','10-Projects/Film','Templates','Journal']);
  const states=new Map<string,{revision:number;value:unknown}>(),drafts=new Map<string,Record<string,unknown>>(),history=new Map<string,NoteDocument[]>(),trash=new Map<string,{path:string;docs:NoteDocument[]}>();
  documents.set('Templates/制作记录.md',{path:'Templates/制作记录.md',version:'fixture-1',body:'# {{title}}\n\n{{date}}\n\n负责人：{{prompt:负责人}}\n'});
  documents.set('镜头.base',{path:'镜头.base',version:'fixture-1',body:'filters:\n  and:\n    - file.folder == "10-Projects"\nviews:\n  - type: table\n    name: 制作记录\n    order:\n      - file.name\n      - note.status\n'});
  for(let i=1;i<=51;i++){const path=`10-Projects/Film/测试笔记-${String(i).padStart(2,'0')}-长标题与制作流程记录.md`;documents.set(path,{path,version:'fixture-1',body:`---\ntitle: 虚构制作记录 ${i}\nstatus: ${i%2?'进行中':'完成'}\ndate: 2026-10-${String(i%28+1).padStart(2,'0')}\nend: 2026-10-28\ntags: [制作,测试]\n---\n# 虚构制作记录 ${i}\n\n${'这是隔离环境的长正文，用于核对搜索摘要、换行和列表行高。'.repeat(12)}\n\n- [ ] 待办 ${i}\n- [x] 已完成 ${i}\n\n[[00-Inbox/长标题笔记]]\n`});}
  if(state.startsWith('notes-base-')){const doc=documents.get('镜头.base')!;doc.body=doc.body.replace('type: table','type: table\n    plainva:\n      render: '+state.slice(11));}
  if(state==='notes-bookmarks'){const paths=[...documents.keys()].filter(p=>p.endsWith('.md'));states.set('bookmarks',{revision:1,value:paths.slice(3,6)});states.set('recent',{revision:1,value:paths.slice(0,8)});}
  if(state==='notes-history'){const doc=[...documents.values()][0];history.set(doc.path,[{...doc,version:'fixture-old',body:'# 旧版虚构笔记\n\n保留的历史内容。'}]);}
  if(state==='notes-drafts'){const doc=[...documents.values()][0];drafts.set('fixture-draft',{...doc,body:doc.body+'\n\n恢复记录中的虚构补充。',session:'fixture',revision:1,time:String(Date.now())});}
  if(state==='notes-trash')trash.set('fixture-trash',{path:'00-Inbox/虚构已删除.md',docs:[{path:'00-Inbox/虚构已删除.md',body:'# 可恢复的虚构内容',version:'fixture-trash'}]});
  if(state==='long')for(const doc of documents.values())doc.body+='\n\n'+('这是用于总览检查长文本换行的虚构内容。'.repeat(40));
  const index=():NotesIndex=>({library:selected?'C:/Fixture/Notes':null,name:selected?'虚构笔记库':'',directories:selected?[...folders]:[],files:selected?[...documents.values()].map(d=>({path:d.path,kind:d.path.endsWith('.base')?'base':'note',mtime:revision,size:d.body.length})):[]});
  return {
    local:async<T,>(_library:string,operation:string,args:Record<string,unknown>={})=>{
      const path=String(args.path??''),key=String(args.key??'');let result:unknown=null;
      if(operation==='catalog')result=[...documents.values()].map(d=>({...d,mtime:revision}));
      else if(operation==='state-get')result=states.get(key)??null;
      else if(operation==='state-put'){const old=states.get(key);if((old?.revision??0)!==(args.revision??0))throw Error('虚构状态冲突');const next={revision:(old?.revision??0)+1,value:args.value};states.set(key,next);result=next;}
      else if(operation==='inspect'){if(!documents.has(path)&&!folders.has(path))throw Error('虚构文件不存在');result={path,version:String(revision),folder:folders.has(path)};}
      else if(operation==='exists')result=documents.has(path)||folders.has(path);
      else if(operation==='mkdir'){let current='';for(const part of path.split('/')){current+=(current?'/':'')+part;folders.add(current);}}
      else if(operation==='create'){if(documents.has(path)||folders.has(path))throw Error('虚构：名称已存在');if(args.folder)folders.add(path);else documents.set(path,{path,body:String(args.body??''),version:`fixture-${++revision}`});result={path};}
      else if(['rename','copy','trash'].includes(operation)){const target=String(args.target??'');if(operation!=='trash'&&target&&(documents.has(target)||folders.has(target)))throw Error('虚构：目标已存在');const affected=[...documents.values()].filter(d=>d.path===path||d.path.startsWith(path+'/'));if(operation==='trash'){const id=String(++revision);trash.set(id,{path,docs:affected});result={id,path};}for(const d of affected){if(operation!=='copy')documents.delete(d.path);if(operation!=='trash'){const next=target+d.path.slice(path.length);documents.set(next,{...d,path:next});}}for(const folder of [...folders].filter(f=>f===path||f.startsWith(path+'/'))){if(operation!=='copy')folders.delete(folder);if(operation!=='trash')folders.add(target+folder.slice(path.length));}}
      else if(operation==='trash-list')result=[...trash].map(([id,r])=>({id,path:r.path,time:String(Date.now())}));
      else if(operation==='trash-restore'){const r=trash.get(String(args.id));if(!r)throw Error('虚构恢复记录不存在');for(const d of r.docs){if(documents.has(d.path))throw Error('虚构同名文件存在');}for(const d of r.docs)documents.set(d.path,d);trash.delete(String(args.id));}
      else if(operation==='draft-put'||operation==='draft-clear')drafts.set(path+'|'+args.session,{...args,cleared:operation==='draft-clear',time:String(Date.now())});
      else if(operation==='drafts')result=[...drafts.values()];
      else if(operation==='history')result=(history.get(path)??[]).map((d,i)=>({id:String(i),path,version:d.version,time:String(Date.now()-i*60000)}));
      else if(operation==='history-read')result=(history.get(path)??[]).find(d=>d.version===args.version);
      else if(operation==='import-file'){if(documents.has(path))throw Error('虚构同名文件存在');documents.set(path,{path,body:new TextDecoder().decode(new Uint8Array(args.bytes as number[])),version:`fixture-${++revision}`});}
      else if(operation==='file-times')result=null;
      else throw Error('此总览操作不访问系统或真实磁盘。');
      return result as T;
    },
    index:async()=>{if(state==='error')throw Error('虚构：目录暂时不可用。');if(state==='loading')return new Promise<NotesIndex>(()=>{});return index();},
    select:async()=>{selected=true;return index();},pick:async()=>'C:/Fixture/Notes',
    read:async(_library,path)=>{const doc=documents.get(path);if(!doc)throw Error('虚构：笔记不存在。');return {...doc};},
    save:async(_library,doc)=>{if(state==='conflict')throw {code:'notes_conflict',message:'虚构：原文件已被外部修改，草稿保留。'};if(state==='dirty')throw Error('虚构：保存失败，草稿保留。');const old=documents.get(doc.path);if(old&&old.version!==doc.version)throw Error('虚构文件冲突');if(old)history.set(doc.path,[...(history.get(doc.path)??[]),{...old}]);const saved={...doc,version:`fixture-${++revision}`};documents.set(doc.path,saved);return saved;},
    binary:async()=>{throw Error('虚构库没有这个附件。');},attach:async()=>{throw Error('总览不写入磁盘附件。');},external:async()=>{throw Error('总览不打开外部链接。');},
  };
}
