import type { ImageItem } from '@/lib/api';
import { TEMPLATES as CATALOG_IMAGES } from '@/lib/templates';

export type MachineCreateType = 'container';
export type IncusImageType = 'container';

export function machineTypeToImageType(_type: MachineCreateType): IncusImageType {
  void _type;
  return 'container';
}

export function catalogImageType(_type: 'container'): IncusImageType {
  void _type;
  return 'container';
}

export function imageAliases(image: ImageItem) {
  return (image.aliases ?? []).map((alias) => alias.name).filter(Boolean);
}

function humanizeAlias(alias: string) {
  if (alias.startsWith('ubuntu/24.04') || alias.startsWith('ubuntu/noble')) {
    return 'Ubuntu 24.04';
  }
  return alias;
}

export function catalogForImage(image: ImageItem) {
  const aliases = new Set(imageAliases(image));
  return CATALOG_IMAGES.find((entry) => aliases.has(entry.id)) ?? null;
}

export function imageIdForCreate(image: ImageItem) {
  const catalog = catalogForImage(image);
  return catalog?.id ?? imageAliases(image)[0] ?? image.fingerprint ?? image.id;
}

export function imageDisplayName(image: ImageItem) {
  const catalog = catalogForImage(image);
  if (catalog) return catalog.name;
  const aliases = imageAliases(image);
  const ubuntu = aliases.find((alias) => alias.startsWith('ubuntu/24.04'))
    ?? aliases.find((alias) => alias.startsWith('ubuntu/noble'));
  return humanizeAlias(ubuntu ?? aliases[0] ?? image.fingerprint?.slice(0, 12) ?? image.id);
}

export function imageTypeLabel(type?: string | null) {
  if (type === 'container') return 'Container';
  return 'Unsupported';
}

export function imageMatchesMachineType(image: ImageItem, type: MachineCreateType) {
  const want = machineTypeToImageType(type);
  return !image.type || image.type === want;
}

export function imageClusterLabel(image: ImageItem) {
  return image.cluster?.id ?? 'unknown cluster';
}

export { CATALOG_IMAGES };
