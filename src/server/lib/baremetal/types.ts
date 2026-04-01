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

export interface BaremetalRunnerClient {
  createInstance(input: RunnerCreateInstanceInput): Promise<RunnerCreateInstanceResult>;
  deleteInstance(instanceId: string): Promise<void>;
  startInstance(instanceId: string): Promise<void>;
  stopInstance(instanceId: string): Promise<void>;
  rebootInstance(instanceId: string): Promise<void>;
  publishImage?(instanceId: string, alias: string): Promise<{ imageId: string }>;
}
