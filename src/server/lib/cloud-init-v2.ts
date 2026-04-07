/**
 * V2 Cloud-init — minimal machine identity injection only.
 *
 * The golden base image already has Docker, daemon, sandbox-agent, opencode,
 * fail2ban, UFW, systemd services, etc. pre-installed.
 *
 * This cloud-init ONLY does:
 * 1. Write SSH keys
 * 2. Write /etc/justavps/config.json (slug, token, callback URL)
 * 3. Write /etc/justavps/env (machine env vars)
 * 4. Start the daemon
 * 5. Report stage callbacks
 *
 * Target: <5 seconds of cloud-init execution time.
 */

import { config } from './config';

interface V2CloudInitOpts {
  slug: string;
  sshPublicKey: string;
  machineToken: string;
  platformCallbackUrl: string;
  proxyDomain: string;
  envVars?: Record<string, string>;
  extraSSHKeys?: string[];
  cloudInitScript?: string;
}

export function buildCloudInitV2(opts: V2CloudInitOpts): string {
  const envEntries: Record<string, string> = {
    JUSTAVPS_SLUG: opts.slug,
    JUSTAVPS_MACHINE_TOKEN: opts.machineToken,
    ...opts.envVars,
  };

  const envLines = Object.entries(envEntries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const envLinesBase64 = Buffer.from(envLines).toString('base64');

  const stageCallback = (stage: string, message: string) =>
    `curl -sf -X POST "${opts.platformCallbackUrl}/api/v1/internal/stage" ` +
    `-H "Content-Type: application/json" ` +
    `-d '{"slug":"${opts.slug}","machine_token":"${opts.machineToken}","stage":"${stage}","message":"${message}"}' ` +
    `>/dev/null 2>&1 || true`;

  const allKeys = [opts.sshPublicKey, ...(opts.extraSSHKeys ?? [])];
  const keysBlock = allKeys.map((k) => `echo '${k}'`).join('\n');

  const brokerUfwRules = config.brokerSourceIPs()
    .map((ip) => `ufw allow from ${ip} to any port 80 proto tcp 2>/dev/null || true`)
    .join('\n');

  const cloudInitScriptBase64 = opts.cloudInitScript
    ? Buffer.from(opts.cloudInitScript).toString('base64')
    : '';

  return `#!/bin/bash
# V2 minimal cloud-init — identity injection only
# CRITICAL: file writes FIRST, network calls LAST, all errors tolerated
set +e
export HOME=/root
export DEBIAN_FRONTEND=noninteractive

# ── 1. Write all files (no network needed) ────────────────────────────────
mkdir -p /root/.ssh /home/user/.ssh /etc/justavps

(${keysBlock}) > /root/.ssh/authorized_keys
cp /root/.ssh/authorized_keys /home/user/.ssh/authorized_keys
chmod 700 /root/.ssh /home/user/.ssh
chmod 600 /root/.ssh/authorized_keys /home/user/.ssh/authorized_keys
chown -R user:user /home/user/.ssh 2>/dev/null || true

cat > /etc/justavps/config.json << 'CONFIGEOF'
{
  "slug": "${opts.slug}",
  "callback_url": "${opts.platformCallbackUrl}",
  "machine_token": "${opts.machineToken}",
  "proxy_domain": "${opts.proxyDomain}"
}
CONFIGEOF

echo '${envLinesBase64}' | base64 -d > /etc/justavps/env

systemd-machine-id-setup 2>/dev/null || true
echo "${opts.slug}" > /etc/hostname
hostname "${opts.slug}" 2>/dev/null || true

# ── 2. Ensure daemon + default landing service files exist ──
cat > /etc/systemd/system/justavps-daemon.service << 'DAEONSVC'
[Unit]
Description=JustAVPS Daemon
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/local/bin/justavps-daemon --config /etc/justavps/config.json
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
DAEONSVC

mkdir -p /opt/justavps-welcome
cat > /opt/justavps-welcome/index.html << 'WELCOMEHTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>JustAVPS — ${opts.slug}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #09090b; color: #fafafa; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px; }
    .card { border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03); border-radius: 20px; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 14px; color: #a1a1aa; line-height: 1.55; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { background: #18181b; color: #d4d4d8; padding: 14px; border-radius: 12px; overflow: auto; border: 1px solid rgba(255,255,255,.08); }
    .muted { font-size: 13px; color: #71717a; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>JustAVPS — ${opts.slug}</h1>
      <p>Your machine is online. The daemon is reachable and the default proxy is working.</p>
      <p>Run a web service inside the machine and access it via a port URL. Example:</p>
      <pre>python3 -m http.server 3000

Then open:
https://3000--${opts.slug}.${opts.proxyDomain}</pre>
      <p>You can also use the built-in terminal and SSH connect flow from the dashboard.</p>
      <p class="muted">This page is served by the default landing app on port 3456 so the root proxy URL always has a valid upstream.</p>
    </div>
  </div>
</body>
</html>
WELCOMEHTML

cat > /etc/systemd/system/justavps-welcome.service << 'WELCOMESVC'
[Unit]
Description=JustAVPS Welcome App
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/justavps-welcome
ExecStart=/usr/bin/python3 -m http.server 3456 --bind 127.0.0.1 --directory /opt/justavps-welcome
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
WELCOMESVC

# ── 3. Start services ────────────────────────────────────────────────────
systemctl unmask justavps-daemon justavps-welcome sandbox-agent opencode-web 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now justavps-daemon 2>/dev/null || true
systemctl enable --now justavps-welcome 2>/dev/null || true
systemctl enable --now sandbox-agent 2>/dev/null || true
systemctl enable --now opencode-web 2>/dev/null || true

# ── 4. UFW broker rules ──────────────────────────────────────────────────
${brokerUfwRules}

# ── 5. UFW / custom script ────────────────────────────────────────────────
${cloudInitScriptBase64 ? `echo '${cloudInitScriptBase64}' | base64 -d > /tmp/justavps-custom.sh
chmod +x /tmp/justavps-custom.sh
/bin/bash /tmp/justavps-custom.sh || true` : ''}

# ── 6. Stage callback (best-effort, control plane marks ready on runnerd return) ─
${stageCallback('services_ready', 'Services started')}
`;
}
