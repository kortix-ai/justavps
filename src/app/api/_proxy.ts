import type { NextRequest } from 'next/server';

const DEFAULT_V1_API_URL = 'http://localhost:4101';

function v1ApiBaseUrl() {
  return (process.env.V1_API_URL || DEFAULT_V1_API_URL).replace(/\/$/, '');
}

export async function proxyToV1Api(request: NextRequest) {
  const upstream = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, v1ApiBaseUrl());
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', request.headers.get('host') || request.nextUrl.host);
  headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    responseHeaders.delete('set-cookie');
    for (const cookie of setCookies) responseHeaders.append('set-cookie', cookie);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
