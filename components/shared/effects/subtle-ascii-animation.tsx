"use client";

import React, { useEffect, useRef } from "react";
import { setIntervalOnVisible } from "@/utils/set-timeout-on-visible";

const ASCII_FRAMES = [
  "░░░░░░░░░░░░░░░░",
  "▒░░░░░░░░░░░░░░░",
  "▒▒░░░░░░░░░░░░░░",
  "░▒▒░░░░░░░░░░░░░",
  "░░▒▒░░░░░░░░░░░░",
  "░░░▒▒░░░░░░░░░░░",
  "░░░░▒▒░░░░░░░░░░",
  "░░░░░▒▒░░░░░░░░░",
  "░░░░░░▒▒░░░░░░░░",
  "░░░░░░░▒▒░░░░░░░",
  "░░░░░░░░▒▒░░░░░░",
  "░░░░░░░░░▒▒░░░░░",
  "░░░░░░░░░░▒▒░░░░",
  "░░░░░░░░░░░▒▒░░░",
  "░░░░░░░░░░░░▒▒░░",
  "░░░░░░░░░░░░░▒▒░",
  "░░░░░░░░░░░░░░▒▒",
  "░░░░░░░░░░░░░░░▒",
];

export default function SubtleAsciiAnimation({
  className = "",
}: {
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frameIndex = 0;

    const animateAscii = () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = ASCII_FRAMES[frameIndex];
        frameIndex = (frameIndex + 1) % ASCII_FRAMES.length;
      }
    };

    // Initialize first frame
    animateAscii();

    // Start animation when visible
    const cleanup = setIntervalOnVisible({
      element: containerRef.current,
      callback: animateAscii,
      interval: 150, // Slightly slower for subtlety
    });

    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`font-mono text-white/20 whitespace-pre select-none ${className}`}
      style={{
        fontSize: "10px",
        lineHeight: "1",
        letterSpacing: "0.05em",
      }}
    />
  );
}
