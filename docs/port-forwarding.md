# Port Forwarding

Every JustAVPS machine comes with automatic port forwarding out of the box. Any service running on your machine is instantly accessible via a public URL — no configuration needed.

## URL Format

```
https://PORT--SLUG.kortix.cloud
```

Example: if your machine slug is `xoydduba` and you run a service on port 3000:
```
https://3000--xoydduba.kortix.cloud
```

## How It Works

1. **Services bind to `localhost`** — your service runs on `127.0.0.1:PORT` as usual
2. **The daemon proxies** — the JustAVPS daemon on port 80 forwards external requests to your service via `/_port/PORT/path`
3. **Cloudflare Worker routes** — `PORT--SLUG.kortix.cloud` is handled by the CF Worker, which authenticates the request and proxies it through the daemon
4. **Auth is automatic** — if you're logged into JustAVPS, you have access to your machine's ports

## Shell Integration

On every SSH login or terminal session, you'll see:

```
  ⚡ JustAVPS — xoydduba
  ─────────────────────────────────────────
  Ports:  https://PORT--xoydduba.kortix.cloud
  Help:   porturl [PORT]  — get public URL
          portwatch       — live port notifications

  Active ports:
    3000 → https://3000--xoydduba.kortix.cloud
    4096 → https://4096--xoydduba.kortix.cloud
```

### Commands

| Command | Description |
|---------|-------------|
| `porturl 3000` | Print the public URL for port 3000 |
| `porturl` | List all currently listening ports with their public URLs |
| `portwatch` | Watch for new ports and get real-time notifications |

### Environment Variables

Set automatically on login:

| Variable | Value | Description |
|----------|-------|-------------|
| `JUSTAVPS_SLUG` | `xoydduba` | Machine slug |
| `JUSTAVPS_DOMAIN` | `kortix.cloud` | Proxy domain |
| `JUSTAVPS_PORT_URL_TEMPLATE` | `https://{{port}}--xoydduba.kortix.cloud` | URL template |

## Web Terminal

The web terminal (dashboard terminal and `/_terminal` page) automatically rewrites localhost URLs. When a service prints `http://localhost:3000`, it becomes a clickable link to `https://3000--slug.kortix.cloud`.

Supported patterns:
- `http://localhost:PORT`
- `http://127.0.0.1:PORT`
- `http://0.0.0.0:PORT`
- `localhost:PORT` (without protocol)

## Port Watcher

The daemon continuously monitors for new listening ports. When a new service starts, it:
1. Logs the public URL to `/run/justavps/port-events`
2. The `portwatch` command picks up these events and displays notifications in your terminal

## Architecture

```
Browser → CF Worker (auth) → daemon :80 → /_port/PORT → localhost:PORT
         ↑                    ↑
    PORT--SLUG.kortix.cloud   Single entry point, all ports via daemon
```

All port traffic flows through the daemon on port 80. Services don't need to bind to `0.0.0.0` or open firewall ports — the daemon handles everything.
