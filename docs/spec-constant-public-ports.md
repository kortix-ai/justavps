# Constant Public Ports — Spec & Implementation Plan

> Status: DRAFT — March 29, 2026

---

## 1. Problem Statement

Today, all machine port access flows through the HTTP proxy:

```
Client → CF Worker (auth) → Broker → Machine:80 → daemon → /_port/PORT → localhost:PORT
```

This works well for HTTP/WebSocket traffic, but has hard limitations:

1. **HTTP-only** — No raw TCP (databases, game servers, MQTT, gRPC without web, custom protocols)
2. **Not addressable by standard tools** — You can't `psql -h X -p 5432`, you can't `mysql -h X`, you can't `redis-cli -h X`. Every tool needs HTTP proxy support or a wrapper.
3. **No constant endpoint** — The `PORT--slug.kortix.cloud` URL requires Cloudflare, requires auth headers/cookies, and only works for HTTP clients. Users can't give a stable `host:port` to external services.
4. **Agent integration friction** — AI agents and CI pipelines that need to connect to a database or service on the machine must route through the HTTP proxy or SSH tunnel, adding complexity.

**What users want:** "Give me a public `host:port` endpoint that routes TCP traffic directly to port X on my machine."

---

## 2. Design Goals

1. **TCP-level forwarding** — Support any protocol, not just HTTP
2. **Stable endpoints** — A mapping doesn't change until the user removes it (survives reboots, redeploys)
3. **Integrated with the proxy system** — Uses the broker infrastructure, not raw machine IP exposure
4. **Scoped and controlled** — Per-machine, per-account, quota-limited
5. **Secure by default** — Optional auth layer, but even without auth the machine IP stays hidden behind the broker
6. **Testable E2E** — Full lifecycle testing in the existing e2e framework

---

## 3. Architecture

### 3.1 Current Traffic Flow (HTTP-only)

```
         ┌──────────────┐    ┌────────────┐    ┌──────────────────────┐
Client → │ CF Worker     │ →  │  Broker    │ →  │ Machine:80 (daemon)  │
         │ (auth + route)│    │ (HTTP fwd) │    │  → localhost:PORT    │
         └──────────────┘    └────────────┘    └──────────────────────┘
         SLUG.kortix.cloud   broker.kortix.cloud   Machine IP (hidden)
```

### 3.2 New: Constant Public Port Flow (TCP)

```
         ┌────────────────────────────┐    ┌──────────────────────┐
Client → │ Broker:ALLOCATED_PORT      │ →  │ Machine:TARGET_PORT   │
         │ (TCP tunnel, no CF Worker) │    │ (direct TCP)          │
         └────────────────────────────┘    └──────────────────────┘
         broker.kortix.cloud:41234         Machine IP:5432 (hidden)
```

Key differences:
- **No Cloudflare Worker** — TCP forwarding bypasses the HTTP worker entirely
- **Broker handles TCP** — The broker listens on an allocated public port and tunnels raw TCP to the machine
- **Machine IP stays hidden** — Client connects to `broker.kortix.cloud:41234`, never sees the machine IP
- **Machine firewall opens the target port** — The machine UFW/Hetzner firewall allows the broker IP to reach the target port directly (not just port 80)

### 3.3 Why Broker-Based (Not Direct Machine IP)

| Approach | Pros | Cons |
|----------|------|------|
| **Broker TCP tunnel** | IP hidden, centralized port allocation, no per-machine firewall chaos, works with dynamic IPs | Extra hop, broker becomes a TCP load point |
| **Direct machine IP:PORT** | Zero latency overhead, simple | Exposes machine IP, requires per-machine firewall rules for each port, IP changes break connections |

**Decision: Broker-based.** The broker already exists and handles the HTTP traffic. Adding TCP listeners is a natural extension. Machine IPs stay hidden. Port allocation is centralized.

---

## 4. Data Model

### 4.1 New Table: `port_mappings`

