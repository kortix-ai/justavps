import { describe, expect, it } from 'vitest';

import { handleRouteError } from '@/server/lib/route-helpers';

class CapacityError extends Error {
  statusCode = 409;
  details = { placement_decision: { outcome: 'rejected', summary: 'No capacity', explanation: ['reserve budget exceeded'] } };
}

describe('route helpers', () => {
  it('uses error statusCode when provided', async () => {
    const response = handleRouteError({
      json: (payload: unknown, status: number) => new Response(JSON.stringify(payload), { status }),
    } as never, new CapacityError('No schedulable host could place request'), 'MACHINES-V2');

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ error: true, status: 409, details: { placement_decision: { outcome: 'rejected' } } });
  });
});
