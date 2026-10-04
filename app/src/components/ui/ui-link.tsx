import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const linkVariants = cva('ui-link', {variants:{variant:{
  plain:'', text:'foundation-link', action:'text-action', document:'doc-button',
  idea:'idea-action', pill:'pill', menu:'ui-menu-item', navigation:'',
}}, defaultVariants:{variant:'text'}});
export function UILink({variant, className, ...props}: ComponentProps<'a'> & VariantProps<typeof linkVariants>) {
  return <a data-slot="ui-link" data-variant={variant ?? 'text'} className={cn(linkVariants({variant}), className)} {...props}/>;
}
