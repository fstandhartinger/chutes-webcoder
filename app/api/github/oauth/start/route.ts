import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

const STATE_COOKIE = 'github_oauth_state';

function getAppBaseUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL ||
    `https://${request.headers.get('host') || 'chutes-webcoder.onrender.com'}`;
}

export async function GET(request: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    const appBaseUrl = getAppBaseUrl(request);
    return NextResponse.redirect(
      new URL('/?oauthError=GitHub+OAuth+not+configured', appBaseUrl)
    );
  }

  const appBaseUrl = getAppBaseUrl(request);
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI || `${appBaseUrl}/api/github/oauth/callback`;
  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/';
  const state = crypto.randomBytes(16).toString('base64url');
  const scope = process.env.GITHUB_OAUTH_SCOPE || 'repo read:user user:email';

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, JSON.stringify({ state, returnTo, createdAt: Date.now() }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
  });

  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}
