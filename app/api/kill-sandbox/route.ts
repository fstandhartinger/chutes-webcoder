import { NextResponse } from 'next/server';
import { SandboxFactory } from '@/lib/sandbox/factory';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import type { SandboxState } from '@/types/sandbox';

declare global {
  var activeSandboxProvider: any;
  var sandboxProvider: ReturnType<typeof SandboxFactory.create> | null;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxCreationInProgress: boolean;
  var sandboxCreationPromise: Promise<any> | null;
  var sandboxState: SandboxState;
}

export async function POST() {
  console.log('[kill-sandbox] Starting sandbox cleanup...');
  
  const results = {
    providerTerminated: false,
    managerCleanedUp: false,
    stateCleared: false,
    errors: [] as string[],
  };

  // Step 1: Wait for any in-progress creation to complete first
  if (global.sandboxCreationInProgress && global.sandboxCreationPromise) {
    console.log('[kill-sandbox] Waiting for in-progress sandbox creation...');
    try {
      await Promise.race([
        global.sandboxCreationPromise,
        new Promise(resolve => setTimeout(resolve, 5000)) // Max 5s wait
      ]);
    } catch {
      // Ignore errors, we're cleaning up anyway
    }
  }

  // Step 2: Terminate sandbox via provider
  const provider = global.activeSandboxProvider || global.sandboxProvider;
  if (provider) {
    try {
      // Give it a timeout
      await Promise.race([
        provider.terminate(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Terminate timeout')), 10000))
      ]);
      results.providerTerminated = true;
      console.log('[kill-sandbox] Provider terminated successfully');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[kill-sandbox] Provider termination error:', errorMsg);
      results.errors.push(`Provider: ${errorMsg}`);
    }
  }

  // Step 3: Clean up via sandbox manager
  try {
    await sandboxManager.terminateAll();
    results.managerCleanedUp = true;
    console.log('[kill-sandbox] Sandbox manager cleaned up');
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[kill-sandbox] Manager cleanup error:', errorMsg);
    results.errors.push(`Manager: ${errorMsg}`);
  }

  // Step 4: Clear ALL sandbox-related global variables
  global.activeSandboxProvider = null;
  global.sandboxProvider = null;
  global.sandboxData = null;
  // Reset sandboxState to empty state (can't be null due to type constraint)
  global.sandboxState = {
    fileCache: { files: {}, lastSync: 0, sandboxId: '' },
    sandbox: null as any,
    sandboxData: null as any
  };
  global.sandboxCreationInProgress = false;
  global.sandboxCreationPromise = null;
  
  if (global.existingFiles) {
    global.existingFiles.clear();
  }
  
  results.stateCleared = true;
  console.log('[kill-sandbox] All sandbox state cleared');
  
  return NextResponse.json({
    success: true,
    sandboxKilled: results.providerTerminated || results.managerCleanedUp,
    message: 'Sandbox cleaned up successfully',
    details: results
  });
}