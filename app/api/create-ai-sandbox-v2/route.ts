import { NextRequest, NextResponse } from 'next/server';
import { SandboxFactory } from '@/lib/sandbox/factory';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { resolveSandboxUrls } from '@/lib/server/sandbox-preview';
import { buildDefaultProjectState, readProjectState, writeProjectState } from '@/lib/project-state';

async function createSandboxWithRetry(maxRetries: number = 3): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[create-ai-sandbox-v2] Attempt ${attempt}/${maxRetries}`);
      return await createSandboxInternal();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[create-ai-sandbox-v2] Attempt ${attempt} failed:`, lastError.message);

      if (attempt < maxRetries) {
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
        console.log(`[create-ai-sandbox-v2] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Sandbox creation failed after all retries');
}

async function createSandboxInternal() {
  console.log('[create-ai-sandbox-v2] Creating sandbox...');

  const provider = SandboxFactory.create();

  const createPromise = provider.createSandbox();
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Sandbox creation timeout (60s)')), 60000)
  );

  const sandboxInfo = await Promise.race([createPromise, timeoutPromise]);

  if (!sandboxInfo.sandboxId || sandboxInfo.sandboxId.length < 8) {
    throw new Error(`Invalid sandbox ID received: ${sandboxInfo.sandboxId}`);
  }

  const { previewUrl, sandboxUrl } = resolveSandboxUrls(sandboxInfo);

  console.log('[create-ai-sandbox-v2] Setting up Vite React app...');
  const setupPromise = provider.setupViteApp();
  const setupTimeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Vite setup timeout (30s)')), 30000)
  );

  await Promise.race([setupPromise, setupTimeoutPromise]);

  try {
    const healthResult = await provider.runCommand('echo "sandbox-ready"');
    if (!healthResult.success) {
      throw new Error(`Health check returned exit code ${healthResult.exitCode}`);
    }
    console.log('[create-ai-sandbox-v2] Sandbox health check passed');
  } catch (healthError) {
    console.error('[create-ai-sandbox-v2] Health check failed:', healthError);
    throw new Error('Sandbox health check failed');
  }

  sandboxManager.registerSandbox(sandboxInfo.sandboxId, provider);

  await writeProjectState(provider, sandboxInfo.sandboxId, buildDefaultProjectState(sandboxInfo.sandboxId));

  console.log('[create-ai-sandbox-v2] Sandbox ready at:', previewUrl);

  return {
    success: true,
    sandboxId: sandboxInfo.sandboxId,
    url: previewUrl,
    sandboxUrl,
    provider: sandboxInfo.provider,
    message: 'Sandbox created and Vite React app initialized'
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sandboxId = body?.sandboxId as string | undefined;

    if (sandboxId) {
      console.log('[create-ai-sandbox-v2] Attempting to restore sandbox:', sandboxId);
      const provider = sandboxManager.getProvider(sandboxId) || await sandboxManager.getOrCreateProvider(sandboxId);
      if (!provider?.getSandboxInfo?.()) {
        return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
      }

      const providerInfo = provider.getSandboxInfo?.();
      if (!providerInfo) {
        return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
      }
      const { previewUrl, sandboxUrl } = resolveSandboxUrls(providerInfo);
      const state = await readProjectState(provider, sandboxId);
      await writeProjectState(provider, sandboxId, state);

      return NextResponse.json({
        success: true,
        sandboxId: providerInfo?.sandboxId || sandboxId,
        url: previewUrl,
        sandboxUrl,
        provider: providerInfo?.provider,
        message: 'Sandbox restored'
      });
    }

    const result = await createSandboxWithRetry();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[create-ai-sandbox-v2] Sandbox creation failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create sandbox',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
