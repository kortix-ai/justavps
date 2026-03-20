# Port Forwarding

Every JustAVPS machine comes with automatic port forwarding out of the box. Any service running on your machine is instantly accessible via a public URL — no configuration, no firewall rules, no tunnels.

## URL Format

```
https://PORT--SLUG.kortix.cloud
```

Example: machine slug `abc123`, service on port 3000:
```
https://3000--abc123.kortix.cloud
```

## Environments

| Environment | Proxy Domain | Worker | Platform |
|-------------|-------------|--------|----------|
| **Production** | `*.kortix.cloud` | `kortix-cloud-proxy` | `justavps.com` |
| **Development** | `*.kortix-dev.cloud` | `kortix-cloud-proxy-dev` | `dev.justavps.com` |

Each environment is fully isolated — separate CF Workers, separate KV namespaces, separate auth secrets. A dev machine is not accessible via the prod domain and vice versa.

## How It Works

1. **Your service binds to `localhost`** — runs on `127.0.0.1:PORT` as usual, no need to bind `0.0.0.0`
2. **The daemon proxies** — the JustAVPS daemon on port 80 forwards requests via `/_port/PORT/path` to `localhost:PORT`
3. **CF Worker authenticates** — `PORT--SLUG.kortix.cloud` hits the Worker, which verifies your session and proxies through the daemon
4. **Auth is transparent** — if you're logged into JustAVPS, your machine ports just work

```
Browser → CF Worker (auth) → daemon :80 → /_port/PORT → localhost:PORT
         ↑                    ↑
    PORT--SLUG.kortix.cloud   All ports through single entry point
```

## SSH Experience

When you SSH into a machine, port forwarding works automatically. No extra setup, no SSH tunnels.

### Login Banner

Every SSH login shows the port URL pattern and currently active ports:

```
  ⚡ JustAVPS — abc123
  ─────────────────────────────────────────
  Ports:  https://PORT--abc123.kortix.cloud
  Help:   porturl [PORT]  — get public URL

  Active ports:
    3000 → https://3000--abc123.kortix.cloud
    4096 → https://4096--abc123.kortix.cloud
```

### Automatic Port Notifications

When you start a new service, a notification appears automatically in your terminal:

```
root@justavps-abc123:~# npm run dev
> dev server listening on http://localhost:3000

⚡ Port 3000 is now available: https://3000--abc123.kortix.cloud
```

The daemon detects new listening ports within 2 seconds and the background watcher (auto-started on login) prints the notification inline. No manual `portwatch` command needed.

### Commands

| Command | Description |
|---------|-------------|
| `porturl 3000` | Print the public URL for port 3000 |
| `porturl` | List all listening ports with their public URLs |
| `portwatch` | Manually run the port watcher (auto-started on login, but available if needed) |

### Environment Variables

Set automatically on every login:

| Variable | Example | Description |
|----------|---------|-------------|
| `JUSTAVPS_SLUG` | `abc123` | Machine slug |
| `JUSTAVPS_DOMAIN` | `kortix.cloud` | Proxy domain |
| `JUSTAVPS_PORT_URL_TEMPLATE` | `https://{{port}}--abc123.kortix.cloud` | URL template for programmatic use |

Frameworks can use these env vars for auto-configuration.

## Web Terminal

The web terminal (dashboard and `/_terminal` page) adds clickable link rewriting on top of the SSH experience:

- `http://localhost:3000` → clickable link to `https://3000--slug.kortix.cloud`
- `http://127.0.0.1:8080` → clickable link to `https://8080--slug.kortix.cloud`
- `http://0.0.0.0:4096` → clickable link to `https://4096--slug.kortix.cloud`

Hover shows the forwarded URL. Click opens it in a new tab.

## Port Watcher (Daemon)

The daemon continuously polls `/proc/net/tcp` for new listening ports. When detected:

1. Logs to `/run/justavps/port-events` (format: `<timestamp> <open|close> <port> <url>`)
2. The background shell watcher (auto-started on login) picks up events and prints notifications

System ports are excluded: 22 (SSH), 80 (daemon), 7777 (internal API), 2468 (sandbox agent), and ephemeral ports (>49151).

## Deployment

### Deploying Workers

```bash
# Prod worker (*.kortix.cloud)
cd workers/proxy && npx wrangler deploy

# Dev worker (*.kortix-dev.cloud)
cd workers/proxy && npx wrangler deploy -c wrangler.dev.toml
```

### Setting Secrets

```bash
# Prod
echo "YOUR_SECRET" | npx wrangler secret put PROXY_AUTH_SECRET

# Dev
echo "YOUR_SECRET" | npx wrangler secret put PROXY_AUTH_SECRET -c wrangler.dev.toml
```
