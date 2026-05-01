import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Prisma } from '@prisma/client';
import type { AppConfig, IncusClusterConfig } from '../config.js';
import { getPrisma } from '../db/client.js';
import { IncusClient } from '../incus/client.js';

// Node provisioning runner — drives a NodeProvisioningRun row through the
// steps required to bring a fresh host up and into an existing Incus cluster.
//
// Keep it simple by design:
//   • One state machine per `targetOs`.
//   • Each step is idempotent — re-running a successful step is a no-op.
//   • Steps shell out via SSH to the target host using `system ssh` (we
//     reuse the operator's existing keys; no third-party SSH lib).
//   • Progress is persisted on every step boundary so the runner can be
//     killed and resumed without losing state.
//
// What's NOT here (intentionally):
//   • Real Hetzner Robot ordering — it's gated behind ORDER REAL HOSTS in
//     the existing procurement endpoints. The orchestration here drives the
//     post-order bootstrap; pairing it with a real Hetzner buy is a
//     `source: 'hetzner-buy'` flow that calls the procurement endpoints
//     first to mint a server, then drives this runner against the IP that
//     comes back. See nodeProvisioning::stepHetznerProvision.
//   • Concurrency control. Driver loop runs one run at a time — this is
//     intentionally not async-parallel for now (cluster-add is also a
//     single-writer op on the leader anyway).

// Bootstrap scripts live at the repo root, but v2-api's cwd is the app
// dir. Walk up from this module's URL to find the repo, then anchor on
// scripts/. Override either dir with V2_HOST_BOOTSTRAP_DIR /
// V2_INCUS_OS_DIR for non-default deployments.
const REPO_ROOT = resolve(process.env.V2_REPO_ROOT?.trim() || resolve(process.cwd(), '..', '..'));
const HOST_BOOTSTRAP_DIR = resolve(process.env.V2_HOST_BOOTSTRAP_DIR?.trim() || resolve(REPO_ROOT, 'scripts/deploy/host-bootstrap'));
const INCUS_OS_DIR = resolve(process.env.V2_INCUS_OS_DIR?.trim() || resolve(REPO_ROOT, 'scripts/deploy/incus-os'));

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type Step = {
  name: string;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  log?: string;
  error?: string;
};

type Run = {
  id: string;
  clusterId: string;
  source: string;
  targetOs: string;
  sshHost: string | null;
  sshUser: string;
  sshPort: number;
  hetznerServerNumber: number | null;
  status: string;
  steps: Step[];
  metadata: Record<string, unknown>;
};

function loadRun(prisma: ReturnType<typeof getPrisma>, runId: string) {
  return prisma.nodeProvisioningRun.findUnique({ where: { id: runId } });
}

async function persistSteps(runId: string, steps: Step[], extra: Partial<{ status: string; currentStep: string | null; lastError: string | null; startedAt: Date; endedAt: Date }> = {}) {
  await getPrisma().nodeProvisioningRun.update({
    where: { id: runId },
    data: {
      steps: steps as unknown as Prisma.InputJsonValue,
      ...(extra.status !== undefined ? { status: extra.status } : {}),
      ...(extra.currentStep !== undefined ? { currentStep: extra.currentStep } : {}),
      ...(extra.lastError !== undefined ? { lastError: extra.lastError } : {}),
      ...(extra.startedAt !== undefined ? { startedAt: extra.startedAt } : {}),
      ...(extra.endedAt !== undefined ? { endedAt: extra.endedAt } : {}),
    },
  });
}

