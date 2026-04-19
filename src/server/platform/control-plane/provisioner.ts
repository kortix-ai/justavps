import {
  enqueueControlPlaneJob,
  processDueControlPlaneJobs,
  registerControlPlaneJobHandler,
  type ControlPlaneJobHandler,
} from "@/server/v2/services/control-plane-jobs";

import {
  acquireControlPlaneServiceLease,
  buildControlPlaneServiceKey,
  releaseControlPlaneServiceLease,
} from "@/server/platform/control-plane/service-state";

const CONTROL_PLANE_PROVISIONER_SERVICE = 'provisioner' as const;
export const MACHINE_CREATE_JOB_TYPE = 'machine_create' as const;
const MACHINE_CREATE_SERVICE_SCOPE = 'machine_create';

export function machineCreateJobIdempotencyKey(machineId: string) {
  return `machine_create:${machineId}`;
}

export async function enqueueMachineCreateJob(input: Parameters<typeof enqueueControlPlaneJob>[0]) {
  return enqueueControlPlaneJob(input);
}

export function registerMachineCreateJobHandler(handler: ControlPlaneJobHandler) {
  registerControlPlaneJobHandler(MACHINE_CREATE_JOB_TYPE, handler);
}

export function ensureProvisionerServiceWorker() {
  // Background loops are owned by the explicit control-plane runtime.
}

export function kickProvisionerServiceWorker(limit = 1) {
  void runProvisionerServicePass({ limit }).catch((error) => {
    console.error('[CONTROL-PLANE-PROVISIONER] kick failed:', error);
  });
}

export async function runProvisionerServicePass(options?: {
  limit?: number;
  leaseMs?: number;
  leaseOwner?: string;
}) {
  const lease = await acquireControlPlaneServiceLease({
    service: CONTROL_PLANE_PROVISIONER_SERVICE,
    scope: MACHINE_CREATE_SERVICE_SCOPE,
    leaseMs: options?.leaseMs,
    leaseOwner: options?.leaseOwner,
  });
  if (!lease.acquired) {
    return {
      acquired: false,
      processed: 0,
      leaseOwner: lease.leaseOwner,
      scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_PROVISIONER_SERVICE, scope: MACHINE_CREATE_SERVICE_SCOPE }),
    };
  }

  const jobs = await processDueControlPlaneJobs({
    jobTypes: [MACHINE_CREATE_JOB_TYPE],
    limit: options?.limit,
    leaseOwner: lease.leaseOwner,
    leaseMs: options?.leaseMs,
  });

  await releaseControlPlaneServiceLease({
    service: CONTROL_PLANE_PROVISIONER_SERVICE,
    scope: MACHINE_CREATE_SERVICE_SCOPE,
    leaseOwner: lease.leaseOwner,
    checkpoint: {
      last_processed_at: new Date().toISOString(),
      last_processed_count: jobs.length,
      last_job_ids: jobs.map((job) => job.id).slice(0, 25),
    },
    metadata: {
      last_job_type: MACHINE_CREATE_JOB_TYPE,
    },
  });

  return {
    acquired: true,
    processed: jobs.length,
    leaseOwner: lease.leaseOwner,
    scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_PROVISIONER_SERVICE, scope: MACHINE_CREATE_SERVICE_SCOPE }),
  };
}
