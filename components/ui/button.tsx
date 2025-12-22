import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-ink-950 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-moss-400 text-surface-ink-950 shadow-[0_10px_24px_rgba(99,210,151,0.22)] hover:bg-moss-500",
        secondary: "bg-surface-ink-800/80 text-ink-100 border border-surface-ink-600/70 hover:bg-surface-ink-700",
        outline: "border border-surface-ink-600/80 bg-transparent hover:bg-surface-ink-800/60 text-ink-100",
        destructive: "bg-heat-100 text-surface-ink-950 hover:bg-heat-90/90",
        code: "bg-surface-ink-800/90 text-ink-200 border border-surface-ink-600/60 hover:bg-surface-ink-700",
        orange: "bg-heat-100 text-surface-ink-950 hover:bg-heat-90/90",
        ghost: "text-ink-200 hover:bg-surface-ink-800/60",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-9 px-3 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? "button" : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
