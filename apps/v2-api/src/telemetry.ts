type TelemetryStatus = 'active' | 'ok' | 'error';

type TelemetrySpan = {
  name: string;
  status: TelemetryStatus;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  details?: Record<string, unknown>;
  error?: string;
};

export type MachineCreationTelemetry = {
  id: string;
  kind: 'machine.create';
  status: TelemetryStatus;
  stage: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  labels: Record<string, unknown>;
  spans: TelemetrySpan[];
  error?: string;
};

const MAX_RECENT_TRACES = 100;
const activeCreations = new Map<string, MachineCreationTelemetry>();
const recentCreations: MachineCreationTelemetry[] = [];

function nowIso() {
  return new Date().toISOString();
}

function durationMs(startedAt: string, endedAt = nowIso()) {
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

function cleanRecord(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function snapshot(trace: MachineCreationTelemetry): MachineCreationTelemetry {
  return JSON.parse(JSON.stringify(trace)) as MachineCreationTelemetry;
}

function finishTrace(trace: MachineCreationTelemetry, status: 'ok' | 'error', error?: unknown) {
  if (trace.status !== 'active') return;
  const endedAt = nowIso();
  trace.status = status;
  trace.stage = status === 'ok' ? 'complete' : 'failed';
  trace.ended_at = endedAt;
  trace.duration_ms = durationMs(trace.started_at, endedAt);
  if (error) trace.error = error instanceof Error ? error.message : String(error);
  activeCreations.delete(trace.id);
  recentCreations.unshift(snapshot(trace));
  recentCreations.splice(MAX_RECENT_TRACES);
}

export function startMachineCreationTelemetry(id: string, labels: Record<string, unknown> = {}) {
  const existing = activeCreations.get(id);
  if (existing) return existing;
  const trace: MachineCreationTelemetry = {
    id,
    kind: 'machine.create',
    status: 'active',
    stage: 'received',
    started_at: nowIso(),
    labels: cleanRecord(labels),
    spans: [],
  };
  activeCreations.set(id, trace);
  return trace;
}

export function updateMachineCreationLabels(trace: MachineCreationTelemetry, labels: Record<string, unknown>) {
  trace.labels = cleanRecord({ ...trace.labels, ...labels });
}

export async function withTelemetrySpan<T>(trace: MachineCreationTelemetry, name: string, fn: () => Promise<T>, details?: Record<string, unknown>): Promise<T> {
  trace.stage = name;
  const span: TelemetrySpan = {
    name,
    status: 'active',
    started_at: nowIso(),
    ...(details ? { details: cleanRecord(details) } : {}),
  };
  trace.spans.push(span);
  try {
    const result = await fn();
    const endedAt = nowIso();
    span.status = 'ok';
    span.ended_at = endedAt;
    span.duration_ms = durationMs(span.started_at, endedAt);
    return result;
  } catch (error) {
    const endedAt = nowIso();
    span.status = 'error';
    span.ended_at = endedAt;
    span.duration_ms = durationMs(span.started_at, endedAt);
    span.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export function completeMachineCreationTelemetry(trace: MachineCreationTelemetry) {
  finishTrace(trace, 'ok');
  return snapshot(trace);
}

export function failMachineCreationTelemetry(trace: MachineCreationTelemetry, error: unknown) {
  finishTrace(trace, 'error', error);
  return snapshot(trace);
}

export function listMachineCreationTelemetry() {
  return {
    active: [...activeCreations.values()].map(snapshot),
    recent: recentCreations.map(snapshot),
  };
}

export function getMachineCreationTelemetry(id: string) {
  const active = activeCreations.get(id);
  if (active) return snapshot(active);
  return recentCreations.find((trace) => trace.id === id) ?? null;
}
