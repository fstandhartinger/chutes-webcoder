import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSession,
  SESSION_COOKIE_NAME,
  updateSessionOAuth,
} from '@/lib/auth';

const STATE_COOKIE = 'github_oauth_state';

function getAppBaseUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL ||
    `https://${request.headers.get('host') || 'chutes-webcoder.onrender.com'}`;
}

export async function GET(request: NextRequest) {
  const appBaseUrl = getAppBaseUrl(request);
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      return NextResponse.redirect(
        new URL(`/?oauthError=${encodeURIComponent(errorDescription || error)}`, appBaseUrl)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/?oauthError=Missing+code+or+state', appBaseUrl)
      );
    }

    const cookieStore = await cookies();
    const stateCookie = cookieStore.get(STATE_COOKIE);
    if (!stateCookie) {
      return NextResponse.redirect(
        new URL('/?oauthError=GitHub+auth+state+expired', appBaseUrl)
      );
    }

    let storedState: { state: string; returnTo?: string };
    try {
      storedState = JSON.parse(stateCookie.value);
    } catch {
      return NextResponse.redirect(
        new URL('/?oauthError=Invalid+GitHub+auth+state', appBaseUrl)
      );
    }

    if (storedState.state !== state) {
      return NextResponse.redirect(
        new URL('/?oauthError=GitHub+state+mismatch', appBaseUrl)
      );
    }

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI || `${appBaseUrl}/api/github/oauth/callback`;

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        new URL('/?oauthError=GitHub+OAuth+not+configured', appBaseUrl)
      );
    }

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      return NextResponse.redirect(
        new URL(`/?oauthError=${encodeURIComponent(text || 'GitHub token exchange failed')}`, appBaseUrl)
      );
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      return NextResponse.redirect(
        new URL(`/?oauthError=${encodeURIComponent(tokenData.error || 'GitHub token missing')}`, appBaseUrl)
      );
    }

    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (!sessionCookie) {
      return NextResponse.redirect(
        new URL('/?oauthError=Login+required+to+connect+GitHub', appBaseUrl)
      );
    }

    const session = getSession(sessionCookie.value);
    if (!session) {
      cookieStore.delete(SESSION_COOKIE_NAME);
      return NextResponse.redirect(
        new URL('/?oauthError=Session+expired', appBaseUrl)
      );
    }

    const updatedCookie = updateSessionOAuth(sessionCookie.value, 'github', {
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type,
      scope: tokenData.scope,
      createdAt: Date.now(),
    });

    cookieStore.set(SESSION_COOKIE_NAME, updatedCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    cookieStore.delete(STATE_COOKIE);

    const returnTo = storedState.returnTo || '/';
    const redirectUrl = new URL(returnTo, appBaseUrl);
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('[github-oauth] Error:', error);
    return NextResponse.redirect(
      new URL(`/?oauthError=${encodeURIComponent((error as Error).message)}`, appBaseUrl)
    );
  }
}
