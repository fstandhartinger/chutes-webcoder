'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, ArrowRight, Sparkles } from 'lucide-react';
import { appConfig } from '@/config/app.config';

interface HomeScreenProps {
  onSubmit: (prompt: string, url?: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  isLoading?: boolean;
}

export function HomeScreen({ onSubmit, selectedModel, onModelChange, isLoading }: HomeScreenProps) {
  const [promptInput, setPromptInput] = useState('');
  const [urlInput, setUrlInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (promptInput.trim() || urlInput.trim()) {
      onSubmit(promptInput.trim(), urlInput.trim() || undefined);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      {/* Main Content */}
      <main className="relative flex-1 flex flex-col items-center justify-center px-6 py-20">
        <div className="w-full max-w-3xl mx-auto text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full bg-emerald-500/10 border border-emerald-500/20"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400 uppercase tracking-wider">
              Chutes AI
            </span>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-5xl md:text-6xl font-semibold mb-6 tracking-tight"
          >
            Chutes <span className="text-emerald-400">Webcoder</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl text-neutral-400 mb-12 max-w-xl mx-auto"
          >
            Build React apps with AI. Describe your idea or clone a website.
          </motion.p>

          {/* Main Form */}
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="space-y-6"
          >
            {/* Prompt Textarea */}
            <div className="relative bg-[#171717] rounded-2xl border border-neutral-800 shadow-2xl overflow-hidden">
              <textarea
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="Describe your app idea... (e.g., Build a snake game with neon effects)"
                className="w-full min-h-[200px] bg-transparent px-6 py-6 pb-20 text-lg text-white placeholder-neutral-500 resize-none focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              
              {/* Bottom Bar */}
              <div className="absolute bottom-0 left-0 right-0 px-6 py-4 flex items-center justify-between bg-gradient-to-t from-[#171717] to-transparent">
                <span className="text-sm text-neutral-500">
                  Press Enter to send
                </span>
                <button
                  type="submit"
                  disabled={isLoading || (!promptInput.trim() && !urlInput.trim())}
                  className="flex items-center gap-2 h-12 px-8 rounded-xl bg-emerald-500 text-white font-semibold text-base hover:bg-emerald-600 active:scale-[0.98] transition-all shadow-lg shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>Generate</span>
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 py-2">
              <div className="flex-1 h-px bg-neutral-800" />
              <span className="px-4 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-widest border border-neutral-800 rounded-full bg-[#0a0a0a]">
                Or clone a website
              </span>
              <div className="flex-1 h-px bg-neutral-800" />
            </div>

            {/* URL Input */}
            <div className="relative bg-[#171717] rounded-2xl border border-neutral-800 overflow-hidden">
              <ExternalLink className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com"
                className="w-full h-16 bg-transparent pl-14 pr-28 text-base text-white placeholder-neutral-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isLoading || !urlInput.trim()}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-10 px-6 rounded-xl bg-neutral-800 text-white font-semibold text-sm hover:bg-neutral-700 border border-neutral-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clone
              </button>
            </div>
          </motion.form>

          {/* Model Selector */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-8 flex justify-center"
          >
            <div className="flex items-center gap-3 px-5 h-12 bg-[#171717] border border-neutral-800 rounded-xl">
              <span className="text-sm text-neutral-400 font-medium">Model:</span>
              <select
                value={selectedModel}
                onChange={(e) => onModelChange(e.target.value)}
                className="bg-transparent text-base text-white font-semibold cursor-pointer focus:outline-none appearance-none pr-6"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2322c55e' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 0 center',
                  backgroundSize: '16px'
                }}
              >
                {appConfig.ai.availableModels.map(model => {
                  const displayName = (appConfig.ai.modelDisplayNames as Record<string, string>)[model] || model;
                  const cleanName = displayName.replace(/\s*\(Chutes\)\s*$/i, '').trim();
                  return (
                    <option key={model} value={model} className="bg-[#171717] text-white">
                      {cleanName}
                    </option>
                  );
                })}
              </select>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}




















