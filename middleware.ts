import { NextRequest, NextResponse } from 'next/server';

const PROXY_PREFIXES = [
  '/@vite/',
  '/@id/',
  '/@fs/',
  '/src/',
  '/node_modules/',
  '/assets/'
];

const PROXY_EXACT = new Set([
  '/@react-refresh',
  '/vite.svg',
  '/favicon.ico'
]);

function shouldProxy(pathname: string): boolean {
  if (PROXY_EXACT.has(pathname)) {
    return true;
  }
  return PROXY_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const sandboxId = request.cookies.get('sandySandboxId')?.value;
  if (!sandboxId) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  if (!shouldProxy(pathname)) {
    return NextResponse.next();
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/api/sandy-proxy/${sandboxId}${pathname}`;
  return NextResponse.rewrite(rewriteUrl);
}

export const config = {
  matcher: [
    '/@vite/:path*',
    '/@id/:path*',
    '/@fs/:path*',
    '/src/:path*',
    '/node_modules/:path*',
    '/assets/:path*',
    '/@react-refresh',
    '/@react-refresh/:path*',
    '/vite.svg',
    '/favicon.ico'
  ]
};
