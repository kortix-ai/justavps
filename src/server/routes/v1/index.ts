/**
 * V1 API router — mounts all v1 route modules.
 * Import this once in app.ts to register all v1 endpoints.
 */

import { Hono } from 'hono';
import { machinesApp } from './machines';
import { snapshotsApp } from './snapshots';
import { sshKeysApp } from './ssh-keys';
import { apiKeysApp } from './api-keys';
import { serverTypesApp } from './server-types';
import { accountApp } from './account';
import { internalApp } from './internal';
import { sseApp } from './sse';

export const v1 = new Hono();

v1.route('/machines', machinesApp);
v1.route('/snapshots', snapshotsApp);
v1.route('/ssh-keys', sshKeysApp);
v1.route('/api-keys', apiKeysApp);
v1.route('/server-types', serverTypesApp);
v1.route('/account', accountApp);
v1.route('/internal', internalApp);
v1.route('/machines', sseApp);
