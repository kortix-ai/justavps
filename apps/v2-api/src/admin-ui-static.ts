import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Context, Hono } from 'hono';

const ADMIN_UI_PREFIX = '/admin-ui';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveDistRoot(): string {
  // `apps/v2-api/src/admin-ui-static.ts` (tsx dev) and `apps/v2-api/dist/admin-ui-static.js` (prod)
  // both sit two levels above `apps/admin-web/dist`.
  const here = fileURLToPath(import.meta.url);
  const root = resolve(here, '..', '..', '..', 'admin-web', 'dist');
  return root;
}

function contentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  for (const [ext, type] of Object.entries(MIME_TYPES)) {
    if (lower.endsWith(ext)) return type;
  }
  return 'application/octet-stream';
}

function notFoundHtml(reason: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>JustAVPS V2 Admin · build missing</title>
    <style>
      body { background:#050509; color:#f6f7fb; font-family:-apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif; padding:48px; line-height:1.6; }
      code { background:rgba(255,255,255,0.05); padding:1px 6px; border-radius:6px; }
      h1 { letter-spacing:-0.04em; font-size:28px; }
      a { color:#22d3ee; }
    </style>
  </head>
  <body>
    <h1>JustAVPS V2 admin web build is missing</h1>
    <p>${reason}</p>
    <p>Build it with <code>pnpm --dir apps/admin-web build</code> (or <code>pnpm v2api:build</code>), then refresh.</p>
  </body>
</html>`;
}

function safeJoin(root: string, requested: string): string | null {
  // Trim leading slashes and normalize to prevent traversal.
  const cleaned = requested.replace(/^\/+/, '');
  const target = normalize(join(root, cleaned));
  if (!target.startsWith(root)) return null;
  return target;
}

export function registerAdminUi(app: Hono): { distRoot: string } {
  const distRoot = resolveDistRoot();
  const indexPath = join(distRoot, 'index.html');

  app.get(ADMIN_UI_PREFIX, async (c) => {
    return serveIndex(c, distRoot, indexPath);
  });

  app.get(`${ADMIN_UI_PREFIX}/`, async (c) => {
    return serveIndex(c, distRoot, indexPath);
  });

  app.get(`${ADMIN_UI_PREFIX}/*`, async (c) => {
    const path = c.req.path;
    const remainder = path.slice(ADMIN_UI_PREFIX.length); // includes leading "/"
    if (!remainder || remainder === '/') {
      return serveIndex(c, distRoot, indexPath);
    }

    const target = safeJoin(distRoot, remainder);
    if (!target) {
      return c.json({ error: true, message: 'Invalid admin-ui asset path' }, 400);
    }

    if (existsSync(target)) {
      try {
        const stat = statSync(target);
        if (stat.isFile()) {
          const data = await readFile(target);
          c.header('Content-Type', contentType(target));
          // Cache hashed assets aggressively, fall back to revalidate for index.html.
          if (/\.[a-f0-9]{8,}\./.test(target)) {
            c.header('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            c.header('Cache-Control', 'public, max-age=0, must-revalidate');
          }
          return c.body(data as unknown as ArrayBuffer);
        }
      } catch {
        // fall through to SPA fallback
      }
    }

    return serveIndex(c, distRoot, indexPath);
  });

  return { distRoot };
}

async function serveIndex(c: Context, distRoot: string, indexPath: string) {
  if (!existsSync(indexPath)) {
    c.header('Content-Type', 'text/html; charset=utf-8');
    return c.body(notFoundHtml(`No index.html found in <code>${distRoot}</code>.`), 503);
  }
  const data = await readFile(indexPath);
  c.header('Content-Type', 'text/html; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  return c.body(data as unknown as ArrayBuffer);
}
