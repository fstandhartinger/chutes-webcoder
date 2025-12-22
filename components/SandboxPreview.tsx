import { useState, useEffect } from 'react';
import { Loader2, ExternalLink, RefreshCw, Terminal } from 'lucide-react';

interface SandboxPreviewProps {
  sandboxId: string;
  port: number;
  type: 'vite' | 'nextjs' | 'console';
  output?: string;
  isLoading?: boolean;
}

export default function SandboxPreview({ 
  sandboxId, 
  port, 
  type, 
  output,
  isLoading = false 
}: SandboxPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [showConsole, setShowConsole] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    if (sandboxId && type !== 'console') {
      const rawSuffix = (process.env.NEXT_PUBLIC_SANDBOX_HOST_SUFFIX || '.sandy.localhost').trim();
      const suffix = rawSuffix ? (rawSuffix.startsWith('.') ? rawSuffix : `.${rawSuffix}`) : '';
      setPreviewUrl(suffix ? `https://${sandboxId}${suffix}` : '');
    }
  }, [sandboxId, port, type]);

  const handleRefresh = () => {
    setIframeKey(prev => prev + 1);
  };

  if (type === 'console') {
    return (
      <div className="bg-surface-ink-850 rounded-2xl p-4 border border-surface-ink-700/70">
        <div className="font-mono text-sm whitespace-pre-wrap text-ink-300">
          {output || 'No output yet...'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Preview Controls */}
      <div className="flex items-center justify-between bg-surface-ink-850 rounded-2xl p-3 border border-surface-ink-700/70">
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-400">
            {type === 'vite' ? '⚡ Vite' : '▲ Next.js'} Preview
          </span>
          <code className="text-xs bg-surface-ink-900 px-2 py-1 rounded text-moss-400">
            {previewUrl}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConsole(!showConsole)}
            className="p-2 hover:bg-surface-ink-700 rounded transition-colors"
            title="Toggle console"
          >
            <Terminal className="w-5 h-5" />
          </button>
          <button
            onClick={handleRefresh}
            className="p-2 hover:bg-surface-ink-700 rounded transition-colors"
            title="Refresh preview"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-surface-ink-700 rounded transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-5 h-5" />
          </a>
        </div>
      </div>

      {/* Main Preview */}
      <div className="relative bg-surface-ink-900 rounded-2xl overflow-hidden border border-surface-ink-700/70">
        {isLoading && (
          <div className="absolute inset-0 bg-surface-ink-900/80 flex items-center justify-center z-10">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
              <p className="text-sm text-ink-400">
                {type === 'vite' ? 'Starting Vite dev server...' : 'Starting Next.js dev server...'}
              </p>
            </div>
          </div>
        )}
        
        <iframe
          key={iframeKey}
          src={previewUrl}
          className="w-full h-[420px] md:h-[600px] bg-surface-ink-900"
          title={`${type} preview`}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>

      {/* Console Output (Toggle) */}
      {showConsole && output && (
        <div className="bg-surface-ink-850 rounded-2xl p-4 border border-surface-ink-700/70">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-ink-400">Console Output</span>
          </div>
          <div className="font-mono text-xs whitespace-pre-wrap text-ink-300 max-h-48 overflow-y-auto">
            {output}
          </div>
        </div>
      )}
    </div>
  );
}
