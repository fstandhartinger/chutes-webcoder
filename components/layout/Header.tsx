'use client';

import Link from 'next/link';
import { UserAvatar } from '@/components/auth/UserAvatar';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[var(--app-header-height)] bg-[#0d1117] border-b border-[#21262d]">
      <div className="flex h-full w-full items-center justify-between px-4 md:px-6">
        {/* Logo */}
        <Link 
          href="/" 
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <svg
            viewBox="0 0 32 32"
            className="w-8 h-8"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="16" cy="16" r="14" className="fill-moss-400" />
            <path
              d="M10 14L16 8L22 14L16 20L10 14Z"
              className="fill-[#0d1117]"
            />
            <path
              d="M16 20L22 14V22L16 28L10 22V14L16 20Z"
              className="fill-[#0d1117]/60"
            />
          </svg>
          <span className="text-base font-semibold text-[#e6edf3]">
            Chutes <span className="text-moss-400">Webcoder</span>
          </span>
        </Link>

        {/* Right section */}
        <div className="flex items-center">
          <UserAvatar />
        </div>
      </div>
    </header>
  );
}






