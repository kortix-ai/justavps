/**
 * Daemon version checker — reads the latest daemon version from R2.
 *
 * The CI/CD writes a version.txt file alongside the daemon binary in R2.
 * This module fetches it periodically (every 60s) and caches the result.
 * The heartbeat handler uses this to decide whether to send update instructions.
 *
 * Two channels:
 *   - "latest"  → daemon/latest/version.txt (production machines)
 *   - "dev"     → daemon/dev/latest/version.txt (dev machines)
 */

import { config } from "@/server/core/config";

const R2_PUBLIC_BASE = 'https://pub-caf7762051b942d5a801397d750a0dc3.r2.dev';
const CACHE_TTL = 60_000; // 60 seconds

interface CachedVersion {
  version: string;
  url: string;
  fetchedAt: number;
}

let cache: CachedVersion | null = null;

function getR2Prefix(): string {
  return config.DAEMON_CHANNEL === 'dev' ? 'daemon/dev' : 'daemon';
}

/**
 * Get the latest daemon version and download URL.
 * Returns null if version info is unavailable.
 */
export async function getLatestDaemonVersion(): Promise<{ version: string; url: string } | null> {
  // Check env var override first (takes precedence over R2)
  if (config.DAEMON_DESIRED_VERSION && config.DAEMON_DOWNLOAD_URL) {
    return {
      version: config.DAEMON_DESIRED_VERSION,
      url: config.DAEMON_DOWNLOAD_URL,
    };
  }

  // Check cache
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return { version: cache.version, url: cache.url };
  }

  // Fetch from R2
  try {
    const prefix = getR2Prefix();
    const versionUrl = `${R2_PUBLIC_BASE}/${prefix}/latest/version.txt`;
    const resp = await fetch(versionUrl, { signal: AbortSignal.timeout(5000) });

    if (!resp.ok) {
      return cache ? { version: cache.version, url: cache.url } : null;
    }

    const version = (await resp.text()).trim();
    if (!version || version.length > 20) {
      return cache ? { version: cache.version, url: cache.url } : null;
    }

    const binaryUrl = `${R2_PUBLIC_BASE}/${prefix}/latest/justavps-daemon-linux-amd64`;

    cache = { version, url: binaryUrl, fetchedAt: Date.now() };
    return { version, url: binaryUrl };
  } catch {
    // Network error — return stale cache if available
    return cache ? { version: cache.version, url: cache.url } : null;
  }
}
