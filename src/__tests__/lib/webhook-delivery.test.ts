import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const updateMock = vi.fn();
const transactionMock = vi.fn();
const runWebhookDispatcherServicePassMock = vi.fn();
const registerHandlerMock = vi.fn();
const enqueueControlPlaneJobMock = vi.fn();

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
    update: updateMock,
    transaction: transactionMock,
  },
}));

vi.mock('@/server/platform/control-plane/jobs', () => ({
  enqueueControlPlaneJob: enqueueControlPlaneJobMock,
  registerControlPlaneJobHandler: registerHandlerMock,
}));

vi.mock('@/server/platform/control-plane/webhook-dispatcher', () => ({
  runWebhookDispatcherServicePass: runWebhookDispatcherServicePassMock,
}));

describe('webhook delivery queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runWebhookDispatcherServicePassMock.mockResolvedValue({ acquired: true, processed: 0 });
  });

  it('enqueues persisted webhook deliveries and matching control-plane jobs', async () => {
    selectMock.mockImplementation(() => ({
      from: () => ({
        where: async () => [{
          id: 'hook-1',
          url: 'https://example.com/webhook',
          secret: 'secret-1',
          events: ['machine.stage_changed'],
        }],
      }),
    }));

    const insertedValues: Array<Record<string, unknown>> = [];
    transactionMock.mockImplementation(async (callback: (tx: { insert: (table: unknown) => { values: (values: Record<string, unknown>) => { returning: () => Promise<Array<{ id: string }>> } | Promise<void> } }) => Promise<void>) => {
      let insertCount = 0;
      await callback({
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            insertedValues.push(values);
            insertCount += 1;
            if (insertCount === 1) {
              return {
                returning: async () => [{ id: 'delivery-1' }],
              };
            }
            return Promise.resolve();
          },
        }),
      });
    });

    const fetchMock = vi.spyOn(global, 'fetch');
    const { deliverWebhooks } = await import("@/server/platform/control-plane/webhook-delivery");

    await deliverWebhooks('account-1', {
      machineId: 'machine-1',
      accountId: 'account-1',
      event: 'stage_changed',
      stage: 'server_created',
      timestamp: new Date().toISOString(),
    });

    expect(insertedValues).toHaveLength(2);
    expect(insertedValues[0]).toMatchObject({
      webhookId: 'hook-1',
      eventType: 'machine.stage_changed',
      payloadVersion: 1,
      status: 'queued',
      attempt: 0,
      success: false,
    });
    expect(insertedValues[1]).toMatchObject({
      jobType: 'webhook_deliver',
      subjectType: 'webhook_delivery',
      subjectId: 'delivery-1',
      status: 'queued',
      maxAttempts: 3,
      idempotencyKey: 'webhook_delivery:delivery-1',
      payload: { deliveryId: 'delivery-1' },
    });
    expect(runWebhookDispatcherServicePassMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists retry_waiting state after a failed delivery attempt', async () => {
    const updateSets: Array<Record<string, unknown>> = [];
    updateMock.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values);
        return {
          where: async () => undefined,
        };
      },
    }));

    const selectQueue = [
      [{
        id: 'delivery-1',
        webhookId: 'hook-1',
        eventType: 'machine.stage_changed',
        payload: { event: 'machine.stage_changed', data: { ok: true } },
        payloadVersion: 1,
        status: 'queued',
        statusCode: null,
        responseBody: null,
        durationMs: null,
        attempt: 0,
        nextAttemptAt: new Date(),
        lastAttemptAt: null,
        success: false,
        error: null,
        deliveredAt: null,
        deadLetteredAt: null,
        createdAt: new Date(),
      }],
      [{
        id: 'hook-1',
        url: 'https://example.com/webhook',
        secret: 'secret-1',
        active: true,
        failureCount: 0,
      }],
    ];

    selectMock.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
      }),
    }));

    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));

    const { webhookDeliveryInternals } = await import("@/server/platform/control-plane/webhook-delivery");
    const result = await webhookDeliveryInternals.handleWebhookDeliveryJob({
      id: 'job-1',
      jobType: 'webhook_deliver',
      subjectType: 'webhook_delivery',
      subjectId: 'delivery-1',
      status: 'running',
      priority: 100,
      attempt: 0,
      maxAttempts: 3,
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(),
      runAfter: new Date(),
      idempotencyKey: 'webhook_delivery:delivery-1',
      payload: { deliveryId: 'delivery-1' },
      result: null,
      error: null,
      lastAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
    });

    expect(result.status).toBe('retry');
    expect(updateSets[0]).toMatchObject({
      status: 'delivering',
      attempt: 1,
      success: false,
      error: null,
    });
    expect(updateSets[1]).toMatchObject({
      status: 'retry_waiting',
      attempt: 1,
      statusCode: 500,
      responseBody: 'nope',
      success: false,
      error: 'HTTP 500',
    });
  });
});
