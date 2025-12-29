import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

async function getProviderForSandbox(sandboxId: string) {
  const existing = sandboxManager.getProvider(sandboxId);
  if (existing) return existing;
  const provider = await sandboxManager.getOrCreateProvider(sandboxId);
  if (provider?.getSandboxInfo?.()) return provider;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const sandboxId = request.nextUrl.searchParams.get('sandboxId');
    const rawPath = request.nextUrl.searchParams.get('path');

    if (!sandboxId || !rawPath) {
      return NextResponse.json({ success: false, error: 'sandboxId and path are required' }, { status: 400 });
    }

    const normalizedPath = rawPath.replace(/^\/?workspace\//, '');
    if (normalizedPath.includes('..')) {
      return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 });
    }

    const provider = await getProviderForSandbox(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    const content = await provider.readFile(normalizedPath);
    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error('[sandbox-file] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
