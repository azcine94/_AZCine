import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function StatusBadge({tone = 'neutral', variant = 'default', className, ...props}:ComponentProps<'span'> & {tone?:'neutral'|'success'|'error'|'warning'; variant?:'default'|'soft'}) {
  return <span data-slot="status-badge" data-tone={tone} data-variant={variant} className={cn('ui-status-badge', 'news-status', className)} {...props}/>;
}
