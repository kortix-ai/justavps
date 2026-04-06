/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { OpenAPIHono } from '@hono/zod-openapi';
import { sseApp } from '../v1/sse';

export const machineStatusV2App = new OpenAPIHono();
machineStatusV2App.route('/', sseApp);
