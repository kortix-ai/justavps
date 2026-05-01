# Node provisioning — operator runbook

Add a new host to an Incus cluster end-to-end via the V2 API. Two source
modes (BYO and Hetzner-buy) and two target OS modes (Ubuntu+Incus and
IncusOS).

## Concept

Each "add a node" attempt is a `NodeProvisioningRun` row. The runner walks
ordered steps; each step is idempotent. A failed run can be retried in
place — the runner skips already-succeeded steps and resumes from the
failed one.

```
pending → running → succeeded
              ↓
            failed → (retry) → pending
              ↓
          cancelled
```

## Steps

### Ubuntu + Incus path
1. `probe-ssh` — verify reachability via SSH.
2. `bootstrap-prereqs` — `scripts/deploy/host-bootstrap/00-prereqs.sh`.
3. `bootstrap-install-incus` — `10-install-incus.sh`.
4. `bootstrap-configure-incus` — `20-configure-incus.sh`.
5. `mint-join-token` — leader cluster mints a one-shot member token.
6. `cluster-join` — `incus admin init --preseed` on the new node.
7. `verify-membership` — leader sees the new member online.

### IncusOS path
1. `probe-ssh` — host is in Hetzner Rescue.
2. `incus-os-flash` — `scripts/deploy/incus-os/install-from-rescue.sh` flashes the rescue's NVMe with IncusOS, optionally injects a seed.tar carrying the cluster join token, reboots.
3. `incus-os-await-online` — wait for IncusOS to come online (up to 10 min).
4. `mint-join-token` (skipped if seed.tar already had it).
5. `cluster-join` (skipped if seed.tar already did it).
6. `verify-membership`.

## Operator flow

### From the admin UI

`/admin/topology` → "Add node" button → fill in cluster + source + SSH details → "Schedule run". The new run shows up in the "Node provisioning" panel, polled every 3s. Click "Drive" to execute (or rely on the background worker if `V2_NODE_PROVISIONING_WORKER=on`).

### From the CLI

```bash
# BYO host (existing rented dedicated)
pnpm justavps admin nodes add \
  --cluster hel1 \
  --source byo \
  --target-os ubuntu-incus \
  --ssh-host 135.181.x.x

# Hetzner buy (gated)
pnpm justavps admin nodes add \
  --cluster hel1 \
  --source hetzner-buy \
  --hetzner-server 1234567

# Manage
pnpm justavps admin nodes list
pnpm justavps admin nodes get <runId>
pnpm justavps admin nodes drive <runId>
pnpm justavps admin nodes retry <runId>
pnpm justavps admin nodes cancel <runId>
```

### From the SDK

```ts
import { JustAVPSV2 } from '@kortix/justavps-v2';
const client = new JustAVPSV2({ baseUrl, token });

const { run } = await client.admin.nodes.add({
  cluster_id: 'hel1',
  source: 'byo',
  target_os: 'ubuntu-incus',
  ssh_host: '135.181.x.x',
});

await client.admin.nodes.drive(run.id);
// poll client.admin.nodes.get(run.id) until run.status === 'succeeded' or 'failed'
```

## Money gate

Real Hetzner ordering stays gated server-side via the existing procurement
endpoints (`POST /admin/procurements/.../order` returns 409 unless
`confirm: 'ORDER REAL HOSTS'` is provided). Creating a `hetzner-buy`
provisioning run does NOT place an order — the run sits in `pending` until
the operator separately drives the procurement → bootstrap pairing.

This is intentional: every order is ~$50/mo recurring. We never spend
without explicit operator confirmation. The runner picks up the
already-delivered server number and proceeds with the bootstrap.

## Background worker

Off by default. Enable with `V2_NODE_PROVISIONING_WORKER=on`; tick every
5s by default (`V2_NODE_PROVISIONING_TICK_MS`). One run at a time.

For one-shot manual drive (CI / debug): `POST /admin/nodes/runs/:id/drive`.

## Failure recovery

- Failed step → `POST /admin/nodes/runs/:id/retry` resets the failed step
  to `pending`. The runner re-executes from there. Idempotent: completed
  steps are skipped.
- Stuck running → `POST /admin/nodes/runs/:id/cancel` marks the row
  cancelled. The runner stops at the next step boundary.
- Node was added to Incus but the run row says `failed` (rare desync) →
  cancel the run + manually `incus cluster remove <name>` on the leader,
  then schedule a fresh run.

## Defaults + the "make IncusOS the default" question

Ship default = `ubuntu-incus`. Reason: the bootstrap shell scripts have
been validated; the IncusOS flash path is fresh and any image-format /
seed-format change between releases will catch us off-guard the first time.

Move IncusOS to default once **three consecutive `incus-os` runs have
succeeded green** against fresh Hetzner orders. Until then, `incus-os` is
opt-in via the dialog / `--target-os` flag.

## Schema

`v2_ops.node_provisioning_runs` (`prisma/schema.prisma`):

| column | type | meaning |
|---|---|---|
| id | cuid | run id |
| cluster_id | string | target Incus cluster |
| source | enum | `byo` \| `hetzner-buy` |
| target_os | enum | `ubuntu-incus` \| `incus-os` |
| ssh_host | string? | required for `byo` |
| ssh_user, ssh_port | string, int | SSH details |
| hetzner_server_number | int? | for `hetzner-buy` |
| status | enum | `pending` \| `running` \| `succeeded` \| `failed` \| `cancelled` |
| current_step | string? | step in flight |
| last_error | string? | latest failure message |
| steps | jsonb | full step log: `[{name, status, started_at, ended_at, log, error}]` |
| metadata | jsonb | run-specific extras (leader_addresses, seed config, etc.) |
| started_at, ended_at | timestamps | wall clock |
