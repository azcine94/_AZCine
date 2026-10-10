export type NoteFile={path:string;kind:'note'|'attachment'|'base';mtime:number;size:number};
export type NotesIndex={library:string|null;name:string;files:NoteFile[];directories:string[]};
export type NoteDocument={path:string;body:string;version:string};
export type Heading={text:string;line:number;slug:string};
export type NotesApi={
  local<T=unknown>(library:string,operation:string,args?:Record<string,unknown>):Promise<T>;
  index():Promise<NotesIndex>;select(path:string):Promise<NotesIndex>;pick():Promise<string|null>;
  read(library:string,path:string):Promise<NoteDocument>;
  save(library:string,doc:NoteDocument):Promise<NoteDocument>;
  binary(library:string,path:string):Promise<Uint8Array>;
  attach(library:string,path:string,bytes:Uint8Array):Promise<void>;
  external(url:string):Promise<void>;
};
export function notesError(error:unknown){
  const message=typeof error==='string'?error:error&&typeof error==='object'&&'message' in error?String(error.message):'';
  if(/notes_\w+.*(?:not allowed|not found)/i.test(message))return '笔记桌面命令尚未就绪，请重启当前工作目录的桌面开发版；草稿保留。';
  return message.trim()||'笔记操作失败，草稿保留，请重试。';
}
