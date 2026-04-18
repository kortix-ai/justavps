/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from "@/server/db/index";
import { getProvider } from "@/server/platform/providers/index";
import type { ComputeProvider } from "@/server/platform/providers/index";

export function errorResponse(c: Context, status: number, message: string) {
  return c.json({ error: true, message, status }, status as any);
}

function errorResponseWithDetails(c: Context, status: number, message: string, details?: Record<string, unknown>) {
  return c.json({ error: true, message, status, ...(details ? { details } : {}) }, status as any);
}

type OwnedResult<T> =
  | { resource: T; response?: never }
  | { resource?: never; response: Response };

export async function requireAccountResource<T extends Record<string, any>>(
  c: Context,
  table: any,
  idColumn: any,
  idValue: string,
  accountId: string,
  label: string,
): Promise<OwnedResult<T>> {
  const [row] = await db.select().from(table).where(eq(idColumn, idValue));
  if (!row || row.accountId !== accountId) {
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
  if (err && typeof err === 'object' && 'statusCode' in err && typeof (err as { statusCode?: unknown }).statusCode === 'number') {
    const statusCode = (err as { statusCode: number }).statusCode;
    const message = err instanceof Error ? err.message : `Failed to process ${label.toLowerCase()}`;
    const details = 'details' in (err as Record<string, unknown>) && typeof (err as { details?: unknown }).details === 'object'
      ? (err as { details?: Record<string, unknown> }).details
      : undefined;
    return errorResponseWithDetails(c, statusCode, message, details);
  }
  const message = err instanceof Error ? err.message : `Failed to process ${label.toLowerCase()}`;
  return errorResponse(c, 500, message);
}