```sql
CREATE TABLE port_mappings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id    UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  account_id    UUID REFERENCES accounts(id),

  -- What the user configures
  target_port   INTEGER NOT NULL,           -- Port on the machine (e.g. 5432)
  protocol      TEXT NOT NULL DEFAULT 'tcp', -- 'tcp' | 'udp' (future)
  label         TEXT,                        -- User-friendly name ("postgres", "redis")

  -- What the system allocates
  public_port   INTEGER NOT NULL UNIQUE,     -- Port on the broker (e.g. 41234)
  broker_host   TEXT NOT NULL,               -- Which broker (e.g. "broker.kortix.cloud")

  -- State
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended' | 'deleted'

  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Indexes
CREATE UNIQUE INDEX port_mappings_public_port_idx ON port_mappings (public_port) WHERE status = 'active';
CREATE INDEX port_mappings_machine_id_idx ON port_mappings (machine_id) WHERE status = 'active';
```

### 4.2 Account Limits Extension

Add to `account_limits`:

```sql
ALTER TABLE account_limits ADD COLUMN max_port_mappings INTEGER NOT NULL DEFAULT 3;
```

Default: 3 public port mappings per account. Adjustable per-account.

### 4.3 Port Allocation Range

The broker allocates from a defined range:

```
PUBLIC_PORT_RANGE_START = 40000
PUBLIC_PORT_RANGE_END   = 49999
```

This gives 10,000 ports. At 3 per account, that's ~3,333 accounts before exhaustion. Range is configurable.

---

## 5. API Design

### 5.1 Create Port Mapping

```
POST /api/v1/machines/:machineId/ports
```

Request:
```json
{
  "target_port": 5432,
  "protocol": "tcp",
  "label": "postgres"
}
```

Response (201):
```json
{
  "id": "uuid",
  "machine_id": "uuid",
  "target_port": 5432,
  "protocol": "tcp",
  "label": "postgres",
  "public_port": 41234,
  "public_host": "broker.kortix.cloud",
  "public_endpoint": "broker.kortix.cloud:41234",
  "status": "active",
  "created_at": "2026-03-29T..."
}
```

Validation:
- Machine must be owned by the caller
- Machine must be in `ready` status
- `target_port` must be 1–65535
- Account must not exceed `max_port_mappings` limit
- Same `machine_id + target_port` combo must not already exist (active)

### 5.2 List Port Mappings

```
GET /api/v1/machines/:machineId/ports
```

Response:
```json
{
  "ports": [
    {
      "id": "uuid",
      "target_port": 5432,
      "protocol": "tcp",
      "label": "postgres",
      "public_port": 41234,
      "public_host": "broker.kortix.cloud",
      "public_endpoint": "broker.kortix.cloud:41234",
      "status": "active",
      "created_at": "2026-03-29T..."
    }
  ]
}
```

### 5.3 Delete Port Mapping

```
DELETE /api/v1/machines/:machineId/ports/:portId
```

Response: 204 No Content

Side effects:
- Broker stops listening on the allocated public port
- Machine firewall rule for that port is removed (if using direct firewall approach)
- Port is returned to the allocation pool

### 5.4 Get Single Port Mapping

```
GET /api/v1/machines/:machineId/ports/:portId
```

### 5.5 Machine Serialization Extension

The existing machine detail response gets a new field:

```json
{
  "id": "...",
  "slug": "...",
  "urls": {
    "proxy": "https://slug.kortix.cloud",
    "terminal": "https://slug.kortix.cloud/_terminal",
    "port_template": "https://{port}--slug.kortix.cloud"
  },
  "public_ports": [
    {
      "target_port": 5432,
      "public_endpoint": "broker.kortix.cloud:41234",
      "label": "postgres",
      "protocol": "tcp"
    }
  ]
}
```

---

## 6. Broker Changes

### 6.1 Current Broker

The broker currently:
- Listens on `:443` (TLS) and `:80` (health)
- Handles `/_broker_proxy` — receives signed requests from the CF Worker and dials machine IPs
- Terminates TLS using Cloudflare Origin CA certs

### 6.2 New: TCP Port Listener

The broker needs a new subsystem:

```
┌─────────────────────────────────────────────────────┐
│                    BROKER                            │
│                                                      │
│  :443  ── HTTP proxy (existing)                      │
│  :80   ── Health (existing)                          │
│                                                      │
│  :40000-49999 ── TCP port forwarders (NEW)           │
│    Each allocated port → net.Dial(machineIP:port)    │
│                                                      │
│  Config source: poll platform API or read from       │
│  local config file pushed by deploy                  │
└─────────────────────────────────────────────────────┘
```

#### 6.2.1 TCP Forwarding Logic (Go pseudocode)

