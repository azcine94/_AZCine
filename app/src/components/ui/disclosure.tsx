import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// 使用原生 details 的键盘与打开状态；不会另造一份业务状态。
export function Disclosure({variant = 'default', className, ...props}: ComponentProps<'details'> & {variant?:'default'|'custom'}) {
  return <details data-slot="disclosure" data-variant={variant} className={cn('ui-disclosure', variant === 'default' && 'disclosure', className)} {...props}/>;
}
