"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/utils/cn";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-8 w-full grow overflow-hidden rounded-full bg-surface-ink-700">
      <SliderPrimitive.Range className="absolute h-full bg-moss-400" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-20 w-20 rounded-full border-2 border-moss-400 bg-ink-50 ring-offset-surface-ink-950 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));

Slider.displayName = "Slider";

export { Slider };
