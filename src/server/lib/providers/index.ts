import type { ComputeProvider } from './types';
import { HetznerProvider } from './hetzner';
import { config } from '../config';

const providers = new Map<string, ComputeProvider>();

function init() {
  if (providers.size > 0) return;
  if (config.HETZNER_API_KEY) {
    providers.set('cloud', new HetznerProvider());
  }
}

export function getProvider(name: string): ComputeProvider {
  init();
  // Resolve legacy alias — existing DB records store 'hetzner'
  const resolved = name === 'hetzner' ? 'cloud' : name;
  const provider = providers.get(resolved);
  if (!provider) {
    const available = Array.from(providers.keys()).join(', ') || 'none';
    throw new Error(`Unknown provider '${resolved}'. Available: ${available}`);
  }
  return provider;
}

export function listProviders(): Array<{ name: string; displayName: string }> {
  init();
  return Array.from(providers.values()).map((p) => ({
    name: p.name,
    displayName: p.displayName,
  }));
}

export function isProviderAvailable(name: string): boolean {
  init();
  return providers.has(name);
}

export type { ComputeProvider, ServerTypeInfo, RegionInfo, CreateServerOpts, ServerResult, SSHKeyResult } from './types';
