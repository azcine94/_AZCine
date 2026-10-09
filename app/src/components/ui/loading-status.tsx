import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton.tsx';

export function LoadingPlaceholder({label='正在读取…'}:{label?:string}) {
  return <div className="ui-loading-placeholder" aria-busy="true" role="status"><span className="sr-only">{label}</span><div aria-hidden="true"><Skeleton/><Skeleton/><Skeleton/></div></div>;
}

// Keep one status line in the layout while refreshing existing content.
export function LoadingStatus({ active, children, className, delayMs = 250 }: { active: boolean; children: ReactNode; className?: string; delayMs?: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!active || delayMs <= 0) return;
    const timer = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  const visible = active && (delayMs <= 0 || ready);
  return <div className={cn('ui-loading-status', className)} data-loading={visible} role="status" aria-live="polite"><span>{children}</span></div>;
}
