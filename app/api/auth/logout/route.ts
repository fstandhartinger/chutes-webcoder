import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSession,
  deleteSession,
  revokeToken,
  SESSION_COOKIE_NAME,
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    
    if (sessionCookie) {
      const session = getSession(sessionCookie.value);
      
      if (session) {
        // Revoke tokens (optional, but good practice)
        try {
          await revokeToken(session.tokens.accessToken);
          if (session.tokens.refreshToken) {
            await revokeToken(session.tokens.refreshToken);
          }
        } catch (e) {
          // Ignore revocation errors - token may already be expired
          console.warn('[auth/logout] Token revocation failed:', e);
        }
        
        // Delete session from store
        deleteSession(sessionCookie.value);
      }
      
      // Delete session cookie
      cookieStore.delete(SESSION_COOKIE_NAME);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[auth/logout] Error:', error);
    return NextResponse.json(
      { error: 'Failed to logout' },
      { status: 500 }
    );
  }
}

// Also support GET for simple logout links
export async function GET(request: NextRequest) {
  const response = await POST(request);
  
  // Redirect to home after logout
  return NextResponse.redirect(new URL('/', request.url));
}

