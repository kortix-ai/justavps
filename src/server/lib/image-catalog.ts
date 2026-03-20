import { images } from '../db/schema';

export type ImageKind = 'template' | 'snapshot';

type ImageRow = typeof images.$inferSelect;

export const DEFAULT_TEMPLATE_NAME = 'justavps standard';
export const KORTIX_TEMPLATE_NAME = 'Kortix';

export interface SerializedImage {
  id: string;
  name: string;
  description: string | null;
  status: string;
  kind: ImageKind;
  is_template: boolean;
  source_machine_id: string | null;
  provider: string;
  provider_image_id: string | null;
  disk_size_gb: number | null;
  architecture: string | null;
  created_at: string;
  updated_at: string;
}

type TemplatePreset = {
  dockerImage?: string;
  entrypoint?: string;
};

interface ResolveImageInput {
  explicitImage?: Pick<ImageRow, 'id' | 'name' | 'status' | 'providerImageId'> | null;
  fallbackPublicImage?: Pick<ImageRow, 'id' | 'name' | 'providerImageId'> | null;
}

export interface ResolvedImageSelection {
  providerImage: string;
  machineImageId: string | null;
  dockerImage?: string;
  entrypoint?: string;
}

type ResolveImageResult =
  | { ok: true; selection: ResolvedImageSelection }
  | { ok: false; status: 400; message: string };

const PRESET_BY_TEMPLATE_NAME: Record<string, TemplatePreset> = {
  [KORTIX_TEMPLATE_NAME]: {
    dockerImage: 'kortix/computer:latest',
  },
};

export function isDefaultTemplateImage(image: Pick<ImageRow, 'name' | 'providerImageId'>): boolean {
  return image.name === DEFAULT_TEMPLATE_NAME;
}

export function getTemplatePreset(templateName: string): TemplatePreset | null {
  return PRESET_BY_TEMPLATE_NAME[templateName] ?? null;
}

export function serializeImageRow(image: ImageRow): SerializedImage {
  return {
    id: image.id,
    name: image.name,
    description: image.description,
    status: image.status,
    kind: image.isTemplate ? 'template' : 'snapshot',
    is_template: image.isTemplate,
    source_machine_id: image.sourceMachineId,
    provider: image.provider,
    provider_image_id: image.providerImageId,
    disk_size_gb: image.diskSizeGb,
    architecture: image.architecture,
    created_at: image.createdAt.toISOString(),
    updated_at: image.updatedAt.toISOString(),
  };
}

export function buildVisibleImageCatalog(rows: ImageRow[]): SerializedImage[] {
  const visible = rows.filter((row) => row.status !== 'deleted');
  const publicTemplates = visible
    .filter((row) => row.isTemplate)
    .sort((a, b) => {
      if (a.name === DEFAULT_TEMPLATE_NAME) return -1;
      if (b.name === DEFAULT_TEMPLATE_NAME) return 1;
      if (a.name === KORTIX_TEMPLATE_NAME) return -1;
      if (b.name === KORTIX_TEMPLATE_NAME) return 1;
      return a.name.localeCompare(b.name);
    })
    .map(serializeImageRow);
  const snapshots = visible.filter((row) => !row.isTemplate).map(serializeImageRow);
  return [...publicTemplates, ...snapshots];
}

function withPreset(selection: ResolvedImageSelection, templateName?: string | null): ResolvedImageSelection {
  if (!templateName) return selection;
  const preset = getTemplatePreset(templateName);
  if (!preset) return selection;

  return {
    ...selection,
    dockerImage: preset.dockerImage,
    entrypoint: preset.entrypoint,
  };
}

export function resolveRequestedProviderImage(input: ResolveImageInput): ResolveImageResult {
  if (input.explicitImage) {
    if (input.explicitImage.status !== 'ready') {
      return {
        ok: false,
        status: 400,
        message: `Image is not ready (status: ${input.explicitImage.status})`,
      };
    }

    if (!input.explicitImage.providerImageId) {
      return { ok: false, status: 400, message: 'Image has no provider image ID' };
    }

    return {
      ok: true,
      selection: withPreset(
        {
          providerImage: input.explicitImage.providerImageId,
          machineImageId: input.explicitImage.id,
        },
        input.explicitImage.name,
      ),
    };
  }

  if (input.fallbackPublicImage?.providerImageId) {
    return {
      ok: true,
      selection: {
        providerImage: input.fallbackPublicImage.providerImageId,
        machineImageId: input.fallbackPublicImage.id,
      },
    };
  }

  return {
    ok: false,
    status: 400,
    message: 'No default template image is configured',
  };
}

export function getDefaultMachineLabel(): string {
  return DEFAULT_TEMPLATE_NAME;
}
