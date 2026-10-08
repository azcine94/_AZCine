import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({as:Tag='div',className,variant='default',...props}:ComponentProps<'div'> & {as?:'div'|'section'|'p';variant?:'default'|'centered'}) {
  const attributes={...props,'data-slot':'empty-state',className:cn('ui-empty-state',variant==='centered'?'ui-empty-state--centered':className||'foundation-empty',variant==='centered'&&className)};
  return createElement(Tag,attributes);
}
