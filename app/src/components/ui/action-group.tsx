import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function ActionGroup({direction = 'row', className, ...props}:ComponentProps<'div'> & {direction?:'row'|'column'}) {
  return <div data-slot="action-group" data-direction={direction} className={cn('ui-action-group', className)} {...props}/>;
}
