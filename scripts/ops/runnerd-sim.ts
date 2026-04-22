/**
 * Local runnerd simulator — dev only.
 *
 * Implements the BaremetalRunnerClient HTTP contract so the v2 e2e suite
 * can run fully offline without needing a real Hetzner dedicated host.
 *
 * What it does:
 *   - Listens on http://127.0.0.1:${SIM_PORT} (default 7780).
 *   - Accepts Bearer ${DEV_RUNNERD_TOKEN} auth (default 'dev-runnerd-token').
 *   - Implements /v1/instances, /v1/instances/:id/{exec,start,stop,reboot,snapshots,…},
 *     /v1/images/publish, DELETE /v1/images/:id, GET /v1/state, GET /healthz.
 *   - For each instance, spawns a tiny HTTP listener on a random port that serves
 *     an nginx-looking body so the control-plane HTTP probe flips the machine to
 *     ready (03-create-machine-container.ts pattern).
 *   - For VM-mode instances (04-baremetal-lifecycle.ts), POSTs synthetic
 *     heartbeats back to the control-plane /api/v1/internal/heartbeat every few
 *     seconds using the machine's decrypted machine_token.
 *
 * Run:
 *   DEV_RUNNERD_TOKEN=dev-runnerd-token pnpm v2:sim
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig();
dotenvConfig({ path: ".env.local", override: true });

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { machines } from "@/server/db/schema";
import { decryptSecret } from "@/server/core/crypto";

const SIM_PORT = Number(process.env.SIM_PORT ?? "7780");
const DEV_RUNNERD_TOKEN = process.env.DEV_RUNNERD_TOKEN ?? "dev-runnerd-token";
const CONTROL_PLANE_BASE = process.env.CONTROL_PLANE_BASE ?? "http://localhost:4100";
const HOST_IPV4 = process.env.SIM_HOST_IPV4 ?? "127.0.0.1";

type Snapshot = { id: string; name: string; createdAt: string; status: string };

type SimInstance = {
  id: string;
  slug: string;
  machineId?: string;
  image: string;
  machineMode: "vm" | "container";
  vcpu: number;
  memoryGb: number;
  diskGb: number;
  status: "running" | "stopped";
  privateIpv4: string;
  sshPort: number | null;
  httpPort: number;
  httpServer: http.Server | null;
  snapshots: Map<string, Snapshot>;
  heartbeatTimer?: NodeJS.Timeout;
  createdAt: string;
};

const instances = new Map<string, SimInstance>();
const images = new Map<string, { aliases: string[]; cached: boolean }>();

let nextSshPort = 30022;
let nextHttpPort = 38000;

function nextInt(counter: { n: number }, bump: () => void): number {
  const v = counter.n;
  bump();
  return v;
}

function jsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function unauthorized(req: IncomingMessage): boolean {
  // Healthz is open.
  if (req.url === "/healthz") return false;
  const auth = req.headers["authorization"];
  return auth !== `Bearer ${DEV_RUNNERD_TOKEN}`;
}

function nginxBody(slug: string): string {
  return `<!doctype html><html><head><title>nginx</title></head><body><h1>Welcome to nginx on ${slug}</h1><p>code-server-like dev sim</p></body></html>`;
}

function startInstanceHttp(instance: SimInstance) {
  if (instance.httpServer) return;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(nginxBody(instance.slug));
  });
  server.on("error", (err) => {
    console.warn(`[sim] ${instance.slug} http server error`, err);
  });
  server.listen(instance.httpPort, HOST_IPV4);
  instance.httpServer = server;
  instance.status = "running";
}

function stopInstanceHttp(instance: SimInstance) {
  if (instance.httpServer) {
    instance.httpServer.close();
    instance.httpServer = null;
  }
  instance.status = "stopped";
}

async function sendSyntheticHeartbeat(instance: SimInstance) {
  try {
    const [machine] = instance.machineId
      ? await db.select().from(machines).where(eq(machines.id, instance.machineId))
      : await db.select().from(machines).where(eq(machines.slug, instance.slug));
    if (!machine) { console.log(`[sim] heartbeat ${instance.slug}: machine row not found yet`); return; }
    if (machine.deletedAt) return;
    let token: string;
    try {
      token = decryptSecret(machine.machineToken);
    } catch {
      return;
    }
    const payload = {
      slug: machine.slug,
      machine_token: token,
      daemon_version: "dev-sim-1.0.0",
      uptime: Math.floor((Date.now() - new Date(instance.createdAt).getTime()) / 1000),
      services: { docker: true },
      load: { cpu: 1, memory: 20, disk: 10 },
    };
    const res = await fetch(`${CONTROL_PLANE_BASE}/api/v1/internal/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((err) => { console.warn(`[sim] heartbeat ${machine.slug} network-error:`, err.message); return null; });
    if (!res) return;
    const body = await res.text().catch(() => "");
    if (res.ok) {
      console.log(`[sim] heartbeat ${machine.slug} -> ${res.status}`);
    } else {
      console.warn(`[sim] heartbeat ${machine.slug} -> ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[sim] heartbeat loop error:`, (err as Error).message);
  }
}

function armHeartbeats(instance: SimInstance) {
  if (instance.heartbeatTimer) return;
  // Wait briefly so the machine row and machineToken are persisted, then fire
  // immediately and every 3s thereafter.
  setTimeout(() => {
    void sendSyntheticHeartbeat(instance).catch((err) => console.warn(`[sim] heartbeat bootstrap error:`, err));
  }, 2_000);
  instance.heartbeatTimer = setInterval(() => {
    if (instance.status !== "running") return;
    void sendSyntheticHeartbeat(instance).catch((err) => console.warn(`[sim] heartbeat tick error:`, err));
  }, 3_000);
  instance.heartbeatTimer.unref?.();
}

function disarmHeartbeats(instance: SimInstance) {
  if (instance.heartbeatTimer) {
    clearInterval(instance.heartbeatTimer);
    instance.heartbeatTimer = undefined;
  }
}

async function handleCreateInstance(req: IncomingMessage, res: ServerResponse) {
  const body = (await jsonBody(req)) as {
    instanceName: string;
    machineSlug: string;
    machineId?: string;
    image: string;
    machineMode?: "vm" | "container";
    vcpu: number;
    memoryGb: number;
    diskGb: number;
    sshPort?: number | null;
    httpPort?: number | null;
  };
  const instanceId = randomUUID();
  const sshCounter = { n: nextSshPort };
  const httpCounter = { n: nextHttpPort };
  const sshPort = body.sshPort ?? nextInt(sshCounter, () => { nextSshPort += 1; });
  const httpPort = body.httpPort ?? nextInt(httpCounter, () => { nextHttpPort += 1; });
  if (!body.sshPort) nextSshPort = sshCounter.n + 1;
  if (!body.httpPort) nextHttpPort = httpCounter.n + 1;

  const instance: SimInstance = {
    id: instanceId,
    slug: body.machineSlug,
    machineId: body.machineId,
    image: body.image,
    machineMode: body.machineMode ?? "vm",
    vcpu: body.vcpu,
    memoryGb: body.memoryGb,
    diskGb: body.diskGb,
    status: "running",
    privateIpv4: `10.0.0.${(instances.size + 2) % 254}`,
    sshPort,
    httpPort,
    httpServer: null,
    snapshots: new Map(),
    createdAt: new Date().toISOString(),
  };
  instances.set(instanceId, instance);
  startInstanceHttp(instance);
  armHeartbeats(instance);

  console.log(`[sim] created instance ${body.machineSlug} id=${instanceId} mode=${instance.machineMode} httpPort=${httpPort}`);

  sendJson(res, 200, {
    instanceId,
    hostIpv4: HOST_IPV4,
    hostIpv6: null,
    privateIpv4: instance.privateIpv4,
    sshPort,
    httpPort,
    metadata: {
      sim: true,
      sim_http_port: httpPort,
    },
  });
}

function matchInstance(url: string | undefined, base: string): { instance: SimInstance; rest: string } | null {
  if (!url) return null;
  const parts = url.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "v1" || parts[1] !== base) return null;
  const id = decodeURIComponent(parts[2]);
  const instance = instances.get(id);
  if (!instance) return null;
  return { instance, rest: parts.slice(3).join("/") };
}

async function handleInstanceRequest(req: IncomingMessage, res: ServerResponse) {
  const m = matchInstance(req.url, "instances");
  if (!m) return sendJson(res, 404, { error: "instance not found" });
  const { instance, rest } = m;

  // DELETE /v1/instances/:id
  if (req.method === "DELETE" && rest === "") {
    stopInstanceHttp(instance);
    disarmHeartbeats(instance);
    instances.delete(instance.id);
    console.log(`[sim] deleted instance ${instance.slug}`);
    return sendJson(res, 200, { ok: true });
  }

  // POST /v1/instances/:id/start
  if (req.method === "POST" && rest === "start") {
    startInstanceHttp(instance);
    armHeartbeats(instance);
    console.log(`[sim] started ${instance.slug}`);
    return sendJson(res, 200, { ok: true });
  }

  // POST /v1/instances/:id/stop
  if (req.method === "POST" && rest === "stop") {
    stopInstanceHttp(instance);
    disarmHeartbeats(instance);
    console.log(`[sim] stopped ${instance.slug}`);
    return sendJson(res, 200, { ok: true });
  }

  // POST /v1/instances/:id/reboot
  if (req.method === "POST" && rest === "reboot") {
    stopInstanceHttp(instance);
    await new Promise((r) => setTimeout(r, 200));
    startInstanceHttp(instance);
    armHeartbeats(instance);
    console.log(`[sim] rebooted ${instance.slug}`);
    return sendJson(res, 200, { ok: true });
  }

  // POST /v1/instances/:id/exec
  if (req.method === "POST" && rest === "exec") {
    const body = (await jsonBody(req)) as { command: string; args?: string[] };
    const command = [body.command, ...(body.args ?? [])].join(" ");
    return sendJson(res, 200, {
      stdout: `[sim] exec ${command}`,
      stderr: "",
      exitCode: 0,
    });
  }

  // Snapshots
  if (rest === "snapshots") {
    if (req.method === "GET") {
      return sendJson(res, 200, Array.from(instance.snapshots.values()));
    }
    if (req.method === "POST") {
      const body = (await jsonBody(req)) as { name?: string };
      const id = randomUUID();
      const snapshot: Snapshot = {
        id,
        name: body.name ?? `snap-${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: "ready",
      };
      instance.snapshots.set(id, snapshot);
      console.log(`[sim] snapshot created ${instance.slug}/${id}`);
      return sendJson(res, 200, snapshot);
    }
  }

  // Snapshot by id
  if (rest.startsWith("snapshots/")) {
    const [, snapshotId, action] = rest.split("/");
    const snapshot = instance.snapshots.get(snapshotId);
    if (!snapshot) return sendJson(res, 404, { error: "snapshot not found" });
    if (req.method === "DELETE" && !action) {
      instance.snapshots.delete(snapshotId);
      console.log(`[sim] snapshot deleted ${instance.slug}/${snapshotId}`);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && action === "restore") {
      // Restore is a no-op in sim — instance already running from the snapshot image.
      startInstanceHttp(instance);
      console.log(`[sim] snapshot restored ${instance.slug}/${snapshotId}`);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: `no such route ${req.method} ${req.url}` });
}

async function handleImagesRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.url === "/v1/images/publish" && req.method === "POST") {
    const body = (await jsonBody(req)) as { instanceId: string; alias: string };
    const imageId = randomBytes(12).toString("hex");
    images.set(imageId, { aliases: [body.alias], cached: true });
    console.log(`[sim] image published ${imageId} alias=${body.alias}`);
    return sendJson(res, 200, { imageId });
  }
  if (req.method === "DELETE" && req.url?.startsWith("/v1/images/")) {
    const imageId = decodeURIComponent(req.url.slice("/v1/images/".length));
    const existed = images.delete(imageId);
    console.log(`[sim] image delete ${imageId} existed=${existed}`);
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { error: "images route not found" });
}

function handleHostState(_req: IncomingMessage, res: ServerResponse) {
  const now = new Date().toISOString();
  sendJson(res, 200, {
    checkedAt: now,
    runnerd: "ok",
    incus: {
      status: "ok",
      serverVersion: "sim-6.0",
      instanceCount: instances.size,
      imageCount: images.size,
    },
    instances: Array.from(instances.values()).map((i) => ({
      instanceId: i.id,
      status: i.status,
      privateIpv4: i.privateIpv4,
      vcpu: i.vcpu,
      memoryGb: i.memoryGb,
      diskGb: i.diskGb,
      role: null,
    })),
    images: Array.from(images.entries()).map(([imageId, image]) => ({
      imageId,
      aliases: image.aliases,
      cached: image.cached,
    })),
  });
}

const server = http.createServer((req, res) => {
  (async () => {
    if (req.url === "/healthz" && req.method === "GET") {
      return sendJson(res, 200, {
        status: "ok",
        runnerd: "ok",
        incus: { status: "ok", serverVersion: "sim-6.0", instanceCount: instances.size, imageCount: images.size },
        warm_pool: { size: 0, target: 0, ready: 0 },
      });
    }
    if (unauthorized(req)) return sendJson(res, 401, { error: "unauthorized" });

    if (req.url === "/v1/state" && req.method === "GET") return handleHostState(req, res);
    if (req.url === "/v1/instances" && req.method === "POST") return handleCreateInstance(req, res);
    if (req.url?.startsWith("/v1/instances/")) return handleInstanceRequest(req, res);
    if (req.url?.startsWith("/v1/images")) return handleImagesRequest(req, res);

    return sendJson(res, 404, { error: `no such route ${req.method} ${req.url}` });
  })().catch((err) => {
    console.error("[sim] handler error", err);
    if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
  });
});

server.listen(SIM_PORT, HOST_IPV4, () => {
  console.log(`=== runnerd-sim listening on http://${HOST_IPV4}:${SIM_PORT} ===`);
  console.log(`DEV_RUNNERD_TOKEN=${DEV_RUNNERD_TOKEN}`);
  console.log(`CONTROL_PLANE_BASE=${CONTROL_PLANE_BASE}`);
});

function shutdown() {
  console.log("[sim] shutting down");
  for (const instance of instances.values()) {
    disarmHeartbeats(instance);
    stopInstanceHttp(instance);
  }
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
