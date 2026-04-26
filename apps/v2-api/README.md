# JustAVPS V2 API

Standalone V2 API. This is not a route bundle inside the legacy app.

## Boundary

- Incus owns runtime: clusters, members, instances, images, snapshots, backups, operations.
- Prisma/Postgres owns product state: machines, ownership, inventory annotations, jobs, audit, retention.
- Hetzner Robot owns physical server purchase/inventory facts before hosts join Incus.
- `justavps-daemon` owns per-machine filesystem/bash/PTY/toolbox UX inside each instance.

## Commands

```bash
pnpm --dir apps/v2-api install
pnpm --dir apps/v2-api db:migrate
pnpm --dir apps/v2-api dev
```

Root shortcuts:

```bash
pnpm v2api:build
pnpm v2api:dev
pnpm v2api:db:migrate
pnpm e2e:v2api:01
```

## Config

```bash
V2_API_PORT=4200
V2_ADMIN_TOKEN=optional-local-admin-token
DATABASE_URL=postgresql://...

HETZNER_ROBOT_USER=...
HETZNER_ROBOT_PASSWORD=...

INCUS_ENDPOINT=https://135.181.129.188:8443
INCUS_CLUSTER_ID=hel1
INCUS_CLUSTER_NAME=hel1
INCUS_REGION=eu
INCUS_PROJECT=default
INCUS_ROOT_POOL=default
INCUS_CLIENT_CERT=/path/client.crt
INCUS_CLIENT_KEY=/path/client.key
INCUS_CA_CERT=/path/ca.crt
```

Multiple Incus clusters can be configured with `INCUS_CLUSTERS_JSON`.
