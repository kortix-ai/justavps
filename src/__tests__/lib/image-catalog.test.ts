import { describe, expect, it } from 'vitest';
import {
  buildVisibleImageCatalog,
  DEFAULT_TEMPLATE_NAME,
  getDefaultMachineLabel,
  getTemplatePreset,
  isDefaultTemplateImage,
  resolveRequestedProviderImage,
} from '@/server/lib/image-catalog';

describe('image catalog', () => {
  it('lists public templates before private snapshots', () => {
    const now = new Date();
    const images = buildVisibleImageCatalog([
      {
        id: '11111111-1111-1111-1111-111111111111',
        ownerId: '22222222-2222-2222-2222-222222222222',
        name: 'snapshot-a',
        description: null,
        status: 'ready',
        isTemplate: false,
        sourceMachineId: null,
        provider: 'cloud',
        providerImageId: 'snapshot-a',
        diskSizeGb: 40,
        architecture: 'x86',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        ownerId: '44444444-4444-4444-4444-444444444444',
        name: 'Kortix',
        description: 'Base justavps template with kortix preinstalled.',
        status: 'ready',
        isTemplate: true,
        sourceMachineId: null,
        provider: 'cloud',
        providerImageId: '367950002',
        diskSizeGb: 20,
        architecture: 'x86',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    expect(images.map((image) => image.name)).toEqual(['Kortix', 'snapshot-a']);
  });

  it('identifies the default template row by name', () => {
    expect(
      isDefaultTemplateImage({
        name: DEFAULT_TEMPLATE_NAME,
        providerImageId: '367950002',
      }),
    ).toBe(true);
  });

  it('returns the Kortix preset workload', () => {
    expect(getTemplatePreset('Kortix')).toEqual({
      dockerImage: 'kortix/computer:latest',
    });
  });

  it('resolves an explicit ready image with a Kortix preset', () => {
    const resolved = resolveRequestedProviderImage({
      explicitImage: {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Kortix',
        status: 'ready',
        providerImageId: '367950002',
      },
    });

    expect(resolved).toEqual({
      ok: true,
      selection: {
        providerImage: '367950002',
        machineImageId: '33333333-3333-3333-3333-333333333333',
        dockerImage: 'kortix/computer:latest',
        entrypoint: undefined,
      },
    });
  });

  it('falls back to the default template row', () => {
    const resolved = resolveRequestedProviderImage({
      fallbackPublicImage: {
        id: '0372a1e7-1289-4218-b436-7bf8ed3ed579',
        name: DEFAULT_TEMPLATE_NAME,
        providerImageId: '367950002',
      },
    });

    expect(resolved).toEqual({
      ok: true,
      selection: {
        providerImage: '367950002',
        machineImageId: '0372a1e7-1289-4218-b436-7bf8ed3ed579',
      },
    });
  });

  it('returns justavps standard as the default label', () => {
    expect(getDefaultMachineLabel()).toBe('justavps standard');
  });
});
