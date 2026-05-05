import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Prisma } from '@prisma/client';

import type { AppConfig, IncusClusterConfig } from '../config.js';
import { getPrisma } from '../db/client.js';
import type { IncusClient } from '../incus/client.js';

export type EnsureManagedDaemonInput = {
  config: AppConfig;
  client: IncusClient;
  instanceName: string;
  machineId: string;
  verifyPort?: number | null;
};

export type EnsureManagedDaemonResult = {
  ok: boolean;
  mode: 'guest-daemon';
  ensured_at: string;
  daemon_url: string;
  telemetry_url?: string;
  telemetry_ingest_reachable_from_sandbox?: boolean;
  telemetry_warnings?: string[];
  daemon_source: 'baked' | 'local-push' | 'download' | 'injected-mount' | 'injected-push';
  token_prefix: string;
  token_sha256: string;
  install: { exit_code: number | null; stdout: string; stderr: string };
  active?: string;
  autostart?: boolean;
  autostart_kind?: 'systemd' | 'openrc' | 'none';
  version?: string;
  health?: unknown;
  health_raw?: string;
  port_check?: { port: number; exit_code: number | null; stdout: string; stderr: string };
  error?: string;
};

export type GuestExecReadyResult = {
  ok: boolean;
  checked_at: string;
  attempts: number;
  duration_ms: number;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type CloudInitReadyResult = {
  ok: boolean;
  checked_at: string;
  duration_ms: number;
  present: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type ManagedDaemonHealthResult = {
  ok: boolean;
  checked_at: string;
  attempts: number;
  duration_ms: number;
  active?: string;
  health?: unknown;
  health_raw?: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type ManagedDaemonRestartResult = ManagedDaemonHealthResult & {
  restart: { exit_code: number | null; stdout: string; stderr: string };
};

export type JustavpsLiveResult = ManagedDaemonHealthResult & {
  file_probe?: boolean;
  command_probe?: boolean;
};

export type BakeManagedDaemonResult = {
  ok: boolean;
  baked_at: string;
  daemon_url: string;
  daemon_source: 'local-push' | 'download';
  install: { exit_code: number | null; stdout: string; stderr: string };
  version?: string;
  error?: string;
};

type MachineRow = Awaited<ReturnType<ReturnType<typeof getPrisma>['machine']['findFirst']>>;

const READY_RECHECK_MS = 60 * 60 * 1000;
const FAILED_RETRY_MS = 5 * 60 * 1000;
const INSTALLING_STALE_MS = 3 * 60 * 1000;
const WORKER_INTERVAL_MS = 30_000;

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function daemonMeta(machine: NonNullable<MachineRow>) {
  return jsonRecord(machine.metadata);
}

function managedDaemonConfigHash(config: AppConfig, machineId: string) {
  const payload = {
    daemon_url: config.daemonDownloadUrl,
    daemon_guest_path: config.daemonGuestPath,
    daemon_mount_source: config.daemonMountSource ?? '',
    daemon_callback_url: config.daemonCallbackUrl,
    telemetry_url: daemonTelemetryBaseUrl(config, machineId),
    telemetry_interval_seconds: config.telemetry.metricIntervalSeconds,
    telemetry_driver: config.telemetry.driver,
    otlp_endpoint: config.telemetry.otlpEndpoint ?? '',
    app_url: config.appUrl,
  };
  return sha256Hex(JSON.stringify(payload));
}

export function shouldEnsureManagedDaemon(machine: NonNullable<MachineRow>, now = Date.now(), config?: AppConfig) {
  if (['deleted', 'Stopped', 'warm_pool', 'warm_pool_claiming'].includes(machine.status)) return false;
  const meta = daemonMeta(machine);
  if (meta.managed_daemon_desired === false) return false;
  if (config && meta.managed_daemon_config_hash !== managedDaemonConfigHash(config, machine.id)) return true;
  const state = typeof meta.managed_daemon_state === 'string' ? meta.managed_daemon_state : '';
  const checkedAt = typeof meta.managed_daemon_checked_at === 'string' ? Date.parse(meta.managed_daemon_checked_at) : 0;
  const queuedAt = typeof meta.managed_daemon_queued_at === 'string' ? Date.parse(meta.managed_daemon_queued_at) : 0;
  if (state === 'ready') return !checkedAt || now - checkedAt > READY_RECHECK_MS;
  if (state === 'installing') return !queuedAt || now - queuedAt > INSTALLING_STALE_MS;
  if (state === 'failed') return !checkedAt || now - checkedAt > FAILED_RETRY_MS;
  return true;
}

export async function markManagedDaemonQueued(machineId: string) {
  const prisma = getPrisma();
  const machine = await prisma.machine.findUnique({ where: { id: machineId } });
  if (!machine) return null;
  const metadata = {
    ...daemonMeta(machine),
    managed_daemon_desired: true,
    managed_daemon_state: 'installing',
    managed_daemon_queued_at: new Date().toISOString(),
  };
  return prisma.machine.update({
    where: { id: machineId },
    data: { metadata: metadata as Prisma.InputJsonValue },
  });
}

function sha256Hex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function machineToken() {
  return `mt_${randomBytes(32).toString('base64url')}`;
}

function parseJsonMaybe(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForGuestExecReady(input: {
  client: IncusClient;
  instanceName: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<GuestExecReadyResult> {
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1_000, input.timeoutMs ?? 60_000);
  const intervalMs = Math.max(250, input.intervalMs ?? 1_000);
  let attempts = 0;
  let last: { exit_code: number | null; stdout: string; stderr: string; error?: string } = { exit_code: null, stdout: '', stderr: '' };

  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const result = await input.client.exec(input.instanceName, {
        command: ['/bin/sh', '-lc', 'true'],
        timeoutMs: Math.min(10_000, Math.max(1_000, deadline - Date.now())),
      });
      last = result;
      if (result.exit_code === 0) {
        return { ok: true, checked_at: nowIso(), attempts, duration_ms: elapsedMs(startedAt), ...result };
      }
    } catch (error) {
      last = { exit_code: 1, stdout: '', stderr: '', error: error instanceof Error ? error.message : String(error) };
    }
    if (Date.now() + intervalMs > deadline) break;
    await delay(intervalMs);
  }

  return {
    ok: false,
    checked_at: nowIso(),
    attempts,
    duration_ms: elapsedMs(startedAt),
    exit_code: last.exit_code,
    stdout: last.stdout,
    stderr: last.stderr,
    error: last.error || last.stderr || last.stdout || 'guest exec did not become ready before timeout',
  };
}

export async function waitForCloudInitDone(input: {
  client: IncusClient;
  instanceName: string;
  timeoutMs?: number;
}): Promise<CloudInitReadyResult> {
  const startedAt = Date.now();
  const checkedAt = nowIso();
  const script = `set -eu
if ! command -v cloud-init >/dev/null 2>&1; then
  echo JUSTAVPS_CLOUD_INIT_NOT_PRESENT
  exit 0
fi
cloud-init status --wait
`;
  try {
    const result = await input.client.exec(input.instanceName, {
      command: ['/bin/sh', '-lc', script],
      timeoutMs: Math.max(5_000, input.timeoutMs ?? 180_000),
    });
    const present = !result.stdout.includes('JUSTAVPS_CLOUD_INIT_NOT_PRESENT');
    return {
      ok: result.exit_code === 0,
      checked_at: checkedAt,
      duration_ms: elapsedMs(startedAt),
      present,
      ...result,
      error: result.exit_code === 0 ? undefined : (result.stderr || result.stdout || 'cloud-init did not report ready'),
    };
  } catch (error) {
    return {
      ok: false,
      checked_at: checkedAt,
      duration_ms: elapsedMs(startedAt),
      present: true,
      exit_code: 1,
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function waitForManagedDaemonHealth(input: {
  client: IncusClient;
  instanceName: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<ManagedDaemonHealthResult> {
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1_000, input.timeoutMs ?? 60_000);
  const intervalMs = Math.max(250, input.intervalMs ?? 1_000);
  let attempts = 0;
  let last: { exit_code: number | null; stdout: string; stderr: string; error?: string; active?: string } = { exit_code: null, stdout: '', stderr: '' };
  const script = `set -eu
active="unknown"
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  active="$(systemctl is-active justavps-daemon 2>/dev/null || true)"
  if [ "$active" != "active" ]; then
    systemctl start justavps-daemon >/dev/null 2>&1 || true
    active="$(systemctl is-active justavps-daemon 2>/dev/null || true)"
  fi
fi
printf '%s\n' "$active" >&2
${daemonHealthCommand()}
`;

  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const result = await input.client.exec(input.instanceName, {
        command: ['/bin/sh', '-c', script],
        timeoutMs: Math.min(10_000, Math.max(1_000, deadline - Date.now())),
      });
      const stderrLines = result.stderr.trim().split('\n').filter(Boolean);
      const active = stderrLines[0] ?? undefined;
      last = { ...result, active };
      if (result.exit_code === 0) {
        const healthRaw = result.stdout.trim();
        return {
          ok: true,
          checked_at: nowIso(),
          attempts,
          duration_ms: elapsedMs(startedAt),
          active,
          health: parseJsonMaybe(healthRaw),
          health_raw: healthRaw,
          ...result,
        };
      }
    } catch (error) {
      last = { exit_code: 1, stdout: '', stderr: '', error: error instanceof Error ? error.message : String(error) };
    }
    if (Date.now() + intervalMs > deadline) break;
    await delay(intervalMs);
  }

  return {
    ok: false,
    checked_at: nowIso(),
    attempts,
    duration_ms: elapsedMs(startedAt),
    active: last.active,
    exit_code: last.exit_code,
    stdout: last.stdout,
    stderr: last.stderr,
    error: last.error || last.stderr || last.stdout || 'managed daemon health did not become ready before timeout',
  };
}

export async function waitForJustavpsLive(input: {
  client: IncusClient;
  instanceName: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<JustavpsLiveResult> {
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1_000, input.timeoutMs ?? 60_000);
  const intervalMs = Math.max(250, input.intervalMs ?? 750);
  let attempts = 0;
  let last: { exit_code: number | null; stdout: string; stderr: string; error?: string; active?: string } = { exit_code: null, stdout: '', stderr: '' };
  const script = `set -eu
probe_dir="/tmp/justavps-live"
probe_file="$probe_dir/probe"
mkdir -p "$probe_dir"
printf 'JUSTAVPS_LIVE' > "$probe_file"
grep -q 'JUSTAVPS_LIVE' "$probe_file"
active="unknown"
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  active="$(systemctl is-active justavps-daemon 2>/dev/null || true)"
  if [ "$active" != "active" ]; then
    systemctl start justavps-daemon >/dev/null 2>&1 || true
    active="$(systemctl is-active justavps-daemon 2>/dev/null || true)"
  fi
fi
printf '%s\n' "$active" >&2
${daemonHealthCommand()}
`;

  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const result = await input.client.exec(input.instanceName, {
        command: ['/bin/sh', '-lc', script],
        timeoutMs: Math.min(10_000, Math.max(1_000, deadline - Date.now())),
      });
      const stderrLines = result.stderr.trim().split('\n').filter(Boolean);
      const active = stderrLines[0] ?? undefined;
      last = { ...result, active };
      if (result.exit_code === 0) {
        const healthRaw = result.stdout.trim();
        return {
          ok: true,
          checked_at: nowIso(),
          attempts,
          duration_ms: elapsedMs(startedAt),
          active,
          health: parseJsonMaybe(healthRaw),
          health_raw: healthRaw,
          file_probe: true,
          command_probe: true,
          ...result,
        };
      }
    } catch (error) {
      last = { exit_code: 1, stdout: '', stderr: '', error: error instanceof Error ? error.message : String(error) };
    }
    if (Date.now() + intervalMs > deadline) break;
    await delay(intervalMs);
  }

  return {
    ok: false,
    checked_at: nowIso(),
    attempts,
    duration_ms: elapsedMs(startedAt),
    active: last.active,
    exit_code: last.exit_code,
    stdout: last.stdout,
    stderr: last.stderr,
    file_probe: false,
    command_probe: false,
    error: last.error || last.stderr || last.stdout || 'JustAVPS live probe did not become ready before timeout',
  };
}

function daemonPortUrlTemplate(config: AppConfig, machineId: string) {
  const appUrl = new URL(config.appUrl);
  if (appUrl.hostname === 'localhost') {
    const url = new URL(appUrl.toString());
    url.hostname = `{{port}}--${machineId}.localhost`;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  }
  const prefix = `${appUrl.protocol}//${appUrl.host}`;
  const basePath = appUrl.pathname.replace(/\/+$/, '');
  // Do not use URL for this path: URL serialisation percent-encodes `{}` and
  // breaks the daemon's shell-side {{port}} substitution.
  return `${prefix}${basePath}/proxy/{{port}}--${machineId}/`;
}

function daemonTelemetryBaseUrl(config: AppConfig, machineId: string) {
  return new URL(`/internal/telemetry/machines/${machineId}`, config.telemetry.ingestBaseUrl || config.appUrl).toString();
}

function daemonUnitText() {
  return `[Unit]
Description=JustAVPS Guest Daemon
After=network.target
ConditionPathExists=/etc/justavps/config.json

[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-daemon --config /etc/justavps/config.json
Restart=always
RestartSec=1
StartLimitIntervalSec=0
WatchdogSec=120

[Install]
WantedBy=multi-user.target`;
}

function daemonOpenRcText() {
  return `#!/sbin/openrc-run
name="JustAVPS Guest Daemon"
command="/usr/local/bin/justavps-daemon"
command_args="--config /etc/justavps/config.json"
command_background="yes"
pidfile="/run/justavps-daemon.pid"
output_log="/var/log/justavps-daemon.log"
error_log="/var/log/justavps-daemon.err"

depend() {
  need net
}`;
}

function daemonBinaryPath(config: AppConfig) {
  return config.daemonGuestPath || '/usr/local/bin/justavps-daemon';
}

function daemonHealthCommand(binaryPath = '/usr/local/bin/justavps-daemon') {
  const quoted = shellQuote(binaryPath);
  return `if [ -x ${quoted} ]; then
  ${quoted} --health-check --api-port 7777
elif command -v curl >/dev/null 2>&1; then
  curl -fsS http://127.0.0.1:7777/health
else
  echo "justavps-daemon health-check unavailable: ${binaryPath} missing and curl not installed" >&2
  exit 127
fi`;
}

function daemonServiceStatusCommand(binaryPath = '/usr/local/bin/justavps-daemon') {
  return `if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl is-active justavps-daemon 2>/dev/null || true
elif command -v rc-service >/dev/null 2>&1; then
  if rc-service justavps-daemon status >/dev/null 2>&1; then echo active; elif ( ${daemonHealthCommand(binaryPath)} ) >/dev/null 2>&1; then echo active; else echo inactive; fi
else
  if [ -s /run/justavps-daemon.pid ] && kill -0 "$(cat /run/justavps-daemon.pid)" >/dev/null 2>&1; then echo active; elif ( ${daemonHealthCommand(binaryPath)} ) >/dev/null 2>&1; then echo active; else echo inactive; fi
fi`;
}

function startDaemonFallbackScript() {
  return `if [ -s /run/justavps-daemon.pid ]; then kill "$(cat /run/justavps-daemon.pid)" >/dev/null 2>&1 || true; fi
mkdir -p /run /var/log
nohup /usr/local/bin/justavps-daemon --config /etc/justavps/config.json >/var/log/justavps-daemon.log 2>/var/log/justavps-daemon.err &
echo $! >/run/justavps-daemon.pid`;
}

function ensureInitKindScript() {
  return `INIT_KIND=""
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  INIT_KIND="systemd"
elif command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1; then
  INIT_KIND="openrc"
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache openrc >/dev/null 2>&1 || fail "failed to install openrc"
  INIT_KIND="openrc"
else
  fail "systemd or openrc is required for managed JustAVPS machines"
fi`;
}

function installCurlAndDaemonScript(input: { daemonUrl: string; preloadedDaemonPath?: string | null }) {
  const preloadedDaemonPath = input.preloadedDaemonPath ?? '';
  return `if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq ca-certificates curl >/dev/null 2>&1 || fail "failed to install curl"
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache ca-certificates curl >/dev/null 2>&1 || fail "failed to install curl"
  else
    fail "curl is missing and no supported package manager was found"
  fi
fi

PRELOADED_DAEMON=${shellQuote(preloadedDaemonPath)}
if [ -n "$PRELOADED_DAEMON" ] && [ -s "$PRELOADED_DAEMON" ]; then
  chmod +x "$PRELOADED_DAEMON" || fail "could not chmod preloaded daemon"
  mv "$PRELOADED_DAEMON" /usr/local/bin/justavps-daemon || fail "could not install preloaded daemon binary"
else
  DAEMON_URL=${shellQuote(input.daemonUrl)}
  tmp="/tmp/justavps-daemon.$$"
  curl -fsSL -o "$tmp" "$DAEMON_URL" || fail "daemon download failed from $DAEMON_URL"
  chmod +x "$tmp" || fail "could not chmod downloaded daemon"
  mv "$tmp" /usr/local/bin/justavps-daemon || fail "could not install daemon binary"
fi
chmod 0755 /usr/local/bin/justavps-daemon || true`;
}

function installScript(input: {
  configJson: string;
  daemonUrl: string;
  preloadedDaemonPath?: string | null;
}) {
  const preloadedDaemonPath = input.preloadedDaemonPath ?? '';
  return `set -eu
export DEBIAN_FRONTEND=noninteractive
fail() { echo "JUSTAVPS_DAEMON_ENSURE_ERROR: $*" >&2; exit 1; }

${ensureInitKindScript()}

mkdir -p /etc/justavps /usr/local/bin /etc/systemd/system /etc/init.d /run /var/log || fail "could not create platform directories"
cat > /etc/justavps/config.json <<'JUSTAVPS_CONFIG_JSON'
${input.configJson}
JUSTAVPS_CONFIG_JSON
chmod 0600 /etc/justavps/config.json || true

${installCurlAndDaemonScript({ daemonUrl: input.daemonUrl, preloadedDaemonPath })}

cat > /etc/systemd/system/justavps-daemon.service <<'JUSTAVPS_DAEMON_UNIT'
${daemonUnitText()}
JUSTAVPS_DAEMON_UNIT
cat > /etc/init.d/justavps-daemon <<'JUSTAVPS_OPENRC_UNIT'
${daemonOpenRcText()}
JUSTAVPS_OPENRC_UNIT
chmod +x /etc/init.d/justavps-daemon || true

if [ "$INIT_KIND" = "systemd" ]; then
  systemctl disable --now caddy >/dev/null 2>&1 || true
  systemctl daemon-reload || fail "systemctl daemon-reload failed"
  systemctl enable justavps-daemon >/dev/null 2>&1 || true
  systemctl restart justavps-daemon || { ${startDaemonFallbackScript()} ; }
else
  rc-update add justavps-daemon default >/dev/null 2>&1 || true
  rc-service justavps-daemon restart >/dev/null 2>&1 || { ${startDaemonFallbackScript()} ; }
fi

ok=0
i=0
while [ "$i" -lt 20 ]; do
  if curl -fsS http://127.0.0.1:7777/health >/dev/null 2>&1; then ok=1; break; fi
  i=$((i + 1))
  sleep 1
done
[ "$ok" = "1" ] || fail "daemon health endpoint did not become ready"

echo "JUSTAVPS_DAEMON_ENSURE_OK"
`;
}

function activateBakedScript(input: { configJson: string }) {
  return `set -eu
fail() { echo "JUSTAVPS_DAEMON_ACTIVATE_ERROR: $*" >&2; exit 1; }
${ensureInitKindScript()}
if [ ! -x /usr/local/bin/justavps-daemon ]; then fail "baked justavps-daemon binary missing"; fi
mkdir -p /etc/justavps /etc/systemd/system /etc/init.d /run /var/log || fail "could not create platform directories"
cat > /etc/justavps/config.json <<'JUSTAVPS_CONFIG_JSON'
${input.configJson}
JUSTAVPS_CONFIG_JSON
chmod 0600 /etc/justavps/config.json || true
cat > /etc/systemd/system/justavps-daemon.service <<'JUSTAVPS_DAEMON_UNIT'
${daemonUnitText()}
JUSTAVPS_DAEMON_UNIT
cat > /etc/init.d/justavps-daemon <<'JUSTAVPS_OPENRC_UNIT'
${daemonOpenRcText()}
JUSTAVPS_OPENRC_UNIT
chmod +x /etc/init.d/justavps-daemon || true
if [ "$INIT_KIND" = "systemd" ]; then
  systemctl daemon-reload || fail "systemctl daemon-reload failed"
  systemctl enable justavps-daemon >/dev/null 2>&1 || true
  systemctl restart justavps-daemon || { ${startDaemonFallbackScript()} ; }
else
  rc-update add justavps-daemon default >/dev/null 2>&1 || true
  rc-service justavps-daemon restart >/dev/null 2>&1 || { ${startDaemonFallbackScript()} ; }
fi
ok=0
i=0
while [ "$i" -lt 8 ]; do
  if curl -fsS http://127.0.0.1:7777/health >/dev/null 2>&1; then ok=1; break; fi
  i=$((i + 1))
  sleep 0.5
done
[ "$ok" = "1" ] || fail "daemon health endpoint did not become ready from baked binary"
echo "JUSTAVPS_DAEMON_ACTIVATE_OK"
`;
}

function activateInjectedScript(input: { configJson: string; binaryPath: string; expectedSha256?: string | null }) {
  const binaryPath = shellQuote(input.binaryPath);
  const expectedSha256 = shellQuote(input.expectedSha256 ?? '');
  return `set -eu
fail() { echo "JUSTAVPS_DAEMON_INJECT_ERROR: $*" >&2; exit 1; }
BIN=${binaryPath}
[ -x "$BIN" ] || fail "injected justavps-daemon binary missing at $BIN"
EXPECTED_SHA256=${expectedSha256}
if [ -n "$EXPECTED_SHA256" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA256=$(sha256sum "$BIN" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA256=$(shasum -a 256 "$BIN" | awk '{print $1}')
  else
    fail "could not verify injected justavps-daemon binary hash"
  fi
  [ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || fail "injected justavps-daemon binary hash mismatch at $BIN"
fi
mkdir -p /run /var/log /tmp /etc/justavps || fail "could not create runtime directories"
if [ -s /run/justavps-daemon.pid ]; then kill "$(cat /run/justavps-daemon.pid)" >/dev/null 2>&1 || true; fi
JUSTAVPS_DAEMON_CONFIG_JSON=$(cat <<'JUSTAVPS_CONFIG_JSON'
${input.configJson}
JUSTAVPS_CONFIG_JSON
)
export JUSTAVPS_DAEMON_CONFIG_JSON
cat > /etc/justavps/config.json <<'JUSTAVPS_CONFIG_JSON_FILE'
${input.configJson}
JUSTAVPS_CONFIG_JSON_FILE
chmod 0600 /etc/justavps/config.json >/dev/null 2>&1 || true
AUTOSTART_KIND=none
if command -v systemctl >/dev/null 2>&1 || [ -d /etc/systemd/system ]; then
  mkdir -p /etc/systemd/system /etc/systemd/system/multi-user.target.wants
  cat > /etc/systemd/system/justavps-daemon.service <<JUSTAVPS_DAEMON_UNIT
[Unit]
Description=JustAVPS Guest Daemon
After=network.target
ConditionPathExists=/etc/justavps/config.json

[Service]
Type=simple
ExecStart=$BIN --config /etc/justavps/config.json
Restart=always
RestartSec=1
StartLimitIntervalSec=0
WatchdogSec=120

[Install]
WantedBy=multi-user.target
JUSTAVPS_DAEMON_UNIT
  ln -sf /etc/systemd/system/justavps-daemon.service /etc/systemd/system/multi-user.target.wants/justavps-daemon.service >/dev/null 2>&1 || true
  if [ -d /run/systemd/system ]; then systemctl daemon-reload >/dev/null 2>&1 || true; systemctl enable justavps-daemon >/dev/null 2>&1 || true; fi
  AUTOSTART_KIND=systemd
elif command -v rc-update >/dev/null 2>&1; then
  mkdir -p /etc/init.d
  cat > /etc/init.d/justavps-daemon <<JUSTAVPS_OPENRC_UNIT
#!/sbin/openrc-run
name="JustAVPS Guest Daemon"
command="$BIN"
command_args="--config /etc/justavps/config.json"
command_background="yes"
pidfile="/run/justavps-daemon.pid"
output_log="/var/log/justavps-daemon.log"
error_log="/var/log/justavps-daemon.err"

depend() { need net; }
JUSTAVPS_OPENRC_UNIT
  chmod +x /etc/init.d/justavps-daemon >/dev/null 2>&1 || true
  rc-update add justavps-daemon default >/dev/null 2>&1 || true
  AUTOSTART_KIND=openrc
fi
echo "JUSTAVPS_DAEMON_AUTOSTART_$AUTOSTART_KIND"
nohup "$BIN" --config /dev/null >/var/log/justavps-daemon.log 2>/var/log/justavps-daemon.err &
echo $! >/run/justavps-daemon.pid
ok=0
i=0
while [ "$i" -lt 40 ]; do
  if "$BIN" --health-check --api-port 7777 >/tmp/justavps-daemon.health 2>/tmp/justavps-daemon.health.err; then ok=1; break; fi
  i=$((i + 1))
  sleep 0.25
done
if [ "$ok" != "1" ]; then
  if [ -s /var/log/justavps-daemon.err ]; then cat /var/log/justavps-daemon.err >&2; fi
  if [ -s /tmp/justavps-daemon.health.err ]; then cat /tmp/justavps-daemon.health.err >&2; fi
  fail "daemon health endpoint did not become ready from injected binary"
fi
cat /tmp/justavps-daemon.health
printf '\nJUSTAVPS_DAEMON_INJECT_OK\n'
`;
}

function installInjectedBinaryScript(input: { binaryPath: string; tempPath: string }) {
  const binaryPath = shellQuote(input.binaryPath);
  const tempPath = shellQuote(input.tempPath);
  return `set -eu
fail() { echo "JUSTAVPS_DAEMON_BINARY_INSTALL_ERROR: $*" >&2; exit 1; }
BIN=${binaryPath}
TMP=${tempPath}
[ -s "$TMP" ] || fail "uploaded daemon binary missing at $TMP"
if [ -s /run/justavps-daemon.pid ]; then kill "$(cat /run/justavps-daemon.pid)" >/dev/null 2>&1 || true; fi
if command -v pgrep >/dev/null 2>&1; then
  pgrep -x justavps-daemon 2>/dev/null | while read -r pid; do kill "$pid" >/dev/null 2>&1 || true; done
fi
mkdir -p "$(dirname "$BIN")" || fail "could not create daemon binary directory"
mv "$TMP" "$BIN" || fail "could not replace daemon binary"
chmod 0755 "$BIN" || fail "could not chmod daemon binary"
echo "JUSTAVPS_DAEMON_BINARY_INSTALLED"`;
}

async function activateInjectedManagedDaemon(input: EnsureManagedDaemonInput & { token: string; configJson: string; ensuredAt: string }): Promise<EnsureManagedDaemonResult | null> {
  const binaryPath = daemonBinaryPath(input.config);
  let daemonSource: 'injected-mount' | 'injected-push' | null = null;
  let localBinary: Buffer | null = null;

  if (input.config.daemonMountSource) {
    daemonSource = 'injected-mount';
  } else if (input.config.daemonLocalPath) {
    daemonSource = 'injected-push';
  } else {
    return null;
  }

  const readLocalBinary = () => {
    if (!input.config.daemonLocalPath) return null;
    localBinary ??= readFileSync(input.config.daemonLocalPath);
    return localBinary;
  };
  const expectedSha256 = daemonSource === 'injected-push' ? sha256Hex(readLocalBinary()!) : null;

  const runActivation = () => input.client.exec(input.instanceName, {
    command: ['/bin/sh', '-c', activateInjectedScript({ configJson: input.configJson, binaryPath, expectedSha256 })],
    timeoutMs: 20_000,
  }).catch((error) => ({
    exit_code: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
  }));

  let activation = await runActivation();
  if (activation.exit_code !== 0
    && daemonSource === 'injected-push'
    && input.config.daemonLocalPath
    && /binary missing|not found|No such file|missing at|binary hash mismatch|flag provided but not defined|health-check|Config error|unexpected end of JSON/i.test(`${activation.stderr}\n${activation.stdout}`)) {
    const binary = readLocalBinary()!;
    const tempBinaryPath = `/tmp/justavps-daemon.${expectedSha256}.new`;
    await input.client.pushFile(input.instanceName, tempBinaryPath, binary, { mode: 0o755 });
    const installBinary = await input.client.exec(input.instanceName, {
      command: ['/bin/sh', '-c', installInjectedBinaryScript({ binaryPath, tempPath: tempBinaryPath })],
      timeoutMs: 10_000,
    });
    const retried = installBinary.exit_code === 0
      ? await runActivation()
      : { exit_code: installBinary.exit_code, stdout: installBinary.stdout, stderr: installBinary.stderr };
    activation = {
      exit_code: retried.exit_code,
      stdout: `JUSTAVPS_DAEMON_BINARY_PUSHED\n${retried.stdout}`,
      stderr: retried.stderr,
    };
  } else if (activation.exit_code === 0 && daemonSource === 'injected-push') {
    activation = {
      exit_code: activation.exit_code,
      stdout: `JUSTAVPS_DAEMON_BINARY_REUSED\n${activation.stdout}`,
      stderr: activation.stderr,
    };
  }

  const base: EnsureManagedDaemonResult = {
    ok: false,
    mode: 'guest-daemon',
    ensured_at: input.ensuredAt,
    daemon_url: input.config.daemonDownloadUrl,
    telemetry_url: daemonTelemetryBaseUrl(input.config, input.machineId),
    telemetry_ingest_reachable_from_sandbox: input.config.telemetry.ingestReachableFromSandbox,
    telemetry_warnings: input.config.telemetry.warnings,
    daemon_source: daemonSource,
    token_prefix: `${input.token.slice(0, 10)}…`,
    token_sha256: sha256Hex(input.token),
    install: activation,
  };
  if (activation.exit_code !== 0) return { ...base, error: activation.stderr || activation.stdout || 'injected daemon activation failed' };
  const healthRaw = activation.stdout.split('\n').find((line) => line.trim().startsWith('{'))?.trim() ?? '';
  const autostartKind = activation.stdout.includes('JUSTAVPS_DAEMON_AUTOSTART_systemd')
    ? 'systemd'
    : activation.stdout.includes('JUSTAVPS_DAEMON_AUTOSTART_openrc')
      ? 'openrc'
      : 'none';
  return {
    ...base,
    ok: true,
    active: 'active',
    autostart: autostartKind !== 'none',
    autostart_kind: autostartKind,
    health: parseJsonMaybe(healthRaw),
    health_raw: healthRaw,
  };
}

export async function cleanupInjectedManagedDaemon(input: {
  config: AppConfig;
  client: IncusClient;
  instanceName: string;
  removeBinary?: boolean;
}): Promise<{ exit_code: number | null; stdout: string; stderr: string }> {
  const binaryPath = shellQuote(daemonBinaryPath(input.config));
  const removeBinary = input.removeBinary === true;
  return input.client.exec(input.instanceName, {
    command: ['/bin/sh', '-c', `set -eu
if [ -s /run/justavps-daemon.pid ]; then kill "$(cat /run/justavps-daemon.pid)" >/dev/null 2>&1 || true; fi
rm -f /run/justavps-daemon.pid /tmp/justavps-daemon.health /tmp/justavps-daemon.health.err >/dev/null 2>&1 || true
if [ ${removeBinary ? '1' : '0'} = 1 ]; then
  rm -f ${binaryPath} /etc/justavps/config.json /etc/systemd/system/justavps-daemon.service /etc/systemd/system/multi-user.target.wants/justavps-daemon.service /etc/init.d/justavps-daemon >/dev/null 2>&1 || true
fi
echo JUSTAVPS_DAEMON_INJECTION_CLEAN_OK
`],
    timeoutMs: 10_000,
  }).catch((error) => ({ exit_code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
}

async function activateBakedManagedDaemon(input: EnsureManagedDaemonInput & { token: string; configJson: string; ensuredAt: string }): Promise<EnsureManagedDaemonResult> {
  const activation = await input.client.exec(input.instanceName, {
    command: ['/bin/sh', '-c', activateBakedScript({ configJson: input.configJson })],
    timeoutMs: 45_000,
  }).catch((error) => ({
    exit_code: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
  }));

  const base: EnsureManagedDaemonResult = {
    ok: false,
    mode: 'guest-daemon',
    ensured_at: input.ensuredAt,
    daemon_url: input.config.daemonDownloadUrl,
    telemetry_url: daemonTelemetryBaseUrl(input.config, input.machineId),
    telemetry_ingest_reachable_from_sandbox: input.config.telemetry.ingestReachableFromSandbox,
    telemetry_warnings: input.config.telemetry.warnings,
    daemon_source: 'baked',
    token_prefix: `${input.token.slice(0, 10)}…`,
    token_sha256: sha256Hex(input.token),
    install: activation,
  };
  if (activation.exit_code !== 0) return { ...base, error: activation.stderr || activation.stdout || 'baked daemon activation failed' };

  const [active, version, health] = await Promise.all([
    input.client.exec(input.instanceName, { command: ['/bin/sh', '-c', daemonServiceStatusCommand()], timeoutMs: 10_000 }),
    input.client.exec(input.instanceName, { command: ['/usr/local/bin/justavps-daemon', '--version'], timeoutMs: 10_000 }).catch(() => ({ exit_code: 0, stdout: '', stderr: '' })),
    input.client.exec(input.instanceName, { command: ['curl', '-fsS', 'http://127.0.0.1:7777/health'], timeoutMs: 10_000 }),
  ]);
  const activeText = active.stdout.trim();
  const healthRaw = health.stdout.trim();
  const ok = activeText === 'active' && health.exit_code === 0;
  return {
    ...base,
    ok,
    active: activeText,
    version: version.stdout.trim() || undefined,
    health: parseJsonMaybe(healthRaw),
    health_raw: healthRaw,
    error: ok ? undefined : (health.stderr || active.stderr || 'baked daemon verification failed'),
  };
}

export async function ensureManagedDaemon(input: EnsureManagedDaemonInput): Promise<EnsureManagedDaemonResult> {
  const token = machineToken();
  const daemonUrl = input.config.daemonDownloadUrl;
  const preloadedDaemonPath = input.config.daemonLocalPath ? '/tmp/justavps-daemon.next' : null;
  const ensuredAt = new Date().toISOString();
  const telemetryUrl = daemonTelemetryBaseUrl(input.config, input.machineId);
  const configJson = JSON.stringify({
    slug: input.machineId,
    machine_id: input.machineId,
    callback_url: input.config.daemonCallbackUrl,
    machine_token: token,
    proxy_domain: input.config.proxyDomain,
    port_url_template: daemonPortUrlTemplate(input.config, input.machineId),
    telemetry_url: telemetryUrl,
    telemetry_token: input.config.telemetry.ingestToken ?? '',
    telemetry_interval_seconds: input.config.telemetry.metricIntervalSeconds,
    otlp_endpoint: input.config.telemetry.otlpEndpoint ?? '',
  }, null, 2);

  const injected = await activateInjectedManagedDaemon({ ...input, token, configJson, ensuredAt });
  if (injected) return injected;

  const baked = await activateBakedManagedDaemon({ ...input, token, configJson, ensuredAt });
  if (baked.ok) return baked;

  if (input.config.daemonLocalPath && preloadedDaemonPath) {
    const binary = readFileSync(input.config.daemonLocalPath);
    await input.client.pushFile(input.instanceName, preloadedDaemonPath, binary, { mode: 0o755 });
  }

  const install = await input.client.exec(input.instanceName, {
    command: ['/bin/sh', '-c', installScript({ configJson, daemonUrl, preloadedDaemonPath })],
    timeoutMs: 180_000,
  }).catch((error) => ({
    exit_code: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
  }));

  const base: EnsureManagedDaemonResult = {
    ok: false,
    mode: 'guest-daemon',
    ensured_at: ensuredAt,
    daemon_url: daemonUrl,
    telemetry_url: telemetryUrl,
    telemetry_ingest_reachable_from_sandbox: input.config.telemetry.ingestReachableFromSandbox,
    telemetry_warnings: input.config.telemetry.warnings,
    daemon_source: preloadedDaemonPath ? 'local-push' : 'download',
    token_prefix: `${token.slice(0, 10)}…`,
    token_sha256: sha256Hex(token),
    install,
  };

  if (install.exit_code !== 0) {
    return { ...base, error: install.stderr || install.stdout || 'daemon install failed' };
  }

  const [active, version, health] = await Promise.all([
    input.client.exec(input.instanceName, { command: ['/bin/sh', '-c', daemonServiceStatusCommand()], timeoutMs: 10_000 }),
    input.client.exec(input.instanceName, { command: ['/usr/local/bin/justavps-daemon', '--version'], timeoutMs: 10_000 }).catch(() => ({ exit_code: 0, stdout: '', stderr: '' })),
    input.client.exec(input.instanceName, { command: ['curl', '-fsS', 'http://127.0.0.1:7777/health'], timeoutMs: 10_000 }),
  ]);

  let portCheck: EnsureManagedDaemonResult['port_check'];
  if (input.verifyPort) {
    const check = await input.client.exec(input.instanceName, {
      command: ['/bin/sh', '-c', `curl -sS -o /dev/null -w '%{http_code}' ${shellQuote(`http://127.0.0.1/_port/${input.verifyPort}/`)}`],
      timeoutMs: 15_000,
    }).catch((error) => ({ exit_code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
    portCheck = { port: input.verifyPort, ...check };
  }

  const activeText = active.stdout.trim();
  const healthRaw = health.stdout.trim();
  const ok = activeText === 'active' && health.exit_code === 0;
  return {
    ...base,
    ok,
    active: activeText,
    version: version.stdout.trim() || undefined,
    health: parseJsonMaybe(healthRaw),
    health_raw: healthRaw,
    port_check: portCheck,
    error: ok ? undefined : (health.stderr || active.stderr || 'daemon verification failed'),
  };
}

export async function restartManagedDaemonService(input: {
  client: IncusClient;
  instanceName: string;
  timeoutMs?: number;
}): Promise<ManagedDaemonRestartResult> {
  const startedAt = Date.now();
  const checkedAt = nowIso();
  const restart = await input.client.exec(input.instanceName, {
    command: ['/bin/sh', '-lc', `set -eu
if [ ! -x /usr/local/bin/justavps-daemon ]; then echo "justavps-daemon binary missing" >&2; exit 126; fi
if [ ! -s /etc/justavps/config.json ]; then echo "justavps config missing" >&2; exit 125; fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable justavps-daemon >/dev/null 2>&1 || true
  systemctl restart justavps-daemon
elif command -v rc-service >/dev/null 2>&1; then
  rc-update add justavps-daemon default >/dev/null 2>&1 || true
  rc-service justavps-daemon restart >/dev/null 2>&1 || { ${startDaemonFallbackScript()} ; }
else
  ${startDaemonFallbackScript()}
fi
${daemonServiceStatusCommand()}
`],
    timeoutMs: Math.max(5_000, input.timeoutMs ?? 20_000),
  }).catch((error) => ({ exit_code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));

  if (restart.exit_code !== 0) {
    return {
      ok: false,
      checked_at: checkedAt,
      attempts: 0,
      duration_ms: elapsedMs(startedAt),
      restart,
      active: restart.stdout.trim() || undefined,
      exit_code: restart.exit_code,
      stdout: restart.stdout,
      stderr: restart.stderr,
      error: restart.stderr || restart.stdout || 'managed daemon service restart failed',
    };
  }

  const health = await waitForManagedDaemonHealth({
    client: input.client,
    instanceName: input.instanceName,
    timeoutMs: Math.max(2_000, Math.min(10_000, input.timeoutMs ?? 10_000)),
    intervalMs: 500,
  });
  return { ...health, duration_ms: elapsedMs(startedAt), restart };
}

function bakeScript(input: { daemonUrl: string; preloadedDaemonPath?: string | null }) {
  const preloadedDaemonPath = input.preloadedDaemonPath ?? '';
  return `set -eu
export DEBIAN_FRONTEND=noninteractive
fail() { echo "JUSTAVPS_DAEMON_BAKE_ERROR: $*" >&2; exit 1; }

${ensureInitKindScript()}

mkdir -p /etc/justavps /usr/local/bin /etc/systemd/system /etc/init.d /run /var/log || fail "could not create platform directories"
${installCurlAndDaemonScript({ daemonUrl: input.daemonUrl, preloadedDaemonPath })}

cat > /etc/systemd/system/justavps-daemon.service <<'JUSTAVPS_DAEMON_UNIT'
${daemonUnitText()}
JUSTAVPS_DAEMON_UNIT
cat > /etc/init.d/justavps-daemon <<'JUSTAVPS_OPENRC_UNIT'
${daemonOpenRcText()}
JUSTAVPS_OPENRC_UNIT
chmod +x /etc/init.d/justavps-daemon || true

# Never bake a machine-scoped token/config into reusable images. The real config
# is written during machine creation or pool priming, then the enabled service
# starts immediately because ConditionPathExists becomes true.
rm -f /etc/justavps/config.json
if [ "$INIT_KIND" = "systemd" ]; then
  systemctl stop justavps-daemon >/dev/null 2>&1 || true
  systemctl daemon-reload || fail "systemctl daemon-reload failed"
  systemctl enable justavps-daemon >/dev/null 2>&1 || true
  systemctl reset-failed justavps-daemon >/dev/null 2>&1 || true
else
  if [ -s /run/justavps-daemon.pid ]; then kill "$(cat /run/justavps-daemon.pid)" >/dev/null 2>&1 || true; fi
  rc-update add justavps-daemon default >/dev/null 2>&1 || true
fi
/usr/local/bin/justavps-daemon --version || true
echo "JUSTAVPS_DAEMON_BAKE_OK"
`;
}

export async function bakeManagedDaemonIntoInstance(input: {
  config: AppConfig;
  client: IncusClient;
  instanceName: string;
}): Promise<BakeManagedDaemonResult> {
  const daemonUrl = input.config.daemonDownloadUrl;
  const preloadedDaemonPath = input.config.daemonLocalPath ? '/tmp/justavps-daemon.bake' : null;
  const bakedAt = nowIso();

  if (input.config.daemonLocalPath && preloadedDaemonPath) {
    const binary = readFileSync(input.config.daemonLocalPath);
    await input.client.pushFile(input.instanceName, preloadedDaemonPath, binary, { mode: 0o755 });
  }

  const install = await input.client.exec(input.instanceName, {
    command: ['/bin/sh', '-c', bakeScript({ daemonUrl, preloadedDaemonPath })],
    timeoutMs: 180_000,
  }).catch((error) => ({
    exit_code: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
  }));

  const version = await input.client.exec(input.instanceName, {
    command: ['/usr/local/bin/justavps-daemon', '--version'],
    timeoutMs: 10_000,
  }).catch(() => ({ exit_code: 0, stdout: '', stderr: '' }));

  const ok = install.exit_code === 0;
  return {
    ok,
    baked_at: bakedAt,
    daemon_url: daemonUrl,
    daemon_source: preloadedDaemonPath ? 'local-push' : 'download',
    install,
    version: version.stdout.trim() || undefined,
    error: ok ? undefined : (install.stderr || install.stdout || 'daemon bake failed'),
  };
}

export async function ensureManagedDaemonForMachine(input: {
  config: AppConfig;
  machineId: string;
  findCluster: (id: string) => IncusClusterConfig | null;
  clientFor: (cluster: IncusClusterConfig) => IncusClient;
  verifyPort?: number | null;
}) {
  const prisma = getPrisma();
  const machine = await prisma.machine.findUnique({ where: { id: input.machineId } });
  if (!machine) return null;
  const cluster = input.findCluster(machine.incusClusterId);
  const checkedAt = new Date().toISOString();
  if (!cluster) {
    const metadata = {
      ...daemonMeta(machine),
      managed_daemon_desired: true,
      managed_daemon_state: 'failed',
      managed_daemon_checked_at: checkedAt,
      managed_daemon: { ok: false, error: `Configured Incus cluster ${machine.incusClusterId} not found`, ensured_at: checkedAt, mode: 'guest-daemon' },
    };
    return prisma.machine.update({ where: { id: machine.id }, data: { metadata: metadata as Prisma.InputJsonValue } });
  }

  const daemon = await ensureManagedDaemon({
    config: input.config,
    client: input.clientFor(cluster),
    instanceName: machine.incusInstanceName,
    machineId: machine.id,
    verifyPort: input.verifyPort ?? null,
  });
  const current = await prisma.machine.findUnique({ where: { id: machine.id } }).catch(() => null);
  const metadata = {
    ...daemonMeta(current ?? machine),
    managed_daemon_desired: true,
    managed_daemon_state: daemon.ok ? 'ready' : 'failed',
    managed_daemon_checked_at: daemon.ensured_at,
    managed_daemon_config_hash: managedDaemonConfigHash(input.config, machine.id),
    managed_daemon_telemetry_url: daemonTelemetryBaseUrl(input.config, machine.id),
    managed_daemon_telemetry_ingest_reachable_from_sandbox: input.config.telemetry.ingestReachableFromSandbox,
    managed_daemon_telemetry_warnings: input.config.telemetry.warnings,
    managed_daemon: daemon,
  };
  return prisma.machine.update({ where: { id: machine.id }, data: { metadata: metadata as Prisma.InputJsonValue } });
}

export function startManagedDaemonEnsurer(input: {
  config: AppConfig;
  findCluster: (id: string) => IncusClusterConfig | null;
  clientFor: (cluster: IncusClusterConfig) => IncusClient;
}) {
  if (!input.config.databaseConfigured || !input.config.daemonEnsureWorker) return;

  const inFlight = new Set<string>();
  const tick = async () => {
    const prisma = getPrisma();
    const machines = await prisma.machine.findMany({ where: { status: { notIn: ['deleted', 'warm_pool', 'warm_pool_claiming'] } }, take: 100 });
    const target = machines.find((machine) => !inFlight.has(machine.id) && shouldEnsureManagedDaemon(machine, Date.now(), input.config));
    if (!target) return;
    inFlight.add(target.id);
    await markManagedDaemonQueued(target.id).catch(() => undefined);
    ensureManagedDaemonForMachine({
      config: input.config,
      machineId: target.id,
      findCluster: input.findCluster,
      clientFor: input.clientFor,
    }).catch((error) => {
      console.warn(`[v2-api] managed daemon ensure failed for ${target.id}:`, error instanceof Error ? error.message : String(error));
    }).finally(() => {
      inFlight.delete(target.id);
    });
  };

  tick().catch((error) => console.warn('[v2-api] managed daemon ensure worker initial tick failed:', error instanceof Error ? error.message : String(error)));
  setInterval(() => {
    tick().catch((error) => console.warn('[v2-api] managed daemon ensure worker tick failed:', error instanceof Error ? error.message : String(error)));
  }, WORKER_INTERVAL_MS).unref?.();
}
