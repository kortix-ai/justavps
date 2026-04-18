/**
 * Machine Event Bus — Vercel-compatible (no in-memory state).
 *
 * Lifecycle state changes are persisted to the hot machine lifecycle stream
 * (`machines` + `machine_events`). High-volume retained telemetry is written to
 * bucketed rollups separately so SSE/OLTP and telemetry retention can evolve
 * independently. No in-memory pub/sub.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from "@/server/db/index";
import { machines, machineEvents } from "@/server/db/schema";
import { recordMachineTelemetry } from "@/server/platform/control-plane/machine-telemetry";
import { deliverWebhooks } from "@/server/platform/control-plane/webhook-delivery";

type MachineLifecycleEventType = 'stage_changed' | 'status_changed';
type MachineTelemetryEventType = 'heartbeat';
export type MachineEventType = MachineLifecycleEventType | MachineTelemetryEventType;
const MACHINE_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface MachineEvent {
  machineId: string;
  accountId: string;
  event: MachineEventType;
  stage?: string;
  status?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

class MachineEventBus {
  /**
   * Emit a stage change — persists to DB + delivers webhooks.
   * No in-memory pub/sub; SSE consumers poll machine_events.
   */
  async emitStageChange(
    machineId: string,
    accountId: string,
    stage: string,
    message?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const event: MachineEvent = {
      machineId,
      accountId,
      event: 'stage_changed',
      stage,
      message,
      metadata,
      timestamp: now.toISOString(),
    };

    const STAGE_ORDER = [
      'server_creating', 'server_created',
      'cloud_init_running', 'cloud_init_done',
      'services_starting', 'services_ready',
    ];

    try {
      const [current] = await db.select({ provisioningStage: machines.provisioningStage })
        .from(machines).where(eq(machines.id, machineId)).limit(1);
      const currentIdx = STAGE_ORDER.indexOf(current?.provisioningStage || '');
      const newIdx = STAGE_ORDER.indexOf(stage);
      const isForward = newIdx === -1 || newIdx > currentIdx;

      if (!isForward) return; // Stale/duplicate stage — skip entirely

      await db.update(machines).set({
        provisioningStage: stage,
        provisioningStageUpdatedAt: now,
      }).where(eq(machines.id, machineId));
    } catch (err) {
      console.error(`[EVENT-BUS] Failed to update machine stage:`, err);
      return;
    }

    try {
      await db.insert(machineEvents).values({
        machineId,
        accountId,
        event: 'stage_changed',
        stage,
        message: message ?? null,
        metadata: metadata ?? {},
      });
    } catch (err) {
      console.error(`[EVENT-BUS] Failed to insert event:`, err);
    }

    deliverWebhooks(accountId, event).catch((err) => {
      console.error(`[EVENT-BUS] Webhook delivery failed:`, err);
    });
  }

  /**
   * Emit a status change — persists to DB + delivers webhooks.
   */
  async emitStatusChange(
    machineId: string,
    accountId: string,
    status: string,
    message?: string,
  ): Promise<void> {
    const now = new Date();
    const event: MachineEvent = {
      machineId,
      accountId,
      event: 'status_changed',
      status,
      message,
      timestamp: now.toISOString(),
    };

    try {
      await db.insert(machineEvents).values({
        machineId,
        accountId,
        event: 'status_changed',
        stage: status,
        message: message ?? null,
        metadata: {},
      });
    } catch (err) {
      console.error(`[EVENT-BUS] Failed to insert status event:`, err);
    }

    deliverWebhooks(accountId, event).catch((err) => {
      console.error(`[EVENT-BUS] Webhook delivery failed:`, err);
    });
  }

  /**
   * Fire-and-forget event (e.g. heartbeat) — deliver webhooks and retain a
   * bucketed telemetry rollup outside the lifecycle event hot path.
   */
  async emitTransient(event: MachineEvent): Promise<void> {
    recordMachineTelemetry(event).catch((err) => {
      console.error(`[EVENT-BUS] Telemetry persistence failed:`, err);
    });

    deliverWebhooks(event.accountId, event).catch((err) => {
      console.error(`[EVENT-BUS] Webhook delivery failed:`, err);
    });
  }
}

export const eventBus = new MachineEventBus();

export async function pruneExpiredMachineEvents(input?: {
  now?: Date;
  limit?: number;
  executor?: Pick<typeof db, 'execute'>;
}) {
  const executor = input?.executor ?? db;
  const now = input?.now ?? new Date();
  const limit = input?.limit ?? 1000;
  const cutoff = new Date(now.getTime() - MACHINE_EVENT_RETENTION_MS).toISOString();

  const result = await executor.execute(sql<{ id: string }>`
    with expired as (
      select ${machineEvents.id}
      from ${machineEvents}
      where ${machineEvents.createdAt} < ${cutoff}::timestamp
      order by ${machineEvents.createdAt} asc
      limit ${limit}
    )
    delete from ${machineEvents}
    using expired
    where ${machineEvents.id} = expired.id
    returning ${machineEvents.id}
  `);

  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Array<{ id: string }> }).rows.length;
  }
  return 0;
}
