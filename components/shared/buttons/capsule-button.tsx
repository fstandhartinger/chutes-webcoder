"use client";

import React from "react";
import { cn } from "@/utils/cn";
import { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import AnimatedWidth from "@/components/shared/layout/animated-width";

interface CapsuleButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  iconPosition?: "left" | "right";
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  variant?: "primary" | "secondary" | "tertiary" | "ghost";
  loading?: boolean;
}

export function CapsuleButton({
  icon: Icon,
  iconPosition = "left",
  children,
  className,
  size = "md",
  fullWidth = false,
  variant = "primary",
  loading = false,
  disabled,
  ...props
}: CapsuleButtonProps) {
  const [isPressed, setIsPressed] = React.useState(false);

  const sizeClasses = {
    sm: "h-32 px-16 text-label-small gap-6",
    md: "h-40 px-20 text-label-medium gap-8",
    lg: "h-40 px-20 text-label-medium gap-8",
  };

  const iconSizes = {
    sm: "w-14 h-14",
    md: "w-16 h-16",
    lg: "w-16 h-16",
  };

  const variants = {
    primary: [
      "bg-moss-400 text-surface-ink-950",
      "hover:bg-moss-500",
      "active:scale-[0.98]",
      "shadow-[0_12px_28px_rgba(99,210,151,0.25)]",
    ],
    secondary: [
      "bg-surface-ink-800 text-ink-100 border border-surface-ink-700/70",
      "hover:bg-surface-ink-700",
      "active:scale-[0.98]",
      "shadow-[0_10px_24px_rgba(5,8,15,0.35)]",
    ],
    tertiary: [
      "bg-surface-ink-900 text-ink-100 border border-surface-ink-700/70",
      "hover:bg-surface-ink-800 hover:border-surface-ink-600/70",
      "active:scale-[0.98]",
    ],
    ghost: [
      "bg-transparent text-ink-400",
      "hover:text-ink-100 hover:bg-surface-ink-800/70",
      "active:scale-[0.98]",
    ],
  };

  const isDisabled = disabled || loading;

  return (
    <button
      className={cn(
        // Base styles
        "inline-flex items-center justify-center rounded-full  transition-all duration-200",
        // Size
        sizeClasses[size],
        // Variant
        variants[variant],
        // Full width
        fullWidth && "w-full",
        // Disabled state
        isDisabled && [
          "opacity-50 cursor-not-allowed",
          "hover:shadow-none hover:bg-current",
        ],
        // Pressed state
        isPressed && "scale-[0.98]",
        className,
      )}
      disabled={isDisabled}
      onMouseDown={() => !isDisabled && setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onMouseLeave={() => setIsPressed(false)}
      {...props}
    >
      <AnimatedWidth initial={{ width: "auto" }}>
        <AnimatePresence initial={false} mode="popLayout">
          {loading ? (
            <motion.div
              key="loading"
              animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
              className="flex gap-8 items-center justify-center"
              exit={{ opacity: 0, filter: "blur(2px)", scale: 0.9 }}
              initial={{ opacity: 0, filter: "blur(2px)", scale: 0.95 }}
            >
              <span>Loading...</span>
            </motion.div>
          ) : (
            <motion.div
              key="content"
              animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
              className="flex gap-8 items-center justify-center"
              exit={{ opacity: 0, filter: "blur(2px)", scale: 0.9 }}
              initial={{ opacity: 0, filter: "blur(2px)", scale: 0.95 }}
            >
              {Icon && iconPosition === "left" && (
                <span
                  className={cn(
                    iconSizes[size],
                    "flex-shrink-0 inline-flex items-center justify-center",
                  )}
                >
                  <Icon className="w-full h-full" />
                </span>
              )}
              <span>{children}</span>
              {Icon && iconPosition === "right" && (
                <span
                  className={cn(
                    iconSizes[size],
                    "flex-shrink-0 inline-flex items-center justify-center",
                  )}
                >
                  <Icon className="w-full h-full" />
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </AnimatedWidth>
    </button>
  );
}
