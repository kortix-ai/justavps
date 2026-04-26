import { Hono } from 'hono';

import { handlers } from '@/server/auth/nextauth';
import { app as legacyApiApp } from '@/server/app';

import { registerWebApiRoutes } from './routes/web.js';

type NextRequestCompat = Request & {
  nextUrl?: URL;
};

function toNextRequestCompat(request: Request): never {
  const nextRequest = request as NextRequestCompat;
  if (!nextRequest.nextUrl) {
    Object.defineProperty(nextRequest, 'nextUrl', {
      value: new URL(request.url),
      configurable: true,
    });
  }
  return nextRequest as never;
}

export function createV1ApiApp() {
  const app = new Hono();

  registerWebApiRoutes(app);

  app.all('/api/auth/*', async (c) => {
    const request = toNextRequestCompat(c.req.raw);
    if (c.req.method === 'GET') return handlers.GET(request);
    if (c.req.method === 'POST') return handlers.POST(request);
    return c.text('Method Not Allowed', 405);
  });

  app.all('*', (c) => legacyApiApp.fetch(c.req.raw));

  return app;
}
