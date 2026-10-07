import './record-context-menu.css';
import { useRef } from 'react';
import type { ReactElement } from 'react';
import { ContextMenu } from 'radix-ui';
import { Copy } from 'lucide-react';
import { notifyOperation } from './operation-toast.tsx';

export interface RecordContextAction {label:string;disabled?:boolean;destructive?:boolean;run:(origin:HTMLElement|null)=>void}
export async function copyRecordText(text:string){
  try{await navigator.clipboard.writeText(text);notifyOperation('已复制。');}
  catch{notifyOperation('复制失败，请选择文字后用 Ctrl+C 复制。',{tone:'error'});}
}
export function RecordContextMenu({children,copyText,actions=[]}:{children:ReactElement;copyText?:string;actions?:RecordContextAction[]}){
  const origin=useRef<HTMLElement|null>(null),openingLayer=useRef(false);
  return <ContextMenu.Root><ContextMenu.Trigger asChild onContextMenuCapture={event=>{
    // Native input menus keep selection, OS clipboard formats and undo intact.
    const target=event.target instanceof Element?event.target:null;
    const selection=window.getSelection();
    const selectedHere=!!selection?.toString()&&!!(selection.anchorNode&&event.currentTarget.contains(selection.anchorNode)||selection.focusNode&&event.currentTarget.contains(selection.focusNode));
    if(target?.closest('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),[contenteditable=true],img')||selectedHere){event.stopPropagation();return;}
    origin.current=event.currentTarget.matches('button,a,[tabindex]')?event.currentTarget:event.currentTarget.querySelector<HTMLElement>('button:not(:disabled),a,[tabindex]')??event.currentTarget;
  }}>{children}</ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content data-slot="context-menu-content" collisionPadding={12} className="z-50 min-w-40 max-w-80 rounded-md border bg-popover p-1 text-popover-foreground shadow-md" onCloseAutoFocus={event=>{event.preventDefault();if(openingLayer.current){openingLayer.current=false;return;}if(origin.current?.isConnected)origin.current.focus({preventScroll:true});}}>
    {copyText!==undefined&&<ContextMenu.Item className="record-context-item" onSelect={()=>void copyRecordText(copyText)}><Copy/>复制内容</ContextMenu.Item>}
    {actions.map(action=><ContextMenu.Item key={action.label} className="record-context-item" data-destructive={action.destructive||undefined} disabled={action.disabled} onSelect={()=>{openingLayer.current=true;action.run(origin.current);}}>{action.label}</ContextMenu.Item>)}
  </ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>;
}
