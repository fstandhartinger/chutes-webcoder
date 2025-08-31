'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

export default function DeployedApp() {
  const params = useParams();
  const { id } = params as { id: string };
  const [srcDoc, setSrcDoc] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Build a simple index that loads ./index.html from the folder via Next static serving
        // Note: We serve the static files under /deployments/[id]
        const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body style="margin:0;padding:0;overflow:hidden"><iframe src="/deployments/${id}/index.html" style="border:0;width:100vw;height:100vh"></iframe></body></html>`;
        if (!cancelled) setSrcDoc(doc);
      } catch {
        if (!cancelled) setSrcDoc('<h1>Deployment not found</h1>');
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="w-full h-screen">
      <iframe ref={iframeRef} className="w-full h-full" srcDoc={srcDoc} />
    </div>
  );
}


