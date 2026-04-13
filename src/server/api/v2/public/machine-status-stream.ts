import { OpenAPIHono } from '@hono/zod-openapi';

import { sseApp } from '@/server/api/v1/legacy/sse';

export const machineStatusV2App = new OpenAPIHono();
machineStatusV2App.route('/', sseApp);
