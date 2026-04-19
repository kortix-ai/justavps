# runnerd

Host-local control plane for bare-metal JustAVPS nodes.

Responsibilities:

- talks only to local Incus
- creates/starts/stops/reboots/deletes Incus VMs
- publishes custom images from instances
- reports host-local machine metadata back to JustAVPS

## Environment

- `RUNNERD_TOKEN` — bearer token expected from JustAVPS
- `RUNNERD_PORT` — default `7779`
- `INCUS_REMOTE` — optional Incus remote name (default local)
- `RUNNERD_PUBLIC_IPV4` — public host IPv4 advertised back to control plane
- `RUNNERD_PUBLIC_IPV6` — optional public host IPv6

## Start

```bash
pnpm runnerd:dev
```

## API

- `GET /healthz` — returns `503` if runnerd is up but local Incus is unhealthy or unreachable
- `POST /v1/instances`
- `POST /v1/instances/:id/start`
- `POST /v1/instances/:id/stop`
- `POST /v1/instances/:id/reboot`
- `DELETE /v1/instances/:id`
- `POST /v1/images/publish`

This is intentionally minimal for the first implementation.
