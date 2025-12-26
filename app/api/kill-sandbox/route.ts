import { NextResponse } from 'next/server';
import { SandboxFactory } from '@/lib/sandbox/factory';

declare global {
  var activeSandboxProvider: any;
  var sandboxProvider: ReturnType<typeof SandboxFactory.create> | null;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxCreationInProgress: boolean;
  var sandboxCreationPromise: Promise<any> | null;
}

export async function POST() {
  try {
    console.log('[kill-sandbox] Stopping active sandbox...');

    let sandboxKilled = false;

    // Stop existing sandbox if any (check both variable names for compatibility)
    const provider = global.activeSandboxProvider || global.sandboxProvider;
    if (provider) {
      try {
        await provider.terminate();
        sandboxKilled = true;
        console.log('[kill-sandbox] Sandbox stopped successfully');
      } catch (e) {
        console.error('[kill-sandbox] Failed to stop sandbox:', e);
      }
    }
    
    // Clear ALL sandbox-related global variables
    global.activeSandboxProvider = null;
    global.sandboxProvider = null;
    global.sandboxData = null;
    global.sandboxCreationInProgress = false;
    global.sandboxCreationPromise = null;
    
    // Clear existing files tracking
    if (global.existingFiles) {
      global.existingFiles.clear();
    }
    
    console.log('[kill-sandbox] All sandbox state cleared');
    
    return NextResponse.json({
      success: true,
      sandboxKilled,
      message: 'Sandbox cleaned up successfully'
    });
    
  } catch (error) {
    console.error('[kill-sandbox] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message 
      }, 
      { status: 500 }
    );
  }
}