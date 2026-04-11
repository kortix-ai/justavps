import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const selectMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
let updateSets: Array<Record<string, unknown>> = [];

vi.mock('@/server/db', () => ({
  db: {
    execute: executeMock,
    select: selectMock,
    update: updateMock,
    insert: insertMock,
  },
}));

describe('control-plane jobs runtime', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    updateSets = [];
    selectMock.mockImplementation(() => ({
      from: () => ({
        where: async () => [{
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
        }],
      }),
    }));

    updateMock.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values);
        return {
          where: async () => values,
        };
      },
    }));
  });

  it('reschedules claimed jobs using the registered handler result', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [{ id: 'job-1' }],
    });

    const {
      processDueControlPlaneJobs,
      registerControlPlaneJobHandler,
      resetControlPlaneJobWorkerForTests,
    } = await import('@/server/lib/control-plane-jobs');

    const retryAt = new Date(Date.now() + 60_000);
    registerControlPlaneJobHandler('webhook_deliver', {
      handle: vi.fn().mockResolvedValue({
        status: 'retry',
        error: 'HTTP 500',
        runAfter: retryAt,
        result: { deliveryId: 'delivery-1' },
      }),
    });

    await processDueControlPlaneJobs({ jobTypes: ['webhook_deliver'], limit: 1 });

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const updateValues = updateSets[0];
    expect(updateValues.status).toBe('retry_waiting');
    expect(updateValues.attempt).toBe(1);
    expect(updateValues.error).toBe('HTTP 500');
    expect(updateValues.runAfter).toEqual(retryAt);

    resetControlPlaneJobWorkerForTests();
  });
});
