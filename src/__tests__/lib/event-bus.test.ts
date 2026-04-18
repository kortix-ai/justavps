import { describe, expect, it } from 'vitest';

import { pruneExpiredMachineEvents } from "@/server/core/event-bus";

describe('event bus retention helpers', () => {
  it('prunes expired machine lifecycle events', async () => {
    const executor = {
      execute: async () => ({ rows: [{ id: 'evt-1' }, { id: 'evt-2' }, { id: 'evt-3' }] }),
    } as never;

    const deleted = await pruneExpiredMachineEvents({
      now: new Date('2026-05-11T05:00:00.000Z'),
      limit: 100,
      executor,
    });

    expect(deleted).toBe(3);
  });
});
