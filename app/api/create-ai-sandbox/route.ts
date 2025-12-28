import { NextResponse } from 'next/server';
import type { SandboxState } from '@/types/sandbox';
import { SandboxFactory } from '@/lib/sandbox/factory';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { resolveSandboxUrls } from '@/lib/server/sandbox-preview';

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
  // Check if sandbox creation is already in progress
  if (global.sandboxCreationInProgress && global.sandboxCreationPromise) {
    console.log('[create-ai-sandbox] Sandbox creation already in progress, waiting for existing creation...');
    try {
      const existingResult = await global.sandboxCreationPromise;
      console.log('[create-ai-sandbox] Returning existing sandbox creation result');
      return NextResponse.json(existingResult);
    } catch (error) {
      console.error('[create-ai-sandbox] Existing sandbox creation failed:', error);
      // Continue with new creation if the existing one failed
    }
  }

  // Check if we already have an active sandbox
  if (global.sandboxProvider && global.sandboxData) {
    const providerInfo = global.sandboxProvider.getSandboxInfo?.();
    if (providerInfo) {
      const { previewUrl, sandboxUrl } = resolveSandboxUrls(providerInfo);
      global.sandboxData = {
        sandboxId: providerInfo.sandboxId,
        url: previewUrl,
        sandboxUrl,
        provider: providerInfo.provider
      };
    }
    console.log('[create-ai-sandbox] Returning existing active sandbox');
    return NextResponse.json({
      success: true,
      sandboxId: global.sandboxData.sandboxId,
      url: global.sandboxData.url
    });
  }

  // Set the creation flag
  global.sandboxCreationInProgress = true;
  
  // Create the promise that other requests can await (with retry logic)
  global.sandboxCreationPromise = createSandboxWithRetry(3);
  
  try {
    const result = await global.sandboxCreationPromise;
    return NextResponse.json(result);
  } catch (error) {
    console.error('[create-ai-sandbox] Sandbox creation failed:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to create sandbox',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  } finally {
    global.sandboxCreationInProgress = false;
    global.sandboxCreationPromise = null;
  }
}

// Retry wrapper for sandbox creation
async function createSandboxWithRetry(maxRetries: number = 3): Promise<any> {
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
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
        console.log(`[create-ai-sandbox] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Sandbox creation failed after all retries');
}

async function createSandboxInternal() {
  console.log('[create-ai-sandbox] Creating sandbox via factory...');

  // Clean up any existing sandbox first
  if (global.sandboxProvider) {
    console.log('[create-ai-sandbox] Terminating existing sandbox provider before recreation');
    try {
      await global.sandboxProvider.terminate();
    } catch (error) {
      console.error('[create-ai-sandbox] Failed to terminate existing sandbox provider:', error);
    }
    global.sandboxProvider = null;
    global.sandboxData = null;
  }

  if (global.existingFiles) {
    global.existingFiles.clear();
  } else {
    global.existingFiles = new Set<string>();
  }

  const provider = SandboxFactory.create();
  
  // Create sandbox with timeout
  const createPromise = provider.createSandbox();
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Sandbox creation timeout (60s)')), 60000)
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
  const setupTimeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Vite setup timeout (30s)')), 30000)
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

  sandboxManager.registerSandbox(sandboxInfo.sandboxId, provider);

  global.sandboxProvider = provider;
  global.sandboxData = {
    sandboxId: sandboxInfo.sandboxId,
    url: previewUrl,
    sandboxUrl,
    provider: sandboxInfo.provider
  };

  global.sandboxState = {
    fileCache: {
      files: {},
      lastSync: Date.now(),
      sandboxId: sandboxInfo.sandboxId
    },
    sandbox: provider,
    sandboxData: {
      sandboxId: sandboxInfo.sandboxId,
      url: previewUrl,
      sandboxUrl,
      provider: sandboxInfo.provider
    }
  };

  const result = {
    success: true,
    sandboxId: sandboxInfo.sandboxId,
    url: previewUrl,
    provider: sandboxInfo.provider,
    message: 'Sandbox created and Vite React app initialized'
  };

  global.sandboxData = {
    ...global.sandboxData,
    ...result
  };

  return result;
}
