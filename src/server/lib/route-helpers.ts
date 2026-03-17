import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { getProvider } from './providers';
import type { ComputeProvider } from './providers';

export function errorResponse(c: Context, status: number, message: string) {
  return c.json({ error: true, message, status }, status as any);
}

type OwnedResult<T> =
  | { resource: T; response?: never }
  | { resource?: never; response: Response };

export async function requireOwnedResource<T extends Record<string, any>>(
  c: Context,
  table: any,
  idColumn: any,
  idValue: string,
  ownerId: string,
  label: string,
): Promise<OwnedResult<T>> {
  const [row] = await db.select().from(table).where(eq(idColumn, idValue));
  if (!row || row.ownerId !== ownerId) {
    return { response: errorResponse(c, 404, `${label} not found`) };
  }
  return { resource: row as T };
}

type ProviderResult =
  | { provider: ComputeProvider; response?: never }
  | { provider?: never; response: Response };

export function requireProvider(c: Context, providerName: string): ProviderResult {
  try {
    return { provider: getProvider(providerName) };
  } catch (err) {
    return { response: errorResponse(c, 400, (err as Error).message) };
  }
}

export function handleRouteError(c: Context, err: unknown, label: string) {
  console.error(`[${label}] error:`, err);
  const message = err instanceof Error ? err.message : `Failed to process ${label.toLowerCase()}`;
  return errorResponse(c, 500, message);
}
