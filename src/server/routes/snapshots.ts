import { Hono } from 'hono';
import { apiGuard, type AuthVariables } from '../lib/api-guard';

export const snapshotsApp = new Hono<{ Variables: AuthVariables }>();
snapshotsApp.use('*', apiGuard);

snapshotsApp.get('/', async (c) => {
  return c.json({ snapshots: [] });
});
