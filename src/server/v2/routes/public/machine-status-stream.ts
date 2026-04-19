import { OpenAPIHono } from '@hono/zod-openapi';

import { sseApp } from "@/server/v1/routes/legacy/sse";

export const machineStatusV2App = new OpenAPIHono();
machineStatusV2App.route('/', sseApp);
