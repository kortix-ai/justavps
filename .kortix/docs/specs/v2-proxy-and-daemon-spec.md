# V2 Proxy & Daemon Architecture Spec

## Current State (broken)

- Each VM gets per-machine NAT ports on the host (e.g. SSH:22209, HTTP:8252)
- The daemon inside each VM listens on :80 and does host-header routing
- Port-forwarding uses `{port}--{slug}.kortix-dev.cloud` subdomain pattern
- But subdomains resolve to Cloudflare edge (proxied wildcard), and the Worker doesn't forward to the right host port
- Direct `origin-{slug}:8252` works but doesn't support subdomain-based port forwarding
- Result: terminal works, SSH works, but **port forwarding and proxy are broken**

## Target Architecture

### Layer 1: DNS (Cloudflare)

```
*.kortix-dev.cloud      → Cloudflare edge IPs (proxied, orange cloud)
origin-{slug}.kortix-dev.cloud → host IP (unproxied, grey cloud) [for SSH only]
```

### Layer 2: Host-level reverse proxy (nginx on host port 80)

nginx on the **baremetal host** listens on port 80 and:

1. Reads `Host` header from incoming request
2. Extracts the machine slug:
   - `{slug}.kortix-dev.cloud` → slug = `{slug}`, forward to `vm_ip:80`
   - `{port}--{slug}.kortix-dev.cloud` → slug = `{slug}`, forward to `vm_ip:80`
   - `_terminal` path → forward to `vm_ip:80` (daemon handles it)
3. Looks up VM private IP from a **map file** (`/etc/nginx/vm-map.conf`)
4. Forwards the full request (including original Host header) to `vm_ip:80`
5. The **daemon inside the VM** reads the Host header and routes to the right internal port

This is the missing piece. Without this, Cloudflare has no origin to forward to.

### Layer 3: Cloudflare Worker

The Worker receives requests at `*.kortix-dev.cloud`:
1. Reads the KV entry `machine:{slug}` for auth/routing
2. Forwards to the **host's public IP on port 80**
3. The host nginx reads the Host header and routes to the right VM
4. The daemon inside the VM routes to the right internal port

The Worker already exists and handles auth. We just need the KV entry to point to `host_ip:80` (the nginx port), not the VM's private IP.

### Layer 4: Daemon inside VM (port 80)

The Go daemon:
- Listens on `:80` (public proxy) and `:7777` (internal API)
- Routes based on Host header:
  - `{slug}.kortix-dev.cloud` → default upstream (port 3456 or first detected port)
  - `{port}--{slug}.kortix-dev.cloud` → `127.0.0.1:{port}`
  - `/_terminal` → built-in web terminal
  - `/_justavps/*` → internal API
- Heartbeats to the control plane
- Detects listening ports and reports them

### Layer 5: SSH access

SSH bypasses all HTTP layers:
- `origin-{slug}.kortix-dev.cloud` → unproxied DNS → host IP
- Host has Incus NAT proxy device: `host:{ssh_port}` → `vm:22`
- User SSHes to `origin-{slug}.kortix-dev.cloud:{ssh_port}`

## What needs to change

### 1. Install nginx on host
- Listen on port 80
- Dynamic upstream resolution from a map file
- Pass-through Host header
- WebSocket support (for terminal)

### 2. Runnerd generates nginx map
- On VM create/delete: regenerate `/etc/nginx/vm-map.conf`
- Map format: `slug → vm_private_ip`
- Reload nginx after update

### 3. Remove per-VM HTTP NAT proxy devices
- No more `incus config device add ... http proxy ...`
- Only SSH NAT proxy devices remain per VM
- HTTP goes through nginx on host:80

### 4. Update KV entries
- `ip` field should be the host's public IP
- `origin_hostname` should be `host_ip` (since nginx on host:80 handles routing)

### 5. Golden image additions
- Node.js (LTS)
- Python 3
- Common dev tools (git, curl, wget, jq, htop, tmux, vim)
- Keep it lean but usable

## Flow diagram

```
User browser
  → https://3000--pwg5ey5m.kortix-dev.cloud
  → Cloudflare edge (wildcard DNS, proxied)
  → Cloudflare Worker (reads KV for auth)
  → http://135.181.129.188:80 (host nginx)
  → nginx reads Host: 3000--pwg5ey5m.kortix-dev.cloud
  → extracts slug "pwg5ey5m", looks up VM IP 10.189.108.62
  → forwards to http://10.189.108.62:80
  → Go daemon reads Host header
  → routes to 127.0.0.1:3000 inside VM
  → user sees their app
```

```
User SSH
  → ssh -p 22209 root@origin-pwg5ey5m.kortix-dev.cloud
  → DNS resolves to 135.181.129.188 (unproxied)
  → Incus NAT proxy: host:22209 → vm:22
  → sshd inside VM
```
