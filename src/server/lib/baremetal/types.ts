export type BaremetalVendor = 'hetzner_robot';

export type BaremetalHostStatus =
  | 'requested'
  | 'ordering'
  | 'bootstrapping'
  | 'active'
  | 'draining'
  | 'disabled'
  | 'error'
  | 'deleted';

export type BaremetalProcurementStatus =
  | 'requested'
  | 'approved'
  | 'ordering'
  | 'bootstrapping'
  | 'active'
  | 'failed'
  | 'cancelled';

export interface BaremetalCapacity {
  totalVcpu: number;
  totalMemoryGb: number;
  totalDiskGb: number;
  usedVcpu: number;
  usedMemoryGb: number;
  usedDiskGb: number;
}

export interface BaremetalHostCandidate {
  id: string;
  region: string;
  status: BaremetalHostStatus;
  runnerBaseUrl: string | null;
  publicIpv4: string | null;
  publicIpv6?: string | null;
  runnerToken?: string | null;
  capacity: BaremetalCapacity;
}

export interface BaremetalPlanDefinition {
  id: string;
  vcpu: number;
  memory: number;
  disk: number;
  priceMonthly: number;
  providerCostMonthly: number;
}

export interface BaremetalPlacementResult {
  host: BaremetalHostCandidate;
  plan: BaremetalPlanDefinition;
}

export interface RunnerCreateInstanceInput {
  instanceName: string;
  machineSlug: string;
  machineId?: string;
  image: string;
  region: string;
  serverType: string;
  cloudInitUserData: string;
  vcpu: number;
  memoryGb: number;
  diskGb: number;
  labels?: Record<string, string>;
}

export interface RunnerCreateInstanceResult {
  instanceId: string;
  hostIpv4: string | null;
  hostIpv6?: string | null;
  privateIpv4: string | null;
  sshPort: number | null;
  metadata?: Record<string, unknown>;
}

export interface RunnerInstanceState {
  instanceId: string;
  status: string | null;
  privateIpv4: string | null;
  vcpu: number | null;
  memoryGb: number | null;
  diskGb: number | null;
}

export interface RunnerImageState {
  imageId: string;
  aliases: string[];
  cached: boolean;
}

export interface RunnerHostState {
  checkedAt: string;
  runnerd: 'ok';
  incus: {
    status: 'ok' | 'error';
    serverVersion: string | null;
    instanceCount: number;
    imageCount: number;
  };
  instances: RunnerInstanceState[];
  images: RunnerImageState[];
}

export interface BaremetalRunnerClient {
  createInstance(input: RunnerCreateInstanceInput): Promise<RunnerCreateInstanceResult>;
  deleteInstance(instanceId: string): Promise<void>;
  startInstance(instanceId: string): Promise<void>;
  stopInstance(instanceId: string): Promise<void>;
  rebootInstance(instanceId: string): Promise<void>;
  getState?(): Promise<RunnerHostState>;
  listSnapshots?(instanceId: string): Promise<Array<{ id: string; name: string; createdAt: string; status: string }>>;
  createSnapshot?(instanceId: string, name?: string): Promise<{ id: string; name: string; createdAt: string; status: string }>;
  restoreSnapshot?(instanceId: string, snapshotId: string): Promise<void>;
  deleteSnapshot?(instanceId: string, snapshotId: string): Promise<void>;
  publishImage?(instanceId: string, alias: string): Promise<{ imageId: string }>;
  deleteImage?(imageId: string): Promise<void>;
}
