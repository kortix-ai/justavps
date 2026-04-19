import { eq } from 'drizzle-orm';

import { db } from '@/server/db';
import { baremetalHosts, cells, type BaremetalHost, type CellRow } from '@/server/db/schema';

import {
  buildBaremetalCellName,
  buildBaremetalCellSlug,
  normalizeBaremetalHostGeneration,
} from "@/server/platform/baremetal/cells";

type CellStoreExecutor = Pick<typeof db, 'insert' | 'update'>;

export async function ensureBaremetalCellRecord(input: {
  region: string;
  hostClass: string;
  generation?: string | null;
  executor?: CellStoreExecutor;
}): Promise<CellRow> {
  const executor = input.executor ?? db;
  const generation = normalizeBaremetalHostGeneration(input.generation);
  const slug = buildBaremetalCellSlug({ region: input.region, hostClass: input.hostClass, generation });
  const name = buildBaremetalCellName({ region: input.region, hostClass: input.hostClass, generation });
  const now = new Date();

  const [cell] = await executor.insert(cells)
    .values({
      slug,
      name,
      region: input.region,
      hostClass: input.hostClass,
      generation,
      status: 'active',
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [cells.region, cells.hostClass, cells.generation],
      set: {
        slug,
        name,
        updatedAt: now,
      },
    })
    .returning();

  if (!cell) {
    throw new Error(`Failed to ensure cell for ${input.region}/${input.hostClass}/${generation}`);
  }

  return cell;
}

export async function ensureBaremetalHostCellAssignment(input: {
  host: Pick<BaremetalHost, 'id' | 'region' | 'hostClass' | 'generation' | 'cellId'> & { metadata?: Record<string, unknown> | null };
  executor?: CellStoreExecutor;
}) {
  const executor = input.executor ?? db;
  const generation = normalizeBaremetalHostGeneration(input.host.generation, input.host.metadata ?? null);
  const cell = await ensureBaremetalCellRecord({
    region: input.host.region,
    hostClass: input.host.hostClass,
    generation,
    executor,
  });

  if (input.host.cellId !== cell.id || input.host.generation !== generation) {
    await executor.update(baremetalHosts).set({
      cellId: cell.id,
      generation,
      updatedAt: new Date(),
    }).where(eq(baremetalHosts.id, input.host.id));
  }

  return cell;
}