```go
// For each active port mapping, the broker runs a TCP listener:
func (b *Broker) serveTCPPort(mapping PortMapping) {
    ln, _ := net.Listen("tcp", fmt.Sprintf(":%d", mapping.PublicPort))
    for {
        clientConn, _ := ln.Accept()
        go func() {
            // Dial the machine's target port directly
            machineConn, err := net.DialTimeout("tcp",
                fmt.Sprintf("%s:%d", mapping.MachineIP, mapping.TargetPort),
                5*time.Second,
            )
            if err != nil {
                clientConn.Close()
                return
            }
            // Bidirectional pipe
            go io.Copy(machineConn, clientConn)
            io.Copy(clientConn, machineConn)
        }()
    }
}
```

#### 6.2.2 Configuration Sync

The broker needs to know which ports to listen on. Two options:

**Option A: Platform API polling** (simpler)
- Broker polls `GET /api/v1/internal/port-mappings` every 30s
- Returns all active mappings with machine IPs
- Broker reconciles: starts new listeners, stops removed ones

**Option B: Push via KV / config file** (lower latency)
- Platform writes port mapping config to a known location
- Broker watches for changes

**Decision: Option A (API polling)** for v1. Simpler, no new infrastructure. 30s propagation delay is acceptable for port mapping creation (not a real-time operation).

#### 6.2.3 Internal API Endpoint

New internal endpoint for broker polling:

```
GET /api/v1/internal/port-mappings
```

Response:
```json
{
  "mappings": [
    {
      "public_port": 41234,
      "machine_ip": "95.217.x.x",
      "target_port": 5432,
      "machine_id": "uuid",
      "machine_slug": "abc123",
      "protocol": "tcp"
    }
  ]
}
```

Authenticated with the existing `BROKER_SHARED_SECRET`.

---

## 7. Machine-Side Changes

### 7.1 Firewall: Open Target Ports to Broker

When a port mapping is created, the machine's firewall must allow the broker to reach the target port.

**Two approaches:**

#### Approach A: Open specific ports in UFW + Hetzner Firewall

On port mapping creation:
1. SSH into machine (or use daemon API) to run: `ufw allow from BROKER_IP to any port TARGET_PORT proto tcp`
2. Update Hetzner firewall rules to include the target port from broker IPs

On port mapping deletion:
1. Remove the UFW rule
2. Update Hetzner firewall

**Pros:** Tight security — only the specific port is opened, only from broker IPs
**Cons:** Requires SSH/daemon call, Hetzner firewall API call, more moving parts

#### Approach B: Allow broker IP range to all ports (simpler)

Update the Hetzner managed firewall to allow broker source IPs to all ports (not just 80):

```typescript
// In managedFirewallRules():
{
  direction: 'in',
  protocol: 'tcp',
  port: '1-65535',  // All ports from broker
  source_ips: brokerSourceIPs,
  description: 'Broker TCP forwarding',
},
```

And in cloud-init UFW:
```bash
ufw allow from BROKER_IP to any proto tcp
```

**Pros:** No per-mapping firewall changes needed, simpler lifecycle
**Cons:** Broker can reach any port on any machine (but broker is trusted infrastructure)

**Decision: Approach B for v1.** The broker is our own trusted infrastructure. Opening all ports from broker IPs is equivalent to saying "the broker can reach any service on the machine" — which is already true for port 80. The daemon on :80 can already forward to any localhost port via `/_port/PORT`. The only new thing is the broker reaching ports other than 80 directly.

### 7.2 Service Binding

Currently most services bind to `127.0.0.1` (e.g., sandbox-agent on `127.0.0.1:2468`).

