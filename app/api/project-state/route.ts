import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { readProjectState, writeProjectState } from '@/lib/project-state';

async function getProviderForSandbox(sandboxId: string) {
  const existing = sandboxManager.getProvider(sandboxId);
  if (existing) {
    return existing;
  }
  const provider = await sandboxManager.getOrCreateProvider(sandboxId);
  if (provider?.getSandboxInfo?.()) {
    return provider;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const sandboxId = request.nextUrl.searchParams.get('sandboxId') ||
      request.nextUrl.searchParams.get('project') ||
      request.cookies.get('sandySandboxId')?.value;
    if (!sandboxId) {
      return NextResponse.json({ success: false, error: 'sandboxId is required' }, { status: 400 });
    }

    const provider = await getProviderForSandbox(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    const state = await readProjectState(provider, sandboxId);
    await writeProjectState(provider, sandboxId, state);

    return NextResponse.json({ success: true, state });
  } catch (error) {
    console.error('[project-state] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sandboxId = body?.sandboxId ||
      request.nextUrl.searchParams.get('sandboxId') ||
      request.nextUrl.searchParams.get('project') ||
      request.cookies.get('sandySandboxId')?.value;
    const state = body?.state;

    if (!sandboxId) {
      return NextResponse.json({ success: false, error: 'sandboxId is required' }, { status: 400 });
    }

    const provider = await getProviderForSandbox(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    const savedState = await writeProjectState(provider, sandboxId, state || {});
    return NextResponse.json({ success: true, state: savedState });
  } catch (error) {
    console.error('[project-state] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