// Shell out to system ssh. Streams stdout+stderr into the step log. We
// deliberately don't use a Node SSH library — `ssh` already understands
// the operator's key + ssh_config, and a 30-line wrapper is less attack
// surface than a 5MB dependency.
function sshExec(opts: { host: string; user: string; port: number; cmd: string; identity?: string; proxyJump?: string; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveOuter, rejectOuter) => {
    const args: string[] = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${Math.ceil((opts.timeoutMs ?? 30_000) / 1000)}`,
      '-p', String(opts.port),
    ];
    if (opts.identity) args.push('-i', opts.identity);
    if (opts.proxyJump) args.push('-J', opts.proxyJump);
    args.push(`${opts.user}@${opts.host}`, opts.cmd);
    const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 600_000);
    child.on('error', (err) => { clearTimeout(timer); rejectOuter(err); });
    child.on('close', (code) => { clearTimeout(timer); resolveOuter({ exitCode: code ?? -1, stdout, stderr }); });
  });
}

// Pipe a local script file at the target host and execute it. Used for the
// host-bootstrap shell scripts — copy + run is more reliable than embedding
// the script body in a one-line ssh cmd (escaping hell).
async function sshRunLocalScript(opts: { host: string; user: string; port: number; identity?: string; proxyJump?: string; localPath: string; remoteName?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const body = readFileSync(opts.localPath, 'utf8');
  const remote = opts.remoteName ?? `/tmp/jvs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`;
  // Heredoc-pipe the body, then bash -e it under the requested env. The
  // heredoc terminator is randomized to prevent collisions if the script
  // itself contains the literal "EOSSH" string.
  const eosshTerm = `EOSSH_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const env = Object.entries(opts.env ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
  const cmd = `cat > ${remote} <<'${eosshTerm}'\n${body}\n${eosshTerm}\nchmod +x ${remote} && ${env} bash -e ${remote}; rc=$?; rm -f ${remote}; exit $rc`;
  return sshExec({ ...opts, cmd });
}

// Identity file the runner uses for every SSH call. Operator's local
// `~/.ssh/justavps_host` is the canonical key on Hetzner-side recovery
// access. Override per-environment with V2_RUNNER_SSH_IDENTITY.
const RUNNER_SSH_IDENTITY = process.env.V2_RUNNER_SSH_IDENTITY?.trim()
  || `${process.env.HOME ?? ''}/.ssh/justavps_host`;

function sshProxyJump(run: Run): string | undefined {
  return (run.metadata.ssh_proxy_jump as string | undefined)?.trim() || undefined;
}

function hostPort(host: string, port: number | string) {
  const trimmed = host.trim();
  return trimmed.includes(':') && !trimmed.startsWith('[') ? `[${trimmed}]:${port}` : `${trimmed}:${port}`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function memberNameForRun(run: Run, cluster: IncusClusterConfig) {
  const explicit = typeof run.metadata.member_name === 'string' ? run.metadata.member_name.trim() : '';
  if (explicit) return explicit;
  const source = run.sshHost ? run.sshHost.replace(/[^a-zA-Z0-9-]+/g, '-') : (run.id || 'new').slice(-6);
  return `${cluster.id}-${source}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Run one step. Wraps the step body so we can catch errors, append to the
// log, and persist progress. Idempotent: the body is responsible for being
// re-runnable (which all our shell scripts are).
async function runStep(run: Run, name: string, body: () => Promise<{ log?: string }>): Promise<Step> {
  const existing = run.steps.find((s) => s.name === name);
  if (existing && existing.status === 'succeeded') return existing;
  const step: Step = { name, status: 'running', startedAt: new Date().toISOString() };
  const others = run.steps.filter((s) => s.name !== name);
  run.steps = [...others, step];
  await persistSteps(run.id, run.steps, { currentStep: name, status: 'running' });
  try {
    const result = await body();
    step.status = 'succeeded';
    step.endedAt = new Date().toISOString();
    step.log = result.log;
    await persistSteps(run.id, run.steps, { currentStep: name });
    return step;
  } catch (error) {
    step.status = 'failed';
    step.endedAt = new Date().toISOString();
    step.error = error instanceof Error ? error.stack ?? error.message : String(error);
    await persistSteps(run.id, run.steps, { currentStep: name, lastError: step.error });
    throw error;
  }
}

// ─── Step bodies ──────────────────────────────────────────────────────

async function stepProbeSsh(run: Run): Promise<{ log?: string }> {
  if (!run.sshHost) throw new Error('ssh_host not set on the run');
  const r = await sshExec({ host: run.sshHost, user: run.sshUser, port: run.sshPort, identity: RUNNER_SSH_IDENTITY, proxyJump: sshProxyJump(run), cmd: 'uname -a && hostnamectl 2>/dev/null || true', timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(`SSH probe failed (exit ${r.exitCode}): ${r.stderr.trim() || r.stdout.trim()}`);
  return { log: r.stdout };
}

async function stepUbuntuBootstrap(run: Run, scriptName: string, env: Record<string, string> = {}): Promise<{ log?: string }> {
  if (!run.sshHost) throw new Error('ssh_host not set');
  const path = resolve(HOST_BOOTSTRAP_DIR, scriptName);
  const r = await sshRunLocalScript({ host: run.sshHost, user: run.sshUser, port: run.sshPort, identity: RUNNER_SSH_IDENTITY, proxyJump: sshProxyJump(run), localPath: path, env, timeoutMs: 900_000 });
  if (r.exitCode !== 0) throw new Error(`${scriptName} failed (exit ${r.exitCode})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return { log: r.stdout.split('\n').slice(-50).join('\n') };
}

async function stepIncusOsFlash(run: Run): Promise<{ log?: string }> {
  if (!run.sshHost) throw new Error('ssh_host not set');
  const path = resolve(INCUS_OS_DIR, 'install-from-rescue.sh');
  // Pass in seed/cluster info via env so the script doesn't have to be templated.
  const seed = (run.metadata.seed as Record<string, unknown> | undefined) ?? {};
  const env: Record<string, string> = {
    INCUS_OS_IMAGE_URL: String(seed.image_url ?? 'https://images.linuxcontainers.org/incus-os/latest/incus-os.img.gz'),
    INCUS_OS_TARGET_DEVICE: String(seed.target_device ?? '/dev/nvme0n1'),
  };
  const r = await sshRunLocalScript({ host: run.sshHost, user: run.sshUser, port: run.sshPort, identity: RUNNER_SSH_IDENTITY, proxyJump: sshProxyJump(run), localPath: path, env, timeoutMs: 1_800_000 });
  if (r.exitCode !== 0) throw new Error(`install-from-rescue.sh failed (exit ${r.exitCode})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return { log: r.stdout.split('\n').slice(-50).join('\n') };
}

async function stepMintJoinToken(run: Run, cluster: IncusClusterConfig): Promise<{ token: string; addresses: string[] }> {
  // The leader cluster member mints the token. We use our existing
  // IncusClient pointing at the leader endpoint.
  const client = new IncusClient(cluster);
  // Member name on the new node — mirror the existing naming convention.
  // Member name derived from the host's IP — stable across retries so the
  // cluster-side trust store entry can be reused by repeated attempts.
  // Falls back to run-id-based name for the rare case where ssh_host is null
  // (hetzner-buy that hasn't gotten its IP yet).
  const memberName = memberNameForRun(run, cluster);
  const result = await client.mintClusterJoinToken(memberName);
  const overrideAddresses = run.metadata.cluster_join_addresses as string[] | undefined;
  if (overrideAddresses?.length) {
    const decoded = JSON.parse(Buffer.from(result.token, 'base64').toString('utf8')) as Record<string, unknown>;
    decoded.addresses = overrideAddresses;
    return { token: Buffer.from(JSON.stringify(decoded)).toString('base64'), addresses: overrideAddresses };
  }
  return { token: result.token, addresses: result.raw.addresses ?? [] };
}

async function resolveStoragePoolSize(run: Run, cluster: IncusClusterConfig, poolSource: string): Promise<{ size: string | null; log: string }> {
  const explicit = cluster.storageSize?.trim();
  if (explicit && explicit.toLowerCase() !== 'auto') {
    return { size: explicit, log: `storage size explicit: ${explicit}` };
  }

  // Native block devices should use the whole device. `size` is for Incus's
  // file-backed ZFS source path, so don't invent a file-size policy for /dev/*.
  if (poolSource.startsWith('/dev/')) {
    return { size: null, log: `storage size omitted: block source ${poolSource}` };
  }

  if (!run.sshHost) throw new Error('ssh_host not set');
  const usePercent = Math.max(1, Math.min(95, Math.floor(cluster.storageUsePercent ?? 80)));
  const minGiB = Math.max(1, Math.floor(cluster.storageMinGiB ?? 30));
  const cmd = `set -euo pipefail
pool_source=${shellQuote(poolSource)}
pool_dir="$(dirname "$pool_source")"
mkdir -p "$pool_dir"
avail_bytes="$(df -PB1 "$pool_dir" | awk 'NR == 2 { print $4 }')"
case "$avail_bytes" in ''|*[!0-9]*) echo "invalid df available bytes: $avail_bytes" >&2; exit 2;; esac
size_gib=$(( (avail_bytes * ${usePercent}) / 100 / 1024 / 1024 / 1024 ))
if [ "$size_gib" -lt ${minGiB} ]; then
  echo "computed storage size ${'${size_gib}'}GiB is below minimum ${minGiB}GiB for $pool_dir" >&2
  exit 3
fi
printf '%sGiB\n' "$size_gib"`;
  const r = await sshExec({ host: run.sshHost, user: run.sshUser, port: run.sshPort, identity: RUNNER_SSH_IDENTITY, proxyJump: sshProxyJump(run), cmd, timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(`storage auto-size failed (exit ${r.exitCode})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const size = r.stdout.trim().split('\n').at(-1)?.trim();
  if (!size || !/^\d+GiB$/.test(size)) throw new Error(`storage auto-size returned invalid size: ${r.stdout.trim()}`);
  return { size, log: `storage size auto: ${size} (${usePercent}% of available filesystem space for ${poolSource})` };
}

// Read the cluster's CA certificate. Incus 6.23 needs it inline in the
// preseed for cluster joins — the token alone isn't enough. We pass the
// CA cert through cluster.{caCert} on the cluster config or via the
// runner's existing INCUS_CA_CERT env var.
async function readClusterCertificate(cluster: IncusClusterConfig): Promise<string> {
  if (cluster.caCert) {
    // Config carries either an inline PEM or a file path.
    if (cluster.caCert.includes('-----BEGIN CERTIFICATE-----')) return cluster.caCert;
    try { return readFileSync(cluster.caCert, 'utf8'); } catch { /* fall through */ }
  }
  const server = await new IncusClient(cluster).getServer();
  const observed = server.environment?.certificate;
  if (observed?.includes('-----BEGIN CERTIFICATE-----')) return observed;
  throw new Error('cluster CA certificate not available — set INCUS_CA_CERT or cluster.caCert');
}

// Wipe any stale state on the new node before the join. Non-destructive
// to packages (Incus stays installed); just clears the database +
// storage-pool dirs that previous failed joins might have left behind.
// Idempotent — running it on an already-clean host is a no-op.
async function stepWipeIncusState(run: Run): Promise<{ log?: string }> {
  if (!run.sshHost) throw new Error('ssh_host not set');
  const cmd = `set -e
systemctl stop incus.service incus.socket 2>/dev/null || true
systemctl kill --kill-who=all incus.service 2>/dev/null || true
pkill -9 incusd 2>/dev/null || true
pkill -9 dnsmasq 2>/dev/null || true

# Old standalone Incus installs can leave per-instance bind/ZFS mounts busy.
# Unmount deepest paths first; lazy unmount is acceptable here because the
# host is being converged into a cluster and old local instances are not kept.
awk '$2 ~ /^\/var\/lib\/incus\// { print $2 }' /proc/self/mounts | sort -r | while read -r mountpoint; do
  umount "$mountpoint" 2>/dev/null || umount -l "$mountpoint" 2>/dev/null || true
done

zpool destroy -f zfs-pool 2>/dev/null || true
zpool destroy -f default 2>/dev/null || true
zpool export -f zfs-pool 2>/dev/null || true
zpool export -f default 2>/dev/null || true

# Remove stale standalone bridge devices so Incus can recreate managed cluster
# networks during preseed join. If left behind, Incus sees incusbr0 as an
# unmanaged host interface and the join can fail with "Network not found".
ip link set incusbr0 down 2>/dev/null || true
ip link delete incusbr0 2>/dev/null || true

rm -rf /var/lib/incus/database
rm -rf /var/lib/incus/storage-pools
rm -rf /var/lib/incus/disks/*.img

systemctl start incus.socket
echo wiped`;
  const r = await sshExec({ host: run.sshHost, user: run.sshUser, port: run.sshPort, identity: RUNNER_SSH_IDENTITY, proxyJump: sshProxyJump(run), cmd, timeoutMs: 180_000 });
  if (r.exitCode !== 0) throw new Error(`wipe failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return { log: r.stdout };
}

async function stepClusterJoin(run: Run, cluster: IncusClusterConfig, token: string): Promise<{ log?: string }> {
  if (!run.sshHost) throw new Error('ssh_host not set');
  // Build a minimal preseed and feed it to `incus admin init --preseed` over
  // SSH. The preseed reuses the existing host's first NIC + a default zfs
  // pool on the first NVMe. Operators with non-standard hardware should
  // override via run.metadata.preseed_overrides.
  // Member name derived from the host's IP — stable across retries so the
  // cluster-side trust store entry can be reused by repeated attempts.
  // Falls back to run-id-based name for the rare case where ssh_host is null
  // (hetzner-buy that hasn't gotten its IP yet).
  const memberName = memberNameForRun(run, cluster);
  // Cluster join preseed. Three address fields, all required:
  //   - core.https_address: listen address on this new member
  //   - cluster.server_address: address other members reach this one on
  //   - cluster.cluster_address: any existing member's address (the token
  //     already carries this list, but Incus 6.23 still wants it explicit
  //     in the preseed for joins)
  // All three are derived from the new node's own IP; operators with a
  // private/public split can override via run.metadata.cluster_https_address.
  const httpsAddress = (run.metadata.cluster_https_address as string | undefined) || hostPort(run.sshHost, 8443);
  const leaderAddress = (run.metadata.leader_addresses as string[] | undefined)?.[0]
    || `${new URL(cluster.endpoint).hostname}:${new URL(cluster.endpoint).port || '8443'}`;
  const clusterCert = await readClusterCertificate(cluster);
  // YAML literal block — preserves newlines + indents the cert two spaces in.
  const certBlock = clusterCert.split('\n').map((line) => `    ${line}`).join('\n');
  const poolName = cluster.rootPool ?? 'default';
  const poolSource = cluster.storageSource ?? `/var/lib/incus/disks/${poolName}.img`;
  const storagePlan = await resolveStoragePoolSize(run, cluster, poolSource);
  const poolSizeConfig = storagePlan.size ? `
  - entity: storage-pool
    name: ${poolName}
    key: size
    value: ${storagePlan.size}` : '';
  const preseed = `config:
  core.https_address: "${httpsAddress}"
networks:
- name: incusbr0
  type: bridge
cluster:
  enabled: true
  server_name: ${memberName}
  server_address: "${httpsAddress}"
  cluster_address: "${leaderAddress}"
  cluster_token: ${token}
  cluster_certificate: |
${certBlock}
  member_config:
  - entity: storage-pool
    name: ${poolName}
    key: source
    value: ${poolSource}
${poolSizeConfig}
`;
  const cmd = `cat <<'EOPRESEED' | incus admin init --preseed
${preseed}
EOPRESEED`;
  const r = await sshExec({ host: run.sshHost, user: run.sshUser, port: run.sshPort, identity: RUNNER_SSH_IDENTITY, proxyJump: sshProxyJump(run), cmd, timeoutMs: 900_000 });
  if (r.exitCode !== 0) throw new Error(`incus admin init --preseed failed (exit ${r.exitCode})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return { log: `${storagePlan.log}\n${r.stdout}` };
}

async function stepVerifyMembership(run: Run, cluster: IncusClusterConfig): Promise<{ log?: string }> {
  const client = new IncusClient(cluster);
  // Member name derived from the host's IP — stable across retries so the
  // cluster-side trust store entry can be reused by repeated attempts.
  // Falls back to run-id-based name for the rare case where ssh_host is null
  // (hetzner-buy that hasn't gotten its IP yet).
  const memberName = memberNameForRun(run, cluster);
  // Poll the leader for ~60s waiting for the new member to register.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const members = await client.listClusterMembers().catch(() => [] as Awaited<ReturnType<typeof client.listClusterMembers>>);
    if (members.some((m) => m.server_name === memberName)) {
      return { log: `member ${memberName} present` };
    }
    await new Promise((res) => setTimeout(res, 2_000));
  }
  throw new Error(`member ${memberName} did not register within 60s`);
}

async function markHostProvisioned(run: Run, cluster: IncusClusterConfig) {
  const memberName = memberNameForRun(run, cluster);
  const where = run.hetznerServerNumber !== null
    ? { vendor: 'hetzner_robot', providerServerNumber: String(run.hetznerServerNumber) }
    : run.sshHost
      ? { OR: [{ publicIpv4: run.sshHost }, { publicIpv6: run.sshHost }] }
      : null;
  if (!where) return;
  const hosts = await getPrisma().host.findMany({ where });
  for (const host of hosts) {
    const metadata = host.metadata && typeof host.metadata === 'object' && !Array.isArray(host.metadata)
      ? host.metadata as Record<string, unknown>
      : {};
    await getPrisma().host.update({
      where: { id: host.id },
      data: {
        incusClusterId: cluster.id,
        incusMemberName: memberName,
        status: 'incus_member_online',
        schedulable: true,
        lifecycleState: 'online',
        joinedAt: new Date(),
        metadata: {
          ...metadata,
          target_cluster_id: cluster.id,
          target_member_name: memberName,
          provisioned_run_id: run.id,
          provisioned_at: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────

export async function driveRun(config: AppConfig, runId: string): Promise<void> {
  const prisma = getPrisma();
  const row = await loadRun(prisma, runId);
  if (!row) throw new Error(`run ${runId} not found`);
  if (row.status === 'succeeded' || row.status === 'cancelled') return;

  const run: Run = {
    id: row.id,
    clusterId: row.clusterId,
    source: row.source,
    targetOs: row.targetOs,
    sshHost: row.sshHost ?? null,
    sshUser: row.sshUser,
    sshPort: row.sshPort,
    hetznerServerNumber: row.hetznerServerNumber ?? null,
    status: row.status,
    steps: Array.isArray(row.steps) ? (row.steps as unknown as Step[]) : [],
    metadata: typeof row.metadata === 'object' && row.metadata !== null ? row.metadata as Record<string, unknown> : {},
  };

  // Resolve target cluster.
  const cluster = config.clusters.find((c) => c.id === run.clusterId);
  if (!cluster) throw new Error(`cluster ${run.clusterId} not configured`);

  await persistSteps(run.id, run.steps, { status: 'running', startedAt: new Date(), lastError: null });

  try {
    await runStep(run, 'probe-ssh', () => stepProbeSsh(run));

    if (run.targetOs === 'incus-os') {
      // Rescue-mode flash path: assume the host is currently in Hetzner
      // rescue (or a comparable OS that can dd a disk image and reboot).
      // The script does flash + seed + reboot; afterwards the node comes
      // up as IncusOS with the seed config already applied.
      await runStep(run, 'incus-os-flash', () => stepIncusOsFlash(run));
      await runStep(run, 'incus-os-await-online', async () => {
        // Reuse the SSH probe — IncusOS keeps the same management user.
        const deadline = Date.now() + 600_000;
        let lastErr = '';
        while (Date.now() < deadline) {
          try { await stepProbeSsh(run); return { log: 'IncusOS reachable' }; }
          catch (e) { lastErr = e instanceof Error ? e.message : String(e); await new Promise((res) => setTimeout(res, 5_000)); }
        }
        throw new Error(`IncusOS host did not come online within 10min: ${lastErr}`);
      });
    } else {
      // Ubuntu+Incus path. If the host is freshly delivered into Hetzner
      // Rescue we run installimage first, then wait for it to come back
      // online as a fresh Ubuntu install. metadata.from_rescue=true is the
      // signal — without it we assume the host is already on Ubuntu.
      if (run.metadata.from_rescue === true) {
        await runStep(run, 'rescue-installimage', () => stepUbuntuBootstrap(run, '-1-installimage.sh'));
        await runStep(run, 'await-installed-online', async () => {
          // installimage reboots immediately; SSH host keys change because
          // the new Ubuntu install regenerates them. We wait up to 8min
          // for SSH to come back; the runner's StrictHostKeyChecking=no
          // accepts the new key.
          const deadline = Date.now() + 480_000;
          let lastErr = '';
          while (Date.now() < deadline) {
            // Sleep first — installimage takes a couple minutes before
            // reboot, then bootloader + cloud-init eat another minute.
            await new Promise((res) => setTimeout(res, 15_000));
            try { await stepProbeSsh(run); return { log: 'installed Ubuntu reachable' }; }
            catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
          }
          throw new Error(`installed Ubuntu did not come online within 8min: ${lastErr}`);
        });
      }
      await runStep(run, 'bootstrap-prereqs', () => stepUbuntuBootstrap(run, '00-prereqs.sh'));
      // Pin the apt channel to whatever this cluster was bootstrapped on, so
      // mixed-version cluster joins (which Incus does not support) can't happen.
      // Defaults to lts-6.0 (6.0.6) since `stable` ships 6.23 with the join bug.
      await runStep(run, 'bootstrap-install-incus', () => stepUbuntuBootstrap(run, '10-install-incus.sh', {
        INCUS_CHANNEL: cluster.incusChannel ?? 'lts-6.0',
      }));
      // Always wipe any stale Incus state before the join. Previous failed
      // join attempts may have left half-configured DB / storage pools that
      // would block a fresh join. Idempotent on a clean host.
      await runStep(run, 'wipe-incus-state', () => stepWipeIncusState(run));
      // Intentionally NOT running 20-configure-incus.sh here. That script
      // bootstraps a standalone Incus daemon (storage pool + bridge), which
      // collides with the cluster join we're about to do — the join carries
      // the cluster's pool / network config and member_config patches them
      // onto the new member. Configuring before joining leaves the daemon
      // pre-initialized in non-cluster mode and the preseed silently
      // creates a one-member cluster instead of joining ours.
    }

    let token = '';
    await runStep(run, 'mint-join-token', async () => {
      const t = await stepMintJoinToken(run, cluster);
      token = t.token;
      // Persist the addresses so retries can re-use them.
      run.metadata = { ...run.metadata, leader_addresses: t.addresses };
      await getPrisma().nodeProvisioningRun.update({
        where: { id: run.id },
        data: { metadata: run.metadata as Prisma.InputJsonValue },
      });
      return { log: `addresses=${t.addresses.join(',')}` };
    });
    await runStep(run, 'cluster-join', () => stepClusterJoin(run, cluster, token));
    await runStep(run, 'verify-membership', () => stepVerifyMembership(run, cluster));
    await markHostProvisioned(run, cluster);

    await persistSteps(run.id, run.steps, { status: 'succeeded', currentStep: null, endedAt: new Date() });
  } catch (error) {
    await persistSteps(run.id, run.steps, {
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
      endedAt: new Date(),
    });
    throw error;
  }
}

// Background tick: pick one pending run and drive it. Single-writer; the
// admin-side concurrency story is "operators add nodes one at a time."
export async function tickNodeProvisioning(config: AppConfig): Promise<void> {
  if (!config.databaseConfigured) return;
  const prisma = getPrisma();
  const next = await prisma.nodeProvisioningRun.findFirst({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
  if (!next) return;
  await driveRun(config, next.id).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[nodeProvisioning] run ${next.id} failed:`, error instanceof Error ? error.stack : error);
  });
}

export function startNodeProvisioningWorker(config: AppConfig) {
  if (process.env.V2_NODE_PROVISIONING_WORKER !== 'on') return null;
  const tickMs = Number(process.env.V2_NODE_PROVISIONING_TICK_MS || 5_000);
  const timer = setInterval(() => {
    tickNodeProvisioning(config).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[nodeProvisioning] tick failed', e instanceof Error ? e.stack : e);
    });
  }, tickMs);
  // eslint-disable-next-line no-console
  console.log(`[v2-api] node-provisioning worker started (tick=${tickMs}ms)`);
  return timer;
}