For public port mappings to work with Approach B, the target service must bind to `0.0.0.0` (or the machine's public IP). Users need to configure their services accordingly.

**Documentation requirement:** Make it clear that the service must listen on `0.0.0.0:PORT`, not `127.0.0.1:PORT`, for public port mappings to work.

Alternatively, the daemon could add a local TCP proxy: listen on `0.0.0.0:PORT` and forward to `127.0.0.1:PORT`. This would be a nice DX improvement but adds complexity. **Defer to v2.**

---

## 8. Security Considerations

### 8.1 No Application-Level Auth on TCP Ports

Unlike the HTTP proxy (which has JWT/API key/proxy token auth), raw TCP ports have **no application-level auth** from the platform. The service itself must handle authentication (e.g., PostgreSQL password, Redis AUTH).

This is the same security model as any VPS or cloud provider exposing ports.

### 8.2 Machine IP Stays Hidden

Clients connect to `broker.kortix.cloud:41234`. They never learn the machine IP. This is a meaningful security improvement over direct port exposure.

### 8.3 Broker Trust Model

The broker is trusted infrastructure. It already has the ability to dial any machine IP on port 80. Extending this to other ports doesn't change the trust model.

### 8.4 Rate Limiting & Abuse

- Port allocation is quota-limited (default 3 per account)
- The broker should enforce per-port connection limits (e.g., max 1000 concurrent connections per public port)
- The broker should enforce bandwidth limits per port mapping (configurable, e.g., 100 Mbps)
- Excessive abuse → port mapping automatically suspended

### 8.5 Port Scan Mitigation

The allocated port range (40000–49999) is a known range. Unallocated ports should return connection refused (not timeout), which is the default behavior of ports with no listener. No additional mitigation needed.

---

## 9. Implementation Plan

### Phase 1: Database & API (Control Plane)

| Step | What | Files |
|------|------|-------|
| 1.1 | Add `port_mappings` table to Drizzle schema | `src/server/db/schema.ts` |
| 1.2 | Generate + run migration | `drizzle/` |
| 1.3 | Add `max_port_mappings` to `account_limits` | `src/server/db/schema.ts` |
| 1.4 | Port allocation utility (find next free port in range) | `src/server/lib/port-allocation.ts` |
| 1.5 | CRUD API routes: create, list, get, delete | `src/server/routes/v1/port-mappings.ts` |
| 1.6 | Internal broker endpoint: `GET /v1/internal/port-mappings` | `src/server/routes/v1/internal.ts` |
| 1.7 | Extend machine serialization with `public_ports` | `src/server/routes/v1/machines.ts` |
| 1.8 | Cascade delete on machine deletion | `src/server/lib/machine-lifecycle.ts` |
| 1.9 | Webhook event: `machine.port_mapping.created`, `machine.port_mapping.deleted` | `src/server/lib/event-bus.ts` |

### Phase 2: Firewall (Machine Access)

| Step | What | Files |
|------|------|-------|
| 2.1 | Update Hetzner managed firewall rules — allow broker IPs to all ports | `src/server/lib/providers/hetzner.ts` |
| 2.2 | Update cloud-init UFW rules — allow broker IPs to all ports | `src/server/lib/cloud-init.ts` |
| 2.3 | For existing machines: API endpoint to re-apply firewall rules | `src/server/routes/v1/internal.ts` |

### Phase 3: Broker TCP Forwarding (Data Plane)

| Step | What | Files |
|------|------|-------|
| 3.1 | TCP listener manager in broker (start/stop per-port listeners) | `daemon/cmd/broker/tcpforward.go` |
| 3.2 | Config sync: poll platform API for active mappings | `daemon/cmd/broker/configsync.go` |
| 3.3 | Bidirectional TCP pipe with timeout and connection limits | `daemon/cmd/broker/tcpforward.go` |
| 3.4 | Health check: report active TCP ports in `/healthz` | `daemon/cmd/broker/health.go` |
| 3.5 | Metrics: connections/sec, bytes transferred, active connections per port | `daemon/cmd/broker/metrics.go` |

### Phase 4: Frontend

| Step | What | Files |
|------|------|-------|
| 4.1 | Port mappings section in machine detail page | `src/components/dashboard/` |
| 4.2 | Create port mapping dialog (target port, label) | `src/components/dashboard/` |
| 4.3 | Display public endpoint with copy button | `src/components/dashboard/` |
| 4.4 | Delete port mapping with confirmation | `src/components/dashboard/` |

### Phase 5: E2E Tests

| Step | What | Files |
|------|------|-------|
| 5.1 | API unit tests for port mapping CRUD | `src/__tests__/` |
| 5.2 | Port allocation exhaustion test | `src/__tests__/` |
| 5.3 | E2E: create machine → create port mapping → verify public endpoint → delete | `src/__tests__/e2e/machine-lifecycle.test.ts` |
| 5.4 | E2E: start TCP server on machine port → connect via broker public port → verify data flows | `src/__tests__/e2e/machine-lifecycle.test.ts` |
| 5.5 | E2E: delete port mapping → verify connection refused on public port | `src/__tests__/e2e/machine-lifecycle.test.ts` |
| 5.6 | E2E: exceed quota → 403 | `src/__tests__/e2e/machine-lifecycle.test.ts` |
| 5.7 | E2E: machine deletion cascades port mapping cleanup | `src/__tests__/e2e/machine-lifecycle.test.ts` |

---

## 10. E2E Test Spec (Detailed)

### 10.1 New E2E Phase: Public Port Forwarding

This extends the existing `machine-lifecycle.test.ts` with a new phase between the current port forwarding tests (Phase 7) and cleanup (Phase 9).

#### Test: Create Public Port Mapping via API

```typescript
it('creates a public port mapping for port 9000', async () => {
  const { status, data } = await apiPost(`/v1/machines/${machineId}/ports`, {
    target_port: 9000,
    protocol: 'tcp',
    label: 'test-server',
  });

  expect(status).toBe(201);
  expect(data.public_port).toBeGreaterThanOrEqual(40000);
  expect(data.public_port).toBeLessThanOrEqual(49999);
  expect(data.public_host).toContain('broker');
  expect(data.public_endpoint).toBeTruthy();
  expect(data.status).toBe('active');

  publicPort = data.public_port;
  publicEndpoint = data.public_endpoint;
  portMappingId = data.id;
});
```

#### Test: TCP Connection Through Public Port

```typescript
it('connects to port 9000 via broker public port', async () => {
  // The Python HTTP server from test 20 is still running on port 9000
  // Wait for broker to pick up the new mapping (polling interval)
  await sleep(35_000); // 30s poll + 5s margin

  // Use curl to hit the public endpoint (HTTP over TCP)
  const result = execSync(
    `curl -sf --max-time 10 "http://${publicEndpoint}/"`,
    { encoding: 'utf8', timeout: 15_000 },
  ).trim();

  expect(result).toBe('HELLO_FROM_PORT_9000');
});
```

#### Test: Raw TCP Connection

```typescript
it('raw TCP connection works through public port', async () => {
  // Start a simple TCP echo server on port 9001 via SSH
  ssh(`python3 -c "
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 9001))
s.listen(1)
conn, _ = s.accept()
data = conn.recv(1024)
conn.send(b'ECHO:' + data)
conn.close()
s.close()
" &`);

  // Create mapping for port 9001
  const { data: mapping } = await apiPost(`/v1/machines/${machineId}/ports`, {
    target_port: 9001,
    label: 'tcp-echo',
  });

  await sleep(35_000);

  // Connect with nc (netcat)
  const result = execSync(
    `echo "HELLO" | nc -w 5 ${mapping.public_host} ${mapping.public_port}`,
    { encoding: 'utf8', timeout: 15_000 },
  ).trim();

  expect(result).toBe('ECHO:HELLO');
});
```

#### Test: Port Mapping Listed in Machine Detail

```typescript
it('machine detail includes public_ports', async () => {
  const { data } = await apiGet(`/v1/machines/${machineId}`);
  expect(data.public_ports).toBeDefined();
  expect(data.public_ports.length).toBeGreaterThan(0);
  expect(data.public_ports[0].target_port).toBe(9000);
  expect(data.public_ports[0].public_endpoint).toBeTruthy();
});
```

#### Test: Delete Port Mapping

```typescript
it('deletes port mapping and connection is refused', async () => {
  const { status } = await apiDelete(`/v1/machines/${machineId}/ports/${portMappingId}`);
  expect(status).toBe(204);

  await sleep(35_000); // Wait for broker to stop listener

  // Connection should be refused
  try {
    execSync(`nc -z -w 3 broker.kortix.cloud ${publicPort}`, { timeout: 10_000 });
    throw new Error('Connection should have been refused');
  } catch (err: any) {
    expect(err.status).not.toBe(0); // Non-zero exit = connection refused
  }
});
```

#### Test: Quota Enforcement

```typescript
it('enforces port mapping quota', async () => {
  // Create max_port_mappings (3) mappings
  for (let i = 0; i < 3; i++) {
    await apiPost(`/v1/machines/${machineId}/ports`, {
      target_port: 10000 + i,
      label: `quota-test-${i}`,
    });
  }

  // 4th should fail
  const { status, data } = await apiPost(`/v1/machines/${machineId}/ports`, {
    target_port: 10003,
    label: 'should-fail',
  });
  expect(status).toBe(403);
  expect(data.error).toContain('limit');
});
```

#### Test: Machine Deletion Cascades

```typescript
it('machine deletion removes all port mappings', async () => {
  // Verified by checking broker health after machine deletion
  // Port listeners should be gone within one polling cycle
});
```

### 10.2 Standalone E2E Script

New file: `scripts/e2e-public-ports.ts`

Similar to `scripts/e2e-full.ts` but focused on:
1. Create machine
2. Wait for ready
3. Start test TCP server on machine
4. Create port mapping via API
5. Wait for broker propagation
6. Connect to public endpoint
7. Verify bidirectional data flow
8. Delete mapping
9. Verify connection refused
10. Cleanup

---

## 11. Rollout & Migration

### 11.1 Existing Machines

- Firewall rules (Hetzner + UFW) are updated on next machine boot or via the re-apply endpoint
- No port mappings exist until users create them
- The `managed firewall` function in `hetzner.ts` already reconciles rules — next machine creation will update the shared firewall to include broker-to-all-ports rules

### 11.2 Broker Deployment

- Deploy broker with TCP forwarding capability BEFORE enabling the API
- Broker starts with zero TCP port mappings
- First API-created mapping triggers the broker's first TCP listener via polling

### 11.3 Feature Flag (Optional)

If we want staged rollout:
- Add `enable_public_ports` boolean to account_limits (default false)
- API returns 403 if not enabled
- Flip per-account or globally when ready

---

## 12. Future Extensions (Out of Scope for v1)

1. **UDP support** — Same architecture, `net.ListenPacket` instead of `net.Listen`
2. **Auth on TCP ports** — PROXY protocol or SOCKS5 wrapper for identity
3. **Daemon-side TCP proxy** — Daemon listens on `0.0.0.0:PORT` and forwards to `127.0.0.1:PORT` so services don't need to rebind
4. **Custom domains for TCP** — SRV records pointing to broker:port
5. **Port mapping webhooks** — Notify when a port mapping is created/deleted
6. **Bandwidth metering/billing** — Charge per-GB on public port traffic
7. **Multi-broker** — Multiple brokers with different port ranges for geographic distribution
8. **TLS termination** — Broker terminates TLS on the public port and forwards plain TCP to the machine (e.g., for Postgres SSL)

---

## 13. Open Questions

| # | Question | Default / Recommendation |
|---|----------|--------------------------|
| 1 | Should public ports require the service to bind on `0.0.0.0`, or should we add a daemon-side TCP relay? | v1: require `0.0.0.0`. v2: add daemon relay. |
| 2 | Should there be any auth on TCP public ports? | No for v1. Users handle auth at the application level (DB passwords, etc.). |
| 3 | Port range: 40000-49999 (10k ports) sufficient? | Yes for launch. Expandable later. |
| 4 | Should port mappings survive machine stop/start? | Yes — mapping persists, broker reconnects when machine is back. |
| 5 | Should the broker support connection pooling/keepalive to machine? | Not for v1. Simple dial-per-connection. |
| 6 | Separate broker binary or extend existing? | Extend existing. TCP listeners are lightweight and share the same config sync. |
| 7 | Do we need both `broker.kortix.cloud` and `broker.kortix-dev.cloud` endpoints? | Yes — same as the existing HTTP broker split. |
| 8 | Max connections per public port? | Default 1000 concurrent. Configurable per-account later. |

---

## 14. Success Criteria

The feature is complete when:

- [ ] User can `POST /v1/machines/:id/ports` and get a public `host:port` endpoint
- [ ] `psql -h broker.kortix.cloud -p ALLOCATED_PORT` connects to PostgreSQL on the machine
- [ ] `redis-cli -h broker.kortix.cloud -p ALLOCATED_PORT` connects to Redis on the machine
- [ ] Raw TCP (nc/socat) works bidirectionally through the public port
- [ ] Port mapping appears in machine detail API response
- [ ] Port mapping appears in dashboard UI
- [ ] Deleting the mapping stops the port within 60 seconds
- [ ] Deleting the machine cleans up all port mappings
- [ ] Quota enforcement works (default 3 per account)
- [ ] E2E test passes: create → connect → delete → verify refused
- [ ] Both dev and prod broker environments support TCP forwarding
