# JustAVPS V2 Sandbox Observability Spec

Status: Proposed  
Owner: V2 API / Platform  
Scope: V2 Incus-backed machines, admin dashboard, telemetry pipeline  
Last updated: 2026-05-02

## 1. Summary

JustAVPS V2 should ship every sandbox with built-in observability by default: metrics, logs, traces, lifecycle events, and latest health state. Operators should not need to add ad-hoc scripts or manually SSH into machines to understand whether a sandbox, host, cluster, daemon, proxy, or create flow is healthy.

The default architecture is OpenTelemetry-shaped ingestion plus ClickHouse storage:

```text
v2-api / admin-web / justavps-daemon / Incus hosts
        ↓ OTLP + Prometheus scrape + heartbeat fallback
Telemetry gateway / OpenTelemetry Collector
        ↓
ClickHouse raw telemetry + rollups
        ↓
Admin observability UI + alerts + API queries

Postgres remains product truth and stores only latest/summary telemetry state.
```

Important nuance: there are “container logs” by default only for processes we own or route through our daemon. Incus system containers/VMs are closer to full Linux machines than Docker one-process containers. So the product must define explicit default log sources: daemon logs, managed command stdout/stderr, PTY/session logs where enabled, selected journald/system logs, proxy logs, lifecycle events, and optional user application OTEL/log forwarding.

## 2. Problem Statement

JustAVPS V2 is becoming an E2B/Daytona-style sandbox cloud. At scale, machine failures are rarely explained by one database row: we need correlated host pressure, Incus state, daemon health, logs, command spans, proxy behavior, lifecycle transitions, and billing usage.

Without default observability, operators will be blind to slow creates, broken images, daemon regressions, noisy neighbors, capacity hot spots, network abuse, OOMs, billing drift, and customer-impacting failures.

## 3. Goals

1. Every new machine emits useful telemetry within 5-10 seconds of daemon readiness, with a 5-second default metric interval to match E2B's documented cadence.
2. Admins can open a machine and see Metrics / Logs / Traces / Events without SSH.
3. The fleet dashboard can show host, cluster, region, and machine pressure from real runtime samples, not only requested allocations.
4. Machine create/start/stop/exec/proxy/file operations have trace waterfalls and failure reasons.
5. Raw telemetry is stored cheaply with TTLs and rollups so volume does not destroy Postgres or operator costs.
6. Customer application telemetry can be accepted through OTEL without requiring JustAVPS to predefine every custom metric/span/log field.

## 4. Non-Goals

- Do not put high-volume telemetry in Postgres. Postgres stores product truth and latest summary state only.
- Do not attempt full application performance monitoring for arbitrary apps without user instrumentation. We provide defaults and OTLP endpoints; app internals require app instrumentation or managed process capture.
- Do not keep all raw logs forever. Logs are sensitive and high-volume; default retention must be short and configurable.
- Do not build a custom observability database if ClickHouse + OTEL schemas solve the problem.
- Do not replace Incus runtime truth. Incus remains the source for runtime existence, placement, and instance state.

## 5. Personas

### Platform operator

Needs to know which machines, hosts, or clusters are unhealthy and why.

### Support / incident responder

Needs to debug customer reports without SSHing into hosts or machines.

### Product / infra owner

Needs capacity runway, utilization, margin, and noisy-neighbor signals.

### Customer / developer

Eventually should be able to view their own sandbox metrics/logs/traces with clear access controls.

## 6. “Container Logs by Default” Clarification

Research summary:

