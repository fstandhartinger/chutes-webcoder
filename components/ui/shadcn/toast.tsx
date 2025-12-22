"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface-ink-900 group-[.toaster]:text-ink-100 group-[.toaster]:border-surface-ink-700/70 group-[.toaster]:shadow-[0_16px_32px_rgba(5,8,15,0.45)]",
          description:
            "group-[.toast]:text-ink-400",
          actionButton:
            "group-[.toast]:bg-surface-ink-800 group-[.toast]:text-ink-100",
          cancelButton:
            "group-[.toast]:bg-surface-ink-800 group-[.toast]:text-ink-400",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
