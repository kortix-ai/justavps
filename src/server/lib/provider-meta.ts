/**
 * Thin helper to read/patch the providerMeta JSONB column on a machine row.
 * Extracted so it can be imported without pulling in the full machine-lifecycle module.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { machines } from '../db/schema';

interface ProviderMetaPatch {
  create_action_id?: string | null;
  create_progress?: number | null;
  create_status?: string | null;
  public_ipv4?: string | null;
  public_ipv6?: string | null;
  callback_expected?: boolean;
  callback_url?: string | null;
  last_callback_at?: string | null;
  last_probe_at?: string | null;
  ready_via?: 'heartbeat' | 'probe' | null;
  daemon_reachable_at?: string | null;
  [key: string]: unknown;
}

export async function updateProviderMeta(machineId: string, patch: ProviderMetaPatch) {
  const [current] = await db
    .select({ providerMeta: machines.providerMeta })
    .from(machines)
    .where(eq(machines.id, machineId));
  const merged = {
    ...((current?.providerMeta ?? {}) as ProviderMetaPatch),
    ...patch,
  };
  await db.update(machines).set({
    providerMeta: merged,
    createActionId: patch.create_action_id ?? undefined,
    lastCallbackAt: patch.last_callback_at ?? undefined,
    lastProbeAt: patch.last_probe_at ?? undefined,
    daemonReachableAt: patch.daemon_reachable_at ?? undefined,
    readyVia: patch.ready_via ?? undefined,
  }).where(eq(machines.id, machineId));
  return merged;
}
