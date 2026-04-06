/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Provider-sync helpers — run operations across all providers (best-effort).
 */

import { listProviders, getProvider } from './providers';

/**
 * Run an async operation against every registered provider.
 * Failures are logged but never thrown — best-effort semantics.
 */
export async function broadcastToProviders<T>(
  operation: (provider: ReturnType<typeof getProvider>, providerName: string) => Promise<T>,
  logTag: string,
): Promise<{ providerName: string; result: T } | null> {
  let firstResult: { providerName: string; result: T } | null = null;

  for (const { name: providerName } of listProviders()) {
    try {
      const provider = getProvider(providerName);
      const result = await operation(provider, providerName);
      if (!firstResult) firstResult = { providerName, result };
    } catch (err: any) {
      console.warn(`[${logTag}] ${providerName} failed (non-fatal):`, err.message?.slice(0, 200));
    }
  }

  return firstResult;
}
