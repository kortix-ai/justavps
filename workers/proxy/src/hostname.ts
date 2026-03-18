export interface ParsedHostname {
  slug: string;
  port: number;
  isPty: boolean;
  rewrittenPath?: string; // Set when path-based port routing rewrites the path
}

/**
 * Parse hostname and pathname to extract slug and port information.
 *
 * Supports two routing modes:
 *   1. Subdomain-based: 3000.slug.kortix.cloud → port 3000
 *   2. Path-based:      slug.kortix.cloud/_port/3000/path → port 3000
 *
 * Path-based routing is the reliable fallback when two-level subdomain DNS
 * isn't configured (requires per-machine wildcard A records).
 *
 * Examples:
 * - abc123.kortix.cloud → { slug: 'abc123', port: 80, isPty: false }
 * - 3000.abc123.kortix.cloud → { slug: 'abc123', port: 3000, isPty: false }
 * - abc123.kortix.cloud/_port/3000/ → { slug: 'abc123', port: 3000, isPty: false, rewrittenPath: '/' }
 * - abc123.kortix.cloud/_pty → { slug: 'abc123', port: 80, isPty: true }
 */
export function parseHostname(hostname: string, pathname?: string): ParsedHostname | null {
  if (!hostname) return null;

  // Check if it's a kortix.cloud domain
  if (!hostname.endsWith('.kortix.cloud')) return null;

  // Remove the .kortix.cloud suffix
  const subdomain = hostname.replace('.kortix.cloud', '');
  
  // Split by dots to handle port.slug format
  const parts = subdomain.split('.');
  
  if (parts.length === 0) return null;
  
  let slug: string;
  let port = 80; // Caddy on port 80 → reverse proxies to code-server localhost:8080
  
  if (parts.length === 1) {
    // Simple case: slug.kortix.cloud
    slug = parts[0];
  } else if (parts.length === 2) {
    // Port case: port.slug.kortix.cloud
    const portStr = parts[0];
    const portNum = parseInt(portStr, 10);
    
    // Validate port number
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      return null;
    }
    
    port = portNum;
    slug = parts[1];
  } else {
    // Too many parts, invalid
    return null;
  }
  
  // Validate slug
  if (!isValidSlug(slug)) return null;
  
  // Normalize slug to lowercase
  slug = slug.toLowerCase();
  
  // Check for path-based port routing: /_port/3000/rest/of/path
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

  // Check if this is a PTY WebSocket request
  const isPty = pathname === '/_pty';
  
  return {
    slug,
    port,
    isPty,
    ...(rewrittenPath !== undefined ? { rewrittenPath } : {}),
  };
}

/**
 * Validate that a slug meets our requirements
 */
function isValidSlug(slug: string): boolean {
  if (!slug) return false;
  
  // Reject reserved subdomains
  const reservedSlugs = ['www', 'api', 'mail', 'ftp', 'admin'];
  if (reservedSlugs.includes(slug.toLowerCase())) return false;
  
  // Must be at least 3 characters
  if (slug.length < 3) return false;
  
  // Must be alphanumeric with hyphens allowed
  const slugPattern = /^[a-zA-Z0-9-]+$/;
  if (!slugPattern.test(slug)) return false;
  
  return true;
}