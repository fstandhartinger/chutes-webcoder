import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/utils/cn";

export default function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <button
      className="size-20 p-3 relative"
      type="button"
      onClick={() => onChange?.(!checked)}
    >
      <div
        className={cn(
          "w-full h-full rounded-3 group inside-border relative transition-all",
          checked
            ? "bg-moss-400 group-hover:bg-moss-500 before:border-transparent"
            : "bg-surface-ink-800/70 group-hover:bg-surface-ink-700 before:border-surface-ink-600/70 group-hover:before:border-surface-ink-500/80",
        )}
        style={{
          boxShadow: checked
            ? "0px 2px 4px 0px rgba(99, 210, 151, 0.18), 0px 1px 1px 0px rgba(99, 210, 151, 0.16), 0px 0.5px 0.5px 0px rgba(99, 210, 151, 0.18)"
            : "",
        }}
      >
        <AnimatePresence>
          {checked && (
            <motion.svg
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="absolute cs-10"
              exit={{ opacity: 0, scale: 0.9, y: 4 }}
              fill="none"
              height="10"
              initial={{ opacity: 0, scale: 0.9, y: 4 }}
              viewBox="0 0 10 10"
              width="10"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2 5.98438L4.39062 8.375L8.375 2"
                stroke="white"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.25"
              />
            </motion.svg>
          )}
        </AnimatePresence>
      </div>
    </button>
  );
}
