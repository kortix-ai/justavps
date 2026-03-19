/**
 * V1 API router — mounts all v1 route modules.
 * Import this once in app.ts to register all v1 endpoints.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { machinesApp } from './machines';
import { imagesApp } from './images';
import { sshKeysApp } from './ssh-keys';
import { apiKeysApp } from './api-keys';
import { serverTypesApp } from './server-types';
import { accountApp } from './account';
import { internalApp } from './internal';
import { sseApp } from './sse';
import { webhooksApp } from './webhooks';
import { stripeWebhooksApp } from './stripe-webhooks';
import { toolboxApp } from './toolbox';
import { importKortixApp } from './import-kortix';

export const v1 = new OpenAPIHono();

v1.route('/machines', machinesApp);
v1.route('/images', imagesApp);
v1.route('/ssh-keys', sshKeysApp);
v1.route('/api-keys', apiKeysApp);
v1.route('/server-types', serverTypesApp);
v1.route('/account', accountApp);
v1.route('/internal', internalApp);
v1.route('/machines', sseApp); // SSE status stream mounted under /machines/:id/status/stream
v1.route('/machines', toolboxApp); // Toolbox FS + Process API under /machines/:id/toolbox/*
v1.route('/webhooks', webhooksApp);
v1.route('/stripe/webhooks', stripeWebhooksApp);
v1.route('/', importKortixApp);
