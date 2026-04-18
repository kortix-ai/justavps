export type UiVersion = 'v1' | 'v2';

const VERSIONED_PREFIXES = ['/machines', '/images', '/billing', '/admin'];

function isVersionedPath(pathname: string) {
  return VERSIONED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function detectUiVersionFromPath(pathname: string): UiVersion {
  return pathname.startsWith('/v2') ? 'v2' : 'v1';
}

export function pathForVersion(pathname: string, version: UiVersion): string {
  const normalized = pathname.startsWith('/v2') ? pathname.slice(3) || '/' : pathname;
  if (!isVersionedPath(normalized)) return normalized;
  if (version === 'v1') return normalized;
  return normalized === '/' ? '/v2' : `/v2${normalized}`;
}
