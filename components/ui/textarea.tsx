import * as React from "react"

import { cn } from "@/lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[96px] w-full rounded-2xl border border-surface-ink-600/70 bg-surface-ink-850 text-ink-100 px-4 py-3 text-sm ring-offset-background placeholder:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-ink-950 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 shadow-[0_12px_28px_rgba(5,8,15,0.4)]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
