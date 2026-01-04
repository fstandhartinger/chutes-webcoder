'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, User } from 'lucide-react';

export function UserAvatar2() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    setIsLoggingOut(false);
    setIsOpen(false);
  };

  if (isLoading) {
    return <div className="w-10 h-10 rounded-full bg-neutral-800 animate-pulse" />;
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={() => login(window.location.pathname)}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 active:scale-[0.98] transition-all shadow-lg shadow-emerald-500/20"
      >
        <User className="w-4 h-4" />
        <span>Sign in</span>
      </button>
    );
  }

  const initials = user?.username ? user.username.slice(0, 2).toUpperCase() : 'U';
  const colorIndex = user?.username ? user.username.charCodeAt(0) % 5 : 0;
  const avatarColors = [
    'bg-emerald-500',
    'bg-blue-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
  ];
  const avatarColor = avatarColors[colorIndex];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-10 h-10 rounded-full
          border-2 border-neutral-600 hover:border-neutral-500
          transition-all duration-200
          ${isOpen ? 'ring-2 ring-emerald-500/40 ring-offset-2 ring-offset-neutral-950' : ''}
        `}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div
          className={`w-full h-full rounded-full flex items-center justify-center ${avatarColor} text-white text-sm font-bold`}
        >
          {initials}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-56 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="px-4 py-3 border-b border-neutral-800">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${avatarColor} text-white text-sm font-bold`}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{user?.username}</p>
                  <p className="text-xs text-neutral-500">Chutes Account</p>
                </div>
              </div>
            </div>

            <div className="p-2">
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors disabled:opacity-50"
              >
                <LogOut className="w-4 h-4" />
                <span>{isLoggingOut ? 'Signing out...' : 'Sign out'}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}























