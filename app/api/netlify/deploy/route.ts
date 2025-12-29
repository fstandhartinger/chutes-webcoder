import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { readProjectState, writeProjectState } from '@/lib/project-state';

const NETLIFY_API_TOKEN = process.env.NETLIFY_API_TOKEN;

async function getProvider(sandboxId: string) {
  const existing = sandboxManager.getProvider(sandboxId);
  if (existing) return existing;
  const provider = await sandboxManager.getOrCreateProvider(sandboxId);
  if (provider?.getSandboxInfo?.()) return provider;
  return null;
}

async function netlifyRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${NETLIFY_API_TOKEN}`,
      'User-Agent': 'chutes-webcoder',
      ...(options.headers || {})
    }
  });
  return response;
}

export async function POST(request: NextRequest) {
  try {
    if (!NETLIFY_API_TOKEN) {
      return NextResponse.json({ success: false, error: 'NETLIFY_API_TOKEN is not configured' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const sandboxId = body?.sandboxId as string | undefined;
    const siteName = body?.siteName as string | undefined;
    let siteId = body?.siteId as string | undefined;

    if (!sandboxId) {
      return NextResponse.json({ success: false, error: 'sandboxId is required' }, { status: 400 });
    }

    const provider = await getProvider(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    const buildResult = await provider.runCommand('npm run build');
    if (buildResult.exitCode !== 0) {
      return NextResponse.json({ success: false, error: buildResult.stderr || buildResult.stdout || 'Build failed' }, { status: 500 });
    }

    const distCheck = await provider.runCommand(
      'if [ -d /workspace/dist ]; then echo "dist"; elif [ -d /workspace/build ]; then echo "build"; else echo "none"; fi'
    );
    const outputDir = String(distCheck.stdout || '').trim();
    if (!outputDir || outputDir === 'none') {
      return NextResponse.json({ success: false, error: 'No build output directory found (dist/build)' }, { status: 500 });
    }

    const zipPath = '/tmp/netlify-deploy.zip';
    const zipResult = await provider.runCommand(
      `rm -f ${zipPath} && cd /workspace/${outputDir} && python3 -m zipfile -c ${zipPath} .`
    );
    if (zipResult.exitCode !== 0) {
      return NextResponse.json({ success: false, error: zipResult.stderr || zipResult.stdout || 'Failed to create zip' }, { status: 500 });
    }

    const base64Result = await provider.runCommand(`base64 ${zipPath}`);
    if (base64Result.exitCode !== 0) {
      return NextResponse.json({ success: false, error: base64Result.stderr || base64Result.stdout || 'Failed to read zip' }, { status: 500 });
    }
    const base64Payload = String(base64Result.stdout || '').replace(/\s+/g, '');
    const zipBuffer = Buffer.from(base64Payload, 'base64');

    if (!siteId) {
      const createResponse = await netlifyRequest('/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: siteName || `chutes-${sandboxId.slice(0, 8)}` })
      });

      if (!createResponse.ok) {
        const text = await createResponse.text();
        return NextResponse.json({ success: false, error: text || `Netlify site creation failed (${createResponse.status})` }, { status: 500 });
      }

      const siteData = await createResponse.json();
      siteId = siteData.id;
    }

    const deployResponse = await netlifyRequest(`/sites/${siteId}/deploys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: zipBuffer
    });

    if (!deployResponse.ok) {
      const text = await deployResponse.text();
      return NextResponse.json({ success: false, error: text || `Netlify deploy failed (${deployResponse.status})` }, { status: 500 });
    }

    const deployData = await deployResponse.json();
    const deployUrl = deployData.deploy_ssl_url || deployData.ssl_url || deployData.url;

    const state = await readProjectState(provider, sandboxId);
    const nextState = {
      ...state,
      netlify: {
        siteId,
        siteName: siteName || deployData.site_name,
        url: deployUrl,
        lastDeployAt: new Date().toISOString()
      }
    };
    await writeProjectState(provider, sandboxId, nextState);

    return NextResponse.json({
      success: true,
      siteId,
      url: deployUrl
    });
  } catch (error) {
    console.error('[netlify] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
