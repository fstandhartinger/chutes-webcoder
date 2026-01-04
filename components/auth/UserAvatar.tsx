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
      <div className="w-8 h-8 rounded-full bg-[#21262d] animate-pulse" />
    );
  }

  // Not authenticated - show sign in button
  if (!isAuthenticated) {
    return (
      <button
        onClick={() => login(window.location.pathname)}
        className="flex items-center gap-2 h-8 px-4 rounded-md bg-moss-400 text-[#0d1117] font-medium text-sm hover:bg-moss-500 transition-colors"
      >
        <User className="w-4 h-4" />
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
    'bg-[#388bfd]',
    'bg-[#a371f7]',
  ];
  const avatarColor = avatarColors[colorIndex];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-1.5 h-8 pl-0.5 pr-2 rounded-full
          bg-[#21262d] hover:bg-[#30363d]
          border border-[#30363d] hover:border-[#484f58]
          transition-all duration-150
          ${isOpen ? 'ring-2 ring-moss-400/30' : ''}
        `}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div
          className={`
            w-7 h-7 rounded-full flex items-center justify-center
            ${avatarColor} text-[#0d1117] text-xs font-semibold
          `}
        >
          {initials}
        </div>
        <ChevronDown
          className={`
            w-3.5 h-3.5 text-[#8b949e] transition-transform duration-150
            ${isOpen ? 'rotate-180' : ''}
          `}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.1 }}
            className="
              absolute right-0 mt-1.5 w-52
              bg-[#161b22] border border-[#30363d]
              rounded-lg shadow-lg overflow-hidden
              z-50
            "
          >
            {/* User info section */}
            <div className="px-3 py-2.5 border-b border-[#21262d]">
              <div className="flex items-center gap-2.5">
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center
                    ${avatarColor} text-[#0d1117] text-xs font-semibold
                  `}
                >
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#e6edf3] truncate">
                    {user?.username}
                  </p>
                  <p className="text-xs text-[#8b949e]">
                    Chutes Account
                  </p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="
                  w-full px-3 py-2 flex items-center gap-2.5
                  text-sm text-[#c9d1d9] hover:text-[#e6edf3]
                  hover:bg-[#21262d]
                  transition-colors duration-100
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
























