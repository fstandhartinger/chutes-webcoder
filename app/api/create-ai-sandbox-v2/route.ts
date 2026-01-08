import { NextRequest, NextResponse } from 'next/server';
import { SandboxFactory } from '@/lib/sandbox/factory';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { resolveSandboxUrls } from '@/lib/server/sandbox-preview';
import { buildDefaultProjectState, readProjectState, writeProjectState } from '@/lib/project-state';
import { appConfig } from '@/config/app.config';

async function createSandboxWithRetry(maxRetries: number = 5): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[create-ai-sandbox-v2] Attempt ${attempt}/${maxRetries}`);
      return await createSandboxInternal();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[create-ai-sandbox-v2] Attempt ${attempt} failed:`, lastError.message);

      if (attempt < maxRetries) {
        const isTransient = /EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|Bad Gateway|502|503|504|headers timeout|UND_ERR_HEADERS_TIMEOUT/i.test(
          lastError.message
        );
        const baseDelay = isTransient ? 5000 : 2000;
        const maxDelay = isTransient ? 30000 : 10000;
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
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
  let registeredSandboxId: string | null = null;

  try {
    const createPromise = provider.createSandbox();
    const sandboxCreateTimeoutMs = appConfig.sandy.createTimeoutMs;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Sandbox creation timeout (${sandboxCreateTimeoutMs / 1000}s)`)), sandboxCreateTimeoutMs)
    );

    const createStarted = Date.now();
    const sandboxInfo = await Promise.race([createPromise, timeoutPromise]);
    console.log(`[create-ai-sandbox-v2] Sandbox created in ${Date.now() - createStarted}ms`);

    if (!sandboxInfo.sandboxId || sandboxInfo.sandboxId.length < 8) {
      throw new Error(`Invalid sandbox ID received: ${sandboxInfo.sandboxId}`);
    }

    const { previewUrl, sandboxUrl } = resolveSandboxUrls(sandboxInfo);

    console.log('[create-ai-sandbox-v2] Setting up Vite React app...');
    const setupStarted = Date.now();
    const setupPromise = provider.setupViteApp();
    const sandboxSetupTimeoutMs = appConfig.sandy.setupTimeoutMs;
    const setupTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Vite setup timeout (${sandboxSetupTimeoutMs / 1000}s)`)), sandboxSetupTimeoutMs)
    );

    await Promise.race([setupPromise, setupTimeoutPromise]);
    console.log(`[create-ai-sandbox-v2] Vite setup completed in ${Date.now() - setupStarted}ms`);

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
    registeredSandboxId = sandboxInfo.sandboxId;

    try {
      await writeProjectState(provider, sandboxInfo.sandboxId, buildDefaultProjectState(sandboxInfo.sandboxId));
    } catch (stateError) {
      console.warn('[create-ai-sandbox-v2] Failed to persist project state:', stateError);
    }

    console.log('[create-ai-sandbox-v2] Sandbox ready at:', previewUrl);

    return {
      success: true,
      sandboxId: sandboxInfo.sandboxId,
      url: previewUrl,
      sandboxUrl,
      provider: sandboxInfo.provider,
      message: 'Sandbox created and Vite React app initialized'
    };
  } catch (error) {
    const sandboxId = registeredSandboxId || provider.getSandboxInfo?.()?.sandboxId;
    if (sandboxId) {
      try {
        if (registeredSandboxId) {
          await sandboxManager.terminateSandbox(sandboxId);
        } else if (provider.terminate) {
          await provider.terminate();
        }
      } catch (cleanupError) {
        console.warn('[create-ai-sandbox-v2] Failed to cleanup sandbox after error:', cleanupError);
      }
    }
    throw error;
  }
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
      try {
        const state = await readProjectState(provider, sandboxId);
        await writeProjectState(provider, sandboxId, state);
      } catch (stateError) {
        console.warn('[create-ai-sandbox-v2] Failed to refresh project state during restore:', stateError);
      }

      const response = NextResponse.json({
        success: true,
        sandboxId: providerInfo?.sandboxId || sandboxId,
        url: previewUrl,
        sandboxUrl,
        provider: providerInfo?.provider,
        message: 'Sandbox restored'
      });
      if (providerInfo?.provider === 'sandy') {
        response.cookies.set({
          name: 'sandySandboxId',
          value: providerInfo?.sandboxId || sandboxId,
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 60 * 60
        });
      }
      return response;
    }

    const result = await createSandboxWithRetry();
    const response = NextResponse.json(result);
    if (result?.provider === 'sandy' && result?.sandboxId) {
      response.cookies.set({
        name: 'sandySandboxId',
        value: result.sandboxId,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60
      });
    }
    return response;
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
