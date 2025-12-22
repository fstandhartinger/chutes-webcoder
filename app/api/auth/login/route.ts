import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  generateState,
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizationUrl,
  AUTH_STATE_COOKIE_NAME,
  AuthState,
} from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const returnTo = searchParams.get('returnTo') || '/';
    const pendingRequestType = searchParams.get('pendingRequestType');
    const pendingRequestPayload = searchParams.get('pendingRequestPayload');
    
    // Generate PKCE values
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    
    // Build auth state to store in cookie
    const authState: AuthState = {
      state,
      codeVerifier,
      returnTo,
    };
    
    // If there's a pending request, include it in the state
    if (pendingRequestType && pendingRequestPayload) {
      try {
        authState.pendingRequest = {
          type: pendingRequestType,
          payload: JSON.parse(decodeURIComponent(pendingRequestPayload)),
        };
      } catch (e) {
        console.error('[auth/login] Failed to parse pending request payload:', e);
      }
    }
    
    // Store auth state in httpOnly cookie
    const cookieStore = await cookies();
    cookieStore.set(AUTH_STATE_COOKIE_NAME, JSON.stringify(authState), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    });
    
    // Build authorization URL and redirect
    const authUrl = buildAuthorizationUrl(state, codeChallenge);
    
    console.log('[auth/login] Redirecting to Chutes IDP:', authUrl);
    
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[auth/login] Error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate login' },
      { status: 500 }
    );
  }
}
