# Admin dashboard (v2) — operator guide

Internal reference for the v2 admin panel at `/v2/admin`. Concise, workflow-first.

---

## 1. Topology

JustAVPS models the fleet as **Region → Host → Machine**:

- **Region** — a coarse user-facing geography (`eu`, `us`). Canonical list:
  [`src/shared/lib/regions.ts`](../src/shared/lib/regions.ts). Regions are the
  stable buckets customers pick from. We keep them few and human-named on
  purpose so the pricing page and API don't churn when we add datacenters.
- **Host** — one bare-metal server (a Hetzner machine, today). Every host
  carries a **`location`** (e.g. `HEL1-DC4`, `FSN1-DC14`, `ASH-DC1`) — that's
  the physical datacenter, a level below the region. Hosts also carry a
  **`host_class`** which is the Hetzner product ID verbatim (e.g. `ax41-nvme`).
  Host class is not an abstraction layer — it's the SKU. Don't invent aliases.
- **Machine** — one user VM / container, scheduled onto exactly one host.

### Admission vs sellability

Admission state lives on **regions**, not hosts:

| admission_state | meaning                                    |
| --------------- | ------------------------------------------ |
| `open`          | new orders can schedule here               |
| `restricted`    | only privileged customers (internal flag)  |
| `closed`        | no new orders, existing machines untouched |

| sellability_state | meaning                                           |
| ----------------- | ------------------------------------------------- |
| `sellable`        | pricing page shows it, public API accepts it      |
| `reserve_only`    | only pre-committed reservations                   |
| `unsellable`      | capacity frozen — typically during an incident    |

Closing a region stops new orders immediately. It does **not** drain existing
machines — for that, drain individual hosts (see workflows below).

Host-level lifecycle (drain / maintenance / quarantine) is orthogonal. A host
can be drained for RAID rebuild while its region stays `open`.

---

## 2. Admin pages

One paragraph per page in [`src/app/v2/admin/`](../src/app/v2/admin). The
shared primitives live in
[`src/v2/components/admin/primitives.tsx`](../src/v2/components/admin/primitives.tsx).

- **Overview** (`/v2/admin`) — attention rail at the top (drift, stale
  services, awaiting approvals), capacity KPIs, and the live
  **Fleet topology** diagram (Region → Host → Machine). Start every shift
  here — if the attention rail is empty, nothing is on fire.

- **Regions** (`/v2/admin/regions`) — open / restrict / close a region for new
  orders, flip sellability, and see per-region fleet aggregates (hosts, used
  vs total vCPU / RAM / disk). This is the fastest path to pause sales in a
  geo without touching individual hosts.

- **Hosts** (`/v2/admin/hosts`) — inventory of every bare-metal server. From
  here and the per-host detail page (`/v2/admin/hosts/[id]`) you drain,
  quarantine, open the Incus UI, cleanup orphan instances, and trigger
  bootstrap validation.

- **Machines** (`/v2/admin/machines`) — full CRUD across all customers.
  Search by slug / IP / email / account, run lifecycle actions
  (start / stop / reboot / delete), batch delete, and admin-on-behalf-of
  creation for a specified user.

- **Procurements** (`/v2/admin/procurements`) — order new bare-metal from
  Hetzner, approve queued orders, re-sync progress from Robot, and view the
  reserve-aware capacity planner's recommendations.

- **Accounts** (`/v2/admin/accounts`) — customer list with per-account drill
  through to machines, members, and subscription. Primary entry point for a
  customer-complaint investigation.

- **Billing** (`/v2/admin/billing`) — subscription roster, MRR, at-risk
  watchlist (cancel_at_period_end, past_due, trialing-about-to-expire), and a
  Stripe webhook health tile (events in the last 24h, last delivery).

- **Images** (`/v2/admin/images`) — user snapshots + templates + backup
  artifacts with per-host locality. Use this to trace why a machine can't find
  its image on a target host.

