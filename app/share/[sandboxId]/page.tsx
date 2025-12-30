'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

export default function ShareSandboxPage() {
  const params = useParams<{ sandboxId: string }>();
  const sandboxId = useMemo(() => {
    const raw = params?.sandboxId;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('Restoring sandbox...');
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!sandboxId) return;
    let cancelled = false;
    setPreviewUrl(null);

    const restore = async () => {
      setStatus('Restoring sandbox...');
      setError(null);
      try {
        const response = await fetch('/api/create-ai-sandbox-v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandboxId })
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || response.statusText);
        }
        const data = await response.json().catch(() => ({}));
        const url = data?.sandboxUrl || data?.url || `/api/sandy-preview/${sandboxId}`;
        if (!cancelled) {
          setPreviewUrl(url);
          setStatus('Loading preview...');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to restore sandbox');
        }
      }
    };

    restore();

    return () => {
      cancelled = true;
    };
  }, [sandboxId, retryKey]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-neutral-200 flex items-center justify-center p-6">
        <div className="max-w-lg text-center space-y-3">
          <div className="text-lg font-semibold">Sandbox unavailable</div>
          <div className="text-sm text-neutral-400">
            {error}
          </div>
          <button
            type="button"
            onClick={() => {
              setPreviewUrl(null);
              setError(null);
              setStatus('Retrying restore...');
              setRetryKey(prev => prev + 1);
            }}
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-neutral-200 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto" />
          <div className="text-sm text-neutral-400">{status}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <iframe
        src={previewUrl}
        className="w-full h-screen border-none"
        title="Shared sandbox preview"
        allow="clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
