import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, SESSION_COOKIE_NAME, updateSessionOAuth } from '@/lib/auth';

export async function POST() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return NextResponse.json({ success: true });
  }

  const session = getSession(sessionCookie.value);
  if (!session) {
    cookieStore.delete(SESSION_COOKIE_NAME);
    return NextResponse.json({ success: true });
  }

  const updatedCookie = updateSessionOAuth(sessionCookie.value, 'netlify', null);
  cookieStore.set(SESSION_COOKIE_NAME, updatedCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });

  return NextResponse.json({ success: true });
}
