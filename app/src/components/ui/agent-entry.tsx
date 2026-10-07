import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.ts';
import { Button } from './button.tsx';
import { ScaleLoader } from './scale-loader.tsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.tsx';

type AgentEntryProps = Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size'> & {
  activeCount?: number;
  waitingCount?: number;
};

export function AgentEntry({activeCount = 0, waitingCount = 0, className, ...props}: AgentEntryProps) {
  const label = waitingCount ? `Agent · ${waitingCount} 个会话待回答` : activeCount ? `Agent · ${activeCount} 个会话正在工作` : 'Agent';
  return <TooltipProvider delayDuration={350}><Tooltip><TooltipTrigger asChild>
    <Button {...props} type="button" variant="ghost" size="icon-sm" data-agent-entry
      className={cn('relative text-foreground aria-expanded:bg-accent', className)} aria-label={label}>
      <ScaleLoader aria-hidden="true" color="currentColor" height={18} width={2} margin={1} speedMultiplier={activeCount ? 1 : .65} />
      {waitingCount > 0 && <span aria-hidden="true" className="pointer-events-none absolute right-1 top-1 size-1 rounded-full bg-current" />}
    </Button>
  </TooltipTrigger><TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent></Tooltip></TooltipProvider>;
}
