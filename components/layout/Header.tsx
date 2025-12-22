'use client';

import Link from 'next/link';
import { UserAvatar } from '@/components/auth/UserAvatar';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[var(--app-header-height)] bg-surface-ink-900/80 backdrop-blur-xl border-b border-surface-ink-700/40 shadow-[0_12px_40px_rgba(5,8,15,0.4)]">
      <div className="mx-auto flex h-full w-full max-w-screen-xl items-center justify-between px-6 md:px-10">
        {/* Logo */}
        <Link 
          href="/" 
          className="flex items-center gap-4 hover:opacity-80 transition-opacity"
        >
          <svg
            viewBox="0 0 32 32"
            className="w-10 h-10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="16" cy="16" r="14" className="fill-moss-400" />
            <path
              d="M10 14L16 8L22 14L16 20L10 14Z"
              className="fill-surface-ink-950"
            />
            <path
              d="M16 20L22 14V22L16 28L10 22V14L16 20Z"
              className="fill-surface-ink-950/60"
            />
          </svg>
          <span className="text-lg font-semibold tracking-tight text-ink-100">
            Chutes <span className="text-moss-400">Webcoder</span>
          </span>
        </Link>

        {/* Right section */}
        <div className="flex items-center gap-4">
          {/* Model info / status could go here */}
          <UserAvatar />
        </div>
      </div>
    </header>
  );
}
