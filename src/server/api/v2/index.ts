import { OpenAPIHono } from '@hono/zod-openapi';

import { catalogV2App } from '@/server/api/v2/public/catalog';
import { adminFleetV2App } from '@/server/api/v2/admin/fleet';
import { machinesV2App } from '@/server/api/v2/public/machines';
import { imagesV2App } from '@/server/api/v2/public/images';
import { billingV2App } from '@/server/api/v2/public/billing';
import { snapshotsV2App } from '@/server/api/v2/public/snapshots';
import { machineStatusV2App } from '@/server/api/v2/public/machine-status-stream';

export const v2 = new OpenAPIHono();

v2.route('/catalog', catalogV2App);
v2.route('/machines', machinesV2App);
v2.route('/machines', machineStatusV2App);
v2.route('/images', imagesV2App);
v2.route('/snapshots', snapshotsV2App);
v2.route('/billing', billingV2App);
v2.route('/admin/fleet', adminFleetV2App);
