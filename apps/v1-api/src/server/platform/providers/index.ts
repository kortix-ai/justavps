import type { ComputeProvider } from "@/server/platform/providers/types";
import { HetznerProvider } from "@/server/platform/providers/hetzner";
import { BaremetalProvider } from "@/server/platform/providers/baremetal";
import { config } from "@/server/core/config";

type ProviderRegistration = {
  driver: ComputeProvider;
  customerVisible: boolean;
};

const providers = new Map<string, ProviderRegistration>();

function init() {
  if (providers.size > 0) return;
  if (config.HETZNER_API_KEY) {
    providers.set('cloud', { driver: new HetznerProvider(), customerVisible: true });
  }
  if (config.BAREMETAL_ENABLED) {
    providers.set('baremetal', { driver: new BaremetalProvider(), customerVisible: false });
  }
}

export function getProvider(name: string): ComputeProvider {
  init();
  // Resolve legacy alias — existing DB records store 'hetzner'
  const resolved = name === 'hetzner' ? 'cloud' : name;
  const provider = providers.get(resolved)?.driver;
  if (!provider) {
    const available = Array.from(providers.keys()).join(', ') || 'none';
    throw new Error(`Unknown provider '${resolved}'. Available: ${available}`);
  }
  return provider;
}

export function listProviders(): Array<{ name: string; displayName: string }> {
  init();
  return Array.from(providers.entries()).map(([name, entry]) => ({
    name,
    displayName: entry.driver.displayName,
  }));
}

export function listCustomerVisibleProviders(): Array<{ name: string; displayName: string }> {
  init();
  return Array.from(providers.entries())
    .filter(([, entry]) => entry.customerVisible)
    .map(([name, entry]) => ({ name, displayName: entry.driver.displayName }));
}

export type {
  ComputeProvider,
  ServerTypeInfo,
  RegionInfo,
  CreateServerOpts,
  ServerResult,
  SSHKeyResult,
  BackupInfo,
  BackupCapableProvider,
} from "@/server/platform/providers/types";
export { isBackupCapableProvider } from "@/server/platform/providers/types";
