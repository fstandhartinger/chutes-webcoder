'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function ShareSandboxPage() {
  const params = useParams();
  const { sandboxId } = params as { sandboxId: string };
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [status, setStatus] = useState<string>('Starting sandbox...');

  useEffect(() => {
    let cancelled = false;

    const ensureSandbox = async () => {
      try {
        const response = await fetch('/api/create-ai-sandbox-v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sandboxId })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || response.statusText);
        }

        const data = await response.json();
        if (!cancelled) {
          setPreviewUrl(data.url);
          setStatus('');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Failed to load sandbox');
        }
      }
    };

    ensureSandbox();

    return () => {
      cancelled = true;
    };
  }, [sandboxId]);

  if (!previewUrl) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-neutral-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-neutral-400">{status}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <iframe
        title="Shared sandbox preview"
        src={previewUrl}
        className="w-full h-screen border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
