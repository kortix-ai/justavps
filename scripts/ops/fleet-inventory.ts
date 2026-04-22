/**
 * Fleet inventory — READ ONLY.
 *
 * Prints a snapshot of what exists in the Hetzner Robot account, the Hetzner
 * Cloud project, and the local DB (machines, baremetal hosts, regions,
 * procurements). Use this before any destructive cleanup to know the scope.
 *
 * Run:
 *   pnpm tsx -r dotenv/config scripts/ops/fleet-inventory.ts
 */
import { HetznerRobotClient } from "@/server/platform/baremetal/vendors/hetzner-robot";
import { db } from "@/server/db";
import {
  baremetalHosts,
  baremetalProcurements,
  machines,
  regions,
} from "@/server/db/schema";
import { eq, isNull } from "drizzle-orm";

function fmt(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function robotInventory() {
  console.log("\n=== Hetzner Robot (dedicated / baremetal) ===");
  try {
    const robot = new HetznerRobotClient();
    const servers = await robot.listServers();
    console.log(`robot.servers.count=${servers.length}`);
    for (const { server } of servers) {
      console.log(
        `  - #${server.server_number} ${server.server_name ?? "(unnamed)"} | ${server.product} | ${server.dc} | status=${server.status} | cancelled=${server.cancelled} | ip=${server.server_ip ?? "—"}${server.paid_until ? ` | paid_until=${server.paid_until}` : ""}`,
      );
    }

    const keys = await robot.listKeys();
    console.log(`robot.ssh_keys.count=${keys.length}`);
    for (const { key } of keys) {
      console.log(`  - ${key.name} | ${key.fingerprint}`);
    }
  } catch (err) {
    console.log(`robot.error=${fmt(err instanceof Error ? err.message : err)}`);
  }
}

async function cloudInventory() {
  console.log("\n=== Hetzner Cloud (VM) — via provider module ===");
  const apiKey = process.env.HETZNER_API_KEY;
  if (!apiKey) {
    console.log("cloud.skipped=HETZNER_API_KEY not set");
    return;
  }
  try {
    const res = await fetch("https://api.hetzner.cloud/v1/servers?per_page=50", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.log(`cloud.error=${res.status} ${res.statusText}`);
      return;
    }
    const data = (await res.json()) as { servers: Array<{ id: number; name: string; status: string; server_type: { name: string }; datacenter: { location: { name: string } }; public_net?: { ipv4?: { ip?: string } | null } }> };
    console.log(`cloud.servers.count=${data.servers.length}`);
    for (const s of data.servers) {
      console.log(
        `  - #${s.id} ${s.name} | ${s.server_type.name} | ${s.datacenter.location.name} | ${s.status} | ip=${s.public_net?.ipv4?.ip ?? "—"}`,
      );
    }
  } catch (err) {
    console.log(`cloud.error=${fmt(err instanceof Error ? err.message : err)}`);
  }
}

async function dbInventory() {
  console.log("\n=== Local DB (control plane) ===");

  const [machineRows, bmHostRows, regionRows, procurementRows] = await Promise.all([
    db.select().from(machines),
    db.select().from(baremetalHosts),
    db.select().from(regions),
    db.select().from(baremetalProcurements),
  ]);

  const liveMachines = machineRows.filter((m) => m.deletedAt === null);
  const deletedMachines = machineRows.filter((m) => m.deletedAt !== null);
  console.log(`db.machines.total=${machineRows.length} live=${liveMachines.length} deleted=${deletedMachines.length}`);
  for (const m of liveMachines) {
    console.log(
      `  - ${m.slug} | ${m.status} | ${m.provider} | server_type=${m.serverType} | region=${m.region} | provider_server_id=${m.providerServerId ?? "—"} | baremetal_host_id=${m.baremetalHostId ?? "—"}`,
    );
  }
  if (deletedMachines.length > 0) {
    console.log(`  (${deletedMachines.length} soft-deleted rows — not listed)`);
  }

  console.log(`db.regions.total=${regionRows.length}`);
  for (const r of regionRows) {
    console.log(
      `  - ${r.id} | ${r.label} | ${r.continent} | admission=${r.admissionState} | sellability=${r.sellabilityState} | active=${r.active}`,
    );
  }

  console.log(`db.baremetal_hosts.total=${bmHostRows.length}`);
  for (const h of bmHostRows) {
    console.log(
      `  - ${h.name} | ${h.status} | ${h.hostClass} | ${h.region}/${h.location} | provider_server=${h.providerServerNumber ?? "—"} | ip=${h.publicIpv4 ?? "—"}`,
    );
  }

  const openProc = procurementRows.filter((p) => p.resolvedAt === null);
  console.log(`db.procurements.total=${procurementRows.length} open=${openProc.length}`);
  for (const p of openProc) {
    console.log(
      `  - ${p.id} | ${p.vendor} | ${p.productId} | ${p.location} | ${p.status}`,
    );
  }

  // Suppress unused-var warnings for helpers used only when extending later.
  void eq;
  void isNull;
}

async function main() {
  console.log("=== JustAVPS Fleet Inventory (read-only) ===");
  console.log(`timestamp=${new Date().toISOString()}`);
  await robotInventory();
  await cloudInventory();
  await dbInventory();
  console.log("\n=== done (nothing deleted) ===");
}

main().catch((err) => {
  console.error("[fleet-inventory] fatal:", err);
  process.exit(1);
});
