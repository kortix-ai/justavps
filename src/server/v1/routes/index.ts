import { OpenAPIHono } from '@hono/zod-openapi';

import { config } from "@/server/core/config";
import { machinesApp } from "@/server/v1/routes/legacy/machines";
import { imagesApp } from "@/server/v1/routes/legacy/images";
import { sshKeysApp } from "@/server/v1/routes/legacy/ssh-keys";
import { apiKeysApp } from "@/server/v1/routes/legacy/api-keys";
import { serverTypesApp } from "@/server/v1/routes/legacy/server-types";
import { accountApp } from "@/server/v1/routes/legacy/account";
import { internalApp } from "@/server/v1/routes/internal";
import { sseApp } from "@/server/v1/routes/legacy/sse";
import { webhooksApp } from "@/server/v1/routes/legacy/webhooks";
import { stripeWebhooksApp } from "@/server/v1/routes/internal/stripe-webhooks";
import { toolboxApp } from "@/server/v1/routes/legacy/toolbox";
import { importKortixApp } from "@/server/v1/routes/legacy/import-kortix";
import { proxyTokensApp } from "@/server/v1/routes/legacy/proxy-tokens";
import { proxyApp } from "@/server/v1/routes/proxy";
import { adminRoutingApp } from "@/server/v1/routes/internal/admin-routing";
import { adminMachinesApp } from "@/server/v1/routes/internal/admin-machines";

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
// SSE status stream + Toolbox mount under /machines so paths resolve as
// /api/v1/machines/:id/status/stream and /api/v1/machines/:id/toolbox/*
v1.route('/machines', sseApp);
v1.route('/machines', toolboxApp);
v1.route('/webhooks', webhooksApp);
v1.route('/stripe/webhooks', stripeWebhooksApp);
// import-kortix declares absolute paths (e.g. /import/kortix/start) — mount
// at root so final paths land under /api/v1/import/kortix/*
v1.route('/', importKortixApp);
