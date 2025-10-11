import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface CodeApplicationState {
  stage: 'analyzing' | 'installing' | 'applying' | 'complete' | 'waiting_preview' | null;
  packages?: string[];
  installedPackages?: string[];
  filesGenerated?: string[];
  message?: string;
}

interface CodeApplicationProgressProps {
  state: CodeApplicationState;
}

export default function CodeApplicationProgress({ state }: CodeApplicationProgressProps) {
  // Keep the progress visible during 'complete' to avoid gap before preview becomes ready
  if (!state.stage) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="loading"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="inline-block bg-[hsl(240_8%_10%)] rounded-[10px] p-3 mt-2 border border-border"
      >
        <div className="flex items-center gap-3">
          {/* Rotating loading indicator */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-5 h-5"
          >
            <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
              <circle 
                cx="12" 
                cy="12" 
                r="10" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round"
                strokeDasharray="31.416"
                strokeDashoffset="10"
                className="text-white"
              />
            </svg>
          </motion.div>

          {/* Simple loading text */}
          <div className="text-sm font-medium text-white">
            {state.stage === 'waiting_preview' || state.stage === 'complete'
              ? 'Preparing preview…'
              : 'Applying to sandbox...'}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}