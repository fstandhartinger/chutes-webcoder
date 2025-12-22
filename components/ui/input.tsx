import * as React from "react"

import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-surface-ink-600/70 bg-surface-ink-850 text-ink-100 px-4 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-ink-950 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 shadow-[0_10px_24px_rgba(5,8,15,0.35)]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
