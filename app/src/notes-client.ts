import {invoke} from './desktop-api.ts';
import type {NotesApi,NotesIndex,NoteDocument} from './notes-contract.ts';
export function notesClient(root:string):NotesApi {return {
  local:<T,>(library:string,operation:string,args:Record<string,unknown>={})=>invoke<T>('notes_local',{input:{root,library,operation,args}}),
  index:()=>invoke<NotesIndex>('notes_index',{root}),
  select:path=>invoke<NotesIndex>('notes_select',{root,path}),
  pick:()=>invoke<string|null>('pick_data_root'),
  read:(library,path)=>invoke<NoteDocument>('notes_read',{root,library,path}),
  save:(library,doc)=>invoke<NoteDocument>('notes_save',{input:{root,library,...doc}}),
  binary:async(library,path)=>new Uint8Array(await invoke<number[]>('notes_binary',{root,library,path})),
  attach:(library,path,bytes)=>invoke<void>('notes_attach',{input:{root,library,path,bytes:Array.from(bytes)}}),
  external:async url=>{const index=await invoke<NotesIndex>('notes_index',{root});if(!index.library)throw Error('请先选择笔记库');await invoke('notes_local',{input:{root,library:index.library,operation:'external',args:{url}}});},
};}
