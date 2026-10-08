import type { ComponentProps } from 'react';
import { UILink } from './components/ui/ui-link.tsx';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { invoke, isTauri } from './desktop-api.ts';
import { goodcaseUrl } from './goodcase-source.ts';

export function GoodcaseLink({href,...props}:ComponentProps<typeof UILink>){
  const url=goodcaseUrl(href);
  return <UILink variant="plain" {...props} href={url||undefined} target="_blank" rel="noopener noreferrer" onClick={event=>{
    if(!url||document.documentElement.dataset.uiPreview==='true'){event.preventDefault();return;}
    if(isTauri()){event.preventDefault();void invoke('open_news_url',{url}).catch(()=>notifyOperation('打开来源失败，请右键复制链接后查看。',{tone:'error'}));}
  }}/>;
}
