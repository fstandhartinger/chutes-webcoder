import { Children, ButtonHTMLAttributes } from "react";

import { cn } from "@/utils/cn";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "tertiary" | "playground" | "destructive";
  size?: "default" | "large";
  disabled?: boolean;
}

export default function Button({
  variant = "primary",
  size = "default",
  disabled,
  ...attrs
}: Props) {
  const children = handleChildren(attrs.children);

  return (
    <button
      {...attrs}
      type={attrs.type ?? "button"}
      className={cn(
        attrs.className,
        "[&>span]:px-6 flex items-center justify-center button relative [&>*]:relative",
        "text-label-medium lg-max:[&_svg]:size-24",
        `button-${variant} group/button`,
        {
          "rounded-full p-6": size === "default",
          "rounded-full p-8 gap-2": size === "large",

          "text-surface-ink-950 active:[scale:0.995]": variant === "primary",
          "text-ink-100 active:[scale:0.99] active:bg-surface-ink-700/70": [
            "secondary",
            "tertiary",
            "playground",
          ].includes(variant),
          "bg-surface-ink-800/80 border border-surface-ink-600/70 hover:bg-surface-ink-700": variant === "secondary",
          "hover:bg-surface-ink-800/70": variant === "tertiary",
        },
        variant === "playground" && [
          "inside-border before:border-surface-ink-600/70",
          disabled
            ? "before:opacity-0 bg-surface-ink-800/60 text-ink-500"
            : "hover:bg-surface-ink-800/70 hover:before:opacity-0 active:before:opacity-0",
        ],
      )}
      disabled={disabled}
    >
      {variant === "primary" && (
        <div className="overlay button-background !absolute" />
      )}

      {children}
    </button>
  );
}

const handleChildren = (children: React.ReactNode) => {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string") {
      return <span key={child}>{child}</span>;
    }

    return child;
  });
};
