/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import { machineBenchmarks } from '@/server/db/schema';
import type { AuthVariables } from "@/server/auth/api-guard";
import { handleRouteError } from "@/server/core/route-helpers";
import { listMachineBenchmarks, summarizeMachineBenchmarks } from "@/server/v2/services/machine-benchmarks";

const MachineBenchmarkSummarySchema = z.object({
  machine_mode: z.enum(['vm', 'container']),
  scenario: z.enum(['cold_create', 'warm_pool_start', 'snapshot_restore', 'user_image_cold_create', 'stop_start']),
  sample_count: z.number().int().min(0),
  min_ms: z.number().nullable(),
  p50_ms: z.number().nullable(),
  p95_ms: z.number().nullable(),
  max_ms: z.number().nullable(),
  avg_ms: z.number().nullable(),
});

const MachineBenchmarkRecordSchema = z.object({
  id: z.string().uuid(),
  machine_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  baremetal_host_id: z.string().uuid().nullable(),
  machine_mode: z.enum(['vm', 'container']),
  scenario: z.enum(['cold_create', 'warm_pool_start', 'snapshot_restore', 'user_image_cold_create', 'stop_start']),
  success: z.boolean(),
  total_ms: z.number().nullable(),
  stage_timings: z.record(z.string(), z.number()),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

const MachineBenchmarkListResponseSchema = z.object({
  benchmarks: z.array(MachineBenchmarkRecordSchema),
  summary: z.array(MachineBenchmarkSummarySchema),
});

function serializeMachineBenchmark(row: typeof machineBenchmarks.$inferSelect) {
  return {
    id: row.id,
    machine_id: row.machineId,
    account_id: row.accountId,
    baremetal_host_id: row.baremetalHostId,
    machine_mode: row.machineMode,
    scenario: row.scenario,
    success: row.success,
    total_ms: row.totalMs,
    stage_timings: row.stageTimings ?? {},
    metadata: row.metadata ?? {},
    created_at: row.createdAt.toISOString(),
  };
}

export function registerAdminFleetBenchmarkRoutes(
  app: { openapi: (...args: any[]) => unknown },
  requireAdmin: (c: Context<{ Variables: AuthVariables }>) => Response | null,
) {
  app.openapi(createRoute({
    method: 'get',
    path: '/benchmarks',
    tags: ['Admin Bare Metal'],
    summary: 'List machine startup benchmarks and timing summaries',
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        machine_mode: z.enum(['vm', 'container']).optional(),
        scenario: z.enum(['cold_create', 'warm_pool_start', 'snapshot_restore', 'user_image_cold_create', 'stop_start']).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Machine benchmarks',
        content: { 'application/json': { schema: MachineBenchmarkListResponseSchema } },
      },
    },
  }), (async (c: any) => {
    const adminError = requireAdmin(c);
    if (adminError) return adminError as Response;

    try {
      const { limit, machine_mode, scenario } = c.req.valid('query');
      const rows = await listMachineBenchmarks({ limit, machineMode: machine_mode, scenario });
      return c.json({
        benchmarks: rows.map(serializeMachineBenchmark),
        summary: summarizeMachineBenchmarks(rows),
      });
    } catch (err) {
      return handleRouteError(c, err, 'ADMIN-BAREMETAL') as Response;
    }
  }) as any);
}
