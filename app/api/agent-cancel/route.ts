import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

async function getProvider(sandboxId: string) {
  const existing = sandboxManager.getProvider(sandboxId);
  if (existing) return existing;
  const provider = await sandboxManager.getOrCreateProvider(sandboxId);
  if (provider?.getSandboxInfo?.()) return provider;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sandboxId = body?.sandboxId as string | undefined;

    if (!sandboxId) {
      return NextResponse.json({ success: false, error: 'sandboxId is required' }, { status: 400 });
    }

    const provider = await getProvider(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    await provider.runCommand('test -f /tmp/agent.pid && kill -TERM $(cat /tmp/agent.pid) || true');
    await provider.runCommand('echo 130 > /tmp/agent.done');
    await provider.runCommand('echo "Agent cancelled by user." >> /tmp/agent_output.log || true');

    return NextResponse.json({ success: true, message: 'Agent cancelled' });
  } catch (error) {
    console.error('[agent-cancel] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
