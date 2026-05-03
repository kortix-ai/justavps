import type { AppConfig } from './config.js';

export type JsonRecord = Record<string, unknown>;

export type MachineMetricSample = {
  timestamp?: string;
  machine_id: string;
  account_id?: string;
  name: string;
  value: number;
  unit?: string;
  source?: string;
  resource_attributes?: JsonRecord;
  attributes?: JsonRecord;
};

export type MachineLogEntry = {
  timestamp?: string;
  machine_id: string;
  account_id?: string;
  severity?: string;
  source?: string;
  stream?: string;
  body: string;
  trace_id?: string;
  span_id?: string;
  resource_attributes?: JsonRecord;
  attributes?: JsonRecord;
};

export type MachineTraceSpan = {
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  machine_id: string;
  account_id?: string;
  operation?: string;
  name: string;
  status?: string;
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  resource_attributes?: JsonRecord;
  attributes?: JsonRecord;
  error?: string;
};

export type MachineEventEntry = {
  timestamp?: string;
  machine_id: string;
  account_id?: string;
  type: string;
  category?: string;
  body?: string;
  resource_attributes?: JsonRecord;
  attributes?: JsonRecord;
};

export type MachineTelemetryLatest = {
  machine_id: string;
  health: 'healthy' | 'stale' | 'unknown';
  last_seen_at: string | null;
  metrics: Record<string, { value: number; unit: string; timestamp: string }>;
};

export type TelemetryStoreInfo = {
  enabled: boolean;
  driver: AppConfig['telemetry']['driver'];
  clickhouse_database?: string;
};

export type TelemetryOverview = {
  store: TelemetryStoreInfo;
  machines_seen: number;
  metric_rows: number;
  log_rows: number;
  trace_rows: number;
  event_rows: number;
  error_log_rows: number;
  from: string;
  to: string;
};

type QueryRange = { from?: string | null; to?: string | null; limit?: number };
type LogQuery = QueryRange & { direction?: 'forward' | 'backward'; level?: string | null; source?: string | null; search?: string | null };
type TraceQuery = QueryRange & { operation?: string | null };

type TelemetryStore = {
  info(): TelemetryStoreInfo;
  insertMetrics(rows: MachineMetricSample[]): Promise<number>;
  insertLogs(rows: MachineLogEntry[]): Promise<number>;
  insertTraces(rows: MachineTraceSpan[]): Promise<number>;
  insertEvents(rows: MachineEventEntry[]): Promise<number>;
  latest(machineId: string): Promise<MachineTelemetryLatest>;
  metrics(machineId: string, query: QueryRange): Promise<Array<Required<Pick<MachineMetricSample, 'machine_id' | 'name' | 'value'>> & { timestamp: string; unit: string; source: string; attributes: JsonRecord }>>;
  logs(machineId: string, query: LogQuery): Promise<Array<{ timestamp: string; machine_id: string; severity: string; source: string; stream: string; body: string; trace_id: string; span_id: string; attributes: JsonRecord }>>;
  traces(machineId: string, query: TraceQuery): Promise<Array<{ trace_id: string; span_id: string; parent_span_id: string; machine_id: string; operation: string; name: string; status: string; started_at: string; ended_at: string | null; duration_ms: number | null; attributes: JsonRecord; error: string }>>;
  events(machineId: string, query: QueryRange): Promise<Array<{ timestamp: string; machine_id: string; type: string; category: string; body: string; attributes: JsonRecord }>>;
  overview(query: QueryRange): Promise<TelemetryOverview>;
};

const memoryStore = newMemoryTelemetryStore();
let clickHouseStore: ClickHouseTelemetryStore | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return nowIso();
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function jsonString(value: unknown): string {
  return JSON.stringify(jsonRecord(value));
}

function parseJsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    return jsonRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function boundedLimit(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function sanitizeIdentifier(value: string, label: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Invalid ClickHouse ${label}: ${value}`);
  return value;
}

function sqlString(value: string) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function timeWhere(column: string, query: QueryRange, fallbackMs = 60 * 60 * 1000) {
  const to = query.to && Number.isFinite(new Date(query.to).getTime()) ? new Date(query.to) : new Date();
  const from = query.from && Number.isFinite(new Date(query.from).getTime()) ? new Date(query.from) : new Date(to.getTime() - fallbackMs);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    sql: `${column} >= parseDateTime64BestEffort(${sqlString(from.toISOString())}) AND ${column} <= parseDateTime64BestEffort(${sqlString(to.toISOString())})`,
  };
}

function severitySet(level: string | null | undefined) {
  const normalized = level?.trim().toLowerCase();
  const order = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const idx = normalized ? order.indexOf(normalized) : -1;
  return idx >= 0 ? order.slice(idx) : [];
}

function staleHealth(lastSeenAt: string | null) {
  if (!lastSeenAt) return 'unknown' as const;
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  return Number.isFinite(ageMs) && ageMs <= 90_000 ? 'healthy' as const : 'stale' as const;
}

export function getTelemetryStore(config: AppConfig): TelemetryStore {
  if (!config.telemetry.enabled || config.telemetry.driver === 'disabled') return disabledTelemetryStore(config);
  if (config.telemetry.driver === 'memory') return memoryStore;
  clickHouseStore ??= new ClickHouseTelemetryStore(config);
  return clickHouseStore;
}

export function resetMemoryTelemetryStoreForTests() {
  memoryStore.reset();
}

export function metricSamplesFromPayload(machineId: string, payload: unknown): MachineMetricSample[] {
  const body = jsonRecord(payload);
  const timestamp = normalizeTimestamp(body.timestamp ?? body.collected_at);
  const accountId = typeof body.account_id === 'string' ? body.account_id : undefined;
  const resource = jsonRecord(body.resource_attributes);
  const source = typeof body.source === 'string' ? body.source : 'daemon';
  const explicit = Array.isArray(body.metrics)
    ? body.metrics.flatMap((raw) => {
      const entry = jsonRecord(raw);
      const value = finiteNumber(entry.value);
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name || value === null) return [];
      return [{
        timestamp: normalizeTimestamp(entry.timestamp ?? timestamp),
        machine_id: machineId,
        account_id: typeof entry.account_id === 'string' ? entry.account_id : accountId,
        name,
        value,
        unit: typeof entry.unit === 'string' ? entry.unit : '',
        source: typeof entry.source === 'string' ? entry.source : source,
        resource_attributes: { ...resource, ...jsonRecord(entry.resource_attributes) },
        attributes: jsonRecord(entry.attributes),
      } satisfies MachineMetricSample];
    })
    : [];

  const rows: MachineMetricSample[] = [...explicit];
  const load = jsonRecord(body.load);
  const network = jsonRecord(body.network);
  const services = jsonRecord(body.services);
  const security = jsonRecord(body.security);
  const add = (name: string, value: unknown, unit = '', attributes: JsonRecord = {}) => {
    const n = finiteNumber(value);
    if (n === null) return;
    rows.push({ timestamp, machine_id: machineId, account_id: accountId, name, value: n, unit, source, resource_attributes: resource, attributes });
  };
  const pct = (value: unknown) => {
    const n = finiteNumber(value);
    if (n === null) return null;
    return n <= 1 ? n * 100 : n;
  };
  add('justavps.sandbox.cpu.utilization', pct(load.cpu), 'percent');
  add('justavps.sandbox.memory.utilization', pct(load.memory), 'percent');
  add('justavps.sandbox.filesystem.utilization', pct(load.disk), 'percent');
  add('justavps.sandbox.network.rx_bytes', network.bytes_in, 'bytes');
  add('justavps.sandbox.network.tx_bytes', network.bytes_out, 'bytes');
  add('justavps.sandbox.network.rx_rate', network.rate_in, 'bytes/s');
  add('justavps.sandbox.network.tx_rate', network.rate_out, 'bytes/s');
  add('justavps.sandbox.network.connections', network.connections, 'count');
  add('justavps.sandbox.uptime', body.uptime, 'seconds');
  add('justavps.daemon.up', 1, '1');
  for (const [service, up] of Object.entries(services)) add('justavps.sandbox.service.up', up ? 1 : 0, '1', { service_name: service });
  for (const [key, ok] of Object.entries(security)) add(`justavps.sandbox.security.${key}`, ok ? 1 : 0, '1');
  return rows;
}

export function logEntriesFromPayload(machineId: string, payload: unknown): MachineLogEntry[] {
  const body = jsonRecord(payload);
  const accountId = typeof body.account_id === 'string' ? body.account_id : undefined;
  const resource = jsonRecord(body.resource_attributes);
  const source = typeof body.source === 'string' ? body.source : 'daemon';
  const logs = Array.isArray(body.logs) ? body.logs : body.body || body.message ? [body] : [];
  return logs.flatMap((raw) => {
    const entry = jsonRecord(raw);
    const text = entry.body ?? entry.message ?? entry.line;
    if (text === undefined || text === null) return [];
    return [{
      timestamp: normalizeTimestamp(entry.timestamp ?? body.timestamp),
      machine_id: machineId,
      account_id: typeof entry.account_id === 'string' ? entry.account_id : accountId,
      severity: typeof entry.severity === 'string' ? entry.severity : typeof entry.level === 'string' ? entry.level : 'info',
      source: typeof entry.source === 'string' ? entry.source : source,
      stream: typeof entry.stream === 'string' ? entry.stream : '',
      body: String(text),
      trace_id: typeof entry.trace_id === 'string' ? entry.trace_id : '',
      span_id: typeof entry.span_id === 'string' ? entry.span_id : '',
      resource_attributes: { ...resource, ...jsonRecord(entry.resource_attributes) },
      attributes: jsonRecord(entry.attributes ?? entry.fields),
    } satisfies MachineLogEntry];
  });
}

export function traceSpansFromPayload(machineId: string, payload: unknown): MachineTraceSpan[] {
  const body = jsonRecord(payload);
  const accountId = typeof body.account_id === 'string' ? body.account_id : undefined;
  const resource = jsonRecord(body.resource_attributes);
  const spans = Array.isArray(body.spans) ? body.spans : Array.isArray(body.traces) ? body.traces : [];
  return spans.flatMap((raw) => {
    const entry = jsonRecord(raw);
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) return [];
    return [{
      trace_id: typeof entry.trace_id === 'string' ? entry.trace_id : typeof body.trace_id === 'string' ? body.trace_id : '',
      span_id: typeof entry.span_id === 'string' ? entry.span_id : '',
      parent_span_id: typeof entry.parent_span_id === 'string' ? entry.parent_span_id : '',
      machine_id: machineId,
      account_id: typeof entry.account_id === 'string' ? entry.account_id : accountId,
      operation: typeof entry.operation === 'string' ? entry.operation : typeof body.operation === 'string' ? body.operation : '',
      name,
      status: typeof entry.status === 'string' ? entry.status : 'ok',
      started_at: normalizeTimestamp(entry.started_at ?? entry.start_time ?? body.timestamp),
      ended_at: entry.ended_at || entry.end_time ? normalizeTimestamp(entry.ended_at ?? entry.end_time) : undefined,
      duration_ms: finiteNumber(entry.duration_ms) ?? undefined,
      resource_attributes: { ...resource, ...jsonRecord(entry.resource_attributes) },
      attributes: jsonRecord(entry.attributes),
      error: typeof entry.error === 'string' ? entry.error : '',
    } satisfies MachineTraceSpan];
  });
}

export function eventEntriesFromPayload(machineId: string, payload: unknown): MachineEventEntry[] {
  const body = jsonRecord(payload);
  const accountId = typeof body.account_id === 'string' ? body.account_id : undefined;
  const resource = jsonRecord(body.resource_attributes);
  const events = Array.isArray(body.events) ? body.events : body.type ? [body] : [];
  return events.flatMap((raw) => {
    const entry = jsonRecord(raw);
    const type = typeof entry.type === 'string' ? entry.type.trim() : '';
    if (!type) return [];
    return [{
      timestamp: normalizeTimestamp(entry.timestamp ?? body.timestamp),
      machine_id: machineId,
      account_id: typeof entry.account_id === 'string' ? entry.account_id : accountId,
      type,
      category: typeof entry.category === 'string' ? entry.category : typeof entry.event_category === 'string' ? entry.event_category : 'lifecycle',
      body: typeof entry.body === 'string' ? entry.body : typeof entry.message === 'string' ? entry.message : '',
      resource_attributes: { ...resource, ...jsonRecord(entry.resource_attributes) },
      attributes: jsonRecord(entry.attributes ?? entry.event_data),
    } satisfies MachineEventEntry];
  });
}

class ClickHouseTelemetryStore implements TelemetryStore {
  private database: string;
  private schemaPromise: Promise<void> | null = null;

  constructor(private config: AppConfig) {
    this.database = sanitizeIdentifier(config.telemetry.clickhouseDatabase, 'database');
  }

  info(): TelemetryStoreInfo {
    return { enabled: true, driver: 'clickhouse', clickhouse_database: this.database };
  }

  private table(name: string) {
    return `${this.database}.${sanitizeIdentifier(name, 'table')}`;
  }

  private async request(query: string, body?: string) {
    const base = this.config.telemetry.clickhouseUrl;
    if (!base) throw new Error('V2_CLICKHOUSE_URL is required when V2_TELEMETRY_DRIVER=clickhouse');
    const url = new URL(base);
    url.searchParams.set('query', query);
    const headers: Record<string, string> = {};
    if (this.config.telemetry.clickhouseUser) {
      headers.Authorization = `Basic ${Buffer.from(`${this.config.telemetry.clickhouseUser}:${this.config.telemetry.clickhousePassword ?? ''}`).toString('base64')}`;
    }
    const response = await fetch(url, { method: 'POST', body, headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`ClickHouse ${response.status}: ${text || response.statusText}`);
    return text;
  }

  private async selectRows<T>(query: string): Promise<T[]> {
    const text = await this.request(`${query} FORMAT JSONEachRow`);
    return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);
  }

  private async ensureSchema() {
    this.schemaPromise ??= (async () => {
      const ttl = Math.max(1, this.config.telemetry.rawRetentionDays);
      await this.request(`CREATE DATABASE IF NOT EXISTS ${this.database}`);
      await this.request(`CREATE TABLE IF NOT EXISTS ${this.table('sandbox_metrics')} (
        timestamp DateTime64(3, 'UTC'),
        ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
        machine_id String,
        account_id String DEFAULT '',
        name LowCardinality(String),
        value Float64,
        unit LowCardinality(String) DEFAULT '',
        source LowCardinality(String) DEFAULT '',
        resource_attributes String DEFAULT '{}',
        attributes String DEFAULT '{}'
      ) ENGINE = MergeTree ORDER BY (machine_id, name, timestamp) TTL toDateTime(timestamp) + INTERVAL ${ttl} DAY`);
      await this.request(`CREATE TABLE IF NOT EXISTS ${this.table('sandbox_logs')} (
        timestamp DateTime64(3, 'UTC'),
        ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
        machine_id String,
        account_id String DEFAULT '',
        severity LowCardinality(String) DEFAULT 'info',
        source LowCardinality(String) DEFAULT '',
        stream LowCardinality(String) DEFAULT '',
        body String,
        trace_id String DEFAULT '',
        span_id String DEFAULT '',
        resource_attributes String DEFAULT '{}',
        attributes String DEFAULT '{}'
      ) ENGINE = MergeTree ORDER BY (machine_id, timestamp, severity) TTL toDateTime(timestamp) + INTERVAL ${ttl} DAY`);
      await this.request(`CREATE TABLE IF NOT EXISTS ${this.table('sandbox_traces')} (
        started_at DateTime64(3, 'UTC'),
        ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
        ended_at Nullable(DateTime64(3, 'UTC')),
        trace_id String,
        span_id String,
        parent_span_id String DEFAULT '',
        machine_id String,
        account_id String DEFAULT '',
        operation LowCardinality(String) DEFAULT '',
        name String,
        status LowCardinality(String) DEFAULT 'ok',
        duration_ms Nullable(Float64),
        resource_attributes String DEFAULT '{}',
        attributes String DEFAULT '{}',
        error String DEFAULT ''
      ) ENGINE = MergeTree ORDER BY (machine_id, trace_id, started_at) TTL toDateTime(started_at) + INTERVAL ${ttl} DAY`);
      await this.request(`CREATE TABLE IF NOT EXISTS ${this.table('sandbox_events')} (
        timestamp DateTime64(3, 'UTC'),
        ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
        machine_id String,
        account_id String DEFAULT '',
        type LowCardinality(String),
        category LowCardinality(String) DEFAULT '',
        body String DEFAULT '',
        resource_attributes String DEFAULT '{}',
        attributes String DEFAULT '{}'
      ) ENGINE = MergeTree ORDER BY (machine_id, timestamp, type) TTL toDateTime(timestamp) + INTERVAL ${ttl} DAY`);
    })();
    return this.schemaPromise;
  }

  async insertMetrics(rows: MachineMetricSample[]) {
    const clean = rows.map((row) => ({
      timestamp: normalizeTimestamp(row.timestamp),
      machine_id: row.machine_id,
      account_id: row.account_id ?? '',
      name: row.name,
      value: row.value,
      unit: row.unit ?? '',
      source: row.source ?? '',
      resource_attributes: jsonString(row.resource_attributes),
      attributes: jsonString(row.attributes),
    })).filter((row) => row.machine_id && row.name && Number.isFinite(row.value));
    if (!clean.length) return 0;
    await this.ensureSchema();
    await this.request(`INSERT INTO ${this.table('sandbox_metrics')} SETTINGS date_time_input_format='best_effort' FORMAT JSONEachRow`, clean.map((row) => JSON.stringify(row)).join('\n'));
    return clean.length;
  }

  async insertLogs(rows: MachineLogEntry[]) {
    const clean = rows.map((row) => ({
      timestamp: normalizeTimestamp(row.timestamp),
      machine_id: row.machine_id,
      account_id: row.account_id ?? '',
      severity: (row.severity ?? 'info').toLowerCase(),
      source: row.source ?? '',
      stream: row.stream ?? '',
      body: row.body,
      trace_id: row.trace_id ?? '',
      span_id: row.span_id ?? '',
      resource_attributes: jsonString(row.resource_attributes),
      attributes: jsonString(row.attributes),
    })).filter((row) => row.machine_id && row.body !== undefined);
    if (!clean.length) return 0;
    await this.ensureSchema();
    await this.request(`INSERT INTO ${this.table('sandbox_logs')} SETTINGS date_time_input_format='best_effort' FORMAT JSONEachRow`, clean.map((row) => JSON.stringify(row)).join('\n'));
    return clean.length;
  }

  async insertTraces(rows: MachineTraceSpan[]) {
    const clean = rows.map((row) => ({
      started_at: normalizeTimestamp(row.started_at),
      ended_at: row.ended_at ? normalizeTimestamp(row.ended_at) : null,
      trace_id: row.trace_id || `trace-${row.machine_id}-${Date.now()}`,
      span_id: row.span_id || `span-${Math.random().toString(36).slice(2)}`,
      parent_span_id: row.parent_span_id ?? '',
      machine_id: row.machine_id,
      account_id: row.account_id ?? '',
      operation: row.operation ?? '',
      name: row.name,
      status: row.status ?? 'ok',
      duration_ms: row.duration_ms ?? null,
      resource_attributes: jsonString(row.resource_attributes),
      attributes: jsonString(row.attributes),
      error: row.error ?? '',
    })).filter((row) => row.machine_id && row.name);
    if (!clean.length) return 0;
    await this.ensureSchema();
    await this.request(`INSERT INTO ${this.table('sandbox_traces')} SETTINGS date_time_input_format='best_effort' FORMAT JSONEachRow`, clean.map((row) => JSON.stringify(row)).join('\n'));
    return clean.length;
  }

  async insertEvents(rows: MachineEventEntry[]) {
    const clean = rows.map((row) => ({
      timestamp: normalizeTimestamp(row.timestamp),
      machine_id: row.machine_id,
      account_id: row.account_id ?? '',
      type: row.type,
      category: row.category ?? '',
      body: row.body ?? '',
      resource_attributes: jsonString(row.resource_attributes),
      attributes: jsonString(row.attributes),
    })).filter((row) => row.machine_id && row.type);
    if (!clean.length) return 0;
    await this.ensureSchema();
    await this.request(`INSERT INTO ${this.table('sandbox_events')} SETTINGS date_time_input_format='best_effort' FORMAT JSONEachRow`, clean.map((row) => JSON.stringify(row)).join('\n'));
    return clean.length;
  }

  async latest(machineId: string): Promise<MachineTelemetryLatest> {
    await this.ensureSchema();
    type Row = { name: string; value: number; unit: string; timestamp_ms: string | number };
    const rows = await this.selectRows<Row>(`SELECT name, argMax(value, timestamp) AS value, argMax(unit, timestamp) AS unit, max(toUnixTimestamp64Milli(timestamp)) AS timestamp_ms FROM ${this.table('sandbox_metrics')} WHERE machine_id = ${sqlString(machineId)} GROUP BY name`);
    const metrics: MachineTelemetryLatest['metrics'] = {};
    let maxTs = 0;
    for (const row of rows) {
      const ms = Number(row.timestamp_ms);
      if (Number.isFinite(ms)) maxTs = Math.max(maxTs, ms);
      metrics[row.name] = { value: Number(row.value), unit: row.unit ?? '', timestamp: Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso() };
    }
    const lastSeenAt = maxTs ? new Date(maxTs).toISOString() : null;
    return { machine_id: machineId, health: staleHealth(lastSeenAt), last_seen_at: lastSeenAt, metrics };
  }

  async metrics(machineId: string, query: QueryRange) {
    await this.ensureSchema();
    const limit = boundedLimit(query.limit, 5000, 20000);
    const window = timeWhere('timestamp', query, 60 * 60 * 1000);
    type Row = { timestamp_ms: string | number; machine_id: string; name: string; value: number; unit: string; source: string; attributes: string };
    const rows = await this.selectRows<Row>(`SELECT toUnixTimestamp64Milli(timestamp) AS timestamp_ms, machine_id, name, value, unit, source, attributes FROM ${this.table('sandbox_metrics')} WHERE machine_id = ${sqlString(machineId)} AND ${window.sql} ORDER BY timestamp ASC LIMIT ${limit}`);
    return rows.map((row) => ({ timestamp: new Date(Number(row.timestamp_ms)).toISOString(), machine_id: row.machine_id, name: row.name, value: Number(row.value), unit: row.unit ?? '', source: row.source ?? '', attributes: parseJsonRecord(row.attributes) }));
  }

  async logs(machineId: string, query: LogQuery) {
    await this.ensureSchema();
    const limit = boundedLimit(query.limit, 1000, 5000);
    const window = timeWhere('timestamp', query, 60 * 60 * 1000);
    const levels = severitySet(query.level);
    const clauses = [`machine_id = ${sqlString(machineId)}`, window.sql];
    if (query.source) clauses.push(`source = ${sqlString(query.source)}`);
    if (query.search) clauses.push(`position(body, ${sqlString(query.search)}) > 0`);
    if (levels.length) clauses.push(`severity IN (${levels.map(sqlString).join(',')})`);
    type Row = { timestamp_ms: string | number; machine_id: string; severity: string; source: string; stream: string; body: string; trace_id: string; span_id: string; attributes: string };
    const order = query.direction === 'forward' ? 'ASC' : 'DESC';
    const rows = await this.selectRows<Row>(`SELECT toUnixTimestamp64Milli(timestamp) AS timestamp_ms, machine_id, severity, source, stream, body, trace_id, span_id, attributes FROM ${this.table('sandbox_logs')} WHERE ${clauses.join(' AND ')} ORDER BY timestamp ${order} LIMIT ${limit}`);
    return rows.map((row) => ({ timestamp: new Date(Number(row.timestamp_ms)).toISOString(), machine_id: row.machine_id, severity: row.severity ?? 'info', source: row.source ?? '', stream: row.stream ?? '', body: row.body ?? '', trace_id: row.trace_id ?? '', span_id: row.span_id ?? '', attributes: parseJsonRecord(row.attributes) }));
  }

  async traces(machineId: string, query: TraceQuery) {
    await this.ensureSchema();
    const limit = boundedLimit(query.limit, 1000, 5000);
    const window = timeWhere('started_at', query, 60 * 60 * 1000);
    const clauses = [`machine_id = ${sqlString(machineId)}`, window.sql];
    if (query.operation) clauses.push(`operation = ${sqlString(query.operation)}`);
    type Row = { started_ms: string | number; ended_ms: string | number | null; trace_id: string; span_id: string; parent_span_id: string; machine_id: string; operation: string; name: string; status: string; duration_ms: number | null; attributes: string; error: string };
    const rows = await this.selectRows<Row>(`SELECT toUnixTimestamp64Milli(started_at) AS started_ms, if(isNull(ended_at), NULL, toUnixTimestamp64Milli(assumeNotNull(ended_at))) AS ended_ms, trace_id, span_id, parent_span_id, machine_id, operation, name, status, duration_ms, attributes, error FROM ${this.table('sandbox_traces')} WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC LIMIT ${limit}`);
    return rows.map((row) => ({ trace_id: row.trace_id, span_id: row.span_id, parent_span_id: row.parent_span_id ?? '', machine_id: row.machine_id, operation: row.operation ?? '', name: row.name, status: row.status ?? '', started_at: new Date(Number(row.started_ms)).toISOString(), ended_at: row.ended_ms === null || row.ended_ms === undefined ? null : new Date(Number(row.ended_ms)).toISOString(), duration_ms: row.duration_ms, attributes: parseJsonRecord(row.attributes), error: row.error ?? '' }));
  }

  async events(machineId: string, query: QueryRange) {
    await this.ensureSchema();
    const limit = boundedLimit(query.limit, 1000, 5000);
    const window = timeWhere('timestamp', query, 24 * 60 * 60 * 1000);
    type Row = { timestamp_ms: string | number; machine_id: string; type: string; category: string; body: string; attributes: string };
    const rows = await this.selectRows<Row>(`SELECT toUnixTimestamp64Milli(timestamp) AS timestamp_ms, machine_id, type, category, body, attributes FROM ${this.table('sandbox_events')} WHERE machine_id = ${sqlString(machineId)} AND ${window.sql} ORDER BY timestamp DESC LIMIT ${limit}`);
    return rows.map((row) => ({ timestamp: new Date(Number(row.timestamp_ms)).toISOString(), machine_id: row.machine_id, type: row.type, category: row.category ?? '', body: row.body ?? '', attributes: parseJsonRecord(row.attributes) }));
  }

  async overview(query: QueryRange): Promise<TelemetryOverview> {
    await this.ensureSchema();
    const window = timeWhere('timestamp', query, 60 * 60 * 1000);
    const traceWindow = timeWhere('started_at', query, 60 * 60 * 1000);
    const [metrics, logs, traces, events, machines] = await Promise.all([
      this.selectRows<{ count: string | number }>(`SELECT count() AS count FROM ${this.table('sandbox_metrics')} WHERE ${window.sql}`),
      this.selectRows<{ count: string | number; errors: string | number }>(`SELECT count() AS count, countIf(severity IN ('error','fatal')) AS errors FROM ${this.table('sandbox_logs')} WHERE ${window.sql}`),
      this.selectRows<{ count: string | number }>(`SELECT count() AS count FROM ${this.table('sandbox_traces')} WHERE ${traceWindow.sql}`),
      this.selectRows<{ count: string | number }>(`SELECT count() AS count FROM ${this.table('sandbox_events')} WHERE ${window.sql}`),
      this.selectRows<{ count: string | number }>(`SELECT countDistinct(machine_id) AS count FROM ${this.table('sandbox_metrics')} WHERE ${window.sql}`),
    ]);
    return {
      store: this.info(),
      machines_seen: Number(machines[0]?.count ?? 0),
      metric_rows: Number(metrics[0]?.count ?? 0),
      log_rows: Number(logs[0]?.count ?? 0),
      trace_rows: Number(traces[0]?.count ?? 0),
      event_rows: Number(events[0]?.count ?? 0),
      error_log_rows: Number(logs[0]?.errors ?? 0),
      from: window.from,
      to: window.to,
    };
  }
}

function newMemoryTelemetryStore(): TelemetryStore & { reset(): void } {
  const metrics: MachineMetricSample[] = [];
  const logs: MachineLogEntry[] = [];
  const traces: MachineTraceSpan[] = [];
  const events: MachineEventEntry[] = [];
  const inWindow = (field: string, row: Record<string, unknown>, query: QueryRange, fallbackMs: number) => {
    const window = timeWhere(field, query, fallbackMs);
    const value = new Date(String(row[field] ?? row.timestamp ?? row.started_at)).getTime();
    return value >= new Date(window.from).getTime() && value <= new Date(window.to).getTime();
  };
  return {
    reset() { metrics.splice(0); logs.splice(0); traces.splice(0); events.splice(0); },
    info: () => ({ enabled: true, driver: 'memory' }),
    async insertMetrics(rows) { const clean = rows.map((row) => ({ ...row, timestamp: normalizeTimestamp(row.timestamp) })).filter((row) => row.machine_id && row.name && Number.isFinite(row.value)); metrics.push(...clean); return clean.length; },
    async insertLogs(rows) { const clean = rows.map((row) => ({ ...row, timestamp: normalizeTimestamp(row.timestamp), severity: (row.severity ?? 'info').toLowerCase() })).filter((row) => row.machine_id && row.body !== undefined); logs.push(...clean); return clean.length; },
    async insertTraces(rows) { const clean = rows.map((row) => ({ ...row, started_at: normalizeTimestamp(row.started_at), trace_id: row.trace_id || `trace-${row.machine_id}`, span_id: row.span_id || `span-${Math.random().toString(36).slice(2)}` })).filter((row) => row.machine_id && row.name); traces.push(...clean); return clean.length; },
    async insertEvents(rows) { const clean = rows.map((row) => ({ ...row, timestamp: normalizeTimestamp(row.timestamp) })).filter((row) => row.machine_id && row.type); events.push(...clean); return clean.length; },
    async latest(machineId) {
      const latestRows = metrics.filter((row) => row.machine_id === machineId).sort((a, b) => new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime());
      const byName: MachineTelemetryLatest['metrics'] = {};
      let lastSeenAt: string | null = null;
      for (const row of latestRows) {
        const timestamp = normalizeTimestamp(row.timestamp);
        byName[row.name] = { value: row.value, unit: row.unit ?? '', timestamp };
        if (!lastSeenAt || timestamp > lastSeenAt) lastSeenAt = timestamp;
      }
      return { machine_id: machineId, health: staleHealth(lastSeenAt), last_seen_at: lastSeenAt, metrics: byName };
    },
    async metrics(machineId, query) { return metrics.filter((row) => row.machine_id === machineId && inWindow('timestamp', row as unknown as Record<string, unknown>, query, 60 * 60 * 1000)).slice(0, boundedLimit(query.limit, 5000, 20000)).map((row) => ({ timestamp: normalizeTimestamp(row.timestamp), machine_id: row.machine_id, name: row.name, value: row.value, unit: row.unit ?? '', source: row.source ?? '', attributes: jsonRecord(row.attributes) })); },
    async logs(machineId, query) {
      const levels = severitySet(query.level);
      const result = logs.filter((row) => row.machine_id === machineId && inWindow('timestamp', row as unknown as Record<string, unknown>, query, 60 * 60 * 1000))
        .filter((row) => !query.source || row.source === query.source)
        .filter((row) => !query.search || row.body.includes(query.search))
        .filter((row) => !levels.length || levels.includes((row.severity ?? 'info').toLowerCase()))
        .sort((a, b) => new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime());
      if (query.direction !== 'forward') result.reverse();
      return result.slice(0, boundedLimit(query.limit, 1000, 5000)).map((row) => ({ timestamp: normalizeTimestamp(row.timestamp), machine_id: row.machine_id, severity: row.severity ?? 'info', source: row.source ?? '', stream: row.stream ?? '', body: row.body, trace_id: row.trace_id ?? '', span_id: row.span_id ?? '', attributes: jsonRecord(row.attributes) }));
    },
    async traces(machineId, query) { return traces.filter((row) => row.machine_id === machineId && inWindow('started_at', row as unknown as Record<string, unknown>, query, 60 * 60 * 1000)).filter((row) => !query.operation || row.operation === query.operation).slice(0, boundedLimit(query.limit, 1000, 5000)).map((row) => ({ trace_id: row.trace_id ?? '', span_id: row.span_id ?? '', parent_span_id: row.parent_span_id ?? '', machine_id: row.machine_id, operation: row.operation ?? '', name: row.name, status: row.status ?? 'ok', started_at: normalizeTimestamp(row.started_at), ended_at: row.ended_at ? normalizeTimestamp(row.ended_at) : null, duration_ms: row.duration_ms ?? null, attributes: jsonRecord(row.attributes), error: row.error ?? '' })); },
    async events(machineId, query) { return events.filter((row) => row.machine_id === machineId && inWindow('timestamp', row as unknown as Record<string, unknown>, query, 24 * 60 * 60 * 1000)).slice(0, boundedLimit(query.limit, 1000, 5000)).map((row) => ({ timestamp: normalizeTimestamp(row.timestamp), machine_id: row.machine_id, type: row.type, category: row.category ?? '', body: row.body ?? '', attributes: jsonRecord(row.attributes) })); },
    async overview(query) {
      const window = timeWhere('timestamp', query, 60 * 60 * 1000);
      const from = new Date(window.from).getTime();
      const to = new Date(window.to).getTime();
      const inTs = (value: string | undefined) => { const t = new Date(normalizeTimestamp(value)).getTime(); return t >= from && t <= to; };
      const metricRows = metrics.filter((row) => inTs(row.timestamp));
      return { store: { enabled: true, driver: 'memory' }, machines_seen: new Set(metricRows.map((row) => row.machine_id)).size, metric_rows: metricRows.length, log_rows: logs.filter((row) => inTs(row.timestamp)).length, trace_rows: traces.filter((row) => inTs(row.started_at)).length, event_rows: events.filter((row) => inTs(row.timestamp)).length, error_log_rows: logs.filter((row) => inTs(row.timestamp) && ['error', 'fatal'].includes((row.severity ?? '').toLowerCase())).length, from: window.from, to: window.to };
    },
  };
}

function disabledTelemetryStore(config: AppConfig): TelemetryStore {
  const latest = async (machineId: string): Promise<MachineTelemetryLatest> => ({ machine_id: machineId, health: 'unknown', last_seen_at: null, metrics: {} });
  const overview = async (query: QueryRange): Promise<TelemetryOverview> => {
    const window = timeWhere('timestamp', query, 60 * 60 * 1000);
    return { store: { enabled: false, driver: config.telemetry.driver }, machines_seen: 0, metric_rows: 0, log_rows: 0, trace_rows: 0, event_rows: 0, error_log_rows: 0, from: window.from, to: window.to };
  };
  return { info: () => ({ enabled: false, driver: config.telemetry.driver }), insertMetrics: async () => 0, insertLogs: async () => 0, insertTraces: async () => 0, insertEvents: async () => 0, latest, metrics: async () => [], logs: async () => [], traces: async () => [], events: async () => [], overview };
}
