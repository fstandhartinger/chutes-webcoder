import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth';

type GithubRepo = {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  url: string;
  defaultBranch: string;
  private: boolean;
};

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

export async function GET() {
  try {
    const { token, error } = await getGithubToken();
    if (!token) {
      return NextResponse.json({ success: false, error: error || 'GitHub connection required' }, { status: 401 });
    }

    const params = new URLSearchParams({
      per_page: '100',
      sort: 'updated',
      affiliation: 'owner,collaborator,organization_member'
    });
    const response = await fetch(`https://api.github.com/user/repos?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, error: text || `GitHub repo fetch failed (${response.status})` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const repos: GithubRepo[] = Array.isArray(data)
      ? data.map((repo: any) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          owner: repo.owner?.login,
          url: repo.html_url,
          defaultBranch: repo.default_branch,
          private: Boolean(repo.private)
        }))
      : [];

    return NextResponse.json({ success: true, repos });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'GitHub repo fetch failed' },
      { status: 500 }
    );
  }
}
