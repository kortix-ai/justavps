export interface ParsedHostname {
  slug: string;
  port: number;
  isPty: boolean;
  rewrittenPath?: string;
}

/**
 * Parse hostname and pathname to extract slug and port information.
 *
 * Port forwarding formats (all single-level subdomain = *.kortix.cloud cert):
 *   1. SLUG.kortix.cloud           → default port 80 (Caddy → OpenCode)
 *   2. PORT--SLUG.kortix.cloud     → port PORT (e.g. 4096--abc123.kortix.cloud)
 *   3. SLUG.kortix.cloud/_port/PORT/path → path-based fallback
 *
 * The PORT--SLUG format uses double-dash as separator because:
 *   - Single level subdomain = covered by *.kortix.cloud wildcard cert (no ACM needed)
 *   - Double-dash won't appear in slugs (generated alphanumeric)
 *   - Works with existing CF Worker route *.kortix.cloud/*
 */
// Supported proxy domains — both prod and dev.
const PROXY_DOMAINS = ['.kortix.cloud', '.kortix-dev.cloud'];

export function parseHostname(hostname: string, pathname?: string): ParsedHostname | null {
  if (!hostname) return null;

  // Find which proxy domain suffix matches
  const lowerHostname = hostname.toLowerCase();
  const matchedDomain = PROXY_DOMAINS.find(d => lowerHostname.endsWith(d));
  if (!matchedDomain) return null;

  const subdomain = lowerHostname.slice(0, -matchedDomain.length);
  if (!subdomain) return null;

  let slug: string;
  let port = 80;

  // Check for PORT--SLUG format (e.g. 4096--abc123)
  const dashMatch = subdomain.match(/^(\d+)--(.+)$/);
  if (dashMatch) {
    const portNum = parseInt(dashMatch[1], 10);
    if (portNum > 0 && portNum <= 65535) {
      port = portNum;
      slug = dashMatch[2];
    } else {
      return null;
    }
  }
  // Legacy: PORT.SLUG format (two-level subdomain — works if ACM cert exists)
  else if (subdomain.includes('.')) {
    const parts = subdomain.split('.');
    if (parts.length === 2) {
      const portNum = parseInt(parts[0], 10);
      if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
        port = portNum;
        slug = parts[1];
      } else {
        return null;
      }
    } else {
      return null;
    }
  }
  // Simple: SLUG only
  else {
    slug = subdomain;
  }

  if (!isValidSlug(slug!)) return null;

  // Path-based port routing: /_port/PORT/path
  let rewrittenPath: string | undefined;
  if (pathname && port === 80) {
    const portMatch = pathname.match(/^\/_port\/(\d+)(\/.*)?$/);
    if (portMatch) {
      const pathPort = parseInt(portMatch[1], 10);
      if (pathPort > 0 && pathPort <= 65535) {
        port = pathPort;
        rewrittenPath = portMatch[2] || '/';
      }
    }
  }

  const isPty = pathname === '/_pty';

  return {
    slug: slug!,
    port,
    isPty,
    ...(rewrittenPath !== undefined ? { rewrittenPath } : {}),
  };
}

function isValidSlug(slug: string): boolean {
  if (!slug || slug.length < 3) return false;
  if (['www', 'api', 'mail', 'ftp', 'admin', 'origin'].includes(slug)) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || /^[a-z0-9]{3,}$/.test(slug);
}