- **Keys & Security** (`/v2/admin/keys`) — SSH keys, API keys, and proxy
  tokens across the whole fleet. Revoke from here during a key-leak incident.

- **Webhooks** (`/v2/admin/webhooks`) — customer webhook configurations plus
  the global delivery feed and dead-letter queue. Start here when a customer
  says "my webhook stopped firing".

- **Capacity** — region capacity snapshots over time. **Currently a
  placeholder** — historical snapshots are not persisted yet, so the page
  shows only the current aggregate. Wiring the backing table is TODO.

- **Audit** (`/v2/admin/audit`) — config audit (stale fields, orphan hosts,
  credential gaps) plus host validation posture (bootstrap pass/fail, drift,
  pending validation). Run before a release.

- **Activity** (`/v2/admin/activity`) — unified event timeline across
  machines, hosts, procurements, webhooks, and admin actions.
  **Start here during an incident.** One stream, one filter.

- **Integrations** (`/v2/admin/integrations`) — live reachability probes for
  Stripe / Hetzner / Cloudflare / DB. Shows the last event counts and
  configured credentials in one glance.

- **Control Plane** (`/v2/admin/control-plane`) — reconciler service leases
  (who owns which lease, how stale, critical or not). Flags a service as
  stale if no completion in its SLA.

- **Edge Routing** (`/v2/admin/routing`) — DNS, KV, and Worker routing drift
  versus the intended configuration. Click a row to scan; run repair if the
  drift is safe to auto-correct.

---

## 3. Common workflows

### Onboarding a new host

1. **Procurements** → *Order a host* → pick Hetzner product + region.
2. If the order is `requested`, approve it from the same page.
3. Robot sync runs automatically every ~10s; status flows
   `requested → ordered → bootstrapping → active`.
4. Click through to the created **Host detail** page. Bootstrap validation
   runs on first heartbeat; if it passes, the host starts scheduling.
5. If the region's admission is `closed`, remember to re-open it in
   **Regions** before the host receives machines.

### Draining a host for maintenance

1. **Hosts** → pick the host → *Drain*. Machines relocate or are paused
   per policy; active reservations move off.
2. Watch the drain report on the host detail page — blockers decrement as
   things move.
3. When `active_machines = 0` and `blockers_total = 0`, flip to
   *Maintenance*. Schedulable = false for the duration.
4. Do the physical work (disk swap, BIOS, etc.). Rerun bootstrap validation.
5. *Return to service*. Scheduler flips back to `in_service` and the host is
   eligible again.

### Investigating a customer complaint

1. **Accounts** → search by email / slug / account id.
2. Open the customer. You see their machines + members + subscription in one
   view.
3. Click the affected machine → full detail: heartbeat, events, port
   allocations, host, recent lifecycle events.
4. Cross-reference the machine's host in **Activity** to see whether the
   issue is local to one VM or fleet-wide on that host.

### Diagnosing "Stripe webhook stopped working"

1. **Integrations** → the Stripe card shows `events_last_24h`, last event
   timestamp, and credential freshness.
2. If inbound is fine but we're not forwarding to the customer,
   **Webhooks** → *Dead letters*. Each row has the target URL, last failure
   reason, and a *Retry* button.
3. Still broken? **Activity** filtered to `webhook.*` for a timeline of
   attempts and responses.

---

## 4. Quick reference: API endpoints

Admin endpoints are split across v1 (legacy admin, customer-scoped surfaces)
and v2 (fleet + infra). Route files linked below.

### v1 admin (customer & business data)

- [`/api/v1/admin/accounts/*`](../src/server/v1/routes/internal/admin-accounts.ts)
  — accounts list, account detail, members, and admin user search.
- [`/api/v1/admin/billing/*`](../src/server/v1/routes/internal/admin-billing.ts)
  — subscription list, MRR, at-risk watchlist.
- [`/api/v1/admin/images/*`](../src/server/v1/routes/internal/admin-images.ts)
  — user snapshots, templates, backup artifacts; per-host locality.
