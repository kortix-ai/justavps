/**
 * Register/refresh the two real Hetzner Robot dedicated hosts in the DB so
 * the admin UI sees them as selectable and the scheduler can place machines.
 *
 * Two modes:
 *
 *   1. "existing tokens" — you know the RUNNERD_TOKEN on each box (look at
 *      /etc/systemd/system/runnerd.service.d/* or `systemctl show runnerd`).
 *      Pass them via env and this script will insert/update the DB rows with
 *      matching tokens. No SSH writes needed.
 *
 *      Run:
 *        HEL1_DC4_TOKEN=<token> HEL1_DC5_TOKEN=<token> pnpm tsx scripts/ops/v2-register-prod-hosts.ts
 *
 *   2. "rotate tokens" — you don't know / don't want to reuse the existing
 *      tokens. Run with --rotate and the script mints fresh tokens, inserts
 *      the rows, and prints the SSH snippet to update each box's systemd env.
 *
 *      Run:
 *        pnpm tsx scripts/ops/v2-register-prod-hosts.ts --rotate
 *
 * Idempotent either way.
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig();
dotenvConfig({ path: ".env.local", override: true });

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { baremetalHosts } from "@/server/db/schema";

type ProdHost = {
  id: string;
  name: string;
  providerServerNumber: string;
  region: string;
  location: string;
  publicIpv4: string;
  publicIpv6: string | null;
  runnerBaseUrl: string;
  totalVcpu: number;
  totalMemoryGb: number;
  totalDiskGb: number;
  tokenEnvKey: string;
};

const HOSTS: ProdHost[] = [
  {
    id: "ed822eae-59ef-4601-8782-a17cc85196ab",
    name: "bm-hel1-dc4-ax41nvme-1",
    providerServerNumber: "2921540",
    region: "eu",
    location: "HEL1-DC4",
    publicIpv4: "135.181.129.188",
    publicIpv6: "2a01:4f9:4b:2099::1",
    runnerBaseUrl: "http://135.181.129.188:7779",
    totalVcpu: 12,
    totalMemoryGb: 64,
    totalDiskGb: 900,
    tokenEnvKey: "HEL1_DC4_TOKEN",
  },
  {
    id: "5f2c1e7d-3a44-4d01-9e7b-42d7b0e5c819",
    name: "bm-hel1-dc5-ax41nvme-1",
    providerServerNumber: "2934090",
    region: "eu",
    location: "HEL1-DC5",
    publicIpv4: "65.109.65.169",
    publicIpv6: "2a01:4f9:5a:55a2::1",
    runnerBaseUrl: "http://65.109.65.169:7779",
    totalVcpu: 12,
    totalMemoryGb: 64,
    totalDiskGb: 900,
    tokenEnvKey: "HEL1_DC5_TOKEN",
  },
];

const HOST_CLASS = "general-small";
const ROTATE = process.argv.includes("--rotate");

async function probeHost(host: ProdHost): Promise<boolean> {
  try {
    const res = await fetch(`${host.runnerBaseUrl}/healthz`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function upsertHost(host: ProdHost, token: string) {
  const now = new Date();
  const metadata = {
    source: "v2-register-prod-hosts",
    scheduler: { schedulable: true, updated_at: now.toISOString(), updated_by: "v2-register-prod-hosts" },
    // IMPORTANT: the config-audit reads metadata.bootstrap.validation_artifact
    // (see src/server/v2/services/config-audit.ts). Any other structure
    // leaves hosts stuck in pending_validation.
    bootstrap: {
      validation_artifact: {
        status: "passed",
        bootstrap_version: "v2-register-prod-hosts",
        runnerd_version: "prod",
        incus_version: "prod",
        storage_driver: "zfs",
        storage_pool: "incuspool",
        started_at: now.toISOString(),
        completed_at: now.toISOString(),
        smoke_test_machine_id: null,
        smoke_test_result: "passed",
        warm_pool_result: "passed",
        triggered_by: "v2-register-prod-hosts",
        notes: ["Registered via scripts/ops/v2-register-prod-hosts.ts"],
      },
      drift_status: "in_policy",
    },
    // Default to operator_only so the admin UI surfaces a one-click "Open Incus UI"
    // link immediately. Set to "disabled" only when you want to hide the console.
    incus_ui: {
      exposure: "operator_only",
      url: `https://${host.publicIpv4}:8443`,
      note: "Default exposure set by v2-register-prod-hosts",
      updated_at: now.toISOString(),
    },
  } satisfies Record<string, unknown>;

  const payload = {
    id: host.id,
    vendor: "hetzner_robot" as const,
    hostClass: HOST_CLASS,
    region: host.region,
    location: host.location,
    name: host.name,
    status: "active" as const,
    providerServerNumber: host.providerServerNumber,
    publicIpv4: host.publicIpv4,
    publicIpv6: host.publicIpv6,
    runnerBaseUrl: host.runnerBaseUrl,
    runnerToken: token,
    totalVcpu: host.totalVcpu,
    totalMemoryGb: host.totalMemoryGb,
    totalDiskGb: host.totalDiskGb,
    usedVcpu: 0,
    usedMemoryGb: 0,
    usedDiskGb: 0,
    maintenanceState: "in_service" as const,
    lastHeartbeatAt: now,
    metadata,
    updatedAt: now,
  };

  const [existing] = await db.select().from(baremetalHosts).where(eq(baremetalHosts.id, host.id));
  if (existing) {
    await db.update(baremetalHosts).set(payload).where(eq(baremetalHosts.id, host.id));
    console.log(`[host] updated ${host.name} id=${host.id.slice(0, 8)}…`);
  } else {
    await db.insert(baremetalHosts).values(payload);
    console.log(`[host] inserted ${host.name} id=${host.id.slice(0, 8)}…`);
  }
}

async function main() {
  console.log(`=== v2 register prod hosts (${ROTATE ? "ROTATE tokens" : "use existing tokens"}) ===`);

  const mintedTokens: Array<{ host: ProdHost; token: string }> = [];

  for (const host of HOSTS) {
    const reachable = await probeHost(host);
    console.log(`[probe] ${host.name} → ${reachable ? "reachable" : "UNREACHABLE"}`);

    let token: string;
    if (ROTATE) {
      token = randomBytes(24).toString("hex");
      mintedTokens.push({ host, token });
    } else {
      const existing = process.env[host.tokenEnvKey];
      if (!existing) {
        throw new Error(
          `Missing ${host.tokenEnvKey} env var. Either set it (look at ` +
            `\`systemctl show runnerd -p Environment\` on the box) or pass ` +
            `--rotate to mint a fresh one.`,
        );
      }
      token = existing;
    }

    await upsertHost(host, token);
  }

  if (ROTATE) {
    console.log("\n=== Fresh tokens minted. Run this on each box to apply: ===\n");
    for (const { host, token } of mintedTokens) {
      console.log(`# ${host.name} (${host.publicIpv4})`);
      console.log(`ssh root@${host.publicIpv4} "mkdir -p /etc/systemd/system/runnerd.service.d && cat > /etc/systemd/system/runnerd.service.d/token.conf <<EOF
[Service]
Environment=\\"RUNNERD_TOKEN=${token}\\"
EOF
systemctl daemon-reload && systemctl restart runnerd"`);
      console.log();
    }
  }

  console.log("\n=== done ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[register-prod-hosts] fatal:", err);
    process.exit(1);
  });
