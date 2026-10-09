import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const standard = "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
const appButtonVariants = {
  "app-choice-chip": "ui-choice-chip", "app-underline-tab": "ui-underline-tab", "app-content": "ui-content-button",
  "app-pill": "pill", "app-text": "text-action", "app-document": "doc-button",
  "app-idea": "idea-action", "app-quiet": "pi-quiet", "app-primary": "pi-primary",
  "app-icon": "icon-btn", "app-menu": "ui-menu-item", "app-control": "ui-control-action",
  "app-reading-tab": "news-reading-tab", "app-domain": "news-domain-option",
  "app-idea-filter": "idea-filter", "app-provider-tab": "ui-provider-tab",
  "app-ranking-tab": "ui-ranking-tab", "app-scope": "ui-scope-option",
} as const
const buttonVariants = cva(
  "ui-button",
  {
    variants: {
      variant: {
        ...appButtonVariants,
        default: `${standard} bg-primary text-primary-foreground shadow-xs hover:bg-primary/90`,
        destructive:
          `${standard} bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40`,
        outline:
          `${standard} border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50`,
        secondary:
          `${standard} bg-secondary text-secondary-foreground hover:bg-secondary/80`,
        ghost:
          `${standard} hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50`,
        link: `${standard} text-primary underline-offset-4 hover:underline`,
      },
      size: {
        app: "",
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  children,
  loading,
  loadingText = '处理中…',
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    loadingText?: React.ReactNode
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size: variant?.startsWith('app-') ? 'app' : size, className }))}
      {...props}
      aria-busy={loading || props['aria-busy']}
    >{loading !== undefined && !asChild ? <span className="ui-button-label-stack" data-loading={loading}>
      <span aria-hidden={loading || undefined}>{children}</span>
      <span aria-hidden={!loading || undefined}>{loadingText}</span>
    </span> : children}</Comp>
  )
}

export { Button, buttonVariants, appButtonVariants }
