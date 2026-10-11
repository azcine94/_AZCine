import type { ReactNode } from 'react';
import { Feedback } from './feedback.tsx';
import { Disclosure } from './disclosure.tsx';

export function FeedbackMessage({message,summary,tone='error',children}:{message:string;summary?:string;tone?:'error'|'pending'|'info';children?:ReactNode}){
  const brief=summary??message.split('\n')[0].slice(0,160);
  const details=brief!==message;
  return <Feedback tone={tone} role={tone==='error'?'alert':'status'} className="min-w-0 [overflow-wrap:anywhere]">
    {details?<Disclosure variant="custom"><summary className="cursor-pointer">{brief}{!summary&&message.length>160?'…':''}</summary><p className="mt-2 whitespace-pre-wrap">{message}</p></Disclosure>:<p>{message}</p>}
    {children}
  </Feedback>;
}
