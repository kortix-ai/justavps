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
  region: string;
}

export interface RegionInfo {
  id: string;
  name: string;
  country: string;
  city: string;
}

export interface ProviderSnapshot {
  snapshotId: string;
  diskSize: number;
  architecture: string;
}

export interface CreateServerOpts {
  name: string;
  snapshotId: string;
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
}

export interface SSHKeyResult {
  keyId: string;
}

export interface ComputeProvider {
  readonly name: string;
  readonly displayName: string;

  buildSnapshot(dockerImage: string, opts?: { description?: string }): Promise<ProviderSnapshot>;
  deleteSnapshot(snapshotId: string): Promise<void>;

  createServer(opts: CreateServerOpts): Promise<ServerResult>;
  deleteServer(serverId: string): Promise<void>;
  startServer(serverId: string): Promise<void>;
  stopServer(serverId: string): Promise<void>;
  rebootServer(serverId: string): Promise<void>;
  resizeServer(serverId: string, serverType: string): Promise<void>;
  getServerStatus(serverId: string): Promise<string>;

  uploadSSHKey(name: string, publicKey: string): Promise<SSHKeyResult>;
  deleteSSHKey(keyId: string): Promise<void>;

  listServerTypes(region: string, snapshot?: ProviderSnapshot): Promise<ServerTypeInfo[]>;
  listRegions(): Promise<RegionInfo[]>;
}
