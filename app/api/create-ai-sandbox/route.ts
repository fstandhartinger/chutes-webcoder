import { NextResponse } from 'next/server';
import type { SandboxState } from '@/types/sandbox';
import { SandboxFactory } from '@/lib/sandbox/factory';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { resolveSandboxUrls } from '@/lib/server/sandbox-preview';
import { buildDefaultProjectState, writeProjectState } from '@/lib/project-state';
import { appConfig } from '@/config/app.config';

// Store active sandbox globally
declare global {
  var sandboxProvider: ReturnType<typeof SandboxFactory.create> | null;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxState: SandboxState;
  var sandboxCreationInProgress: boolean;
  var sandboxCreationPromise: Promise<any> | null;
}

export async function POST() {
  // NOTE: Each call ALWAYS creates a new sandbox for session isolation
  // This prevents sandbox sharing between different users/sessions

  console.log('[create-ai-sandbox] Creating NEW sandbox (session isolation enabled)');

  try {
    const result = await createSandboxWithRetry(3);
    console.log('[create-ai-sandbox] New sandbox created:', result.sandboxId);
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
    console.error('[create-ai-sandbox] Sandbox creation failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create sandbox',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

// Retry wrapper for sandbox creation
async function createSandboxWithRetry(maxRetries: number = 5): Promise<any> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[create-ai-sandbox] Attempt ${attempt}/${maxRetries}`);
      return await createSandboxInternal();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[create-ai-sandbox] Attempt ${attempt} failed:`, lastError.message);
      
      // Clean up before retry
      if (global.sandboxProvider) {
        try {
          await global.sandboxProvider.terminate();
        } catch {}
        global.sandboxProvider = null;
      }
      global.sandboxData = null;
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const isTransient = /EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|Bad Gateway|502|503|504|headers timeout|UND_ERR_HEADERS_TIMEOUT/i.test(
          lastError.message
        );
        const baseDelay = isTransient ? 5000 : 2000;
        const maxDelay = isTransient ? 30000 : 10000;
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
        console.log(`[create-ai-sandbox] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Sandbox creation failed after all retries');
}

async function createSandboxInternal() {
  console.log('[create-ai-sandbox] Creating sandbox via factory...');

  // NOTE: No longer cleaning up global state - each sandbox is independent
  // Previous code would terminate another user's sandbox!

  const provider = SandboxFactory.create();
  let registeredSandboxId: string | null = null;

  try {
    // Create sandbox with timeout
    const createPromise = provider.createSandbox();
    const sandboxCreateTimeoutMs = appConfig.sandy.createTimeoutMs;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Sandbox creation timeout (${sandboxCreateTimeoutMs / 1000}s)`)), sandboxCreateTimeoutMs)
    );

    const sandboxInfo = await Promise.race([createPromise, timeoutPromise]);
    console.log('[create-ai-sandbox] Sandbox created:', sandboxInfo.sandboxId, sandboxInfo.url);

    // Validate sandbox ID
    if (!sandboxInfo.sandboxId || sandboxInfo.sandboxId.length < 8) {
      throw new Error(`Invalid sandbox ID received: ${sandboxInfo.sandboxId}`);
    }

    const { previewUrl, sandboxUrl } = resolveSandboxUrls(sandboxInfo);

    // Setup Vite with timeout
    const setupPromise = provider.setupViteApp();
    const sandboxSetupTimeoutMs = appConfig.sandy.setupTimeoutMs;
    const setupTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Vite setup timeout (${sandboxSetupTimeoutMs / 1000}s)`)), sandboxSetupTimeoutMs)
    );

    await Promise.race([setupPromise, setupTimeoutPromise]);
    console.log('[create-ai-sandbox] Vite app prepared in sandbox');

    // Verify sandbox is responsive
    try {
      const healthResult = await provider.runCommand('echo "sandbox-ready"');
      if (!healthResult.success) {
        throw new Error(`Health check returned exit code ${healthResult.exitCode}`);
      }
      console.log('[create-ai-sandbox] Sandbox health check passed');
    } catch (healthError) {
      console.error('[create-ai-sandbox] Sandbox health check failed:', healthError);
      throw new Error('Sandbox health check failed - sandbox may be unresponsive');
    }

    // Register in sandbox manager (by ID, not as "active")
    sandboxManager.registerSandbox(sandboxInfo.sandboxId, provider);
    registeredSandboxId = sandboxInfo.sandboxId;

    try {
      await writeProjectState(provider, sandboxInfo.sandboxId, buildDefaultProjectState(sandboxInfo.sandboxId));
    } catch (stateError) {
      console.warn('[create-ai-sandbox] Failed to persist project state:', stateError);
    }

    const result = {
      success: true,
      sandboxId: sandboxInfo.sandboxId,
      url: previewUrl,
      sandboxUrl,
      provider: sandboxInfo.provider,
      message: 'Sandbox created and Vite React app initialized'
    };

    // NOTE: No longer setting global.sandboxProvider, global.sandboxData, global.sandboxState
    // Each session stores sandboxId in frontend state and passes it in requests

    return result;
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
        console.warn('[create-ai-sandbox] Failed to cleanup sandbox after error:', cleanupError);
      }
    }
    throw error;
  }
}
