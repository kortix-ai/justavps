/**
 * Machine Event Bus — Vercel-compatible (no in-memory state).
 *
 * All state changes are persisted to DB (machines + machine_events tables).
 * SSE consumers poll the DB. The "emit" methods here only write to DB and
 * trigger webhook delivery — no in-memory pub/sub.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { machines, machineEvents } from '../db/schema';
import { deliverWebhooks } from './webhook-delivery';

export type MachineEventType = 'stage_changed' | 'status_changed' | 'heartbeat';

export interface MachineEvent {
  machineId: string;
  ownerId: string;
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
    ownerId: string,
    stage: string,
    message?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const event: MachineEvent = {
      machineId,
      ownerId,
      event: 'stage_changed',
      stage,
      message,
      metadata,
      timestamp: now.toISOString(),
    };

    try {
      await db.update(machines).set({
        provisioningStage: stage,
        provisioningStageUpdatedAt: now,
      }).where(eq(machines.id, machineId));
    } catch (err) {
      console.error(`[EVENT-BUS] Failed to update machine stage:`, err);
    }

    try {
      await db.insert(machineEvents).values({
        machineId,
        event: 'stage_changed',
        stage,
        message: message ?? null,
        metadata: metadata ?? {},
      });
    } catch (err) {
      console.error(`[EVENT-BUS] Failed to insert event:`, err);
    }

    deliverWebhooks(ownerId, event).catch((err) => {
      console.error(`[EVENT-BUS] Webhook delivery failed:`, err);
    });
  }

  /**
   * Emit a status change — persists to DB + delivers webhooks.
   */
  async emitStatusChange(
    machineId: string,
    ownerId: string,
    status: string,
    message?: string,
  ): Promise<void> {
    const now = new Date();
    const event: MachineEvent = {
      machineId,
      ownerId,
      event: 'status_changed',
      status,
      message,
      timestamp: now.toISOString(),
    };

    try {
      await db.insert(machineEvents).values({
        machineId,
        event: 'status_changed',
        stage: status,
        message: message ?? null,
        metadata: {},
      });
    } catch (err) {
      console.error(`[EVENT-BUS] Failed to insert status event:`, err);
    }

    deliverWebhooks(ownerId, event).catch((err) => {
      console.error(`[EVENT-BUS] Webhook delivery failed:`, err);
    });
  }

  /**
   * Fire-and-forget event (e.g. heartbeat) — just deliver webhooks.
   * Used for events that don't need DB persistence (heartbeat data
   * is already stored on the machines row by the caller).
   */
  async emitTransient(event: MachineEvent): Promise<void> {
    deliverWebhooks(event.ownerId, event).catch((err) => {
      console.error(`[EVENT-BUS] Webhook delivery failed:`, err);
    });
  }
}

export const eventBus = new MachineEventBus();