- **Docker does have default container logs**, but they are specifically the container endpoint command's stdout/stderr. Docker's default `json-file` logging driver captures stdout/stderr, annotates each line with `stdout` or `stderr`, and timestamps it. Docker also documents that `docker logs` may not show useful information when apps write to internal log files instead of stdout/stderr. Source: [Docker logging docs](https://docs.docker.com/engine/logging/) and [Docker json-file driver](https://docs.docker.com/engine/logging/drivers/json-file/).
- **Incus supports two different container models:** system containers and OCI/application containers. Incus docs distinguish Docker-style application containers, which package a single process/application, from Incus system containers, which simulate a fuller Linux operating system and can run multiple applications. Source: [Incus containers and VMs](https://linuxcontainers.org/incus/docs/main/explanation/containers_and_vms/).
- **Incus can launch OCI application containers from Docker-style registries.** Example: add Docker Hub as an OCI remote and launch `oci-docker:hello-world --ephemeral --console`. Source: [Incus create instances](https://linuxcontainers.org/incus/docs/main/howto/instances_create/).
- **Incus exposes console logs, not the exact Docker `/containers/{id}/logs` abstraction.** Incus docs describe `incus console --show-log` and `incus info --show-log` for startup/console logs. Source: [Incus console docs](https://linuxcontainers.org/incus/docs/main/howto/instances_console/) and [Incus troubleshoot docs](https://linuxcontainers.org/incus/docs/main/howto/instances_troubleshoot/).

Conclusion:

If JustAVPS runs a pure OCI/application container as the sandbox entrypoint, then there is a Docker-like stdout/stderr concept for that one entrypoint process. We should capture it by default and export it as OTEL logs.

If JustAVPS runs a normal Incus system container or VM sandbox, there is not one universal “container stdout log” that captures every arbitrary user process. A full Linux sandbox can run systemd services, shells, background jobs, PTYs, Docker-in-sandbox containers, and programs that write to files. For that mode, the correct default is a defined telemetry/logging contract.

Default logging contract:

- Always collect platform-owned logs.
- Always collect daemon/toolbox command stdout/stderr for commands we launch.
- Always collect OCI/application container entrypoint stdout/stderr when the sandbox is launched in OCI-entrypoint mode.
- Always collect lifecycle/proxy/access/error logs.
- Collect selected system logs by allowlist, not unlimited raw journal spam.
- Provide a local OTLP/log endpoint so customer apps can explicitly emit structured telemetry.
- Optionally support user-defined log file globs later.

### 6.1 Competitive Observability Baseline

JustAVPS should match Daytona's sandbox telemetry baseline and exceed E2B/Modal where useful.

#### Daytona baseline

Daytona's experimental OTEL collection documents sandbox-level metrics, traces, and logs:

- Metrics: CPU utilization/limit, memory utilization/usage/limit, filesystem utilization/usage/available/total.
- Traces: HTTP requests/responses and custom application spans.
- Logs: application stdout/stderr, system logs, runtime errors and warnings.
- UI: sandbox details sheet with Logs, Traces, and Metrics tabs.
- Retention: Daytona keeps sandbox telemetry for 3 days by default and recommends connecting an OTLP-compatible collector for longer retention.
- Resource labels: organization ID, region ID, snapshot, plus optional custom labels via env var.
- SDK tracing: create/get/list/start/stop/delete, filesystem, code execution, process management, and HTTP API calls.

Source: [Daytona OpenTelemetry Collection](https://www.daytona.io/docs/en/experimental/otel-collection/).

JustAVPS parity target: implement all Daytona categories, but store internally in ClickHouse by default instead of only requiring customer-provided OTLP export.

#### E2B baseline

E2B exposes:

- Sandbox metrics sampled every 5 seconds: CPU used percent, CPU count, memory used/total, disk used/total. Source: [E2B sandbox metrics](https://e2b.mintlify.app/docs/sandbox/metrics.md).
- Sandbox logs API with cursor, limit, direction, level, and search; v2 log entries include timestamp, level, message, and fields. Source: [E2B sandbox logs v2](https://e2b.mintlify.app/docs/api-reference/sandboxes/get-sandbox-logs-v2.md).
- Command stdout/stderr streaming callbacks and background command stdout/stderr iteration. Source: [E2B command streaming](https://e2b.mintlify.app/docs/commands/streaming.md) and [E2B background commands](https://e2b.mintlify.app/docs/commands/background.md).
- Lifecycle events API and webhooks for created, killed, updated, paused, resumed, checkpointed. Source: [E2B lifecycle API](https://e2b.mintlify.app/docs/sandbox/lifecycle-events-api.md) and [E2B lifecycle webhooks](https://e2b.mintlify.app/docs/sandbox/lifecycle-events-webhooks.md).

JustAVPS parity target: match 5-second core metrics, structured logs with search/filter/cursor, command stream capture, and lifecycle events/webhooks.

#### Modal baseline

Modal exposes:

- OTEL integration for audit logs, function logs, and container metrics.
- Metrics: CPU utilization, memory usage, GPU memory usage, GPU compute utilization, container running, input elapsed time, queue time, cold-start time, successes, total inputs, pending inputs, running inputs.
- Metric tags: container ID, environment name, app name/app ID, function name/function ID, workspace name/workspace ID.
- Custom metrics/spans through an in-platform collector endpoint (`otlp-collector.modal.local:4317`) when enabled.
- Sandbox `exec` returns a process object with stdout, stderr, stdin, return code, polling, and waiting.

Sources: [Modal OTEL integration](https://modal.com/docs/guide/otel-integration.md), [Modal Datadog integration](https://modal.com/docs/guide/datadog-integration.md), [Modal Sandboxes](https://modal.com/docs/guide/sandboxes.md), [Modal sandbox commands](https://modal.com/docs/guide/sandbox-spawn.md), [Modal ContainerProcess](https://modal.com/docs/reference/modal.container_process.md), [Modal GPU metrics](https://modal.com/docs/guide/gpu-metrics.md).

JustAVPS parity target: include audit logs, container/machine metrics, managed command stdout/stderr/return codes, cold-start/create timing, queue/placement timing, and custom OTEL pass-through. GPU metrics can be P2 unless GPU sandboxes become a V2 launch requirement.

## 7. Product Requirements

### P0 Must-Have

#### P0.1 Per-machine metrics by default

Every running machine must emit or be associated with metrics for:

- CPU utilization percentage
- CPU seconds / time counters where available
- vCPU limit
- memory used, total/limit, cache, swap where available
- OOM kill count
- filesystem used, available, total
- disk read/write bytes and operations
- network rx/tx bytes, packets, errors, drops
- connection count
- process count
- uptime
- daemon up/down, version, last heartbeat age

Acceptance criteria:

- Given a newly created machine with managed daemon ready, when 5-10 seconds pass, then `/admin/telemetry/machines/:id/latest` returns CPU, memory, disk, network, daemon, and timestamp fields.
- Given a machine is running, when the admin opens the Metrics tab, then charts show at least CPU, memory, disk, network for the selected range.

#### P0.2 Logs by default

Default log streams:

- `daemon`: justavps-daemon logs
- `system`: selected journald/syslog entries for OOM, service failures, boot, security, daemon unit
- `process.stdout` / `process.stderr`: managed command/session output
- `entrypoint.stdout` / `entrypoint.stderr`: OCI/application-container entrypoint output when the sandbox uses OCI-entrypoint mode
- `pty`: PTY lifecycle metadata and optionally content if enabled
- `proxy.access`: HTTP/proxy requests and errors
- `lifecycle`: create/start/stop/reboot/delete/snapshot/backup events

Acceptance criteria:

- Given a command is run through the toolbox, when it writes stdout/stderr, then logs are queryable by machine ID and command ID.
- Given the daemon logs an error, then the error appears in the machine Logs tab with source `daemon`.
- Given systemd reports `justavps-daemon` failure, then an alert/log entry is recorded.

#### P0.3 Traces by default for platform operations

Traces must cover:

- machine create
- warm pool claim / prime
- placement selection
- Incus create/start/stop/reboot/delete operations
- daemon install / health check
- proxy sync
- toolbox command/exec/file/PTTY/proxy operations
- API request traces for admin and public API routes

Acceptance criteria:

- Given a machine create succeeds or fails, when opening the creation trace, then every major step has duration and error status.
- Given toolbox command execution fails, then a trace span contains command ID, exit code, duration, and error class.

#### P0.4 ClickHouse telemetry store

Use ClickHouse for raw telemetry and rollups:

- `otel_logs`
- `otel_traces`
- `otel_metrics_gauge`
- `otel_metrics_sum`
- `otel_metrics_histogram`
- materialized views for `machine_metrics_5s`, `machine_metrics_1m`, `machine_latest`, `host_metrics_1m`

Acceptance criteria:

- High-volume logs/metrics/traces do not write to Postgres.
- Retention is enforced by ClickHouse TTL.
- Admin API queries telemetry from ClickHouse and falls back to Postgres latest summary only if ClickHouse is unavailable.

#### P0.5 Postgres latest state mirror

Postgres stores only latest or low-volume summaries:

- latest heartbeat timestamp
- latest daemon state
- latest CPU/memory/disk/network snapshot
- latest alert state
- creation trace ID
- telemetry config state

Acceptance criteria:

- Existing machine list/fleet pages can render health indicators without querying ClickHouse for every row.
- ClickHouse outage does not corrupt product state.

#### P0.6 Admin dashboard observability tabs

Machine detail should include:

- Overview: latest health, daemon state, alert badges
- Metrics: CPU/RAM/disk/network charts
- Logs: source/level/search/time filters
- Traces: operation waterfalls and trace detail
- Events: lifecycle/audit timeline

Fleet/admin should include:

- host pressure heatmap
- cluster/region utilization
- unhealthy machine list
- daemon dead / heartbeat stale list
- OOM/disk full/network anomaly alerts

### P1 Should-Have

- Local OTLP endpoint inside each sandbox for customer app telemetry.
- Customer-facing telemetry page scoped to owned machines.
- Log file glob collection configured per machine/template.
- External OTLP export per account.
- Alert routing to webhooks/Slack/email.
- Cost-aware telemetry sampling controls.
- Trace correlation between v2-api request, daemon operation, proxy request, and customer app span.

### P2 Future Considerations

- Full session replay / PTY recording with explicit controls.
- eBPF per-process network and syscall telemetry.
- Automatic anomaly detection.
- Per-tenant SLO dashboards.
- Long-term archival to object storage.
- Bring-your-own observability backend.

## 8. Telemetry Architecture

### 8.1 Components

#### justavps-daemon

Runs inside every managed machine and owns guest-local observability:

- collect machine metrics
- collect daemon logs
- capture managed process stdout/stderr
- create spans for toolbox operations
- emit heartbeats and OTLP batches
- expose optional local OTLP endpoint for user app telemetry

The daemon should remain the only mandatory guest process. If a separate OpenTelemetry Collector binary is needed later, it should be optional or embedded/managed by the daemon.

#### Host OpenTelemetry Collector

Runs on every Incus host or as a host service:

- scrape Incus `/1.0/metrics` per cluster member
- collect host metrics
- collect host/journald logs relevant to Incus and JustAVPS
- send OTLP to the telemetry gateway

Incus metrics must be scraped per cluster member because each member returns metrics only for instances running locally.

#### Telemetry Gateway

Central OTLP endpoint. Responsibilities:

- authenticate daemon/host/API telemetry
- enrich resource attributes from machine/account/cluster/host mapping
- batch and retry
- redact sensitive attributes where possible
- apply sampling/retention class decisions
- export to ClickHouse

Implementation options:

- P0: OpenTelemetry Collector with config-driven processors/exporters plus a thin auth/enrichment service if needed.
- P1: dedicated `apps/telemetry-gateway` service for token validation and enrichment before forwarding to collector.

#### ClickHouse

Primary telemetry database for raw and rollup data.

#### Postgres

Product state and latest summary only.

### 8.2 Data Flow

```text
Machine create
  v2-api creates machine_id and telemetry_token
  v2-api writes daemon config into guest
  daemon starts and emits heartbeat/metrics/logs
  gateway validates token and enriches attributes
  ClickHouse stores raw telemetry
  Postgres machine.metadata/latest state gets small summary patch
  admin UI queries latest summary + ClickHouse charts/logs/traces
```

### 8.3 Host / Incus Metrics Flow

```text
Incus member /1.0/metrics
  ↓ Prometheus receiver
OTel Collector on host or gateway
  ↓ enrich: cluster_id, member_name, instance_name
gateway maps instance_name → machine_id/account_id
  ↓
ClickHouse metrics tables + machine rollups
```

## 9. Resource Attributes

All telemetry should include stable resource attributes.

Required:

```text
service.name=justavps-daemon | justavps-v2-api | justavps-incus-host | customer-app
deployment.environment=dev | staging | production
justavps.machine.id=<uuid>
justavps.account.id=<account_id>
justavps.region=<region>
justavps.runtime.type=container | vm
justavps.incus.cluster_id=<cluster_id>
justavps.incus.project=<project>
justavps.incus.instance_name=<instance_name>
justavps.incus.member_name=<member_name>
justavps.host.id=<host_id>
justavps.source.type=image | snapshot | backup
justavps.source.id=<source_id>
```

Optional:

```text
justavps.machine.name=<display_name>
justavps.image.id=<image_id>
justavps.daemon.version=<version>
justavps.warm_pool.policy_id=<policy_id>
justavps.request.id=<request_id>
justavps.operation.id=<operation_id>
justavps.command.id=<command_id>
justavps.session.id=<session_id>
```

Avoid storing secrets in attributes. Never put env var values, API tokens, command body secrets, SSH keys, or request bodies in resource attributes.

## 10. Metric Contract

Metric names should be product-level names even if raw Incus names are also stored.

### Machine metrics

| Metric | Type | Unit | Description |
| --- | --- | --- | --- |
| `justavps.sandbox.cpu.utilization` | gauge | percent | CPU usage 0-100+ |
| `justavps.sandbox.cpu.limit` | gauge | vcpu | Allocated vCPUs |
| `justavps.sandbox.cpu.time` | sum | seconds | CPU seconds by mode if available |
| `justavps.sandbox.memory.usage` | gauge | bytes | Used memory |
| `justavps.sandbox.memory.limit` | gauge | bytes | Memory limit |
| `justavps.sandbox.memory.cache` | gauge | bytes | Page cache |
| `justavps.sandbox.memory.swap` | gauge | bytes | Swap used |
| `justavps.sandbox.memory.oom_kills` | sum | count | OOM kill count |
| `justavps.sandbox.filesystem.usage` | gauge | bytes | Disk used |
| `justavps.sandbox.filesystem.available` | gauge | bytes | Disk available |
| `justavps.sandbox.filesystem.total` | gauge | bytes | Disk total |
| `justavps.sandbox.disk.read_bytes` | sum | bytes | Disk bytes read |
| `justavps.sandbox.disk.write_bytes` | sum | bytes | Disk bytes written |
| `justavps.sandbox.network.rx_bytes` | sum | bytes | Network received |
| `justavps.sandbox.network.tx_bytes` | sum | bytes | Network transmitted |
| `justavps.sandbox.network.connections` | gauge | count | Established connections |
| `justavps.sandbox.process.count` | gauge | count | Running process count |
| `justavps.sandbox.uptime` | gauge | seconds | Guest uptime |

### Daemon and operation metrics

| Metric | Type | Unit | Description |
| --- | --- | --- | --- |
| `justavps.daemon.up` | gauge | 0/1 | Daemon healthy |
| `justavps.daemon.heartbeat_age` | gauge | seconds | Age of latest heartbeat |
| `justavps.operation.duration` | histogram | ms | Lifecycle/toolbox/API operation duration |
| `justavps.operation.errors` | sum | count | Operation error count |
| `justavps.proxy.requests` | sum | count | Proxy request count |
| `justavps.proxy.duration` | histogram | ms | Proxy latency |
| `justavps.command.duration` | histogram | ms | Managed command duration |
| `justavps.command.exit_code` | gauge/sum | code/count | Exit code observation/count |

## 11. Log Contract

Every log entry should include:

```text
Timestamp
SeverityText / SeverityNumber
Body
ServiceName
ResourceAttributes
LogAttributes.source
LogAttributes.stream
LogAttributes.operation_id
LogAttributes.command_id
LogAttributes.session_id
LogAttributes.exit_code
LogAttributes.trace_id / span_id if available
```

Default sources:

| Source | Default | Notes |
| --- | --- | --- |
| `daemon` | yes | justavps-daemon logs |
| `process.stdout` | yes | commands/processes launched through daemon |
| `process.stderr` | yes | commands/processes launched through daemon |
| `system` | yes, filtered | journald allowlist: daemon, OOM, boot, service failures, security |
| `proxy.access` | yes | request line, status, latency, port, upstream error |
| `lifecycle` | yes | product lifecycle events |
| `pty.content` | no by default | sensitive; enable explicitly if needed |
| `user.file` | no by default | future configurable log globs |
| `app.otel` | yes if emitted | application OTEL logs sent to local endpoint |

Default retention should be short because logs may contain customer data.

## 12. Trace Contract

Required trace families:

### Machine create trace

Root span: `machine.create`

Child spans:

- parse request
- auth/quota check
- warm pool lookup
- placement select
- source resolve
- Incus create/clone/import
- resource enforce
- start machine
- wait guest exec
- wait cloud-init
- install/verify daemon
- sync proxy routes
- persist machine row

### Lifecycle traces

- `machine.start`
- `machine.stop`
- `machine.reboot`
- `machine.resize`
- `machine.snapshot.create`
- `machine.backup.create`
- `machine.restore`
- `machine.delete`

### Toolbox traces

- `toolbox.exec`
- `toolbox.file.read`
- `toolbox.file.write`
- `toolbox.pty.open`
- `toolbox.proxy.request`
- `toolbox.service.restart`

### API traces

Hono middleware should create request spans for v2-api routes, with route template, status, duration, request ID, and account/machine IDs where available.

## 13. ClickHouse Storage

### Raw tables

Use ClickHouse exporter standard OTEL schemas where possible:

- `otel_logs`
- `otel_traces`
- `otel_metrics_gauge`
- `otel_metrics_sum`
- `otel_metrics_histogram`

### Product rollup views

Materialized views or derived tables:

- `machine_metrics_5s`
- `machine_metrics_1m`
- `machine_metrics_5m`
- `machine_latest_metrics`
- `host_metrics_1m`
- `machine_log_index`
- `machine_trace_index`
- `machine_alerts`

### Retention defaults

| Data | Raw retention | Rollup retention |
| --- | --- | --- |
| 5s metrics | 7 days | 1m for 30 days, hourly for 180 days |
| logs | 3-14 days | alert/error summaries 30-90 days |
| traces | 7 days | operation summaries 90 days |
| audit/lifecycle events | Postgres 1 year+ | ClickHouse optional mirror |
| billing usage | Postgres/ledger long-term | ClickHouse analytics optional |

## 14. Postgres Changes

Add product/latest state models or JSON fields:

### Option A: dedicated table

```text
v2_ops.machine_telemetry_state
  machine_id primary key
  account_id
  last_seen_at
  daemon_state
  daemon_version
  latest_cpu_pct
  latest_memory_used_bytes
  latest_memory_limit_bytes
  latest_disk_used_bytes
  latest_disk_total_bytes
  latest_network_rx_bps
  latest_network_tx_bps
  latest_connections
  latest_alerts jsonb
  clickhouse_trace_id
  updated_at
```

### Option B: machine.metadata summary

Good for fastest first version, but a dedicated table is cleaner once dashboards depend on it.

Recommendation: create dedicated latest-state table in P0 and keep machine metadata minimal.

## 15. API Surface

### Admin query endpoints

```text
GET /admin/telemetry/overview?from&to
GET /admin/telemetry/machines/:id/latest
GET /admin/telemetry/machines/:id/metrics?from&to&resolution=5s|1m|5m|1h
GET /admin/telemetry/machines/:id/logs?from&to&cursor&limit&level&source&search
GET /admin/telemetry/machines/:id/traces?from&to&operation
GET /admin/telemetry/machines/:id/events?from&to
GET /admin/telemetry/hosts/:id/metrics?from&to&resolution=1m
GET /admin/telemetry/alerts?status=open|closed&severity
```

### Internal ingest endpoints

Prefer OTLP ingestion through gateway. Keep lightweight fallback:

```text
POST /internal/machines/:id/heartbeat
POST /internal/machines/:id/stage
```

### Customer-facing future endpoints

```text
GET /machines/:id/metrics
GET /machines/:id/logs
GET /machines/:id/traces
```

These must enforce account ownership and log privacy controls.

## 16. Admin UI Requirements

### Machine list

Add columns/badges:

- health: healthy / warning / critical / stale
- CPU/RAM/disk latest
- heartbeat age
- daemon state
- latest alert

### Machine detail

Tabs:

1. Overview
2. Metrics
3. Logs
4. Traces
5. Events

### Fleet page

Add:

- runtime pressure from real metrics
- host heatmap
- unhealthy machine panel
- daemon failures
- network anomaly panel
- disk/OOM pressure panel

## 17. Alert Rules

P0 alert rules:

- heartbeat stale > 90s
- daemon down
- CPU > 95% for 5 minutes
- memory > 90% for 5 minutes
- disk > 90%
- OOM kill observed
- network connections > threshold
- egress rate > threshold
- proxy 5xx rate high
- create failure rate high
- Incus member unreachable

Alerts should write:

- ClickHouse alert event/log
- Postgres latest state
- optional webhook later

## 18. Privacy / Security / Cost Guardrails

- Logs can contain secrets. Default retention must be short.
- Never collect environment variable values as attributes.
- Redact known token patterns in daemon and gateway where possible.
- PTY content capture is disabled by default.
- Customer-facing log access must be scoped to machine owner/account.
- Admin access must be audited.
- Apply per-machine/log-source rate limits.
- Apply max body sizes and truncation for log lines.
- Sampling should apply to high-volume traces, not critical lifecycle traces.

## 19. Implementation Phases

### Phase 0: local stack

- Add ClickHouse service to `docker-compose.yml`.
- Add OTel Collector config for local dev.
- Add env examples.
- Verify v2-api can write test OTLP logs/traces/metrics.

### Phase 1: v2-api tracing

- Add OTEL SDK and Hono request instrumentation.
- Convert machine creation telemetry to real spans.
- Store trace ID on machine metadata/latest state.
- Keep existing `/admin/telemetry/creations/:id` compatibility read model.

### Phase 2: daemon metrics/logs

- Extend daemon config with telemetry endpoint/token/resource attributes.
- Emit default metrics every 5 seconds.
- Emit daemon logs and managed command stdout/stderr as OTEL logs.
- Emit toolbox operation spans.
- Update managed daemon installer to write telemetry config.

### Phase 3: ClickHouse query API and admin UI

- Add ClickHouse client/query helpers.
- Add admin telemetry endpoints.
- Add Metrics/Logs/Traces tabs.
- Add latest-state Postgres mirror.

### Phase 4: host/Incus metrics

- Configure host collector to scrape each Incus member `/1.0/metrics`.
- Enrich Incus `name` label to machine ID/account ID.
- Add host heatmap and fleet pressure charts.

### Phase 5: user app OTEL and external export

- Expose local OTLP endpoint inside sandbox.
- Inject OTEL env vars into templates/sessions.
- Let users export telemetry to their own OTLP provider.

## 20. Success Metrics

- 95% of new machines have first latest metrics within 5-10s of daemon ready, then continue at a 5s default interval.
- 95% of managed commands have stdout/stderr logs and duration spans.
- 100% of machine create failures have a trace with failing span/error message.
- Operators can identify unhealthy host/machine without SSH in < 60 seconds.
- Postgres telemetry write volume remains bounded and low.
- ClickHouse telemetry ingestion lag p95 < 15 seconds.

## 21. Open Questions

1. What is default raw log retention: 3, 7, or 14 days?
2. Should customers see logs by default, or only admins initially?
3. Should PTY content ever be captured by default? Recommendation: no.
4. Should local app OTLP endpoint be in P0 or P1? Recommendation: P1 if daemon metrics/logs are P0.
5. Should ClickHouse be self-hosted first or managed? Local/self-hosted for dev; managed or dedicated production cluster later.
6. What exact threshold defines network anomaly / abuse?
7. How much journald should be collected by default?

## 22. Final Product Stance

JustAVPS should own sandbox observability. Every machine should have built-in metrics, logs, traces, lifecycle events, and latest health state from day one. OTEL gives us the data model and ingestion shape; ClickHouse gives us cheap high-volume storage; Postgres stays clean as product state.

Default logs are included, but we must be precise: not “all bytes ever printed anywhere in a full Linux machine” by magic. The guaranteed default is platform logs, daemon logs, managed process stdout/stderr, OCI-entrypoint stdout/stderr when applicable, lifecycle/proxy logs, selected system logs, and app OTEL/logs when the user routes them through the provided endpoint.
