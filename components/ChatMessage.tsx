'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { cleanAgentOutput } from '@/lib/agent-output-parser';

export interface ChatMessageProps {
  content: string;
  type: 'user' | 'ai' | 'system' | 'file-update' | 'command' | 'error' | 'status' | 'thinking';
  timestamp?: Date;
  metadata?: {
    scrapedUrl?: string;
    scrapedContent?: any;
    generatedCode?: string;
    appliedFiles?: string[];
    commandType?: 'input' | 'output' | 'error' | 'success';
    toolName?: string;
    filePath?: string;
    thinking?: boolean;
  };
  isGenerating?: boolean;
}

const MAX_COLLAPSED_HEIGHT = 200; // px
const MAX_COLLAPSED_LINES = 8;

export function ChatMessage({ content, type, metadata, isGenerating }: ChatMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [needsExpansion, setNeedsExpansion] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Clean up the content before displaying
  const displayContent = useMemo(() => {
    // Don't clean user messages
    if (type === 'user') return content;

    // Clean AI and other messages
    const cleaned = cleanAgentOutput(content);

    // If cleaning resulted in empty, show nothing
    if (!cleaned) return '';

    return cleaned;
  }, [content, type]);

  // Check if content needs expansion
  useEffect(() => {
    if (contentRef.current) {
      const el = contentRef.current;
      const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
      const lines = el.scrollHeight / lineHeight;
      setNeedsExpansion(el.scrollHeight > MAX_COLLAPSED_HEIGHT || lines > MAX_COLLAPSED_LINES);
    }
  }, [displayContent]);

  // Don't render if content is empty
  if (!displayContent) return null;

  // Status messages (tool use, progress)
  if (type === 'status' || metadata?.toolName) {
    return (
      <div className="flex items-start gap-2 py-1">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          {isGenerating ? (
            <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span className="text-neutral-400">{displayContent}</span>
        </div>
      </div>
    );
  }

  // Thinking messages
  if (type === 'thinking' || metadata?.thinking) {
    return (
      <div className="flex items-start gap-2 py-1">
        <div className="flex items-center gap-2 text-xs text-neutral-500 italic">
          <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-neutral-400">Thinking...</span>
        </div>
      </div>
    );
  }

  // Command messages
  if (type === 'command') {
    return (
      <div className="py-1">
        <div className="inline-flex items-start gap-2 px-3 py-2 bg-neutral-800/80 rounded-lg text-xs font-mono max-w-full overflow-x-auto">
          <span className={`shrink-0 ${
            metadata?.commandType === 'input' ? 'text-emerald-500' :
            metadata?.commandType === 'error' ? 'text-red-500' :
            metadata?.commandType === 'success' ? 'text-green-500' :
            'text-neutral-500'
          }`}>
            {metadata?.commandType === 'input' ? '$' : '>'}
          </span>
          <span className="text-neutral-300 whitespace-pre-wrap break-all">{displayContent}</span>
        </div>
      </div>
    );
  }

  // Error messages
  if (type === 'error') {
    return (
      <div className="py-1.5">
        <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm text-red-300">{displayContent}</span>
        </div>
      </div>
    );
  }

  // System messages
  if (type === 'system') {
    return (
      <div className="py-1">
        <div className="text-xs text-neutral-500 font-medium tracking-wide">
          {displayContent}
        </div>
      </div>
    );
  }

  // User messages
  if (type === 'user') {
    return (
      <div className="flex justify-end py-1.5">
        <div className="max-w-[85%] md:max-w-[70%] px-4 py-2.5 bg-gradient-to-r from-emerald-600/40 to-emerald-500/30 border border-emerald-600/30 rounded-2xl rounded-br-md shadow-lg">
          <p className="text-sm text-neutral-100 leading-relaxed whitespace-pre-wrap break-words">
            {displayContent}
          </p>
        </div>
      </div>
    );
  }

  // AI messages (default)
  // Simple code block detection and formatting
  const formatContent = (content: string) => {
    // Split by code blocks and render them with basic styling
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const codeContent = part.slice(3, -3);
        const firstLine = codeContent.indexOf('\n');
        const code = firstLine > -1 ? codeContent.slice(firstLine + 1) : codeContent;
        return (
          <pre key={i} className="my-2 p-2 bg-black/30 rounded-lg overflow-x-auto">
            <code className="text-xs font-mono text-emerald-300">{code}</code>
          </pre>
        );
      }
      return <span key={i} className="whitespace-pre-wrap">{part}</span>;
    });
  };

  return (
    <div className="flex justify-start py-1.5">
      <div className="max-w-[85%] md:max-w-[70%] bg-neutral-800/70 border border-neutral-700/50 rounded-2xl rounded-bl-md shadow-lg overflow-hidden">
        <div
          ref={contentRef}
          className={`px-4 py-2.5 ${
            !isExpanded && needsExpansion ? 'max-h-[200px] overflow-hidden relative' : ''
          }`}
        >
          <div className="text-sm text-neutral-200 leading-relaxed break-words">
            {formatContent(displayContent)}
          </div>

          {/* Gradient fade for collapsed content */}
          {!isExpanded && needsExpansion && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-neutral-800 to-transparent pointer-events-none" />
          )}
        </div>

        {/* Show more/less button */}
        {needsExpansion && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full px-4 py-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-neutral-800/50 hover:bg-neutral-700/50 transition-colors border-t border-neutral-700/50"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}

        {/* Applied files display */}
        {metadata?.appliedFiles && metadata.appliedFiles.length > 0 && (
          <div className="px-4 py-2 border-t border-neutral-700/50 bg-neutral-800/30">
            <div className="text-xs text-neutral-400 mb-1.5">Files Updated:</div>
            <div className="flex flex-wrap gap-1.5">
              {metadata.appliedFiles.map((filePath, idx) => {
                const fileName = filePath.split('/').pop() || filePath;
                const ext = fileName.split('.').pop() || '';
                const color = ext === 'css' ? 'bg-blue-500' :
                             ext === 'jsx' || ext === 'tsx' ? 'bg-yellow-500' :
                             ext === 'ts' || ext === 'js' ? 'bg-yellow-600' :
                             ext === 'json' ? 'bg-green-500' : 'bg-neutral-500';

                return (
                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-700/50 rounded text-xs text-neutral-300">
                    <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
                    {fileName}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;
