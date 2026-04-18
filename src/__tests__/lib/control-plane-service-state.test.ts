import { beforeEach, describe, expect, it, vi } from 'vitest';

const whereMock = vi.fn();
const fromMock = vi.fn();
const selectMock = vi.fn();

describe('control-plane service state listing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    whereMock.mockResolvedValue([]);
    fromMock.mockImplementation(() => ({ where: whereMock }));
    selectMock.mockImplementation(() => ({ from: fromMock }));
  });

  it('pushes service+scope filtering into the database query', async () => {
    const { listControlPlaneServiceStates } = await import("@/server/platform/control-plane/service-state");

    await listControlPlaneServiceStates({
      service: 'auth_cache',
      scope: 'api_keys',
      executor: { select: selectMock } as never,
    });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it('queries all rows directly when no filter is provided', async () => {
    fromMock.mockResolvedValueOnce([{ service: 'routing', scope: 'repair' }]);
    selectMock.mockImplementationOnce(() => ({ from: fromMock }));
    const { listControlPlaneServiceStates } = await import("@/server/platform/control-plane/service-state");

    const rows = await listControlPlaneServiceStates({ executor: { select: selectMock } as never });

    expect(whereMock).not.toHaveBeenCalled();
    expect(rows).toEqual([{ service: 'routing', scope: 'repair' }]);
  });
});
