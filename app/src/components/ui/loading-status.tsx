import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Keep one status line in the layout while refreshing existing content.
export function LoadingStatus({ active, children, className, delayMs = 0 }: { active: boolean; children: ReactNode; className?: string; delayMs?: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!active || delayMs <= 0) return;
    const timer = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  const visible = active && (delayMs <= 0 || ready);
  return <p className={cn('ui-loading-status', className)} data-loading={visible} role="status" aria-live="polite">{visible ? children : '\u00a0'}</p>;
}
