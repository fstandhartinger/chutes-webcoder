import { animate, AnimatePresence, cubicBezier, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/utils/cn";
import { lockBody } from "@/components/shared/lockBody";
import PortalToBody from "@/components/shared/utils/portal-to-body";

export default function Combobox({
  placeholder,
  options,
  value,
  onChange,
  className,
}: {
  placeholder?: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const selected = useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);
  const [isOpen, setIsOpen] = useState(false);
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lockBody("combobox", isOpen);
  }, [isOpen]);

  useEffect(() => {
    document.addEventListener("click", (e) => {
      if (ref.current && e.composedPath().includes(ref.current)) {
        return;
      }

      setIsOpen(false);
    });
  }, []);

  return (
    <div className={cn("w-full", className)} ref={ref}>
      <button
        className={cn(
          "relative bg-surface-ink-850 text-ink-100 flex w-full gap-4 rounded-10 p-6 pl-10",
          "inside-border before:border-surface-ink-600/70 hover:before:border-surface-ink-500/80 hover:bg-surface-ink-800",
          "text-body-medium shadow-[0_10px_24px_rgba(5,8,15,0.35)]",
          isOpen &&
            "!bg-surface-ink-850 before:!border-moss-400 before:!border-[1.25px]",
        )}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setIsOpen(!isOpen);
          setBounds(ref.current?.getBoundingClientRect() ?? null);
        }}
      >
        <div className={cn("flex-1", !selected && "text-ink-500")}>
          {selected?.label || placeholder}
        </div>

        <motion.svg
          animate={{ rotate: isOpen ? 180 : 0 }}
          fill="none"
          height="20"
          viewBox="0 0 20 20"
          width="20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7 8.5L10 11.5L13 8.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.25"
            className="text-ink-400"
          />
        </motion.svg>
      </button>

      <PortalToBody>
        <AnimatePresence initial={false}>
          {isOpen && bounds && (
            <motion.div
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              className="fixed bg-surface-ink-900 border border-surface-ink-700/70 rounded-12 z-[401]"
              exit={{ opacity: 0, y: 0, filter: "blur(4px)" }}
              initial={{ opacity: 0, y: -12, filter: "blur(4px)" }}
              style={{
                top: bounds.top + bounds.height + 8,
                left: bounds.left,
                width: bounds.width,
                boxShadow:
                  "0px 32px 60px rgba(5, 8, 15, 0.45), 0px 0px 0px 1px rgba(31, 41, 55, 0.6)",
              }}
              transition={{ duration: 0.2 }}
            >
              <div className="p-4">
                <Items
                  options={options}
                  onChange={(value) => {
                    onChange(value);
                    setIsOpen(false);
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </PortalToBody>
    </div>
  );
}

const Items = ({
  options,
  onChange,
}: {
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) => {
  const backgroundRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative">
      <div
        className="absolute top-0 opacity-0 left-0 bg-surface-ink-800/80 rounded-8 w-full h-32 pointer-events-none"
        ref={backgroundRef}
      />

      {options.map((option) => (
        <button
          className="w-full group py-6 px-10 text-label-small"
          key={option.value}
          type="button"
          onClick={() => {
            onChange(option.value);
          }}
          onMouseEnter={(e) => {
            const t = e.target as HTMLElement;

            let target =
              t instanceof HTMLButtonElement
                ? t
                : (t.closest("button") as HTMLButtonElement);
            target = target.closest(".group") as HTMLButtonElement;

            animate(backgroundRef.current!, { scale: 0.995 }).then(() =>
              animate(backgroundRef.current!, { scale: 1 }),
            );

            animate(
              backgroundRef.current!,
              {
                y: target.offsetTop,
                opacity: 1,
              },
              {
                ease: cubicBezier(0.165, 0.84, 0.44, 1),
                duration: 0.2,
              },
            );
          }}
          onMouseLeave={() => {
            animate(backgroundRef.current!, { opacity: 0 });
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};
