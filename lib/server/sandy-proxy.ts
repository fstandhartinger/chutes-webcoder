import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

const REQUEST_HEADER_BLOCKLIST = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'cookie',
  'authorization'
]);

const RESPONSE_HEADER_BLOCKLIST = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection'
]);

function getSandyBaseUrl(): string {
  const baseUrl = process.env.SANDY_BASE_URL;
  if (!baseUrl) {
    throw new Error('SANDY_BASE_URL is not configured');
  }
  return baseUrl.replace(/\/+$/, '');
}

function getSandyHostSuffix(): string {
  const rawSuffix = (process.env.SANDY_HOST_SUFFIX || process.env.NEXT_PUBLIC_SANDBOX_HOST_SUFFIX || '').trim();
  if (!rawSuffix) {
    throw new Error('SANDY_HOST_SUFFIX is not configured');
  }
  return rawSuffix.startsWith('.') ? rawSuffix : `.${rawSuffix}`;
}

function buildSandboxHost(sandboxId: string): string {
  return `${sandboxId}${getSandyHostSuffix()}`;
}

function filterRequestHeaders(headers: Headers): Headers {
  const filtered = new Headers();
  for (const [key, value] of headers.entries()) {
    if (REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase())) continue;
    filtered.set(key, value);
  }
  return filtered;
}

function filterResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers();
  for (const [key, value] of headers.entries()) {
    if (RESPONSE_HEADER_BLOCKLIST.has(key.toLowerCase())) continue;
    filtered.set(key, value);
  }
  return filtered;
}

export async function proxySandyRequest(
  request: NextRequest,
  sandboxId: string,
  pathWithSearch: string
): Promise<NextResponse> {
  const baseUrl = getSandyBaseUrl();
  const targetUrl = new URL(pathWithSearch, baseUrl).toString();
  const headers = filterRequestHeaders(request.headers);

  const sandboxHost = buildSandboxHost(sandboxId);
  headers.set('host', sandboxHost);
  headers.set('x-sandy-host', sandboxHost);
  headers.set('x-forwarded-host', sandboxHost);
  headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual'
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) {
      init.body = body;
    }
  }

  const upstreamResponse = await fetch(targetUrl, init);
  const responseHeaders = filterResponseHeaders(upstreamResponse.headers);
  responseHeaders.set('cache-control', 'no-store');

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders
  });
}
