import { cn } from "@/utils/cn";

export default function Textarea(
  textareaProps: React.ComponentPropsWithoutRef<"textarea">,
) {
  return (
    <label
      className={cn(
        "py-8 px-12 rounded-12 transition-all w-full block gap-4 cursor-text",
        "relative bg-surface-ink-850 text-ink-100",
        "inside-border before:border-surface-ink-600/70 hover:before:border-surface-ink-500/80 hover:bg-surface-ink-800 focus-within:!bg-surface-ink-850 focus-within:before:!border-moss-400 focus-within:before:!border-[1.25px]",
        "text-body-medium shadow-[0_12px_28px_rgba(5,8,15,0.4)]",
      )}
    >
      <textarea
        className="outline-none w-full resize-none bg-transparent"
        {...textareaProps}
      />
    </label>
  );
}
