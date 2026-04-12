import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidateQueriesMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: unknown) => useMutationMock(options),
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock('@/hooks/api-client', () => ({
  apiV2: {
    post: vi.fn(async () => ({ host: {}, cell: {} })),
    get: vi.fn(async () => ({ hosts: [], cells: [] })),
  },
}));

describe('use-fleet invalidation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    useMutationMock.mockImplementation((options: { onSuccess?: () => void }) => ({ onSuccess: options.onSuccess }));
  });

  it('invalidates all fleet views after host scheduler updates', async () => {
    const { useUpdateFleetHostSchedulerState } = await import('@/hooks/use-fleet');
    const mutation = useUpdateFleetHostSchedulerState() as { onSuccess?: () => void };

    mutation.onSuccess?.();

    expect(invalidateQueriesMock.mock.calls).toEqual([
      [{ queryKey: ['fleet', 'overview'] }],
      [{ queryKey: ['fleet', 'host-audit'] }],
      [{ queryKey: ['fleet', 'config-audit'] }],
      [{ queryKey: ['fleet', 'cell-capacity-snapshots'] }],
    ]);
  });

  it('invalidates all fleet views after cell reserve policy updates', async () => {
    const { useUpdateFleetCellReservePolicy } = await import('@/hooks/use-fleet');
    const mutation = useUpdateFleetCellReservePolicy() as { onSuccess?: () => void };

    mutation.onSuccess?.();

    expect(invalidateQueriesMock.mock.calls).toEqual([
      [{ queryKey: ['fleet', 'overview'] }],
      [{ queryKey: ['fleet', 'host-audit'] }],
      [{ queryKey: ['fleet', 'config-audit'] }],
      [{ queryKey: ['fleet', 'cell-capacity-snapshots'] }],
    ]);
  });
});
