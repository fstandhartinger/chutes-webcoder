import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

// Per-sandbox restart tracking for session isolation
const sandboxRestartState = new Map<string, { lastRestart: number; inProgress: boolean }>();
const RESTART_COOLDOWN_MS = 5000; // 5 second cooldown between restarts

export async function POST(request: NextRequest) {
  try {
    const { sandboxId } = await request.json();

    // sandboxId is REQUIRED for session isolation
    if (!sandboxId) {
      return NextResponse.json({
        success: false,
        error: 'sandboxId is required for session isolation'
      }, { status: 400 });
    }

    // Get provider by explicit sandboxId (no global fallback)
    const provider = sandboxManager.getProvider(sandboxId);

    if (!provider) {
      return NextResponse.json({
        success: false,
        error: `Sandbox ${sandboxId} not found`
      }, { status: 404 });
    }

    // Get or create per-sandbox state
    let state = sandboxRestartState.get(sandboxId);
    if (!state) {
      state = { lastRestart: 0, inProgress: false };
      sandboxRestartState.set(sandboxId, state);
    }
    
    // Check if restart is already in progress (per-sandbox)
    if (state.inProgress) {
      console.log(`[restart-vite] Vite restart already in progress for ${sandboxId}, skipping...`);
      return NextResponse.json({
        success: true,
        message: 'Vite restart already in progress'
      });
    }

    // Check cooldown (per-sandbox)
    const now = Date.now();
    if (state.lastRestart && (now - state.lastRestart) < RESTART_COOLDOWN_MS) {
      const remainingTime = Math.ceil((RESTART_COOLDOWN_MS - (now - state.lastRestart)) / 1000);
      console.log(`[restart-vite] Cooldown active for ${sandboxId}, ${remainingTime}s remaining`);
      return NextResponse.json({
        success: true,
        message: `Vite was recently restarted, cooldown active (${remainingTime}s remaining)`
      });
    }

    // Set the restart flag (per-sandbox)
    state.inProgress = true;
    
    console.log('[restart-vite] Using provider method to restart Vite...');
    
    // Use the provider's restartViteServer method if available
    if (typeof provider.restartViteServer === 'function') {
      await provider.restartViteServer();
      console.log('[restart-vite] Vite restarted via provider method');
    } else {
      // Fallback to manual restart using provider's runCommand
      console.log('[restart-vite] Fallback to manual Vite restart...');
      
      // Kill existing Vite processes
      try {
        await provider.runCommand('pkill -f vite');
        console.log('[restart-vite] Killed existing Vite processes');
        
        // Wait a moment for processes to terminate
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch {
        console.log('[restart-vite] No existing Vite processes found');
      }
      
      // Clear any error tracking files
      try {
        await provider.runCommand('bash -c "echo \'{\\"errors\\": [], \\"lastChecked\\": '+ Date.now() +'}\' > /tmp/vite-errors.json"');
      } catch {
        // Ignore if this fails
      }
      
      // Start Vite dev server in background
      await provider.runCommand('sh -c "nohup npm run dev > /tmp/vite.log 2>&1 &"');
      console.log('[restart-vite] Vite dev server restarted');
      
      // Wait for Vite to start up
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Update per-sandbox state
    state.lastRestart = Date.now();
    state.inProgress = false;

    return NextResponse.json({
      success: true,
      message: `Vite restarted successfully for sandbox ${sandboxId}`
    });

  } catch (error) {
    console.error('[restart-vite] Error:', error);

    // Clear the restart flag on error (if we have sandboxId and state)
    const { sandboxId: sId } = await request.json().catch(() => ({ sandboxId: null }));
    if (sId) {
      const s = sandboxRestartState.get(sId);
      if (s) s.inProgress = false;
    }

    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
