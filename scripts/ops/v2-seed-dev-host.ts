/**
 * Seed a dev-only bare-metal host that points at the local runnerd simulator.
 *
 * Idempotent — safe to run repeatedly.
 *
 * Run:
 *   pnpm v2:seed:dev
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig();
dotenvConfig({ path: ".env.local", override: true });

import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { baremetalHosts } from "@/server/db/schema";

const HOST_ID = process.env.SIM_HOST_ID ?? "ed822eae-59ef-4601-8782-a17cc85196ab";
const HOST_IPV4 = process.env.SIM_HOST_IPV4 ?? "127.0.0.1";
const RUNNER_BASE_URL = process.env.SIM_RUNNER_BASE_URL ?? "http://127.0.0.1:7780";
const RUNNER_TOKEN = process.env.DEV_RUNNERD_TOKEN ?? "dev-runnerd-token";

const REGION = "hel1";
const HOST_CLASS = "general-small";

async function main() {
  console.log("=== v2 seed dev host ===");

  const [existingHost] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, HOST_ID));
  const hostPayload = {
    id: HOST_ID,
    vendor: "dev-sim" as const,
    hostClass: HOST_CLASS,
    region: REGION,
    location: "dev-sim-local",
    name: "dev-sim-host",
    status: "active" as const,
    publicIpv4: HOST_IPV4,
    publicIpv6: null,
    runnerBaseUrl: RUNNER_BASE_URL,
    runnerToken: RUNNER_TOKEN,
    totalVcpu: 32,
    totalMemoryGb: 128,
    totalDiskGb: 2000,
    usedVcpu: 0,
    usedMemoryGb: 0,
    usedDiskGb: 0,
    maintenanceState: "in_service" as const,
    lastHeartbeatAt: new Date(),
    metadata: {
      bootstrap_source: "dev-sim",
      scheduler: { schedulable: true, updated_at: new Date().toISOString(), updated_by: "v2-seed-dev-host" },
      bootstrap_validation: {
        status: "passed",
        runnerd_version: "dev-sim-1.0.0",
        incus_version: "sim-6.0",
        storage_driver: "local",
        storage_pool: "sim",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        smoke_test_result: "passed",
        warm_pool_result: "passed",
        triggered_by: "dev-sim",
        notes: ["synthetic host — local runnerd simulator"],
      },
      drift_status: "in_policy",
      incus_ui: { exposure: "disabled", url: null, note: "dev sim", updated_at: new Date().toISOString() },
    } satisfies Record<string, unknown>,
    updatedAt: new Date(),
  };

  if (existingHost) {
    await db.update(baremetalHosts).set({
      ...hostPayload,
      updatedAt: new Date(),
    }).where(eq(baremetalHosts.id, HOST_ID));
    console.log(`[seed] updated existing host ${HOST_ID}`);
  } else {
    await db.insert(baremetalHosts).values(hostPayload);
    console.log(`[seed] inserted host ${HOST_ID}`);
  }

  console.log(`publicIpv4=${HOST_IPV4}`);
  console.log(`runnerBaseUrl=${RUNNER_BASE_URL}`);
  console.log(`runnerToken=${RUNNER_TOKEN.slice(0, 6)}…`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] fatal:", err);
    process.exit(1);
  });
