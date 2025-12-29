import { NextRequest } from 'next/server';

import { proxySandyRequest } from '@/lib/server/sandy-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handlePreview(
  request: NextRequest,
  sandboxId: string
) {
  const path = `/${request.nextUrl.search}`;
  const response = await proxySandyRequest(request, sandboxId, path);

  response.cookies.set({
    name: 'sandySandboxId',
    value: sandboxId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60
  });

  return response;
}

type RouteContext = {
  params: Promise<{ sandboxId: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const { sandboxId } = await context.params;
  return handlePreview(request, sandboxId);
}

export async function HEAD(
  request: NextRequest,
  context: RouteContext
) {
  const { sandboxId } = await context.params;
  return handlePreview(request, sandboxId);
}
