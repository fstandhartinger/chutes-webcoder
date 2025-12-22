import { motion } from "motion/react";
import { useState } from "react";

import { cn } from "@/utils/cn";

export default function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const [isHovering, setIsHovering] = useState(false);

  return (
    <button
      className={cn(
        "transition-all relative rounded-full group",
        checked ? "bg-moss-400" : "bg-surface-ink-700",
      )}
      style={{
        width: "50px",
        height: "20px",
        boxShadow: checked
          ? "0px 6px 12px 0px rgba(53, 124, 89, 0.3) inset, 0px 0.75px 0.75px 0px rgba(53, 124, 89, 0.2) inset, 0px 0.25px 0.25px 0px rgba(53, 124, 89, 0.2) inset"
          : "0px 6px 12px 0px rgba(5, 8, 15, 0.2) inset, 0px 0.75px 0.75px 0px rgba(5, 8, 15, 0.2) inset, 0px 0.25px 0.25px 0px rgba(5, 8, 15, 0.3) inset",
      }}
      type="button"
      onClick={() => onChange?.(!checked)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      disabled={disabled}
    >
      <div
        className={cn(
          "overlay bg-moss-500 transition-opacity",
          checked
            ? "opacity-0 group-hover:opacity-100"
            : "opacity-0 group-hover:opacity-0",
        )}
        style={{
          background: "color(display-p3 0.3922 0.8235 0.5922)",
        }}
      />

      <motion.div
        animate={{
          x: checked ? 18 : 0,
        }}
        className="top-[2px] left-[2px] transition-[box-shadow] absolute rounded-full bg-ink-50"
        initial={{
          x: checked ? 18 : 0,
        }}
        style={{
          width: "28px",
          height: "16px",
          boxShadow: (() => {
            if (checked) {
              if (isHovering) {
                return "0px 6px 12px -3px rgba(53, 124, 89, 0.35), 0px 3px 6px -1px rgba(53, 124, 89, 0.2), 0px 1px 2px 0px rgba(53, 124, 89, 0.2), 0px 0.5px 0.5px 0px rgba(53, 124, 89, 0.3)";
              }

              return "0px 6px 12px -3px rgba(53, 124, 89, 0.35), 0px 3px 6px -1px rgba(53, 124, 89, 0.2), 0px 1px 2px 0px rgba(53, 124, 89, 0.2), 0px 0.5px 0.5px 0px rgba(53, 124, 89, 0.3)";
            }

            if (isHovering) {
              return "0px 6px 12px -3px rgba(5, 8, 15, 0.4), 0px 3px 6px -1px rgba(5, 8, 15, 0.3), 0px 1px 2px 0px rgba(5, 8, 15, 0.2), 0px 0.5px 0.5px 0px rgba(5, 8, 15, 0.3)";
            }

            return "0px 6px 12px -3px rgba(5, 8, 15, 0.4), 0px 3px 6px -1px rgba(5, 8, 15, 0.3), 0px 1px 2px 0px rgba(5, 8, 15, 0.2), 0px 0.5px 0.5px 0px rgba(5, 8, 15, 0.3)";
          })(),
        }}
      />
    </button>
  );
}
