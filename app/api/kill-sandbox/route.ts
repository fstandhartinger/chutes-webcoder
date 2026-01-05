import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

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

    console.log(`[kill-sandbox] Terminating sandbox: ${sandboxId}`);

    const results = {
      sandboxId,
      providerTerminated: false,
      errors: [] as string[],
    };

    // Get provider by explicit sandboxId (no global fallback)
    const provider = sandboxManager.getProvider(sandboxId);

    if (provider) {
      try {
        // Give it a timeout
        await Promise.race([
          sandboxManager.terminateSandbox(sandboxId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Terminate timeout')), 30000))
        ]);
        results.providerTerminated = true;
        console.log(`[kill-sandbox] Sandbox ${sandboxId} terminated successfully`);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[kill-sandbox] Termination error for ${sandboxId}:`, errorMsg);
        results.errors.push(errorMsg);
      }
    } else {
      console.log(`[kill-sandbox] Sandbox ${sandboxId} not found in manager`);
      results.errors.push('Sandbox not found');
    }

    // NOTE: No longer clearing global state - each session manages its own sandbox

    return NextResponse.json({
      success: results.providerTerminated,
      sandboxKilled: results.providerTerminated,
      message: results.providerTerminated
        ? `Sandbox ${sandboxId} terminated successfully`
        : `Sandbox ${sandboxId} not found or already terminated`,
      details: results
    });

  } catch (error) {
    console.error('[kill-sandbox] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
