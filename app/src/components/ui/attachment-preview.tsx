import { createContext, useContext, useEffect, useState } from 'react';
import { FileText, FileSpreadsheet, File, Image, X } from 'lucide-react';
import { Button } from './button.tsx';
import { ImageViewer } from './image-viewer.tsx';
import { invoke, isTauri } from '../../desktop-api.ts';
import { RecordContextMenu } from './record-context-menu.tsx';
import { MAX_AGENT_IMAGE_BASE64_BYTES } from '../../agent-image-limits.ts';

export interface AttachmentPreviewValue { name:string; imageUrl?:string; id?:string; mimeType?:string; bytes?:number; projectImage?:import('../../projects-contract.ts').ProjectImage }
// UI preview supplies explicit in-memory images; production has no provider.
export const AttachmentPreviewImages = createContext<Readonly<Record<string,string>>>({});
/** Raster thumbnails and readable document tiles share the same keyboard controls. */
export function AttachmentPreview({value,onRemove,disabled=false,compact=false}:{value:AttachmentPreviewValue;onRemove?:()=>void;disabled?:boolean;compact?:boolean}){
  const [open,setOpen]=useState(false),[loaded,setLoaded]=useState<string>(),[failed,setFailed]=useState(false);
  const previewImages=useContext(AttachmentPreviewImages);
  const image=!!value.imageUrl||/^image\/(png|jpeg|webp|gif)$/.test(value.mimeType??'')||/\.(png|jpe?g|webp|gif)$/i.test(value.name);
  useEffect(()=>{setFailed(false);setLoaded(undefined);if(!image||value.imageUrl||!value.id||!isTauri())return;let disposed=false;
    void invoke<number[]>(value.projectImage?'project_image_preview':'agent_attachment_preview',value.projectImage?{image:value.projectImage}:{id:value.id}).then(bytes=>{if(disposed)return;let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.slice(offset,offset+16384));
      const mime=bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':bytes[0]===71?'image/gif':'image/webp';setLoaded(`data:${mime};base64,${btoa(binary)}`);
    }).catch(()=>{if(!disposed)setFailed(true);});return()=>{disposed=true;};
  },[value.id,value.imageUrl,image,value.projectImage?.hash]);
  const candidate=value.imageUrl??previewImages[value.id??'']??loaded;
  const url=candidate&&candidate.length<=MAX_AGENT_IMAGE_BASE64_BYTES+64&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(candidate)?candidate:undefined;
  const Icon=image?Image:/\.(xlsx?|csv|tsv)$/i.test(value.name)?FileSpreadsheet:/\.(pdf|txt|md|json)$/i.test(value.name)?FileText:File;
  const extension=value.name.split('.').at(-1)?.toUpperCase();
  const tile=<div className={`ui-attachment-preview${image?' ui-attachment-preview--image':''}${compact?' ui-attachment-preview--cell':''}`}>
    <Button variant="app-control" type="button" className="ui-attachment-tile" aria-label={image?`查看图片 ${value.name}`:`附件 ${value.name}`} title={value.name} disabled={!image||!url||failed} onClick={()=>setOpen(true)}>
      <span className="ui-attachment-thumbnail">{url&&!failed?<img src={url} alt={value.name} onError={()=>setFailed(true)}/>:<><Icon/><span>{image?'图片':extension}</span></>}</span>
      {!image&&<span className="ui-attachment-filename"><span className="ui-attachment-name">{value.name}</span><small>{value.bytes?`${Math.ceil(value.bytes/1024)} KB`:'文件附件'}</small></span>}
      {failed&&<span className="ui-attachment-unavailable">预览不可用</span>}
    </Button>
    {onRemove&&<Button variant="secondary" size="icon-xs" type="button" className="ui-attachment-remove" disabled={disabled} aria-label={`移除附件 ${value.name}`} onClick={onRemove}><X/></Button>}
    {url&&<ImageViewer open={open} onOpenChange={setOpen} src={url} name={value.name}/>}
  </div>;
  return onRemove?<RecordContextMenu copyText={value.name} actions={[{label:'移除附件',destructive:true,disabled,run:onRemove}]}>{tile}</RecordContextMenu>:tile;
}
