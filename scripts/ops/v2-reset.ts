/**
 * v2 dev reset — wipes all v2-scoped control-plane state so e2e can start
 * from a clean slate. v1 machines and anything v1-scoped are left alone.
 * Regions are seeded data, not wiped.
 *
 * Removes:
 *   - machines WHERE api_version = 'v2' (and their dependents)
 *   - host_capacity_reservations
 *   - baremetal_procurements
 *   - baremetal_hosts
 *   - control_plane_service_states (reconciler checkpoints)
 *   - .e2e-checkpoints/*.json (on-disk test checkpoints)
 *
 * Run:
 *   pnpm tsx -r dotenv/config scripts/ops/v2-reset.ts            # dry-run
 *   pnpm tsx -r dotenv/config scripts/ops/v2-reset.ts --apply    # actually delete
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig();
dotenvConfig({ path: ".env.local", override: true });

import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import {
  baremetalHosts,
  baremetalProcurements,
  controlPlaneServiceStates,
  hostCapacityReservations,
  machineEvents,
  machines,
} from "@/server/db/schema";

const APPLY = process.argv.includes("--apply");
const CHECKPOINT_DIR = join(process.cwd(), ".e2e-checkpoints");

async function listV2MachineIds(): Promise<string[]> {
  const rows = await db.select({ id: machines.id }).from(machines).where(eq(machines.apiVersion, "v2"));
  return rows.map((r) => r.id);
}

function clearCheckpoints(): { dir: string; files: string[] } {
  if (!existsSync(CHECKPOINT_DIR)) return { dir: CHECKPOINT_DIR, files: [] };
  const files = readdirSync(CHECKPOINT_DIR).filter((f) => f.endsWith(".json"));
  if (APPLY) {
    for (const file of files) unlinkSync(join(CHECKPOINT_DIR, file));
  }
  return { dir: CHECKPOINT_DIR, files };
}

async function main() {
  console.log(`=== v2 reset (${APPLY ? "APPLY" : "dry-run"}) ===`);

  const v2Ids = await listV2MachineIds();
  const [hosts, procurements, reservations, services] = await Promise.all([
    db.select().from(baremetalHosts),
    db.select().from(baremetalProcurements),
    db.select().from(hostCapacityReservations),
    db.select().from(controlPlaneServiceStates),
  ]);

  console.log(`v2_machines (rows): ${v2Ids.length}`);
  console.log(`baremetal_hosts: ${hosts.length}`);
  console.log(`host_capacity_reservations: ${reservations.length}`);
  console.log(`baremetal_procurements: ${procurements.length}`);
  console.log(`control_plane_service_states: ${services.length}`);

  const checkpoints = clearCheckpoints();
  console.log(`e2e checkpoint files: ${checkpoints.files.length}`);
  for (const f of checkpoints.files) console.log(`  - ${f}`);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to delete.");
    return;
  }

  // Delete v2 machines — most FKs to machine_id are ON DELETE CASCADE / SET NULL.
  // machine_events.machine_id has NO cascade, so we purge those rows first.
  await db.delete(hostCapacityReservations);
  await db.delete(baremetalProcurements);
  if (v2Ids.length > 0) {
    await db.delete(machineEvents).where(inArray(machineEvents.machineId, v2Ids));
  }
  for (const id of v2Ids) {
    await db.delete(machines).where(eq(machines.id, id));
  }
  await db.delete(baremetalHosts);
  await db.delete(controlPlaneServiceStates);

  console.log("\n=== v2 reset complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[v2-reset] fatal:", err);
    process.exit(1);
  });
