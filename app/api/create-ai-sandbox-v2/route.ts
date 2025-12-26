import { NextResponse } from 'next/server';
import { SandboxFactory } from '@/lib/sandbox/factory';
import type { SandboxState } from '@/types/sandbox';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

// Store active sandbox globally
declare global {
  var activeSandboxProvider: any;
  var sandboxProvider: ReturnType<typeof SandboxFactory.create> | null;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxState: SandboxState;
  var sandboxCreationInProgress: boolean;
  var sandboxCreationPromise: Promise<any> | null;
}

export async function POST() {
  // Prevent concurrent sandbox creation
  if (global.sandboxCreationInProgress && global.sandboxCreationPromise) {
    console.log('[create-ai-sandbox-v2] Waiting for in-progress sandbox creation...');
    try {
      const existingResult = await global.sandboxCreationPromise;
      console.log('[create-ai-sandbox-v2] Returning existing sandbox');
      return NextResponse.json(existingResult);
    } catch (error) {
      console.error('[create-ai-sandbox-v2] In-progress creation failed, will retry');
    }
  }

  // Check if we have a valid active sandbox
  if (global.activeSandboxProvider && global.sandboxData?.sandboxId) {
    // Verify the sandbox is still responsive
    try {
      const healthResult = await global.activeSandboxProvider.runCommand('echo "health"');
      if (healthResult.success) {
        console.log('[create-ai-sandbox-v2] Returning existing active sandbox:', global.sandboxData.sandboxId);
        return NextResponse.json({
          success: true,
          sandboxId: global.sandboxData.sandboxId,
          url: global.sandboxData.url,
          provider: 'sandy',
          message: 'Using existing sandbox'
        });
      }
    } catch {
      console.log('[create-ai-sandbox-v2] Existing sandbox unresponsive, recreating...');
    }
  }

  // Set creation flag
  global.sandboxCreationInProgress = true;
  global.sandboxCreationPromise = createSandboxWithRetry();

  try {
    const result = await global.sandboxCreationPromise;
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
  } finally {
    global.sandboxCreationInProgress = false;
    global.sandboxCreationPromise = null;
  }
}

async function createSandboxWithRetry(maxRetries: number = 3): Promise<any> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[create-ai-sandbox-v2] Attempt ${attempt}/${maxRetries}`);
      return await createSandboxInternal();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[create-ai-sandbox-v2] Attempt ${attempt} failed:`, lastError.message);
      
      // Clean up before retry
      await cleanupSandboxState();
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
        console.log(`[create-ai-sandbox-v2] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Sandbox creation failed after all retries');
}

async function cleanupSandboxState() {
  try {
    await sandboxManager.terminateAll();
  } catch {}
  
  if (global.activeSandboxProvider) {
    try {
      await global.activeSandboxProvider.terminate();
    } catch {}
  }
  
  if (global.sandboxProvider) {
    try {
      await global.sandboxProvider.terminate();
    } catch {}
  }
  
  global.activeSandboxProvider = null;
  global.sandboxProvider = null;
  global.sandboxData = null;
  
  if (global.existingFiles) {
    global.existingFiles.clear();
  }
}

async function createSandboxInternal() {
  console.log('[create-ai-sandbox-v2] Creating sandbox...');
  
  // Clean up all existing sandboxes first
  await cleanupSandboxState();
  
  global.existingFiles = new Set<string>();

  // Create new sandbox using factory with timeout
  const provider = SandboxFactory.create();
  
  const createPromise = provider.createSandbox();
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Sandbox creation timeout (60s)')), 60000)
  );
  
  const sandboxInfo = await Promise.race([createPromise, timeoutPromise]);
  
  // Validate sandbox ID
  if (!sandboxInfo.sandboxId || sandboxInfo.sandboxId.length < 8) {
    throw new Error(`Invalid sandbox ID received: ${sandboxInfo.sandboxId}`);
  }
  
  console.log('[create-ai-sandbox-v2] Setting up Vite React app...');
  
  // Setup Vite with timeout
  const setupPromise = provider.setupViteApp();
  const setupTimeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Vite setup timeout (30s)')), 30000)
  );
  
  await Promise.race([setupPromise, setupTimeoutPromise]);
  
  // Health check - verify sandbox is responsive
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
  
  // Register with sandbox manager
  sandboxManager.registerSandbox(sandboxInfo.sandboxId, provider);
  
  // Store in global state
  global.activeSandboxProvider = provider;
  global.sandboxProvider = provider;
  global.sandboxData = {
    sandboxId: sandboxInfo.sandboxId,
    url: sandboxInfo.url
  };
  
  // Initialize sandbox state
  global.sandboxState = {
    fileCache: {
      files: {},
      lastSync: Date.now(),
      sandboxId: sandboxInfo.sandboxId
    },
    sandbox: provider,
    sandboxData: {
      sandboxId: sandboxInfo.sandboxId,
      url: sandboxInfo.url
    }
  };
  
  console.log('[create-ai-sandbox-v2] Sandbox ready at:', sandboxInfo.url);
  
  return {
    success: true,
    sandboxId: sandboxInfo.sandboxId,
    url: sandboxInfo.url,
    provider: sandboxInfo.provider,
    message: 'Sandbox created and Vite React app initialized'
  };
}