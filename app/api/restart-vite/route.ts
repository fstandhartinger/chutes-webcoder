import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { readProjectState } from '@/lib/project-state';

// Per-sandbox restart tracking for session isolation
const sandboxRestartState = new Map<string, { lastRestart: number; inProgress: boolean }>();
const RESTART_COOLDOWN_MS = 5000; // 5 second cooldown between restarts

async function safeJson(request: NextRequest): Promise<Record<string, any>> {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function resolveSandboxId(request: NextRequest, body: Record<string, any>): string | null {
  return (
    body?.sandboxId ||
    request.nextUrl.searchParams.get('sandboxId') ||
    request.cookies.get('sandySandboxId')?.value ||
    request.headers.get('x-sandbox-id') ||
    null
  );
}

export async function POST(request: NextRequest) {
  let sandboxId: string | null = null;
  try {
    const body = await safeJson(request);
    sandboxId = resolveSandboxId(request, body);

    // sandboxId is REQUIRED for session isolation
    if (!sandboxId) {
      return NextResponse.json({
        success: false,
        error: 'sandboxId is required for session isolation'
      }, { status: 400 });
    }

    // Get provider by explicit sandboxId (attempt restore if missing)
    let provider = sandboxManager.getProvider(sandboxId);
    if (!provider) {
      try {
        provider = await sandboxManager.getOrCreateProvider(sandboxId);
      } catch {
        provider = null;
      }
    }

    if (!provider || !provider.getSandboxInfo?.()) {
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
    
    const projectState = await readProjectState(provider, sandboxId).catch(() => null);
    const devServer = projectState?.devServer;

    if (devServer?.command) {
      const match = devServer.processMatch || 'vite';
      const workdir = provider.getSandboxInfo?.()?.workdir || '/workspace';
      console.log(`[restart-vite] Restarting dev server with command: ${devServer.command}`);

      try {
        await provider.runCommand(`pkill -f "${match}" || true`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch {
        console.log('[restart-vite] No existing dev server processes found');
      }

      try {
        await provider.runCommand('bash -c "echo \'{\\"errors\\": [], \\"lastChecked\\": '+ Date.now() +'}\' > /tmp/vite-errors.json"');
      } catch {
        // Ignore if this fails
      }

      const safeCommand = devServer.command.replace(/"/g, '\\"');
      await provider.runCommand(`sh -c "cd ${workdir} && nohup ${safeCommand} > /tmp/devserver.log 2>&1 &"`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else if (typeof provider.restartViteServer === 'function') {
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
    if (sandboxId) {
      const s = sandboxRestartState.get(sandboxId);
      if (s) s.inProgress = false;
    }

    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
