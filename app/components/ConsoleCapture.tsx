'use client';

import { useEffect } from 'react';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export default function ConsoleCapture() {
  useEffect(() => {
    const levels: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
    const originals: Partial<Record<ConsoleLevel, (...args: any[]) => void>> = {};

    const send = (level: ConsoleLevel, args: unknown[]) => {
      try {
        // Avoid circular structures by JSON-stringifying args individually
        const safeArgs = args.map((a) => {
          try {
            if (typeof a === 'string') return a;
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        });

        fetch('/api/console-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // keepalive allows sending during page unloads
          keepalive: true,
          body: JSON.stringify({
            level,
            args: safeArgs,
            url: typeof window !== 'undefined' ? window.location.href : '',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            time: Date.now(),
          }),
        }).catch(() => {
          // ignore network errors to not disturb app
        });
      } catch {
        // swallow to ensure we never break console
      }
    };

    levels.forEach((level) => {
      originals[level] = console[level];
      console[level] = (...args: any[]) => {
        try {
          originals[level]?.(...args);
        } finally {
          send(level, args);
        }
      };
    });

    return () => {
      // restore originals
      levels.forEach((level) => {
        if (originals[level]) {
          console[level] = originals[level] as any;
        }
      });
    };
  }, []);

  return null;
}

