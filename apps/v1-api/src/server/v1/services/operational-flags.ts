/**
 * Operational Flags — thin lookup layer for emergency kill switches and
 * operational feature flags.
 *
 * The admin UI writes flags via PUT /admin/controls/:key; the enforcement
 * path calls {@link getOperationalFlag} / {@link assertNotPaused} from inside
 * hot handlers. That read path can fire dozens of times per second on create
 * traffic, so we memoise each flag in-process for TTL_MS to keep DB load
 * flat. The cache is intentionally tiny (one row per known flag) and
 * invalidates on every write via {@link invalidateOperationalFlag}.
 *
 * Design notes:
 *  - Known flag keys live in a code-side registry (see KNOWN_FLAGS). That
 *    gives us typo-safety on writes and a deterministic list for the UI to
 *    render even before any flag has been set.
 *  - Regional closures are `region_<id>_closed` — the registry resolves
 *    active region ids dynamically so the list stays fresh as regions are
 *    added without a deploy.
 *  - A missing row is treated as `{ enabled: false }`. We never refuse to
 *    serve because the flag row hasn't been created yet.
 *  - The numeric multiplier (`rate_limit_multiplier`) stores its scalar in
 *    `value.metadata.value`. The row shape is uniformly boolean-first so
 *    the audit semantics stay the same across flag types.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { operationalFlags, regions, type OperationalFlagRow } from '@/server/db/schema';

export type OperationalFlagValue = {
  enabled: boolean;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type OperationalFlagKind = 'boolean' | 'numeric';

export type OperationalFlagDescriptor = {
  key: string;
  label: string;
  description: string;
  group: 'customer_flows' | 'vendor_flows' | 'regional_closures' | 'rate_limits';
  kind: OperationalFlagKind;
  /** For numeric flags — value lives in value.metadata.value. */
  numeric?: { min: number; max: number; step: number; default: number };
};

/**
 * Static kill-switches. Regional closures are layered on top at runtime.
 */
const STATIC_FLAGS: OperationalFlagDescriptor[] = [
  {
    key: 'machine_creates_paused',
    label: 'Pause machine creates',
    description:
      'Global kill switch for machine create. Blocks both customer-initiated and admin-on-behalf-of creates with a 503.',
    group: 'customer_flows',
    kind: 'boolean',
  },
  {
    key: 'signups_paused',
    label: 'Pause new signups',
    description: 'Blocks new user registration. Existing users can still sign in.',
    group: 'customer_flows',
    kind: 'boolean',
  },
  {
    key: 'procurement_orders_paused',
    label: 'Pause procurement orders',
    description:
      'Blocks new Hetzner Robot orders. The Approve button in /v2/admin/procurements becomes a no-op.',
    group: 'vendor_flows',
    kind: 'boolean',
  },
  {
    key: 'rate_limit_multiplier',
    label: 'Rate limit multiplier',
    description:
      'Numeric multiplier applied to API rate limits. 1.0 = default, 0.5 = halve all limits, 2.0 = double.',
    group: 'rate_limits',
    kind: 'numeric',
    numeric: { min: 0.1, max: 10, step: 0.1, default: 1.0 },
  },
];

/**
 * Builds a regional-closure flag descriptor for a region id.
 */
export function regionClosedFlagKey(regionId: string): string {
  return `region_${regionId}_closed`;
}

function regionClosedDescriptor(regionId: string, regionLabel: string): OperationalFlagDescriptor {
  return {
    key: regionClosedFlagKey(regionId),
    label: `Close region ${regionLabel}`,
    description: `Block new machine creates in the ${regionLabel} region. Existing machines are unaffected.`,
    group: 'regional_closures',
    kind: 'boolean',
  };
}

/**
 * Full known-flag registry for a given snapshot of active regions.
 */
export async function listKnownFlagDescriptors(): Promise<OperationalFlagDescriptor[]> {
  const activeRegions = await db
    .select({ id: regions.id, label: regions.label })
    .from(regions)
    .where(eq(regions.active, true));
  const regional = activeRegions.map((r) => regionClosedDescriptor(r.id, r.label ?? r.id));
  return [...STATIC_FLAGS, ...regional];
}

/**
 * O(1) key-is-known check. Accepts the dynamic region_<id>_closed form too.
 */
export async function isKnownFlagKey(key: string): Promise<boolean> {
  if (STATIC_FLAGS.some((f) => f.key === key)) return true;
  const match = /^region_([^_]+(?:_[^_]+)*)_closed$/.exec(key);
  if (!match) return false;
  const regionId = match[1];
  const [row] = await db.select({ id: regions.id }).from(regions).where(eq(regions.id, regionId));
  return Boolean(row);
}

// ─── In-memory TTL cache ──────────────────────────────────────────────────

type CachedFlag = { value: OperationalFlagValue; fetchedAt: number };
const TTL_MS = 10_000;
const CACHE = new Map<string, CachedFlag>();

/**
 * Invalidates a cache entry — call after every write.
 */
export function invalidateOperationalFlag(key: string): void {
  CACHE.delete(key);
}

/**
 * Clears the whole cache. Intended for tests.
 */
export function clearOperationalFlagsCache(): void {
  CACHE.clear();
}

function normalizeValue(raw: unknown): OperationalFlagValue {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      enabled: Boolean(obj.enabled),
      reason: typeof obj.reason === 'string' ? obj.reason : null,
      metadata: obj.metadata && typeof obj.metadata === 'object'
        ? (obj.metadata as Record<string, unknown>)
        : undefined,
    };
  }
  return { enabled: false };
}

/**
 * Returns the current value of a flag. Missing rows → `{ enabled: false }`.
 * Hot path — uses a 10s in-memory TTL cache.
 */
export async function getOperationalFlag(key: string): Promise<OperationalFlagValue> {
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.value;
  }
  try {
    const [row] = await db.select().from(operationalFlags).where(eq(operationalFlags.key, key));
    const value: OperationalFlagValue = row ? normalizeValue(row.value) : { enabled: false };
    CACHE.set(key, { value, fetchedAt: Date.now() });
    return value;
  } catch (err) {
    // Fail open — if the DB is down we don't want to also tear down the
    // create paths by accident.
    console.error('[operational-flags] lookup failed, failing open:', err);
    return { enabled: false };
  }
}

/**
 * Shaped for {@link handleRouteError} — a thrown error with `statusCode`
 * becomes a JSON 503 response.
 */
class OperationalFlagTripError extends Error {
  readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'OperationalFlagTripError';
  }
}

/**
 * Throws a 503-shaped error if the named flag is currently enabled.
 * Missing / disabled flags are a no-op.
 */
export async function assertNotPaused(key: string, errorMessage: string): Promise<void> {
  const flag = await getOperationalFlag(key);
  if (flag.enabled) {
    throw new OperationalFlagTripError(flag.reason || errorMessage);
  }
}

/**
 * Returns the raw row — used by the admin GET handler so it can surface
 * updated_at / updated_by.
 */
export async function getOperationalFlagRow(key: string): Promise<OperationalFlagRow | null> {
  const [row] = await db.select().from(operationalFlags).where(eq(operationalFlags.key, key));
  return row ?? null;
}
