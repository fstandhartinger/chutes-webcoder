import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[12px] text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-95 [box-shadow:0_10px_30px_-15px_rgba(132,94,247,0.45)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[hsl(240_6%_18%)]",
        outline: "border border-border bg-transparent hover:bg-[hsl(240_6%_14%)] text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-[hsl(0_72%_50%)]",
        code: "bg-[hsl(240_8%_9%)] text-foreground hover:bg-[hsl(240_8%_12%)]",
        orange: "bg-accent text-accent-foreground hover:opacity-95",
        ghost: "hover:bg-[hsl(240_6%_14%)] text-foreground",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 py-1 text-sm",
        lg: "h-12 px-6 py-3",
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