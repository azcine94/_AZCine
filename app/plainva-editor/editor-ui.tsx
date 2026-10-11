// Browser host wiring only. All visible controls/renderers below are upstream.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SelectionToolbar, applySelectionFormat, type SelectionToolbarPosition } from './vendor/packages/ui/src/components/SelectionToolbar';
import { BlockMenu } from './vendor/apps/desktop/src/components/BlockMenu';
import { TableSizePicker } from './vendor/apps/desktop/src/components/TableSizePicker';
import { TableContextMenu } from './vendor/apps/desktop/src/components/TableContextMenu';
import { EmojiPicker, type EmojiPickerLabels } from './vendor/apps/desktop/src/components/EmojiPicker';
import { ColorPopover } from './vendor/apps/desktop/src/components/ColorPopover';
import { MarkdownReader } from './vendor/apps/desktop/src/components/MarkdownReader';
import { DocumentHeaderRead } from './vendor/apps/desktop/src/components/DocumentHeaderRead';
import { docIconValue } from './vendor/packages/ui/src/components/DocIcon';
import { plainvaMetaFromContent } from './vendor/packages/ui/src/services/docMeta';
import { setFrontmatterPath, deleteFrontmatterPath, noteBodyOf } from './vendor/packages/core/src/frontmatter-surgical';
import { minimalDocChange } from './vendor/packages/ui/src/lib/textDiff';
import { toggleTaskAtIndex, setHtmlCheckboxChecked } from './vendor/packages/ui/src/lib/taskToggle';
import { applyBlockAction, performBlockMove } from './vendor/packages/ui/src/components/blockActions';
import { buildMarkdownTable, planTableInsertion, parseMarkdownTable, serializeTable, insertRow, insertColumn, deleteRow, deleteColumn, setColumnAlign } from './vendor/packages/ui/src/components/tableModel';
import type { EditorView } from '@codemirror/view';
import i18n from './i18n-adapter';
import {TooltipHost} from './vendor/packages/ui/src/components/ui/Tooltip';
import {UpstreamEditorChrome} from './editor-chrome';
import {CustomDatePicker} from './vendor/apps/desktop/src/components/DatePicker';
import {TemplatePickerModal} from './vendor/apps/desktop/src/components/TemplatePickerModal';
import {resolveTemplate} from './vendor/packages/ui/src/base/templateEngine';
import {finalizeTemplate} from './vendor/packages/ui/src/base/templateFiles';
import {templates} from './template-adapter';
import {VaultContext} from './reader-adapter';

