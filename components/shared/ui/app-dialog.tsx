"use client";

import React from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import CurvyRect from "@/components/shared/layout/curvy-rect";
import { cn } from "@/utils/cn";
import {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogContent as ShadDialogContent,
} from "@/components/ui/shadcn/dialog";

type AppDialogContentProps = React.ComponentPropsWithoutRef<
  typeof ShadDialogContent
> & {
  withCurvyRect?: boolean;
  bodyClassName?: string;
};

export function AppDialogContent({
  className,
  children,
  withCurvyRect = true,
  bodyClassName,
  hideCloseButton = false,
  ...props
}: AppDialogContentProps) {
  const showCloseButton = !hideCloseButton;

  return (
    <ShadDialogContent
      className={cn(
        "rounded-2xl p-0 border border-surface-ink-700/70 bg-surface-ink-900 text-ink-100 relative overflow-hidden",
        className,
      )}
      hideCloseButton
      {...props}
    >
      {withCurvyRect && (
        <CurvyRect className="absolute inset-0 pointer-events-none" allSides />
      )}
      {showCloseButton && (
        <DialogClose className="absolute right-6 top-6 z-20 flex h-9 w-9 items-center justify-center rounded-8 text-ink-400 transition-colors hover:bg-surface-ink-800/70">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogClose>
      )}
      <motion.div
        initial={{ opacity: 0, scale: 0.985, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 24, mass: 0.9 }}
        className={cn("relative p-16 pb-12", bodyClassName)}
      >
        {children}
      </motion.div>
    </ShadDialogContent>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
