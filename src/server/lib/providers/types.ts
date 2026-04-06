export interface ServerTypeInfo {
  name: string;
  description: string;
  cores: number;
  memory: number;
  disk: number;
  cpuType: 'shared' | 'dedicated';
  architecture: 'x86' | 'arm';
  providerPriceMonthly: number;
  priceMonthly: number;
  backupPriceMonthly: number;
  region: string;
}

export interface RegionInfo {
  id: string;
  name: string;
  country: string;
  city: string;
}

export interface CreateServerOpts {
  name: string;
  image: string; // Hetzner image ID or "ubuntu-24.04"
  serverType: string;
  region: string;
  userData: string;
  sshKeyIds: string[];
  labels: Record<string, string>;
  enableBackups?: boolean;
  // V2 custom resource sizing (baremetal only)
  vcpu?: number;
  memoryGb?: number;
  diskGb?: number;
}

export interface ServerResult {
  serverId: string;
  publicIp: string;
  publicIpv4?: string | null;
  publicIpv6?: string | null;
  createActionId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProviderCapabilities {
  backups: boolean;
  images: boolean;
  bareMetal: boolean;
}

export interface ProviderActionProgress {
  status: string;
  progress: number | null;
}

export interface ProviderServerNetwork {
  publicIpv4: string | null;
  publicIpv6: string | null;
}

export interface SSHKeyResult {
  keyId: string;
}

export interface ComputeProvider {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  validateImage(imageId: string): Promise<boolean>;

  createImage(serverId: string, description: string): Promise<{ imageId: string; diskSize: number; architecture: string }>;
  deleteImage(imageId: string): Promise<void>;

  createServer(opts: CreateServerOpts): Promise<ServerResult>;
  deleteServer(serverId: string): Promise<void>;
  startServer(serverId: string): Promise<void>;
  stopServer(serverId: string): Promise<void>;
  rebootServer(serverId: string): Promise<void>;
  resizeServer(serverId: string, serverType: string, region?: string): Promise<void>;
  getServerStatus(serverId: string): Promise<string>;
  getActionProgress?(actionId: string): Promise<ProviderActionProgress>;
  getServerNetwork?(serverId: string): Promise<ProviderServerNetwork>;

  uploadSSHKey(name: string, publicKey: string): Promise<SSHKeyResult>;
  deleteSSHKey(keyId: string): Promise<void>;

  listServerTypes(region: string): Promise<ServerTypeInfo[]>;
  listRegions(): Promise<RegionInfo[]>;
}

export interface BackupInfo {
  id: string;
  createdAt: string;
  description?: string | null;
  type?: string | null;
}

export interface BackupCapableProvider extends ComputeProvider {
  listBackups(serverId: string): Promise<BackupInfo[]>;
  createBackup(serverId: string, description?: string): Promise<{ id: string }>;
  enableBackups(serverId: string): Promise<void>;
  disableBackups(serverId: string): Promise<void>;
  restoreBackup(serverId: string, backupId: string): Promise<void>;
  deleteBackup(backupId: string): Promise<void>;
}

export function isBackupCapableProvider(provider: ComputeProvider): provider is BackupCapableProvider {
  return provider.capabilities.backups;
}
