import type {
  BaremetalCellAdmissionState,
  BaremetalCellCapacitySnapshot,
  BaremetalCellSellabilityState,
  BaremetalCellState,
} from './cells';

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

export interface BaremetalPlacementResources {
  vcpu: number;
  memoryGb: number;
  diskGb: number;
}

export interface BaremetalSchedulerWarmPoolMetadata {
  enabled?: boolean | null;
  availableCpuBuckets?: number[] | null;
  exactResourceKeys?: string[] | null;
  ready?: number | null;
  target?: number | null;
}

export interface BaremetalSchedulerImageLocalityMetadata {
  state?: 'local' | 'remote' | 'warming' | 'unknown' | 'error' | null;
  imageIds?: string[] | null;
  aliases?: string[] | null;
}

export interface BaremetalSchedulerHostClassPolicyMetadata {
  scoreAdjustment?: number | null;
  labels?: string[] | null;
}

export interface BaremetalSchedulerHostMetadata {
  schedulable?: boolean | null;
  unschedulableReason?: string | null;
  driftStatus?: 'in_policy' | 'warning_drift' | 'blocking_drift' | null;
  warmPool?: BaremetalSchedulerWarmPoolMetadata | null;
  imageLocality?: BaremetalSchedulerImageLocalityMetadata | null;
  hostClassPolicy?: BaremetalSchedulerHostClassPolicyMetadata | null;
}

export interface BaremetalPlacementPolicy {
  requiredHostClass?: string | null;
  requiredCellId?: string | null;
  preferredHostClasses?: string[];
  preferredCellIds?: string[];
  warmPoolPreference?: 'prefer' | 'neutral' | 'avoid';
  requireLocalImage?: boolean;
  cellSpreadPreference?: 'spread' | 'pack' | 'neutral';
  maxProjectedUtilizationScore?: number | null;
  allowRestrictedCellAdmission?: boolean;
  allowReserveOnlySellability?: boolean;
}

export interface BaremetalPlacementRequest {
  region: string;
  resources: BaremetalPlacementResources;
  requestedHostId?: string;
  imageId?: string | null;
  imageAlias?: string | null;
  policy?: BaremetalPlacementPolicy;
}

export interface BaremetalHostCandidate {
  id: string;
  region: string;
  status: BaremetalHostStatus;
  hostClass?: string | null;
  generation?: string | null;
  cellId?: string | null;
  cell?: BaremetalCellState | null;
  maintenanceState?: string | null;
  runnerBaseUrl: string | null;
  publicIpv4: string | null;
  publicIpv6?: string | null;
  runnerToken?: string | null;
  metadata?: Record<string, unknown> | null;
  capacity: BaremetalCapacity;
}

export interface BaremetalPlacementCandidateEvaluation {
  hostId: string;
  eligible: boolean;
  score: number | null;
  reasons: string[];
  cell: BaremetalCellState | null;
  projectedUsage: BaremetalPlacementResources;
  cellProjectedUtilization: {
    hostCount: number;
    vcpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
    score: number;
    reserveBudget: BaremetalPlacementResources;
    projectedAvailable: BaremetalPlacementResources;
    projectedSellable: BaremetalPlacementResources;
    reserveSatisfied: boolean;
    admissionState: BaremetalCellAdmissionState;
    sellabilityState: BaremetalCellSellabilityState;
  } | null;
  projectedUtilization: {
    vcpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
    score: number;
  };
  schedulingHints: {
    requestedHost: boolean;
    warmPool: 'exact' | 'cpu_bucket' | 'none' | 'unknown';
    imageLocality: 'local' | 'remote' | 'warming' | 'unknown' | 'error';
    hostClass: string | null;
    generation: string | null;
    cellId: string | null;
    cellSlug: string | null;
    maintenanceState: string | null;
    schedulable: boolean;
    driftStatus: 'in_policy' | 'warning_drift' | 'blocking_drift' | null;
    admissionState: BaremetalCellAdmissionState;
    sellabilityState: BaremetalCellSellabilityState;
  };
}

export interface BaremetalPlacementDecision {
  outcome: 'placed' | 'rejected';
  selectedHostId: string | null;
  summary: string;
  explanation: string[];
  request: BaremetalPlacementRequest;
  policy: Required<Pick<BaremetalPlacementPolicy, 'warmPoolPreference' | 'requireLocalImage'>> & {
    requiredHostClass: string | null;
    requiredCellId: string | null;
    preferredHostClasses: string[];
    preferredCellIds: string[];
    cellSpreadPreference: 'spread' | 'pack' | 'neutral';
    maxProjectedUtilizationScore: number | null;
    allowRestrictedCellAdmission: boolean;
    allowReserveOnlySellability: boolean;
  };
  cells: BaremetalCellCapacitySnapshot[];
  candidates: BaremetalPlacementCandidateEvaluation[];
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
  decision: BaremetalPlacementDecision;
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
  sshPort?: number | null;
  httpPort?: number | null;
  machineMode?: 'vm' | 'container';
  labels?: Record<string, string>;
}

export interface RunnerCreateInstanceResult {
  instanceId: string;
  hostIpv4: string | null;
  hostIpv6?: string | null;
  privateIpv4: string | null;
  sshPort: number | null;
  httpPort?: number | null;
  metadata?: Record<string, unknown>;
}

export interface RunnerInstanceState {
  instanceId: string;
  status: string | null;
  privateIpv4: string | null;
  vcpu: number | null;
  memoryGb: number | null;
  diskGb: number | null;
  role?: string | null;
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
