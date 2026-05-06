/**
 * Bare-metal placement types.
 *
 * Topology: Region → Cluster → Host → Machine. Scheduling is still a pure
 * per-host decision inside the selected cluster —
 * filter hosts by region + host_class + schedulability, score by projected
 * utilization + warm-pool/image-locality bonuses, pick the best. Region-level
 * admission (open/restricted/closed, sellable/reserve_only/unsellable) is
 * enforced by the caller, not the scheduler.
 */

type BaremetalHostStatus =
  | 'requested'
  | 'ordering'
  | 'bootstrapping'
  | 'active'
  | 'draining'
  | 'disabled'
  | 'error'
  | 'deleted';

interface BaremetalCapacity {
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

interface BaremetalSchedulerWarmPoolMetadata {
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

interface BaremetalSchedulerHostClassPolicyMetadata {
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
  preferredHostClasses?: string[];
  warmPoolPreference?: 'prefer' | 'neutral' | 'avoid';
  requireLocalImage?: boolean;
  hostSpreadPreference?: 'spread' | 'pack' | 'neutral';
  maxProjectedUtilizationScore?: number | null;
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
  projectedUsage: BaremetalPlacementResources;
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
    maintenanceState: string | null;
    schedulable: boolean;
    driftStatus: 'in_policy' | 'warning_drift' | 'blocking_drift' | null;
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
    preferredHostClasses: string[];
    hostSpreadPreference: 'spread' | 'pack' | 'neutral';
    maxProjectedUtilizationScore: number | null;
  };
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
  sshProxyEnabled?: boolean;
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

export interface RunnerExecInstanceInput {
  command: string;
  args?: string[];
  cwd?: string;
  envVars?: Record<string, string>;
  user?: string;
  group?: string;
  timeoutMs?: number;
}

export interface RunnerExecInstanceResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunnerInstanceState {
  instanceId: string;
  status: string | null;
  privateIpv4: string | null;
  vcpu: number | null;
  memoryGb: number | null;
  diskGb: number | null;
  role?: string | null;
}

interface RunnerImageState {
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
  execInstance(instanceId: string, input: RunnerExecInstanceInput): Promise<RunnerExecInstanceResult>;
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
