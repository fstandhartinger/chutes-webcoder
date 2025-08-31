'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

export default function DeployedApp() {
  const params = useParams();
  const { id } = params as { id: string };
  const [src, setSrc] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = `/deployments/${id}/index.html`;
      if (!cancelled) setSrc(u);
    })();
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="w-full h-screen">
      <iframe ref={iframeRef} className="w-full h-full" src={src} />
    </div>
  );
}


