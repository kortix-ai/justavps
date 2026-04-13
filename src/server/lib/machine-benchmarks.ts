import { db } from '@/server/db';
import { machineBenchmarks } from '@/server/db/schema';

const MACHINE_BENCHMARK_SCENARIOS = new Set([
  'cold_create',
  'warm_pool_start',
  'snapshot_restore',
  'user_image_cold_create',
  'stop_start',
] as const);

export type MachineBenchmarkScenario = typeof machineBenchmarks.$inferInsert.scenario;
export type MachineBenchmarkMode = typeof machineBenchmarks.$inferInsert.machineMode;

export interface MachineBenchmarkRecordInput {
  machineId?: string | null;
  accountId?: string | null;
  baremetalHostId?: string | null;
  machineMode: MachineBenchmarkMode;
  metadata: Record<string, unknown>;
}

function normalizeStageTimings(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, ms]) => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0)
      .map(([stage, ms]) => [stage, ms]),
  );
}

export function parseMachineBenchmarkRecord(input: MachineBenchmarkRecordInput) {
  const benchmark = input.metadata.benchmark;
  if (!benchmark || typeof benchmark !== 'object' || Array.isArray(benchmark)) return null;
  const benchmarkRecord = benchmark as Record<string, unknown>;

  const rawScenario = benchmarkRecord.scenario;
  if (typeof rawScenario !== 'string' || !MACHINE_BENCHMARK_SCENARIOS.has(rawScenario as MachineBenchmarkScenario)) {
    return null;
  }

  const rawTotalMs = benchmarkRecord.total_ms;
  const totalMs = typeof rawTotalMs === 'number' && Number.isFinite(rawTotalMs) && rawTotalMs >= 0
    ? Math.round(rawTotalMs)
    : null;

  return {
    machineId: input.machineId ?? null,
    accountId: input.accountId ?? null,
    baremetalHostId: input.baremetalHostId ?? null,
    machineMode: input.machineMode,
    scenario: rawScenario as MachineBenchmarkScenario,
    success: input.metadata.error == null,
    totalMs,
    stageTimings: normalizeStageTimings(benchmarkRecord.stage_timings),
    metadata: input.metadata,
  } satisfies typeof machineBenchmarks.$inferInsert;
}

export async function recordMachineBenchmark(input: MachineBenchmarkRecordInput) {
  const record = parseMachineBenchmarkRecord(input);
  if (!record) return null;
  const [inserted] = await db.insert(machineBenchmarks).values(record).returning();
  return inserted ?? null;
}

function percentile(sorted: number[], ratio: number) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? null;
}

export async function listMachineBenchmarks(input?: {
  limit?: number;
  machineMode?: MachineBenchmarkMode;
  scenario?: MachineBenchmarkScenario;
}) {
  const rows = await db.select().from(machineBenchmarks);
  return rows
    .filter((row) => (input?.machineMode ? row.machineMode === input.machineMode : true))
    .filter((row) => (input?.scenario ? row.scenario === input.scenario : true))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, input?.limit ?? 50);
}

export function summarizeMachineBenchmarks(rows: Array<typeof machineBenchmarks.$inferSelect>) {
  const groups = new Map<string, { mode: MachineBenchmarkMode; scenario: MachineBenchmarkScenario; totals: number[] }>();

  for (const row of rows) {
    if (typeof row.totalMs !== 'number' || !row.success) continue;
    const key = `${row.machineMode}:${row.scenario}`;
    const group = groups.get(key) ?? { mode: row.machineMode, scenario: row.scenario, totals: [] };
    group.totals.push(row.totalMs);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => {
      const sorted = [...group.totals].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, value) => acc + value, 0);
      return {
        machine_mode: group.mode,
        scenario: group.scenario,
        sample_count: sorted.length,
        min_ms: sorted[0] ?? null,
        p50_ms: percentile(sorted, 0.5),
        p95_ms: percentile(sorted, 0.95),
        max_ms: sorted[sorted.length - 1] ?? null,
        avg_ms: sorted.length ? Math.round(sum / sorted.length) : null,
      };
    })
    .sort((a, b) => a.machine_mode.localeCompare(b.machine_mode) || a.scenario.localeCompare(b.scenario));
}
