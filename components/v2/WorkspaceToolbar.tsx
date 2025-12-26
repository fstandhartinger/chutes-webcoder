'use client';

import Link from 'next/link';
import { Plus, Clipboard, Download } from 'lucide-react';
import { appConfig } from '@/config/app.config';

interface WorkspaceToolbarProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  onCreateSandbox: () => void;
  onReapply: () => void;
  onDownload: () => void;
  canReapply: boolean;
  canDownload: boolean;
  status: {
    text: string;
    active: boolean;
  };
}

export function WorkspaceToolbar({
  selectedModel,
  onModelChange,
  onCreateSandbox,
  onReapply,
  onDownload,
  canReapply,
  canDownload,
  status
}: WorkspaceToolbarProps) {
  return (
    <div className="bg-[#171717] h-14 px-4 border-b border-neutral-800 flex items-center justify-between">
      {/* Left Side - Logo */}
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white hover:opacity-90 transition-all shadow-lg shadow-emerald-500/20"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </Link>
      </div>

      {/* Right Side - Controls */}
      <div className="flex items-center gap-3">
        {/* Model Selector */}
        <div className="hidden md:block">
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="h-10 px-4 text-sm bg-[#262626] text-white border border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/50 hover:border-neutral-600 transition-colors font-medium cursor-pointer"
          >
            {appConfig.ai.availableModels.map(model => {
              const displayName = (appConfig.ai.modelDisplayNames as Record<string, string>)[model] || model;
              const cleanName = displayName.replace(/\s*\(Chutes\)\s*$/i, '').trim();
              return (
                <option key={model} value={model}>
                  {cleanName}
                </option>
              );
            })}
          </select>
        </div>

        {/* Action Buttons */}
        <button
          onClick={onCreateSandbox}
          title="Create new sandbox"
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#262626] text-white border border-neutral-700 hover:bg-[#333333] hover:border-neutral-600 transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>

        <button
          onClick={onReapply}
          title="Re-apply last generation"
          disabled={!canReapply}
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#262626] text-white border border-neutral-700 hover:bg-[#333333] hover:border-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Clipboard className="w-5 h-5" />
        </button>

        <button
          onClick={onDownload}
          disabled={!canDownload}
          title="Download as ZIP"
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#262626] text-white border border-neutral-700 hover:bg-[#333333] hover:border-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-5 h-5" />
        </button>

        {/* Status */}
        <div className="flex items-center gap-2 px-4 h-10 bg-[#262626] text-white border border-neutral-700 rounded-xl text-sm font-medium">
          <span>{status.text}</span>
          <div className={`w-2.5 h-2.5 rounded-full ${status.active ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-neutral-600'}`} />
        </div>
      </div>
    </div>
  );
}





