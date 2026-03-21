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
}

export interface ServerResult {
  serverId: string;
  publicIp: string;
  createActionId?: string | null;
}

export interface ProviderActionProgress {
  status: string;
  progress: number | null;
}

export interface SSHKeyResult {
  keyId: string;
}

export interface ComputeProvider {
  readonly name: string;
  readonly displayName: string;

  validateImage(imageId: string): Promise<boolean>;

  createImage(serverId: number, description: string): Promise<{ imageId: string; diskSize: number; architecture: string }>;
  deleteImage(imageId: string): Promise<void>;

  createServer(opts: CreateServerOpts): Promise<ServerResult>;
  deleteServer(serverId: string): Promise<void>;
  startServer(serverId: string): Promise<void>;
  stopServer(serverId: string): Promise<void>;
  rebootServer(serverId: string): Promise<void>;
  resizeServer(serverId: string, serverType: string): Promise<void>;
  getServerStatus(serverId: string): Promise<string>;
  getActionProgress?(actionId: string): Promise<ProviderActionProgress>;

  uploadSSHKey(name: string, publicKey: string): Promise<SSHKeyResult>;
  deleteSSHKey(keyId: string): Promise<void>;

  listServerTypes(region: string): Promise<ServerTypeInfo[]>;
  listRegions(): Promise<RegionInfo[]>;
}
