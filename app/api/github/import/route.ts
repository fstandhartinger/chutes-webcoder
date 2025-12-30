import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { readProjectState, writeProjectState } from '@/lib/project-state';
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth';

type ParsedRepo = { owner: string; repo: string };

function parseRepo(input: string): ParsedRepo | null {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/$/, '');
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/github\.com[:/](.+?)\/([^/]+)$/i);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  const shortMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  return null;
}

function sanitizeRef(input?: string | null) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) return null;
  return trimmed;
}

async function getGithubToken() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return { token: null, error: 'Not authenticated' };
  }
  const session = getSession(sessionCookie.value);
  if (!session) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    return { token: null, error: 'Invalid session' };
  }
  const token = session.oauth?.github?.accessToken;
  if (!token) {
    return { token: null, error: 'GitHub not connected' };
  }
  return { token, error: null };
}

async function getProvider(sandboxId: string) {
  const existing = sandboxManager.getProvider(sandboxId);
  if (existing) return existing;
  const provider = await sandboxManager.getOrCreateProvider(sandboxId);
  if (provider?.getSandboxInfo?.()) return provider;
  return null;
}

async function detectPackageManager(provider: any, packageJson: any) {
  const managerFromPackage = typeof packageJson?.packageManager === 'string'
    ? packageJson.packageManager.split('@')[0]
    : null;

  const lockChecks = await Promise.all([
    provider.runCommand('test -f /workspace/pnpm-lock.yaml && echo "pnpm" || true'),
    provider.runCommand('test -f /workspace/yarn.lock && echo "yarn" || true'),
  ]);

  const lockHint = lockChecks.map((res: any) => String(res.stdout || '').trim()).find(Boolean);
  const manager = managerFromPackage || lockHint || 'npm';

  if (manager === 'pnpm' || manager === 'yarn') {
    await provider.runCommand('corepack enable || true');
  }

  return manager === 'pnpm' || manager === 'yarn' ? manager : 'npm';
}

function detectDevServer(packageJson: any, manager: string) {
  const scripts = packageJson?.scripts || {};
  const dependencies = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
  const hasVite = Boolean(dependencies.vite);
  const hasNext = Boolean(dependencies.next);
  const hasReactScripts = Boolean(dependencies['react-scripts']);

  const pm = manager;
  if (hasVite) {
    return { command: `${pm} run dev -- --host 0.0.0.0 --port 5173`, port: 5173, processMatch: 'vite' };
  }
  if (hasNext) {
    return { command: `PORT=5173 HOST=0.0.0.0 ${pm} run dev`, port: 5173, processMatch: 'next' };
  }
  if (hasReactScripts) {
    return { command: `PORT=5173 HOST=0.0.0.0 ${pm} start`, port: 5173, processMatch: 'react-scripts' };
  }
  if (scripts.dev) {
    return { command: `PORT=5173 HOST=0.0.0.0 ${pm} run dev`, port: 5173, processMatch: 'node' };
  }
  if (scripts.start) {
    return { command: `PORT=5173 HOST=0.0.0.0 ${pm} run start`, port: 5173, processMatch: 'node' };
  }
  return { command: `PORT=5173 HOST=0.0.0.0 ${pm} run dev`, port: 5173, processMatch: 'node' };
}

export async function POST(request: NextRequest) {
  try {
    const { token: githubToken, error: authError } = await getGithubToken();
    if (!githubToken) {
      return NextResponse.json({ success: false, error: authError || 'GitHub connection required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const sandboxId = body?.sandboxId as string | undefined;
    const repoInput = body?.repoUrl || body?.repo;
    const branch = sanitizeRef(body?.branch);

    if (!sandboxId || !repoInput) {
      return NextResponse.json({ success: false, error: 'sandboxId and repoUrl are required' }, { status: 400 });
    }

    const parsed = parseRepo(repoInput);
    if (!parsed) {
      return NextResponse.json({ success: false, error: 'Invalid GitHub repo format' }, { status: 400 });
    }

    const provider = await getProvider(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    const safeBranch = branch ? `--branch ${branch}` : '';
    const authToken = encodeURIComponent(githubToken);
    const cloneUrl = `https://x-access-token:${authToken}@github.com/${parsed.owner}/${parsed.repo}.git`;

    await provider.runCommand('rm -rf /tmp/chutes-repo');
    const cloneResult = await provider.runCommand(`git clone --depth 1 ${safeBranch} "${cloneUrl}" /tmp/chutes-repo`);
    if (cloneResult.exitCode !== 0) {
      return NextResponse.json({ success: false, error: cloneResult.stderr || cloneResult.stdout || 'Git clone failed' }, { status: 500 });
    }

    await provider.runCommand('rm -rf /tmp/chutes-state');
    await provider.runCommand('if [ -d /workspace/.chutes ]; then cp -a /workspace/.chutes /tmp/chutes-state; fi');
    await provider.runCommand('find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf {} +');
    const copyResult = await provider.runCommand('cp -a /tmp/chutes-repo/. /workspace/');
    if (copyResult.exitCode !== 0) {
      return NextResponse.json({ success: false, error: copyResult.stderr || copyResult.stdout || 'Failed to copy repo' }, { status: 500 });
    }
    await provider.runCommand('if [ -d /tmp/chutes-state ]; then rm -rf /workspace/.chutes && mv /tmp/chutes-state /workspace/.chutes; else mkdir -p /workspace/.chutes; fi');
    await provider.runCommand('rm -rf /tmp/chutes-repo');

    let packageJson: any = null;
    try {
      const packageRaw = await provider.readFile('package.json');
      packageJson = JSON.parse(packageRaw);
    } catch {
      packageJson = null;
    }

    let manager = 'npm';
    if (packageJson) {
      manager = await detectPackageManager(provider, packageJson);
      const installCmd = manager === 'pnpm'
        ? 'pnpm install'
        : manager === 'yarn'
          ? 'yarn install'
          : 'npm install --legacy-peer-deps';
      await provider.runCommand(installCmd);
    }

    const devServer = packageJson ? detectDevServer(packageJson, manager) : undefined;

    const state = await readProjectState(provider, sandboxId);
    const conversationContext = state.conversationContext || {
      scrapedWebsites: [],
      generatedComponents: [],
      appliedCode: [],
      currentProject: '',
      lastGeneratedCode: undefined
    };
    const nextState = {
      ...state,
      github: {
        repo: parsed.repo,
        owner: parsed.owner,
        url: `https://github.com/${parsed.owner}/${parsed.repo}`,
        branch: branch || 'main',
        lastSync: new Date().toISOString()
      },
      devServer: devServer || state.devServer,
      conversationContext: {
        ...conversationContext,
        currentProject: `${parsed.owner}/${parsed.repo}`
      }
    };

    await writeProjectState(provider, sandboxId, nextState);

    return NextResponse.json({
      success: true,
      repo: nextState.github,
      devServer: nextState.devServer
    });
  } catch (error) {
    console.error('[github-import] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
