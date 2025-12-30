import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { resolveSandboxUrls } from '@/lib/server/sandbox-preview';

function resolveSandboxId(request: NextRequest): string | null {
  return (
    request.nextUrl.searchParams.get('sandboxId') ||
    request.nextUrl.searchParams.get('project') ||
    request.cookies.get('sandySandboxId')?.value ||
    request.headers.get('x-sandbox-id')
  );
}

export async function GET(request: NextRequest) {
  try {
    // Get sandboxId from query parameter or sandbox cookie (required for session isolation)
    const sandboxId = resolveSandboxId(request);

    if (!sandboxId) {
      return NextResponse.json({
        success: false,
        active: false,
        healthy: false,
        error: 'sandboxId query parameter is required for session isolation',
        message: 'No sandbox specified'
      });
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
    const sandboxExists = !!provider?.getSandboxInfo?.();

    let sandboxHealthy = false;
    let sandboxInfo = null;

    if (sandboxExists && provider) {
      try {
        // Check if sandbox is healthy by getting its info
        const providerInfo = provider.getSandboxInfo();
        sandboxHealthy = !!providerInfo;

        const resolvedUrls = providerInfo ? resolveSandboxUrls(providerInfo) : null;
        const previewUrl = resolvedUrls?.previewUrl || providerInfo?.url;
        const sandboxUrl = resolvedUrls?.sandboxUrl || providerInfo?.url;
        const providerName = providerInfo?.provider;

        sandboxInfo = {
          sandboxId: providerInfo?.sandboxId || sandboxId,
          url: previewUrl,
          sandboxUrl,
          provider: providerName,
          lastHealthCheck: new Date().toISOString()
        };
      } catch (error) {
        console.error('[sandbox-status] Health check failed:', error);
        sandboxHealthy = false;
      }
    }

    return NextResponse.json({
      success: true,
      active: sandboxExists,
      healthy: sandboxHealthy,
      sandboxData: sandboxInfo,
      message: sandboxHealthy
        ? 'Sandbox is active and healthy'
        : sandboxExists
          ? 'Sandbox exists but is not responding'
          : `Sandbox ${sandboxId} not found`
    });

  } catch (error) {
    console.error('[sandbox-status] Error:', error);
    return NextResponse.json({
      success: false,
      active: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
