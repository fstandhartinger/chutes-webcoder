import { NextRequest } from 'next/server';

import { proxySandyRequest } from '@/lib/server/sandy-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getProxyPath(request: NextRequest, sandboxId: string): string {
  const prefix = `/api/sandy-proxy/${sandboxId}`;
  let pathname = request.nextUrl.pathname;
  if (pathname.startsWith(prefix)) {
    pathname = pathname.slice(prefix.length);
  }
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }
  return `${pathname}${request.nextUrl.search}`;
}

type RouteContext = {
  params: Promise<{ sandboxId: string; path?: string[] }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const { sandboxId } = await context.params;
  const path = getProxyPath(request, sandboxId);
  return proxySandyRequest(request, sandboxId, path);
}

export async function HEAD(
  request: NextRequest,
  context: RouteContext
) {
  const { sandboxId } = await context.params;
  const path = getProxyPath(request, sandboxId);
  return proxySandyRequest(request, sandboxId, path);
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const { sandboxId } = await context.params;
  const path = getProxyPath(request, sandboxId);
  return proxySandyRequest(request, sandboxId, path);
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const { sandboxId } = await context.params;
  const path = getProxyPath(request, sandboxId);
  return proxySandyRequest(request, sandboxId, path);
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { sandboxId } = await context.params;
  const path = getProxyPath(request, sandboxId);
  return proxySandyRequest(request, sandboxId, path);
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const { sandboxId } = await context.params;
  const path = getProxyPath(request, sandboxId);
  return proxySandyRequest(request, sandboxId, path);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
