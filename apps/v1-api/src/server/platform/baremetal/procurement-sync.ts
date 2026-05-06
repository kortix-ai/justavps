/**
 * Background procurement synchronization.
 *
 * When an operator approves a procurement, we call the Hetzner Robot API to
 * place the order. Hetzner then takes minutes to hours to actually allocate a
 * physical box. During that window our DB row shows `status='ordering'` with
 * no IP / server number.
 *
 * Rather than ask operators to click "Sync" manually, the fleet-auditor
 * periodic service calls {@link syncPendingProcurements} each pass to poll
 * Hetzner for every non-terminal procurement and update our rows as the order
 * progresses (`ordering` → `bootstrapping` → `active`).
 */
import { and, eq, inArray } from 'drizzle-orm';

import { config } from '@/server/core/config';
import { db } from '@/server/db';
import { baremetalHosts, baremetalProcurements } from '@/server/db/schema';
import { HetznerRobotClient } from '@/server/platform/baremetal/vendors/hetzner-robot';

const OPEN_PROCUREMENT_STATES = ['ordering', 'approved'] as const;

interface ProcurementSyncResult {
  checked: number;
  updated: number;
  promotedToBootstrapping: number;
  errors: Array<{ procurementId: string; error: string }>;
}

/**
 * Poll Hetzner Robot for every procurement in a non-terminal state and write
 * back any state changes. Safe to call concurrently — each procurement is
 * processed independently and writes are idempotent.
 */
export async function syncPendingProcurements(): Promise<ProcurementSyncResult> {
  if (!config.hasHetznerRobotCredentials()) {
    return { checked: 0, updated: 0, promotedToBootstrapping: 0, errors: [] };
  }

  const open = await db
    .select()
    .from(baremetalProcurements)
    .where(inArray(baremetalProcurements.status, OPEN_PROCUREMENT_STATES));

  const withTx = open.filter((p) => p.providerTransactionId);
  if (withTx.length === 0) {
    return { checked: 0, updated: 0, promotedToBootstrapping: 0, errors: [] };
  }

  const robot = new HetznerRobotClient();
  const errors: ProcurementSyncResult['errors'] = [];
  let updated = 0;
  let promotedToBootstrapping = 0;

  for (const procurement of withTx) {
    try {
      const tx = await robot.getOrderTransaction(procurement.providerTransactionId!);
      const ready = tx.transaction.status === 'ready';
      const nextStatus = ready ? 'bootstrapping' : procurement.status;
      const now = new Date();

      await db
        .update(baremetalProcurements)
        .set({
          status: nextStatus,
          metadata: {
            ...(procurement.metadata ?? {}),
            order_status: tx.transaction.status,
            server_ip: tx.transaction.server_ip,
            last_sync_at: now.toISOString(),
          },
          resolvedAt: ready ? now : procurement.resolvedAt,
          updatedAt: now,
        })
        .where(eq(baremetalProcurements.id, procurement.id));

      if (procurement.hostId) {
        await db
          .update(baremetalHosts)
          .set({
            status: ready ? 'bootstrapping' : 'ordering',
            providerServerNumber: tx.transaction.server_number
              ? String(tx.transaction.server_number)
              : null,
            publicIpv4: tx.transaction.server_ip,
            metadata: {
              order_status: tx.transaction.status,
              procurement_id: procurement.id,
            },
            updatedAt: now,
          })
          .where(and(eq(baremetalHosts.id, procurement.hostId)));
      }

      updated += 1;
      if (ready && procurement.status !== 'bootstrapping') promotedToBootstrapping += 1;
    } catch (err) {
      errors.push({
        procurementId: procurement.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    checked: withTx.length,
    updated,
    promotedToBootstrapping,
    errors,
  };
}
