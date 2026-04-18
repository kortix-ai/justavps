import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { db } from '@/server/db';
import { accounts, controlPlaneJobs, users, webhookDeliveries, webhooks } from '@/server/db/schema';

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdWebhookIds: string[] = [];
const createdDeliveryIds: string[] = [];
const createdJobIds: string[] = [];

async function cleanupRows() {
  if (createdJobIds.length) {
    await db.delete(controlPlaneJobs).where(inArray(controlPlaneJobs.id, createdJobIds));
    createdJobIds.length = 0;
  }
  if (createdDeliveryIds.length) {
    await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.id, createdDeliveryIds));
    createdDeliveryIds.length = 0;
  }
  if (createdWebhookIds.length) {
    await db.delete(webhooks).where(inArray(webhooks.id, createdWebhookIds));
    createdWebhookIds.length = 0;
  }
  if (createdAccountIds.length) {
    await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
    createdAccountIds.length = 0;
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
}

describe.skipIf(!process.env.DATABASE_URL)('durable webhook delivery integration', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await cleanupRows();
  });

  afterEach(async () => {
    await cleanupRows();
  });

  async function seedWebhook() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await db.insert(users).values({
      email: `webhook-int-${suffix}@example.com`,
      name: 'Webhook Integration',
    }).returning();
    createdUserIds.push(user.id);

    const [account] = await db.insert(accounts).values({
      name: `Webhook ${suffix}`,
      slug: `webhook-${suffix}`,
      type: 'organization',
    }).returning();
    createdAccountIds.push(account.id);

    const [hook] = await db.insert(webhooks).values({
      ownerId: user.id,
      accountId: account.id,
      url: 'https://example.com/webhook',
      secret: 'super-secret',
      events: ['machine.stage_changed'],
      active: true,
    }).returning();
    createdWebhookIds.push(hook.id);

    return { account, hook };
  }

  it('persists queued deliveries and drives them to delivered via the control-plane worker', async () => {
    const { account, hook } = await seedWebhook();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    const { deliverWebhooks } = await import("@/server/platform/control-plane/webhook-delivery");
    const { processDueControlPlaneJobs } = await import("@/server/v2/services/control-plane-jobs");

    await deliverWebhooks(account.id, {
      machineId: 'machine-1',
      accountId: account.id,
      event: 'stage_changed',
      stage: 'server_created',
      timestamp: new Date().toISOString(),
    });

    const [deliveryBefore] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id));
    const [jobBefore] = await db.select().from(controlPlaneJobs).where(eq(controlPlaneJobs.subjectId, deliveryBefore.id));
    createdDeliveryIds.push(deliveryBefore.id);
    createdJobIds.push(jobBefore.id);

    expect(deliveryBefore.status).toBe('queued');
    expect(jobBefore.status).toBe('queued');

    await processDueControlPlaneJobs({ jobTypes: ['webhook_deliver'], limit: 10 });

    const [deliveryAfter] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryBefore.id));
    const [jobAfter] = await db.select().from(controlPlaneJobs).where(eq(controlPlaneJobs.id, jobBefore.id));

    expect(deliveryAfter.status).toBe('delivered');
    expect(deliveryAfter.success).toBe(true);
    expect(jobAfter.status).toBe('succeeded');
    expect(jobAfter.attempt).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/webhook', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'X-JustAVPS-Event': 'machine.stage_changed',
      }),
    }));
  });

  it('keeps retry state in the database and eventually dead-letters repeated failures', async () => {
    const { account, hook } = await seedWebhook();
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    const { deliverWebhooks } = await import("@/server/platform/control-plane/webhook-delivery");
    const { processDueControlPlaneJobs } = await import("@/server/v2/services/control-plane-jobs");

    await deliverWebhooks(account.id, {
      machineId: 'machine-2',
      accountId: account.id,
      event: 'stage_changed',
      stage: 'server_created',
      timestamp: new Date().toISOString(),
    });

    const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id));
    const [job] = await db.select().from(controlPlaneJobs).where(eq(controlPlaneJobs.subjectId, delivery.id));
    createdDeliveryIds.push(delivery.id);
    createdJobIds.push(job.id);

    await processDueControlPlaneJobs({ jobTypes: ['webhook_deliver'], limit: 10 });

    const [deliveryAfterFirst] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
    const [jobAfterFirst] = await db.select().from(controlPlaneJobs).where(eq(controlPlaneJobs.id, job.id));

    expect(deliveryAfterFirst.status).toBe('retry_waiting');
    expect(deliveryAfterFirst.attempt).toBe(1);
    expect(jobAfterFirst.status).toBe('retry_waiting');
    expect(jobAfterFirst.attempt).toBe(1);

    let deliveryAfterFinal = deliveryAfterFirst;
    let jobAfterFinal = jobAfterFirst;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await db.update(controlPlaneJobs).set({ runAfter: new Date(Date.now() - 1_000) }).where(eq(controlPlaneJobs.id, job.id));
      await processDueControlPlaneJobs({ jobTypes: ['webhook_deliver'], limit: 10 });
      [deliveryAfterFinal] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
      [jobAfterFinal] = await db.select().from(controlPlaneJobs).where(eq(controlPlaneJobs.id, job.id));
      if (deliveryAfterFinal.status === 'dead_lettered' && jobAfterFinal.status === 'dead_lettered') break;
    }

    expect(deliveryAfterFinal.status).toBe('dead_lettered');
    expect(deliveryAfterFinal.attempt).toBeGreaterThanOrEqual(3);
    expect(deliveryAfterFinal.error).toBe('HTTP 500');
    expect(jobAfterFinal.status).toBe('dead_lettered');
    expect(jobAfterFinal.attempt).toBeGreaterThanOrEqual(3);
  });
});
