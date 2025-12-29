import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { readProjectState, writeProjectState } from '@/lib/project-state';

const CHECKPOINT_DIR = '.chutes/checkpoints';

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

async function ensureCheckpointDir(provider: any) {
  await provider.runCommand(`mkdir -p ${CHECKPOINT_DIR}`);
}

export async function GET(request: NextRequest) {
  try {
    const sandboxId = request.nextUrl.searchParams.get('sandboxId');
    if (!sandboxId) {
      return NextResponse.json({ success: false, error: 'sandboxId is required' }, { status: 400 });
    }

    const provider = await getProviderForSandbox(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    const state = await readProjectState(provider, sandboxId);
    return NextResponse.json({ success: true, checkpoints: state.checkpoints || [] });
  } catch (error) {
    console.error('[checkpoints] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sandboxId = body?.sandboxId;
    const action = body?.action || 'create';

    if (!sandboxId) {
      return NextResponse.json({ success: false, error: 'sandboxId is required' }, { status: 400 });
    }

    const provider = await getProviderForSandbox(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    const state = await readProjectState(provider, sandboxId);

    if (action === 'create') {
      await ensureCheckpointDir(provider);

      const label = String(body?.label || 'Checkpoint');
      const checkpointId = `cp-${Date.now()}`;
      const archivePath = `${CHECKPOINT_DIR}/${checkpointId}.tar.gz`;
      const tarCommand = [
        `tar -czf ${archivePath}`,
        `--exclude=node_modules`,
        `--exclude=.git`,
        `--exclude=.next`,
        `--exclude=dist`,
        `--exclude=build`,
        `--exclude=${CHECKPOINT_DIR}`,
        `-C /workspace .`
      ].join(' ');

      const result = await provider.runCommand(tarCommand);
      if (result.exitCode !== 0) {
        return NextResponse.json({ success: false, error: result.stderr || result.stdout || 'Checkpoint failed' }, { status: 500 });
      }

      const checkpoint = {
        id: checkpointId,
        label,
        createdAt: new Date().toISOString()
      };
      state.checkpoints = [...(state.checkpoints || []), checkpoint];
      const snapshotPath = `${CHECKPOINT_DIR}/${checkpointId}.json`;
      await provider.writeFile(snapshotPath, JSON.stringify(state, null, 2));
      const savedState = await writeProjectState(provider, sandboxId, state);

      return NextResponse.json({ success: true, checkpoint, checkpoints: savedState.checkpoints });
    }

    if (action === 'restore') {
      const checkpointId = body?.checkpointId;
      if (!checkpointId) {
        return NextResponse.json({ success: false, error: 'checkpointId is required' }, { status: 400 });
      }

      const archivePath = `${CHECKPOINT_DIR}/${checkpointId}.tar.gz`;
      const existsResult = await provider.runCommand(`test -f ${archivePath} && echo "ok" || echo "missing"`);
      if (!existsResult.stdout.includes('ok')) {
        return NextResponse.json({ success: false, error: 'Checkpoint archive not found' }, { status: 404 });
      }

      await provider.runCommand('find /workspace -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .chutes -exec rm -rf {} +');
      const restoreResult = await provider.runCommand(`tar -xzf ${archivePath} -C /workspace`);
      if (restoreResult.exitCode !== 0) {
        return NextResponse.json({ success: false, error: restoreResult.stderr || restoreResult.stdout || 'Restore failed' }, { status: 500 });
      }

      let snapshotState: any = null;
      try {
        const snapshotRaw = await provider.readFile(`${CHECKPOINT_DIR}/${checkpointId}.json`);
        snapshotState = JSON.parse(snapshotRaw);
      } catch {
        snapshotState = null;
      }

      const refreshed = snapshotState || await readProjectState(provider, sandboxId);
      const mergedCheckpoints = new Map<string, any>();
      for (const cp of (state.checkpoints || [])) {
        if (cp?.id) mergedCheckpoints.set(cp.id, cp);
      }
      for (const cp of (refreshed.checkpoints || [])) {
        if (cp?.id) mergedCheckpoints.set(cp.id, cp);
      }
      refreshed.checkpoints = Array.from(mergedCheckpoints.values());
      await writeProjectState(provider, sandboxId, refreshed);

      return NextResponse.json({ success: true, state: refreshed });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('[checkpoints] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
