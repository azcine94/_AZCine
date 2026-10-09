import { useId, useState } from 'react';
import type { ComponentProps } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button.tsx';

/** Keep the native file picker, keyboard support and input ref; localize its visible control. */
export function FileUpload({ className, fileName, onChange, disabled, ...props }: Omit<ComponentProps<'input'>, 'type'> & { fileName?:string }) {
  const [selected,setSelected]=useState('');
  const nameId=useId();
  const text=(fileName??selected)||'未选择文件';
  return <div className={cn('ui-file-upload',className)} data-disabled={disabled||undefined} data-invalid={props['aria-invalid']}>
    <span className={cn(buttonVariants({variant:'default',size:'sm'}),'ui-file-upload-action')} aria-hidden="true"><Upload size={16}/>上传文件</span>
    <span id={nameId} className="ui-file-upload-name">{text}</span>
    <input {...props} aria-describedby={[props['aria-describedby'],nameId].filter(Boolean).join(' ')} type="file" disabled={disabled} title={text==='未选择文件'?'点击上传文件':`点击更换文件：${text}`} className="ui-file-upload-native" onChange={event=>{
      const names=Array.from(event.currentTarget.files??[]).map(file=>file.name);
      setSelected(names.join('、'));onChange?.(event);
    }}/>
  </div>;
}
