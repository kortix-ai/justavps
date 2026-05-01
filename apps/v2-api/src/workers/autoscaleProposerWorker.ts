// Autoscale proposer worker. Every 5 minutes per cluster: read recent
// utilization samples, evaluate add/drain policies, write ScalingProposal
// rows for any positive result. Skips emitting duplicates if a pending
// proposal of the same kind is already on the queue (operator hasn't
// acted yet — don't pile on).

import {
  shouldProposeAddNode,
  shouldProposeDrainNode,
  type FillSample,
} from '../economics/autoscale.js';
import { recommendNextSku, type Sku } from '../economics/skuCatalog.js';

export type ProposalWrite = {
  kind: 'add-node' | 'drain-node' | 'terminate-node';
  clusterId: string;
  proposedSku: string | null;
  rationale: string;
  costImpactEurMo: number;
  expiresAt: Date;
  metadata: Record<string, unknown>;
};

export async function proposeForCluster(opts: {
  clusterId: string;
  fleetHostCount: number;
  samples: FillSample[];
  addThresholdPct: number;
  drainThresholdPct: number;
  sustainedMinutes: number;
  defaultSku: Sku;
  hasPendingProposalAlready: boolean;
  write: (w: ProposalWrite) => Promise<void>;
}): Promise<void> {
  if (opts.hasPendingProposalAlready) return; // don't pile on; let operator act first

  const addCheck = shouldProposeAddNode(opts.samples, {
    thresholdPct: opts.addThresholdPct,
    sustainedMinutes: opts.sustainedMinutes,
  });
  if (addCheck.shouldPropose) {
    const binding = addCheck.binding === 'vcpu' ? 'vcpus' : addCheck.binding;
    const recommendation = recommendNextSku({
      fleetHostCount: opts.fleetHostCount,
      bindingConstraint: binding,
    });
    const skuRec = recommendation.skuId;
    await opts.write({
      kind: 'add-node',
      clusterId: opts.clusterId,
      proposedSku: skuRec,
      rationale: `${addCheck.reason}. ${recommendation.rationale}`,
      costImpactEurMo: opts.defaultSku.monthlyEur,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      metadata: { binding: addCheck.binding },
    });
    return;
  }

  // Drain check requires more than 1 host (don't drain the only one).
  // We use the same sustained window as add — both directions need
  // matching responsiveness. Operator can pass a longer drain window
  // explicitly via opts.drainSustainedMinutes if needed.
  if (opts.fleetHostCount > 1) {
    const drainCheck = shouldProposeDrainNode(opts.samples, {
      thresholdPct: opts.drainThresholdPct,
      sustainedMinutes: opts.sustainedMinutes,
    });
    if (drainCheck.shouldPropose) {
      await opts.write({
        kind: 'drain-node',
        clusterId: opts.clusterId,
        proposedSku: null,
        rationale: drainCheck.reason,
        costImpactEurMo: -opts.defaultSku.monthlyEur, // negative = savings
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        metadata: {},
      });
    }
  }
}