- [`/api/v1/admin/keys/*`](../src/server/v1/routes/internal/admin-keys.ts),
  `/api/v1/admin/ssh-keys`, and friends — credentials audit + revoke.
- [`/api/v1/admin/webhooks/*`](../src/server/v1/routes/internal/admin-webhooks.ts)
  and `/api/v1/admin/webhook-deliveries/*` — webhook configs + delivery
  history + dead letters.
- [`/api/v1/admin/integrations/*`](../src/server/v1/routes/internal/admin-integrations.ts)
  — Stripe / Hetzner / Cloudflare / DB health probes.
- [`/api/v1/admin/activity`](../src/server/v1/routes/internal/admin-activity.ts)
  — unified activity feed across the admin surface.
- [`/api/v1/admin/machines/*`](../src/server/v1/routes/internal/admin-machines.ts)
  — admin machine list, detail, create, update, start/stop/reboot, delete,
  batch delete.
- [`/api/v1/admin/routing/*`](../src/server/v1/routes/internal/admin-routing.ts)
  — edge routing drift scan + repair.

### v2 admin (fleet & infrastructure)

Routes under [`src/server/v2/routes/admin/fleet/`](../src/server/v2/routes/admin/fleet):

- `/api/v2/admin/fleet/hosts` (and `/hosts/:id`) — hosts + regions overview,
  per-host detail with machines / events / reservations.
  See [`hosts.ts`](../src/server/v2/routes/admin/fleet/hosts.ts).
- `/api/v2/admin/fleet/hosts/:id/maintenance-state`,
  `/scheduler-state`, `/operator-settings`, `/cleanup-orphans` — host
  mutations. See
  [`host-mutations.ts`](../src/server/v2/routes/admin/fleet/host-mutations.ts).
- `/api/v2/admin/fleet/procurements` (+ `/approve`, `/sync`) and
  `/procurement-recommendations` — Hetzner procurement lifecycle. See
  [`procurements.ts`](../src/server/v2/routes/admin/fleet/procurements.ts).
- `/api/v2/admin/fleet/regions/:id/admission-state` — open/close a region.
- `/api/v2/admin/fleet/host-audit`, `/config-audit` — audit & drift. See
  [`audit.ts`](../src/server/v2/routes/admin/fleet/audit.ts).
- `/api/v2/admin/fleet/control-plane/services` — reconciler service leases.
  See
  [`service-states.ts`](../src/server/v2/routes/admin/fleet/service-states.ts)
  and
  [`control-plane.ts`](../src/server/v2/routes/admin/fleet/control-plane.ts).
- `/api/v2/admin/fleet/benchmarks` — hardware benchmarks per host class. See
  [`benchmarks.ts`](../src/server/v2/routes/admin/fleet/benchmarks.ts).
- `/api/v2/admin/fleet/products/hetzner` — Hetzner catalog mirror used by the
  order dialog.

---

## 5. Links to source

- **Admin routes (v1)**:
  [`src/server/v1/routes/internal/*.ts`](../src/server/v1/routes/internal).
- **Admin routes (v2 fleet)**:
  [`src/server/v2/routes/admin/**`](../src/server/v2/routes/admin).
- **Admin pages**: [`src/app/v2/admin/`](../src/app/v2/admin).
- **Shared hooks**: [`src/shared/hooks/use-fleet.ts`](../src/shared/hooks/use-fleet.ts)
  and [`src/shared/hooks/use-admin-*.ts`](../src/shared/hooks).
- **UI primitives**:
  [`src/v2/components/admin/primitives.tsx`](../src/v2/components/admin/primitives.tsx),
  [`tones.ts`](../src/v2/components/admin/tones.ts),
  [`nav.ts`](../src/v2/components/admin/nav.ts).
- **Region definitions**:
  [`src/shared/lib/regions.ts`](../src/shared/lib/regions.ts).
