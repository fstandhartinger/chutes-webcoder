import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export interface CheckboxProps {
  label?: string
  defaultChecked?: boolean
  disabled?: boolean
  className?: string
  onChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLDivElement, CheckboxProps>(
  ({ label, defaultChecked = false, disabled = false, className, onChange }, ref) => {
    const [checked, setChecked] = React.useState(defaultChecked)

    const handleToggle = () => {
      if (!disabled) {
        const newChecked = !checked
        setChecked(newChecked)
        onChange?.(newChecked)
      }
    }

    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-2", className)}
      >
        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          className={cn(
            "h-4 w-4 rounded border border-neutral-800 flex items-center justify-center transition-all duration-200 bg-surface-ink-850",
            !disabled && "hover:bg-surface-ink-750",
            checked && "bg-primary border-primary",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          {checked && <Check className="h-3 w-3 text-white" />}
        </button>
        {label && (
          <label
            onClick={handleToggle}
            className={cn(
              "text-sm select-none",
              !disabled && "cursor-pointer",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {label}
          </label>
        )}
      </div>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }