/** Hide only the app's trailing transport envelope; keep user-authored text intact. */
export function agentMessageContent(text: string): {text: string; files: string[]} {
  const imageOmitted='\n\n[Image omitted: could not be resized below the inline image size limit.]';
  if(text.endsWith(imageOmitted)){
    const original=agentMessageContent(text.slice(0,-imageOmitted.length));
    return {text:original.text+'\n\n图片未能发送，请重新导入有效图片后再试。',files:original.files};
  }
  const marker = '\n\n```azcine-context\n';
  const start = text.lastIndexOf(marker);
  if (start < 0 || !text.endsWith('\n```')) return { text, files: [] as string[] };
  try {
    const value = JSON.parse(text.slice(start + marker.length, -4));
    if (value.version !== 1 || typeof value.inputId !== 'string' || !value.inputId ||
      typeof value.conversationKey !== 'string' || !value.conversationKey ||
      typeof value.source?.module !== 'string' || !Array.isArray(value.objects) || !Array.isArray(value.attachments)) {
      return { text, files: [] as string[] };
    }
    return { text: text.slice(0, start), files: value.attachments.flatMap((file: unknown) =>
      file && typeof file === 'object' && 'name' in file && typeof file.name === 'string' ? [file.name] : []) };
  } catch { return { text, files: [] as string[] }; }
}

export function agentMessageAttachments(text:string):import('./components/ui/attachment-preview.tsx').AttachmentPreviewValue[]{
  text=text.replace(/(?:\n\n\[Image omitted: could not be resized below the inline image size limit\.\])+$/,'');
  if(agentMessageContent(text).text===text)return [];
  const marker='\n\n```azcine-context\n';
  try{const value=JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length,-4));
    return value.attachments.flatMap((file:unknown)=>{if(!file||typeof file!=='object'||!('name' in file)||typeof file.name!=='string')return [];
      const data=file as Record<string,unknown>;return [{name:file.name,...(typeof data.id==='string'?{id:data.id}:{}),...(typeof data.mimeType==='string'?{mimeType:data.mimeType}:{}),...(typeof data.bytes==='number'?{bytes:data.bytes}:{})}];});
  }catch{return [];}
}

/** Fold a well-formed draft for review without altering the original Pi message. */
export function assistantDraftContent(text:string):{text:string;draft:string|null}{
  const matches=[...text.matchAll(/```azcine-draft\r?\n([\s\S]*?)\r?\n```/g)];
  if(matches.length!==1)return{text,draft:null};
  try{const value=JSON.parse(matches[0][1]);if(value.version!==1||!Array.isArray(value.operations)||!Array.isArray(value.decisions))return{text,draft:null};
    return{text:text.replace(matches[0][0],'').trim(),draft:matches[0][1]};
  }catch{return{text,draft:null};}
}
