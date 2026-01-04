import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSession,
  updateSessionTokens,
  refreshAccessToken,
  tokensNeedRefresh,
  SESSION_COOKIE_NAME,
} from '@/lib/auth';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    
    if (!sessionCookie) {
      return NextResponse.json({ user: null });
    }
    
    const session = getSession(sessionCookie.value);
    
    if (!session) {
      // Cookie exists but session data is invalid - clear cookie
      cookieStore.delete(SESSION_COOKIE_NAME);
      return NextResponse.json({ user: null });
    }
    
    // Check if tokens need refresh
    if (tokensNeedRefresh(session.tokens) && session.tokens.refreshToken) {
      try {
        console.log('[auth/me] Refreshing tokens...');
        const newTokens = await refreshAccessToken(session.tokens.refreshToken);
        // Update session with new tokens and set updated cookie
        const newCookieValue = updateSessionTokens(sessionCookie.value, newTokens);
        cookieStore.set(SESSION_COOKIE_NAME, newCookieValue, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7, // 7 days
          path: '/',
        });
        session.tokens = newTokens;
      } catch (e) {
        console.error('[auth/me] Token refresh failed:', e);
        // Token refresh failed - session is invalid
        cookieStore.delete(SESSION_COOKIE_NAME);
        return NextResponse.json({ user: null });
      }
    }
    
    // Return user info (without sensitive token data)
    return NextResponse.json({
      user: {
        id: session.user.sub,
        username: session.user.username,
        createdAt: session.user.created_at,
      },
      // Include info about whether user has chutes:invoke scope
      hasInvokeScope: true, // We always request this scope
      connections: {
        github: Boolean(session.oauth?.github?.accessToken),
        netlify: Boolean(session.oauth?.netlify?.accessToken),
      },
    });
  } catch (error) {
    console.error('[auth/me] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get user info' },
      { status: 500 }
    );
  }
}























