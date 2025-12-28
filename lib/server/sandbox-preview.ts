import 'server-only';

import type { SandboxInfo } from '@/lib/sandbox/types';

export function buildSandyPreviewUrl(sandboxId: string): string {
  return `/api/sandy-preview/${sandboxId}`;
}

export function resolveSandboxUrls(sandboxInfo: SandboxInfo): {
  previewUrl: string;
  sandboxUrl: string;
} {
  if (sandboxInfo.provider === 'sandy') {
    return {
      previewUrl: buildSandyPreviewUrl(sandboxInfo.sandboxId),
      sandboxUrl: sandboxInfo.url
    };
  }

  return {
    previewUrl: sandboxInfo.url,
    sandboxUrl: sandboxInfo.url
  };
}
