import { NextResponse } from 'next/server';
import type { SandboxState } from '@/types/sandbox';
import { SandboxFactory } from '@/lib/sandbox/factory';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

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
    console.log('[create-ai-sandbox] Returning existing active sandbox');
    return NextResponse.json({
      success: true,
      sandboxId: global.sandboxData.sandboxId,
      url: global.sandboxData.url
    });
  }

  // Set the creation flag
  global.sandboxCreationInProgress = true;
  
  // Create the promise that other requests can await
  global.sandboxCreationPromise = createSandboxInternal();
  
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

async function createSandboxInternal() {
  try {
    console.log('[create-ai-sandbox] Creating E2B sandbox via factory...');

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

    const provider = SandboxFactory.create('e2b');
    const sandboxInfo = await provider.createSandbox();
    console.log('[create-ai-sandbox] Sandbox created:', sandboxInfo.sandboxId, sandboxInfo.url);

    await provider.setupViteApp();
    console.log('[create-ai-sandbox] Vite app prepared in sandbox');

    sandboxManager.registerSandbox(sandboxInfo.sandboxId, provider);

    global.sandboxProvider = provider;
    global.sandboxData = {
      sandboxId: sandboxInfo.sandboxId,
      url: sandboxInfo.url
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
        url: sandboxInfo.url
      }
    };

    const result = {
      success: true,
      sandboxId: sandboxInfo.sandboxId,
      url: sandboxInfo.url,
      provider: sandboxInfo.provider,
      message: 'Sandbox created and Vite React app initialized'
    };

    global.sandboxData = {
      ...global.sandboxData,
      ...result
    };

    return result;

  } catch (error) {
    console.error('[create-ai-sandbox] Error:', error);
    if (global.sandboxProvider) {
      try {
        await global.sandboxProvider.terminate();
      } catch (terminationError) {
        console.error('[create-ai-sandbox] Failed to terminate sandbox after error:', terminationError);
      }
      global.sandboxProvider = null;
    }
    global.sandboxData = null;
    await sandboxManager.terminateAll();
    throw error;
  }
}