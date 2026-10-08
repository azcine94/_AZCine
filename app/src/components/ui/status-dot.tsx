import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type StatusDotTone = 'neutral' | 'success' | 'warning' | 'error' | 'active';

export function StatusDot({label, tone = 'neutral', className, ...props}:Omit<ComponentProps<'span'>, 'children'> & {label:string; tone?:StatusDotTone}) {
  return <span {...props} data-slot="status-dot" data-tone={tone} role="img" aria-label={label} title={label} className={cn('ui-status-dot', className)}/>;
}
