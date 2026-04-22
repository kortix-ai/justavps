/**
 * v2 dev inventory — READ ONLY, v2 scope only.
 *
 * Run:
 *   pnpm tsx -r dotenv/config scripts/ops/v2-inventory.ts
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig();
dotenvConfig({ path: ".env.local", override: true });

import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  baremetalHosts,
  baremetalProcurements,
  controlPlaneServiceStates,
  hostCapacityReservations,
  machines,
  regions,
} from "@/server/db/schema";

async function main() {
  const [
    v2Machines,
    hosts,
    regionRows,
    procurements,
    controlPlane,
    reservations,
  ] = await Promise.all([
    db.select().from(machines).where(eq(machines.apiVersion, "v2")),
    db.select().from(baremetalHosts),
    db.select().from(regions),
    db.select().from(baremetalProcurements),
    db.select().from(controlPlaneServiceStates),
    db.select().from(hostCapacityReservations),
  ]);

  const liveV2 = v2Machines.filter((m) => m.deletedAt === null);
  const deletedV2 = v2Machines.filter((m) => m.deletedAt !== null);

  console.log("=== v2 inventory ===");
  console.log(`v2_machines: total=${v2Machines.length} live=${liveV2.length} soft_deleted=${deletedV2.length}`);
  for (const m of liveV2) {
    console.log(
      `  - ${m.slug} | ${m.status} | provider=${m.provider} | type=${m.serverType} | mode=${m.machineMode ?? "n/a"} | created=${m.createdAt.toISOString()}`,
    );
  }
  console.log(`regions: ${regionRows.length}`);
  for (const r of regionRows) {
    console.log(`  - ${r.id} | ${r.label} | ${r.continent} | admission=${r.admissionState} | sellability=${r.sellabilityState} | active=${r.active}`);
  }
  console.log(`baremetal_hosts: ${hosts.length}`);
  for (const h of hosts) {
    console.log(`  - ${h.name} | ${h.status} | ${h.hostClass} | ${h.region}/${h.location}`);
  }
  console.log(`baremetal_procurements: total=${procurements.length} open=${procurements.filter((p) => p.resolvedAt === null).length}`);
  console.log(`control_plane_service_states: ${controlPlane.length}`);
  console.log(`host_capacity_reservations: ${reservations.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
