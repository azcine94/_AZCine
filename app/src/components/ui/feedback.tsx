import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type Props = ComponentProps<'div'> & {as?:'div'|'p'|'section'; tone?:'error'|'pending'|'info'|'conflict'};
export function Feedback({as:Tag = 'div', tone = 'info', className, ...props}:Props) {
  const attributes = {...props, 'data-slot':'feedback', 'data-tone':tone, className:cn('ui-feedback', tone === 'error' && 'form-error', tone === 'pending' && 'pending-note', className)};
  return createElement(Tag, attributes);
}