type Host = { root:HTMLElement; active():boolean; key():string; view():EditorView; editable():boolean; notice(text:string):void; openNote(path:string):void;environment?:()=>unknown;templateAnswers?:(fields:{label:string;kind:string;defaultValue?:string;options?:string[]}[])=>Promise<Record<string,string>|null> };
export function createEditorUI(host:Host) {
  const chromeRoot=createRoot(host.root.querySelector('[data-editor-chrome]')!);
  let fullWidth=false;
  const overlay=document.createElement('div'); overlay.className='plainva-overlays'; host.root.append(overlay);
  const tips=document.createElement('div'); overlay.append(tips); const tipsRoot=createRoot(tips); tipsRoot.render(<TooltipHost/>);
  const toolbar=document.createElement('div'); overlay.append(toolbar);
  const panel=document.createElement('div'); overlay.append(panel);
  const toolbarRoot=createRoot(toolbar), panelRoot=createRoot(panel);
  const reader=document.createElement('div'); reader.className='plainva-reader'; reader.hidden=true;
  host.root.querySelector('[data-editor-mount]')!.append(reader); const readerRoot=createRoot(reader);
  let panelOpen=false;
  const close=()=>{ panelOpen=false; panelRoot.render(null); };
  const show=(node:React.ReactNode)=>{ toolbarRoot.render(null); panelOpen=true; panelRoot.render(node); };
  const guard=()=> { const key=host.key(); return ()=>key===host.key()&&host.editable(); };
  const anchor=()=> { const v=host.view(), c=v.coordsAtPos(v.state.selection.main.head); return {x:c?.left??200,y:c?.bottom??160}; };
  const change=(text:string)=> { const v=host.view(), diff=minimalDocChange(v.state.doc.toString(),text); if(diff) v.dispatch({changes:diff,userEvent:'input'}); };
  const metadata=(fields:Record<string,string|null>)=> {
    try { let text=host.view().state.doc.toString(); for(const [key,value] of Object.entries(fields)) text=value===null?deleteFrontmatterPath(text,['plainva',key]):setFrontmatterPath(text,['plainva',key],value); change(text); }
    catch { host.notice('文档属性格式无法解析，请在源码模式检查顶部 YAML；正文已保留。'); }
  };
  const labels=():EmojiPickerLabels=> {
    const t=(key:string)=>String(i18n.t(`emojiPicker.${key}`));
    return {searchPlaceholder:t('search'),clearSearch:String(i18n.t('sidebar.clearSearch')),recent:t('recent'),remove:t('remove'),noResults:t('noResults'),modeEmoji:t('modeEmoji'),modeIcons:t('modeIcons'),tint:t('tint'),tintDefault:t('tintDefault'),tintCustom:t('tintCustom'),
      categories:Object.fromEntries(['smileys','people','animals','food','activities','travel','objects','symbols'].map(k=>[k,t('cat'+k[0].toUpperCase()+k.slice(1))])) as EmojiPickerLabels['categories'],
      iconCategories:Object.fromEntries(['knowledge','work','tech','people','media','life','nature','travel','finance','symbols'].map(k=>[k,t('iconCategories.'+k)])) as EmojiPickerLabels['iconCategories']};
  };
  function pickIcon(at=anchor(),emojiOnly=false) {
    if(!host.editable()) return; const valid=guard(), v=host.view(), selection=v.state.selection.main;
    const done=()=>{close(); v.focus();};
    show(<EmojiPicker {...at} labels={labels()} emojiOnly={emojiOnly} showRemove={!emojiOnly&&!!plainvaMetaFromContent(v.state.doc.toString()).icon}
      onSelect={emoji=>{if(valid()) {if(emojiOnly) v.dispatch({changes:{from:selection.from,to:selection.to,insert:emoji},selection:{anchor:selection.from+emoji.length},userEvent:'input'}); else metadata({icon:emoji,icon_color:null});} done();}}
      onSelectIcon={(name,color)=>{if(valid()) metadata({icon:docIconValue(name),icon_color:color}); done();}}
      onRemove={()=>{if(valid()) metadata({icon:null,icon_color:null}); done();}} onClose={close}/>);
  }
  function pickColor(at=anchor()) {
    if(!host.editable()) return; const valid=guard();
    show(<ColorPopover {...at} value={plainvaMetaFromContent(host.view().state.doc.toString()).headerColor}
      onSelect={(color,opts)=>{if(valid()) metadata({header_color:color}); if(opts.close) close();}}
      onRemove={()=>{if(valid()) metadata({header_color:null}); close();}} onClose={close}/>);
  }
  const listeners:Array<()=>void>=[];
  const listen=(name:string,run:(detail:any)=>void)=>{const listener=(event:Event)=>{if(host.active()&&host.editable())run((event as CustomEvent).detail??{});};window.addEventListener(name,listener);listeners.push(()=>window.removeEventListener(name,listener));};
  listen('plainva-open-icon-picker',()=>pickIcon());
  listen('plainva-open-emoji-picker',()=>pickIcon(anchor(),true));
  listen('plainva-open-header-color',()=>pickColor());
  listen('plainva-open-date-mention',d=>{
    const valid=guard(),v=host.view(),pos=Math.min(d.pos??v.state.selection.main.head,v.state.doc.length),coords=v.coordsAtPos(pos);
    show(<div className="pv-popover--fixed" style={{left:coords?.left??200,top:coords?.bottom??160,minWidth:180,visibility:'visible'}}><CustomDatePicker value="" autoOpen onClose={close} onChange={iso=>{
      if(valid()) {const token=`@${iso}`; v.dispatch({changes:{from:pos,insert:token},selection:{anchor:pos+token.length},userEvent:'input'}); v.focus();} close();
    }}/></div>);
  });
  listen('plainva-open-template-picker',()=>{
    const valid=guard(),v=host.view(),selection=v.state.selection.main;
    show(<TemplatePickerModal isOpen title="插入模板" onClose={close} onPick={async path=>{
      const template=templates.find(t=>t.path===path); if(!template||!valid()) return;
      const before=v.state.doc.toString();const resolved=resolveTemplate(noteBodyOf(template.body),{title:host.key().split('/').pop()!.replace(/\.md$/i,''),now:new Date(),selection:()=>v.state.sliceDoc(selection.from,selection.to)},'interactive');
      close();const answers=resolved.requests.length?await host.templateAnswers?.(resolved.requests):{};if(answers==null||!valid()||v.state.doc.toString()!==before)return;
      const result=finalizeTemplate(resolved.text,answers),prefix=selection.from&&v.state.sliceDoc(selection.from-1,selection.from)!=='\n'?'\n\n':'';
      v.dispatch({changes:{from:selection.from,to:selection.to,insert:prefix+result.text},selection:{anchor:selection.from+prefix.length+(result.cursor??result.text.length)},userEvent:'input'}); v.focus();
    }}/>);
  });
  listen('plainva-move-block',d=>performBlockMove(host.view(),d.from,d.targetFrom));
  listen('plainva-open-block-menu',d=>{const valid=guard(); show(<BlockMenu x={d.x} y={d.y} onClose={close} onAction={action=>{if(valid()) {applyBlockAction(host.view(),d.from,action); host.view().focus();} close();}}/>);});
  listen('plainva-open-table-picker',()=>{
    const valid=guard(), v=host.view(), selection=v.state.selection.main;
    show(<TableSizePicker {...anchor()} onClose={close} onSelect={(rows,cols)=>{
      if(valid()) {const {from,to}=selection, text=v.state.doc.toString(), table=buildMarkdownTable(rows,cols,'列');
        const plan=planTableInsertion(table.text,text[from-1]||'',text[from-2]||'',text[to]||'',text[to+1]||'');
        v.dispatch({changes:{from,to,insert:plan.insert},selection:{anchor:from+plan.caretOffset},userEvent:'input'}); v.focus();} close();
    }}/>);
  });
  listen('plainva-open-table-menu',d=>{
    const valid=guard(), v=host.view(), before=v.state.sliceDoc(d.from,d.to), model=parseMarkdownTable(before); if(!model) return;
    show(<TableContextMenu x={d.x} y={d.y} kind={d.kind} align={d.align} onClose={close} onAction={action=>{
      if(valid()&&v.state.sliceDoc(d.from,d.to)===before) {
        let next=model;
        if(action==='row-above') next=insertRow(model,d.rowIndex);
        if(action==='row-below') next=insertRow(model,d.kind==='header'?0:d.rowIndex+1);
        if(action==='row-delete') next=deleteRow(model,d.rowIndex);
        if(action==='col-left') next=insertColumn(model,d.colIndex);
        if(action==='col-right') next=insertColumn(model,d.colIndex+1);
        if(action==='col-delete') next=deleteColumn(model,d.colIndex);
        if(action.startsWith('align-')) next=setColumnAlign(model,d.colIndex,action.slice(6) as 'left'|'center'|'right');
        v.dispatch({changes:{from:d.from,to:d.to,insert:action==='table-delete'||!next?'':serializeTable(next)},userEvent:'input'}); v.focus();
      } close();
    }}/>);
  });
  return {
    destroy(){listeners.forEach(off=>off());chromeRoot.unmount();toolbarRoot.unmount();panelRoot.unmount();readerRoot.unmount();tipsRoot.unmount();overlay.remove();reader.remove();},
    chrome(props:any){fullWidth=props.editorWidth==='full'; chromeRoot.render(<UpstreamEditorChrome key={props.activePath} {...props}/>);},
    reset(){close(); toolbarRoot.render(null);}, pickIcon,pickColor,
    selection(position:SelectionToolbarPosition|null){
      if(!position||!host.editable()||panelOpen) {toolbarRoot.render(null); return;}
      const valid=guard(); toolbarRoot.render(<SelectionToolbar {...position} onAction={action=>{if(valid()) applySelectionFormat(host.view(),action,()=>host.notice('链接文字不能跨越多行。'));}}/>);
    },
    read(content:string,path:string,enabled:boolean){
      reader.hidden=!enabled;
      if(!enabled) {readerRoot.render(null); return;}
      const key=host.key();
      const toggle=(index:number,checked:boolean,html=false)=>{if(key!==host.key()) return; const result=(html?setHtmlCheckboxChecked:toggleTaskAtIndex)(host.view().state.doc.toString(),index,checked); if(result.changed) change(result.content);};
      readerRoot.render(<VaultContext.Provider value={host.environment?.()}><React.Fragment key={path}><DocumentHeaderRead meta={plainvaMetaFromContent(content)} fullWidth={fullWidth}/><MarkdownReader content={content} sourcePath={path} fullWidth={fullWidth} onOpenPath={host.openNote} onToggleTask={(i,c)=>toggle(i,c)} onToggleHtmlBox={(i,c)=>toggle(i,c,true)}/></React.Fragment></VaultContext.Provider>);
    },
    scrollToHeading(slug:string){ requestAnimationFrame(()=>{ const el=Array.from(reader.querySelectorAll<HTMLElement>('[id]')).find(el=>el.id===slug); el?.scrollIntoView({block:'start'}); }); },
  };
}
