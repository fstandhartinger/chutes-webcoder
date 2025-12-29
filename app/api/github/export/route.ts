import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { readProjectState, writeProjectState } from '@/lib/project-state';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function getProvider(sandboxId: string) {
  const existing = sandboxManager.getProvider(sandboxId);
  if (existing) return existing;
  const provider = await sandboxManager.getOrCreateProvider(sandboxId);
  if (provider?.getSandboxInfo?.()) return provider;
  return null;
}

async function getGithubUser(): Promise<{ login: string; name?: string; email?: string }> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'chutes-webcoder'
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub user lookup failed (${response.status})`);
  }
  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    if (!GITHUB_TOKEN) {
      return NextResponse.json({ success: false, error: 'GITHUB_TOKEN is not configured' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const sandboxId = body?.sandboxId as string | undefined;
    const repoName = body?.repoName as string | undefined;
    const owner = body?.owner as string | undefined;
    const isPrivate = Boolean(body?.private);

    if (!sandboxId || !repoName) {
      return NextResponse.json({ success: false, error: 'sandboxId and repoName are required' }, { status: 400 });
    }

    const provider = await getProvider(sandboxId);
    if (!provider) {
      return NextResponse.json({ success: false, error: `Sandbox ${sandboxId} not found` }, { status: 404 });
    }

    const user = await getGithubUser();
    const targetOwner = owner || user.login;

    const createUrl = owner
      ? `https://api.github.com/orgs/${owner}/repos`
      : 'https://api.github.com/user/repos';

    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'chutes-webcoder',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: repoName,
        private: isPrivate
      })
    });

    if (!createResponse.ok) {
      const text = await createResponse.text();
      return NextResponse.json({ success: false, error: text || `GitHub repo creation failed (${createResponse.status})` }, { status: 500 });
    }

    const repoData = await createResponse.json();
    const cloneUrl = repoData.clone_url as string;
    const htmlUrl = repoData.html_url as string;

    const authToken = encodeURIComponent(GITHUB_TOKEN);
    const authUrl = cloneUrl.replace('https://', `https://x-access-token:${authToken}@`);

    await provider.runCommand('git config --global init.defaultBranch main || true');
    await provider.runCommand('git init');
    await provider.runCommand(`git config user.name "${user.name || user.login}"`);
    await provider.runCommand(`git config user.email "${user.email || `${user.login}@users.noreply.github.com`}"`);
    await provider.runCommand('git add -A');
    await provider.runCommand('git commit --allow-empty -m "Initial commit"');
    await provider.runCommand('git branch -M main');
    await provider.runCommand('git remote remove origin || true');
    await provider.runCommand(`git remote add origin "${authUrl}"`);
    const pushResult = await provider.runCommand('git push -u origin main');
    if (pushResult.exitCode !== 0) {
      return NextResponse.json({ success: false, error: pushResult.stderr || pushResult.stdout || 'Git push failed' }, { status: 500 });
    }
    await provider.runCommand(`git remote set-url origin "${cloneUrl}"`);

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
        repo: repoName,
        owner: targetOwner,
        url: htmlUrl,
        branch: 'main',
        lastSync: new Date().toISOString()
      },
      conversationContext: {
        ...conversationContext,
        currentProject: `${targetOwner}/${repoName}`
      }
    };
    await writeProjectState(provider, sandboxId, nextState);

    return NextResponse.json({
      success: true,
      repo: nextState.github
    });
  } catch (error) {
    console.error('[github-export] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
