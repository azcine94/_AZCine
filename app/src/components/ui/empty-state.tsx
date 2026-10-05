import { createElement } from 'react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({as:Tag='div',className,...props}:ComponentProps<'div'> & {as?:'div'|'section'|'p'}) {
  const attributes={...props,'data-slot':'empty-state',className:cn('ui-empty-state',className||'foundation-empty')};
  return createElement(Tag,attributes);
}
