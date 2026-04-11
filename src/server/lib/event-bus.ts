/**
 * Machine Event Bus — Vercel-compatible (no in-memory state).
 *
 * Lifecycle state changes are persisted to the hot machine lifecycle stream
 * (`machines` + `machine_events`). High-volume retained telemetry is written to
 * bucketed rollups separately so SSE/OLTP and telemetry retention can evolve
 * independently. No in-memory pub/sub.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { machines, machineEvents } from '../db/schema';
import { recordMachineTelemetry } from './machine-telemetry';
import { deliverWebhooks } from './webhook-delivery';

export type MachineLifecycleEventType = 'stage_changed' | 'status_changed';
export type MachineTelemetryEventType = 'heartbeat';
export type MachineEventType = MachineLifecycleEventType | MachineTelemetryEventType;

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
