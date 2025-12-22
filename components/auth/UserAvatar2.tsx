'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, User, ChevronDown } from 'lucide-react';

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
    return <div className="w-9 h-9 rounded-full bg-neutral-800 animate-pulse" />;
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
          flex items-center gap-2 h-10 pl-1 pr-3 rounded-xl
          bg-neutral-800 hover:bg-neutral-700
          border border-neutral-700 hover:border-neutral-600
          transition-all duration-200
          ${isOpen ? 'ring-2 ring-emerald-500/40' : ''}
        `}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${avatarColor} text-white text-sm font-bold`}
        >
          {initials}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
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
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${avatarColor} text-white text-sm font-bold`}>
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
