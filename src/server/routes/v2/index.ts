import { OpenAPIHono } from '@hono/zod-openapi';
import { catalogV2App } from './catalog';
import { adminBaremetalApp } from '../v1/admin-baremetal';

export const v2 = new OpenAPIHono();

v2.route('/catalog', catalogV2App);
v2.route('/admin/fleet', adminBaremetalApp);
