'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, User, ChevronDown } from 'lucide-react';

export function UserAvatar() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
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

  // Loading state
  if (isLoading) {
    return (
      <div className="w-11 h-11 rounded-full bg-surface-ink-700 animate-pulse" />
    );
  }

  // Not authenticated - show sign in button
  if (!isAuthenticated) {
    return (
      <button
        onClick={() => login(window.location.pathname)}
        className="flex items-center gap-2 h-11 px-5 rounded-full bg-moss-400 text-surface-ink-950 font-semibold text-sm tracking-tight hover:bg-moss-500 transition-colors"
      >
        <User className="w-5 h-5" />
        <span>Sign in</span>
      </button>
    );
  }

  // Get initials for avatar
  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : 'U';

  // Generate a consistent color based on username
  const colorIndex = user?.username
    ? user.username.charCodeAt(0) % 5
    : 0;
  const avatarColors = [
    'bg-moss-400',
    'bg-moss-500',
    'bg-heat-100',
    'bg-surface-ink-600',
    'bg-surface-ink-700',
  ];
  const avatarColor = avatarColors[colorIndex];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 h-11 pl-1.5 pr-3.5 rounded-full
          bg-surface-ink-800/90 hover:bg-surface-ink-700
          border border-surface-ink-600/70 hover:border-surface-ink-500/80
          transition-all duration-200
          ${isOpen ? 'ring-2 ring-moss-400/30' : ''}
        `}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div
          className={`
            w-9 h-9 rounded-full flex items-center justify-center
            ${avatarColor} text-surface-ink-950 text-sm font-semibold
          `}
        >
          {initials}
        </div>
        <ChevronDown
          className={`
            w-4 h-4 text-ink-400 transition-transform duration-200
            ${isOpen ? 'rotate-180' : ''}
          `}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="
              absolute right-0 mt-2 w-56
              bg-surface-ink-850 border border-surface-ink-600/70
              rounded-2xl shadow-[0_16px_40px_rgba(5,8,15,0.45)] overflow-hidden
              z-50
            "
          >
            {/* User info section */}
            <div className="px-4 py-3 border-b border-surface-ink-700">
              <div className="flex items-center gap-3">
                <div
                  className={`
                    w-11 h-11 rounded-full flex items-center justify-center
                    ${avatarColor} text-surface-ink-950 text-sm font-semibold
                  `}
                >
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-100 truncate">
                    {user?.username}
                  </p>
                  <p className="text-xs text-ink-400">
                    Chutes Account
                  </p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-2">
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="
                  w-full px-4 py-2.5 flex items-center gap-3
                  text-sm text-ink-200 hover:text-ink-50
                  hover:bg-surface-ink-700
                  transition-colors duration-150
                  disabled:opacity-50
                "
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
