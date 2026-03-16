import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../lib/middleware';

export const snapshotsApp = new Hono<{ Variables: AuthVariables }>();
snapshotsApp.use('*', authMiddleware);

snapshotsApp.get('/', async (c) => {
  return c.json({ snapshots: [] });
});
