import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Keep one status line in the layout while refreshing existing content.
export function LoadingStatus({ active, children, className }: { active: boolean; children: ReactNode; className?: string }) {
  return <p className={cn('ui-loading-status', className)} data-loading={active} role="status" aria-live="polite">{active ? children : '\u00a0'}</p>;
}
