import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectWhereMock = vi.fn();
const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
const selectMock = vi.fn(() => ({ from: selectFromMock }));
const updateWhereMock = vi.fn();
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));
const getProviderMock = vi.fn(() => ({ name: 'baremetal' }));
const resolveRequestedProviderImageMock = vi.fn();

vi.mock('@/server/db', () => ({
  db: {
    select: selectMock,
    update: updateMock,
  },
}));

vi.mock('@/server/platform/providers', () => ({
  getProvider: getProviderMock,
}));

vi.mock('@/server/core/image-catalog', () => ({
  resolveRequestedProviderImage: resolveRequestedProviderImageMock,
}));

describe('machine image source helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('normalizes Docker refs and placement aliases', async () => {
    const {
      defaultPlacementImageAlias,
      normalizeDockerImageRef,
      normalizeResolvedImageForProvider,
    } = await import("@/server/v2/domains/machine/image-source");

    expect(normalizeDockerImageRef(null)).toBeNull();
    expect(normalizeDockerImageRef('')).toBeNull();
    expect(normalizeDockerImageRef('nginx:latest')).toBe('docker:nginx:latest');
    expect(normalizeDockerImageRef('docker:nginx:latest')).toBe('docker:nginx:latest');

    expect(defaultPlacementImageAlias()).toBe('justavps-golden');
    expect(defaultPlacementImageAlias('img-1')).toBeNull();
    expect(defaultPlacementImageAlias(undefined, 'docker:nginx:latest')).toBeNull();

    expect(normalizeResolvedImageForProvider('baremetal', 'ubuntu-24.04')).toBe('images:ubuntu/noble/cloud');
    expect(normalizeResolvedImageForProvider('baremetal', '12345')).toBe('images:ubuntu/noble/cloud');
    expect(normalizeResolvedImageForProvider('baremetal', 'docker:nginx:latest')).toBe('docker:nginx:latest');
  });

  it('resolves docker image requests without DB catalog lookup', async () => {
    const { resolveMachineCreateImage } = await import("@/server/v2/domains/machine/image-source");

    const result = await resolveMachineCreateImage({
      machine: { id: 'machine-1', imageId: null } as never,
      payload: {
        accountId: 'account-1',
        dockerImage: 'docker:nginx:latest',
      },
    });

    expect(result).toEqual({ resolvedImage: 'docker:nginx:latest', machineImageId: null });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('resolves catalog images and updates machine image id when needed', async () => {
    selectWhereMock.mockResolvedValueOnce([
      { id: 'img-1', accountId: 'account-1', isTemplate: false },
    ]);
    resolveRequestedProviderImageMock.mockReturnValue({
      ok: true,
      selection: {
        providerImage: 'ubuntu-24.04',
        machineImageId: 'img-1',
      },
    });

    const { resolveMachineCreateImage } = await import("@/server/v2/domains/machine/image-source");

    const result = await resolveMachineCreateImage({
      machine: { id: 'machine-1', imageId: null } as never,
      payload: {
        accountId: 'account-1',
        imageId: 'img-1',
      },
    });

    expect(result).toEqual({
      resolvedImage: 'images:ubuntu/noble/cloud',
      machineImageId: 'img-1',
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
