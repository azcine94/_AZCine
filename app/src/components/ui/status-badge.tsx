import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function StatusBadge({tone = 'neutral', className, ...props}:ComponentProps<'span'> & {tone?:'neutral'|'success'|'error'|'warning'}) {
  return <span data-slot="status-badge" data-tone={tone} className={cn('ui-status-badge', 'news-status', className)} {...props}/>;
}
