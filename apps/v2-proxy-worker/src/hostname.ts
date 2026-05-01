import type { ParsedHostname } from './types';

const RESERVED_SLUGS = new Set(['www', 'api', 'mail', 'ftp', 'admin', 'origin']);

export function normalizeProxyDomains(domains?: string): string[] {
  const raw = domains?.trim() ? domains : 'kortix-dev.cloud';
  return raw
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '').replace(/\.$/, ''))
    .filter(Boolean);
}

function validSlug(slug: string) {
  if (!slug || slug.length < 3 || RESERVED_SLUGS.has(slug)) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || /^[a-z0-9]{3,}$/.test(slug);
}

export function parseHostname(hostname: string, pathname = '/', proxyDomains?: string): ParsedHostname | null {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  const matched = normalizeProxyDomains(proxyDomains).find((domain) => lower.endsWith(`.${domain}`));
  if (!matched) return null;

  if (lower === `v2.${matched}`) {
    const pathMatch = pathname.match(/^\/((?:(\d+)--)?([a-z0-9][a-z0-9-]*))(?:\/(.*))?$/i);
    if (!pathMatch) return null;
    const port = pathMatch[2] ? Number(pathMatch[2]) : 80;
    const slug = pathMatch[3].toLowerCase();
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (!validSlug(slug)) return null;
    const rest = pathMatch[4];
    const rewrittenPath = rest ? `/${rest}` : '/';
    return { slug, port, rewrittenPath };
  }

  const subdomain = lower.slice(0, -matched.length - 1);
  if (!subdomain || subdomain.includes('.')) return null;

  let slug = subdomain;
  let port = 80;
  const portMatch = subdomain.match(/^(\d+)--(.+)$/);
  if (portMatch) {
    port = Number(portMatch[1]);
    slug = portMatch[2];
    if (!slug.startsWith('v2-')) return null;
    slug = slug.slice(3);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  } else {
    if (!slug.startsWith('v2-')) return null;
    slug = slug.slice(3);
  }
  if (!validSlug(slug)) return null;

  let rewrittenPath: string | undefined;
  if (port === 80) {
    const pathPort = pathname.match(/^\/_port\/(\d+)(\/.*)?$/);
    if (pathPort) {
      const parsedPort = Number(pathPort[1]);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) return null;
      port = parsedPort;
      rewrittenPath = pathPort[2] || '/';
    }
  }

  return { slug, port, ...(rewrittenPath ? { rewrittenPath } : {}) };
}

export function cookieDomainFor(hostname: string, proxyDomains?: string) {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  const matched = normalizeProxyDomains(proxyDomains).find((domain) => lower === domain || lower.endsWith(`.${domain}`));
  return matched ? `.${matched}` : `.${lower.split('.').slice(-2).join('.')}`;
}
