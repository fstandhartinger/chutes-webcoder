'use client';

import Link from 'next/link';
import { UserAvatar2 } from '@/components/auth/UserAvatar2';

export function Header2() {
  return (
    <header className="fixed top-0 left-0 right-0 z-[60] h-16 bg-neutral-950/95 backdrop-blur-md border-b border-neutral-800">
      <div className="flex h-full w-full items-center justify-between px-6">
        {/* Logo */}
        <Link 
          href="/" 
          className="flex items-center gap-3 hover:opacity-90 transition-opacity"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-white"
              fill="currentColor"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-lg font-bold text-white">
            Chutes <span className="text-emerald-400">Webcoder</span>
          </span>
        </Link>

        {/* Right section */}
        <div className="flex items-center">
          <UserAvatar2 />
        </div>
      </div>
    </header>
  );
}
