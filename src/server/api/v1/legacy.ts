import { OpenAPIHono } from '@hono/zod-openapi';

import { config } from '@/server/lib/config';
import { machinesApp } from '@/server/api/v1/legacy/machines';
import { imagesApp } from '@/server/api/v1/legacy/images';
import { sshKeysApp } from '@/server/api/v1/legacy/ssh-keys';
import { apiKeysApp } from '@/server/api/v1/legacy/api-keys';
import { serverTypesApp } from '@/server/api/v1/legacy/server-types';
import { accountApp } from '@/server/api/v1/legacy/account';
import { internalApp } from '@/server/api/v1/internal';
import { sseApp } from '@/server/api/v1/legacy/sse';
import { webhooksApp } from '@/server/api/v1/legacy/webhooks';
import { stripeWebhooksApp } from '@/server/api/v1/internal/stripe-webhooks';
import { toolboxApp } from '@/server/api/v1/legacy/toolbox';
import { importKortixApp } from '@/server/api/v1/legacy/import-kortix';
import { proxyTokensApp } from '@/server/api/v1/legacy/proxy-tokens';
import { proxyApp } from '@/server/routes/v1/proxy';
import { adminRoutingApp } from '@/server/api/v1/internal/admin-routing';
import { adminMachinesApp } from '@/server/api/v1/internal/admin-machines';

export const v1 = new OpenAPIHono();

if (config.LEGACY_PLATFORM_PROXY_ENABLED) {
  console.warn('[V1] LEGACY_PLATFORM_PROXY_ENABLED=true — direct platform proxy route remains mounted under /api/v1/machines/:machineId/proxy/:port/*');
  v1.route('/machines', proxyApp);
}
v1.route('/machines', machinesApp);
v1.route('/images', imagesApp);
v1.route('/ssh-keys', sshKeysApp);
v1.route('/api-keys', apiKeysApp);
v1.route('/proxy-tokens', proxyTokensApp);
v1.route('/server-types', serverTypesApp);
v1.route('/account', accountApp);
v1.route('/admin/routing', adminRoutingApp);
v1.route('/admin/machines', adminMachinesApp);
v1.route('/internal', internalApp);
v1.route('/sse', sseApp);
v1.route('/webhooks', webhooksApp);
v1.route('/stripe/webhooks', stripeWebhooksApp);
v1.route('/toolbox', toolboxApp);
v1.route('/import', importKortixApp);
