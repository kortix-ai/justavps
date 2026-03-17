import { EventEmitter } from 'events';
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

export type MachineEventListener = (event: MachineEvent) => void;

class MachineEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  emit(event: MachineEvent): void {
    this.emitter.emit('machine_event', event);
    this.emitter.emit(`machine:${event.machineId}`, event);
  }

  on(listener: MachineEventListener): void {
    this.emitter.on('machine_event', listener);
  }

  off(listener: MachineEventListener): void {
    this.emitter.off('machine_event', listener);
  }

  onMachine(machineId: string, listener: MachineEventListener): void {
    this.emitter.on(`machine:${machineId}`, listener);
  }

  offMachine(machineId: string, listener: MachineEventListener): void {
    this.emitter.off(`machine:${machineId}`, listener);
  }

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

    this.emit(event);

    deliverWebhooks(ownerId, event).catch((err) => {
      console.error(`[EVENT-BUS] Webhook delivery failed:`, err);
    });
  }

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

    this.emit(event);

    deliverWebhooks(ownerId, event).catch((err) => {
      console.error(`[EVENT-BUS] Webhook delivery failed:`, err);
    });
  }
}

export const eventBus = new MachineEventBus();
