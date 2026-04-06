import { OpenAPIHono } from '@hono/zod-openapi';
import { catalogV2App } from './catalog';
import { adminBaremetalApp } from '../v1/admin-baremetal';
import { machinesV2App } from './machines';
import { imagesV2App } from './images';
import { billingV2App } from './billing';
import { snapshotsV2App } from './snapshots';
import { machineStatusV2App } from './machine-status-stream';

export const v2 = new OpenAPIHono();

v2.route('/catalog', catalogV2App);
v2.route('/machines', machinesV2App);
v2.route('/machines', machineStatusV2App);
v2.route('/images', imagesV2App);
v2.route('/snapshots', snapshotsV2App);
v2.route('/billing', billingV2App);
v2.route('/admin/fleet', adminBaremetalApp);
