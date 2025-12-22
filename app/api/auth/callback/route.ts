import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  exchangeCodeForTokens,
  getUserInfo,
  createSession,
  AUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  AuthState,
} from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');
    
    // Handle OAuth errors
    if (error) {
      console.error('[auth/callback] OAuth error:', error, errorDescription);
      return NextResponse.redirect(
        new URL(`/?authError=${encodeURIComponent(errorDescription || error)}`, request.url)
      );
    }
    
    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/?authError=Missing+code+or+state', request.url)
      );
    }
    
    // Get auth state from cookie
    const cookieStore = await cookies();
    const authStateCookie = cookieStore.get(AUTH_STATE_COOKIE_NAME);
    
    if (!authStateCookie) {
      return NextResponse.redirect(
        new URL('/?authError=Auth+state+expired', request.url)
      );
    }
    
    let authState: AuthState;
    try {
      authState = JSON.parse(authStateCookie.value);
    } catch (e) {
      return NextResponse.redirect(
        new URL('/?authError=Invalid+auth+state', request.url)
      );
    }
    
    // Verify state matches
    if (authState.state !== state) {
      return NextResponse.redirect(
        new URL('/?authError=State+mismatch', request.url)
      );
    }
    
    // Exchange code for tokens (codeVerifier is optional - PKCE disabled due to Chutes IDP bug)
    console.log('[auth/callback] Exchanging code for tokens...');
    const tokens = await exchangeCodeForTokens(code, authState.codeVerifier);
    
    // Get user info
    console.log('[auth/callback] Getting user info...');
    const user = await getUserInfo(tokens.accessToken);
    
    console.log('[auth/callback] Authenticated user:', user.username);
    
    // Create session
    const sessionId = createSession({
      user,
      tokens,
      createdAt: Date.now(),
    });
    
    // Clear auth state cookie and set session cookie
    cookieStore.delete(AUTH_STATE_COOKIE_NAME);
    cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });
    
    // Determine redirect URL
    let redirectUrl = authState.returnTo || '/';
    
    // If there was a pending request, add it as a query param so the client can resume
    if (authState.pendingRequest) {
      const pendingParam = encodeURIComponent(JSON.stringify(authState.pendingRequest));
      const separator = redirectUrl.includes('?') ? '&' : '?';
      redirectUrl = `${redirectUrl}${separator}pendingRequest=${pendingParam}`;
    }
    
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  } catch (error) {
    console.error('[auth/callback] Error:', error);
    return NextResponse.redirect(
      new URL(`/?authError=${encodeURIComponent((error as Error).message)}`, request.url)
    );
  }
}
