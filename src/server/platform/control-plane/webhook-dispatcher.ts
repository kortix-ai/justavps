import { processDueControlPlaneJobs } from "@/server/v2/services/control-plane-jobs";
import { pruneTerminalControlPlaneJobs } from "@/server/v2/services/control-plane-jobs";
import { pruneTerminalWebhookDeliveries } from "@/server/platform/control-plane/webhook-delivery";

import {
  acquireControlPlaneServiceLease,
  buildControlPlaneServiceKey,
  releaseControlPlaneServiceLease,
} from "@/server/platform/control-plane/service-state";

const CONTROL_PLANE_WEBHOOK_DISPATCHER_SERVICE = 'webhook_dispatcher' as const;
const WEBHOOK_DELIVERY_SCOPE = 'webhook_deliver';

export async function runWebhookDispatcherServicePass(options?: {
  limit?: number;
  leaseMs?: number;
  leaseOwner?: string;
}) {
  const lease = await acquireControlPlaneServiceLease({
    service: CONTROL_PLANE_WEBHOOK_DISPATCHER_SERVICE,
    scope: WEBHOOK_DELIVERY_SCOPE,
    leaseMs: options?.leaseMs,
    leaseOwner: options?.leaseOwner,
  });
  if (!lease.acquired) {
    return {
      acquired: false,
      processed: 0,
      leaseOwner: lease.leaseOwner,
      scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_WEBHOOK_DISPATCHER_SERVICE, scope: WEBHOOK_DELIVERY_SCOPE }),
    };
  }

  const jobs = await processDueControlPlaneJobs({
    jobTypes: ['webhook_deliver'],
    limit: options?.limit,
    leaseOwner: lease.leaseOwner,
    leaseMs: options?.leaseMs,
  });
  const prunedJobs = await pruneTerminalControlPlaneJobs({ limit: 1000 });
  const prunedDeliveries = await pruneTerminalWebhookDeliveries({ limit: 1000 });

  await releaseControlPlaneServiceLease({
    service: CONTROL_PLANE_WEBHOOK_DISPATCHER_SERVICE,
    scope: WEBHOOK_DELIVERY_SCOPE,
    leaseOwner: lease.leaseOwner,
    checkpoint: {
      last_processed_at: new Date().toISOString(),
      last_processed_count: jobs.length,
      last_job_ids: jobs.map((job) => job.id).slice(0, 25),
      last_pruned_jobs_count: prunedJobs,
      last_pruned_deliveries_count: prunedDeliveries,
    },
    metadata: {
      last_job_type: 'webhook_deliver',
    },
  });

  return {
    acquired: true,
    processed: jobs.length,
    jobsPruned: prunedJobs,
    deliveriesPruned: prunedDeliveries,
    leaseOwner: lease.leaseOwner,
    scope: buildControlPlaneServiceKey({ service: CONTROL_PLANE_WEBHOOK_DISPATCHER_SERVICE, scope: WEBHOOK_DELIVERY_SCOPE }),
  };
}
