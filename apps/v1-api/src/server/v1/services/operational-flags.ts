/**
 * Operational Flags — thin lookup layer for emergency kill switches and
 * operational feature flags.
 *
 * The admin UI writes flags via PUT /admin/controls/:key and reads the registry
 * through the admin controls routes.
 *
 * Design notes:
 *  - Known flag keys live in a code-side registry (see STATIC_FLAGS). That
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

type OperationalFlagKind = 'boolean' | 'numeric';

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
      'Blocks new Hetzner Robot orders. The Approve button in the V2 admin procurement pipeline becomes a no-op.',
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
function regionClosedFlagKey(regionId: string): string {
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

/**
 * Returns the raw row — used by the admin GET handler so it can surface
 * updated_at / updated_by.
 */
export async function getOperationalFlagRow(key: string): Promise<OperationalFlagRow | null> {
  const [row] = await db.select().from(operationalFlags).where(eq(operationalFlags.key, key));
  return row ?? null;
}
