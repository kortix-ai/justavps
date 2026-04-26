/**
 * Admin Global Search — one endpoint that fuzzy-matches across the entire
 * fleet state (machines, accounts, users, hosts, procurements, webhooks,
 * images, subscriptions, SSH keys, API keys) and returns jump-to-drawer hrefs
 * for the Cmd-K palette.
 *
 * Guardrails:
 *  - apiGuard + requireAdmin (same pattern as the rest of /admin/*).
 *  - Queries run in parallel via Promise.all, each wrapped in try/catch so a
 *    single entity failure does not nuke the whole search.
 *  - Each per-entity query is limited to 5 rows; the total response is capped
 *    at `limit` (default 30, max 100).
 *  - Uses `ilike '%q%'` — no fulltext index yet. For the current fleet size
 *    (< ~100k rows total across all entities) this is fine; if fleet grows
 *    significantly we should add GIN + tsvector indexes on name/email/url
 *    columns and switch to websearch_to_tsquery.
 *  - No secrets ever leave this endpoint: api_key hashes, webhook secrets,
 *    stripe customer / payment tokens etc. are excluded from projections.
 *  - UUID-exact matches run as a parallel batch of id-equality lookups and
 *    are ranked above fuzzy matches (prefix > substring) in the merged list.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { eq, ilike, or } from 'drizzle-orm';
import { db } from '@/server/db';
import {
  machines,
  accounts,
  users,
  baremetalHosts,
  baremetalProcurements,
  webhooks,
  images,
  subscriptions,
  sshKeys,
  apiKeys,
} from '@/server/db/schema';
import { apiGuard, type AuthVariables } from '@/server/auth/api-guard';
import { errorResponse } from '@/server/core/route-helpers';

export const adminSearchApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminSearchApp.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) {
    return errorResponse(c, 403, 'Admin access required');
  }
  return null;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PER_ENTITY_LIMIT = 5;

export type AdminSearchResultType =
  | 'machine'
  | 'account'
  | 'user'
  | 'host'
  | 'procurement'
  | 'webhook'
  | 'image'
  | 'subscription'
  | 'ssh_key'
  | 'api_key';

export type AdminSearchResult = {
  type: AdminSearchResultType;
  id: string;
  label: string;
  sub_label: string | null;
  href: string;
  slug?: string | null;
};

type RankedResult = AdminSearchResult & {
  /** lower = more relevant. 0 = exact UUID match, 1 = prefix, 2 = substring. */
  rank: number;
};

function parseLimit(raw: string | undefined, fallback: number, max = 100) {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/**
 * Compute a relevance rank for a fuzzy hit. 1 = the query matches a prefix of
 * the primary label (starts-with), 2 = substring anywhere.
 */
function fuzzyRank(label: string | null | undefined, q: string): 1 | 2 {
  if (!label) return 2;
  return label.toLowerCase().startsWith(q.toLowerCase()) ? 1 : 2;
}

/** Wrap a promise so a single entity failure contributes [] instead of throwing. */
async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch (err) {
    console.error('[admin-search] entity query failed:', err);
    return [];
  }
}

// ─── GET /search ────────────────────────────────────────────────────────────

adminSearchApp.get('/search', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const q = (c.req.query('q') || '').trim();
  const limit = parseLimit(c.req.query('limit'), 30, 100);

  if (q.length < 2) {
    return c.json({
      q,
      total: 0,
      results: [] as AdminSearchResult[],
      counts_by_type: {} as Record<AdminSearchResultType, number>,
    });
  }

  const pattern = `%${q}%`;
  const isUuid = UUID_REGEX.test(q);

  // ─── UUID exact matches (only when q looks like a UUID) ──────────────────
  const uuidResults: RankedResult[] = [];

  if (isUuid) {
    const [
      machineById,
      accountById,
      userById,
      hostById,
      procurementById,
      webhookById,
      imageById,
      subscriptionById,
      sshKeyById,
      apiKeyById,
    ] = await Promise.all([
      safe(
        db
          .select({
            id: machines.id,
            slug: machines.slug,
            name: machines.name,
            ip: machines.ip,
            providerServerId: machines.providerServerId,
          })
          .from(machines)
          .where(eq(machines.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({
            id: accounts.id,
            slug: accounts.slug,
            name: accounts.name,
            type: accounts.type,
            billingEmail: accounts.billingEmail,
          })
          .from(accounts)
          .where(eq(accounts.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({
            id: baremetalHosts.id,
            name: baremetalHosts.name,
            region: baremetalHosts.region,
            location: baremetalHosts.location,
            publicIpv4: baremetalHosts.publicIpv4,
          })
          .from(baremetalHosts)
          .where(eq(baremetalHosts.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({
            id: baremetalProcurements.id,
            productId: baremetalProcurements.productId,
            status: baremetalProcurements.status,
            location: baremetalProcurements.location,
            providerTransactionId: baremetalProcurements.providerTransactionId,
          })
          .from(baremetalProcurements)
          .where(eq(baremetalProcurements.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({
            id: webhooks.id,
            url: webhooks.url,
            active: webhooks.active,
          })
          .from(webhooks)
          .where(eq(webhooks.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({
            id: images.id,
            name: images.name,
            isTemplate: images.isTemplate,
          })
          .from(images)
          .where(eq(images.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({
            id: subscriptions.id,
            stripeSubscriptionId: subscriptions.stripeSubscriptionId,
            status: subscriptions.status,
          })
          .from(subscriptions)
          .where(eq(subscriptions.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({
            id: sshKeys.id,
            name: sshKeys.name,
            fingerprint: sshKeys.fingerprint,
          })
          .from(sshKeys)
          .where(eq(sshKeys.id, q))
          .limit(1),
      ),
      safe(
        db
          .select({
            id: apiKeys.id,
            name: apiKeys.name,
            keyPrefix: apiKeys.keyPrefix,
          })
          .from(apiKeys)
          .where(eq(apiKeys.id, q))
          .limit(1),
      ),
    ]);

    for (const r of machineById) {
      uuidResults.push({
        rank: 0,
        type: 'machine',
        id: r.id,
        slug: r.slug,
        label: r.name,
        sub_label: r.ip ?? r.providerServerId ?? r.slug,
        href: `/admin/machines?highlight=${r.id}`,
      });
    }
    for (const r of accountById) {
      uuidResults.push({
        rank: 0,
        type: 'account',
        id: r.id,
        slug: r.slug,
        label: r.name,
        sub_label: r.type,
        href: `/admin/accounts?highlight=${r.id}`,
      });
    }
    for (const r of userById) {
      uuidResults.push({
        rank: 0,
        type: 'user',
        id: r.id,
        label: r.email,
        sub_label: r.name,
        href: `/admin/accounts?highlight=${r.id}&tab=users`,
      });
    }
    for (const r of hostById) {
      uuidResults.push({
        rank: 0,
        type: 'host',
        id: r.id,
        label: r.name,
        sub_label: [r.region, r.location].filter(Boolean).join(' / ') || null,
        href: `/admin/hosts/${r.id}`,
      });
    }
    for (const r of procurementById) {
      uuidResults.push({
        rank: 0,
        type: 'procurement',
        id: r.id,
        label: r.productId,
        sub_label: [r.status, r.location].filter(Boolean).join(' · ') || null,
        href: `/admin/procurements?highlight=${r.id}`,
      });
    }
    for (const r of webhookById) {
      uuidResults.push({
        rank: 0,
        type: 'webhook',
        id: r.id,
        label: r.url,
        sub_label: r.active ? 'active' : 'disabled',
        href: `/admin/webhooks?highlight=${r.id}`,
      });
    }
    for (const r of imageById) {
      uuidResults.push({
        rank: 0,
        type: 'image',
        id: r.id,
        label: r.name,
        sub_label: r.isTemplate ? 'template' : 'user snapshot',
        href: `/admin/images?highlight=${r.id}`,
      });
    }
    for (const r of subscriptionById) {
      uuidResults.push({
        rank: 0,
        type: 'subscription',
        id: r.id,
        label: r.stripeSubscriptionId,
        sub_label: r.status,
        href: `/admin/billing?highlight=${r.id}`,
      });
    }
    for (const r of sshKeyById) {
      uuidResults.push({
        rank: 0,
        type: 'ssh_key',
        id: r.id,
        label: r.name,
        sub_label: r.fingerprint,
        href: `/admin/keys?highlight=${r.id}&tab=ssh`,
      });
    }
    for (const r of apiKeyById) {
      uuidResults.push({
        rank: 0,
        type: 'api_key',
        id: r.id,
        label: r.name,
        sub_label: r.keyPrefix,
        href: `/admin/keys?highlight=${r.id}&tab=api`,
      });
    }
  }

  // ─── Fuzzy matches across every entity (parallel) ────────────────────────

  const [
    machineRows,
    accountRows,
    userRows,
    hostRows,
    procurementRows,
    webhookRows,
    imageRows,
    subscriptionRows,
    sshKeyRows,
    apiKeyRows,
  ] = await Promise.all([
    safe(
      db
        .select({
          id: machines.id,
          slug: machines.slug,
          name: machines.name,
          ip: machines.ip,
          providerServerId: machines.providerServerId,
        })
        .from(machines)
        .where(
          or(
            ilike(machines.slug, pattern),
            ilike(machines.name, pattern),
            ilike(machines.ip, pattern),
            ilike(machines.providerServerId, pattern),
          )!,
        )
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({
          id: accounts.id,
          slug: accounts.slug,
          name: accounts.name,
          type: accounts.type,
          billingEmail: accounts.billingEmail,
        })
        .from(accounts)
        .where(
          or(
            ilike(accounts.name, pattern),
            ilike(accounts.slug, pattern),
            ilike(accounts.billingEmail, pattern),
          )!,
        )
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(
          or(
            ilike(users.email, pattern),
            ilike(users.name, pattern),
          )!,
        )
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({
          id: baremetalHosts.id,
          name: baremetalHosts.name,
          region: baremetalHosts.region,
          location: baremetalHosts.location,
          publicIpv4: baremetalHosts.publicIpv4,
        })
        .from(baremetalHosts)
        .where(
          or(
            ilike(baremetalHosts.name, pattern),
            ilike(baremetalHosts.location, pattern),
            ilike(baremetalHosts.publicIpv4, pattern),
          )!,
        )
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({
          id: baremetalProcurements.id,
          productId: baremetalProcurements.productId,
          status: baremetalProcurements.status,
          location: baremetalProcurements.location,
          providerTransactionId: baremetalProcurements.providerTransactionId,
        })
        .from(baremetalProcurements)
        .where(
          or(
            ilike(baremetalProcurements.productId, pattern),
            ilike(baremetalProcurements.providerTransactionId, pattern),
            ilike(baremetalProcurements.location, pattern),
          )!,
        )
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({
          id: webhooks.id,
          url: webhooks.url,
          active: webhooks.active,
        })
        .from(webhooks)
        .where(ilike(webhooks.url, pattern))
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({
          id: images.id,
          name: images.name,
          isTemplate: images.isTemplate,
        })
        .from(images)
        .where(ilike(images.name, pattern))
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({
          id: subscriptions.id,
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          status: subscriptions.status,
        })
        .from(subscriptions)
        .where(ilike(subscriptions.stripeSubscriptionId, pattern))
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({
          id: sshKeys.id,
          name: sshKeys.name,
          fingerprint: sshKeys.fingerprint,
        })
        .from(sshKeys)
        .where(
          or(
            ilike(sshKeys.name, pattern),
            ilike(sshKeys.fingerprint, pattern),
          )!,
        )
        .limit(PER_ENTITY_LIMIT),
    ),
    safe(
      db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
        })
        .from(apiKeys)
        .where(
          or(
            ilike(apiKeys.name, pattern),
            ilike(apiKeys.keyPrefix, pattern),
          )!,
        )
        .limit(PER_ENTITY_LIMIT),
    ),
  ]);

  const fuzzy: RankedResult[] = [];

  for (const r of machineRows) {
    fuzzy.push({
      rank: fuzzyRank(r.slug, q),
      type: 'machine',
      id: r.id,
      slug: r.slug,
      label: r.name,
      sub_label: r.ip ?? r.providerServerId ?? r.slug,
      href: `/admin/machines?highlight=${r.id}`,
    });
  }
  for (const r of accountRows) {
    fuzzy.push({
      rank: fuzzyRank(r.name ?? r.slug, q),
      type: 'account',
      id: r.id,
      slug: r.slug,
      label: r.name,
      sub_label: r.type,
      href: `/admin/accounts?highlight=${r.id}`,
    });
  }
  for (const r of userRows) {
    fuzzy.push({
      rank: fuzzyRank(r.email, q),
      type: 'user',
      id: r.id,
      label: r.email,
      sub_label: r.name,
      href: `/admin/accounts?highlight=${r.id}&tab=users`,
    });
  }
  for (const r of hostRows) {
    fuzzy.push({
      rank: fuzzyRank(r.name, q),
      type: 'host',
      id: r.id,
      label: r.name,
      sub_label: [r.region, r.location].filter(Boolean).join(' / ') || null,
      href: `/admin/hosts/${r.id}`,
    });
  }
  for (const r of procurementRows) {
    fuzzy.push({
      rank: fuzzyRank(r.productId, q),
      type: 'procurement',
      id: r.id,
      label: r.productId,
      sub_label: [r.status, r.location].filter(Boolean).join(' · ') || null,
      href: `/admin/procurements?highlight=${r.id}`,
    });
  }
  for (const r of webhookRows) {
    fuzzy.push({
      rank: fuzzyRank(r.url, q),
      type: 'webhook',
      id: r.id,
      label: r.url,
      sub_label: r.active ? 'active' : 'disabled',
      href: `/admin/webhooks?highlight=${r.id}`,
    });
  }
  for (const r of imageRows) {
    fuzzy.push({
      rank: fuzzyRank(r.name, q),
      type: 'image',
      id: r.id,
      label: r.name,
      sub_label: r.isTemplate ? 'template' : 'user snapshot',
      href: `/admin/images?highlight=${r.id}`,
    });
  }
  for (const r of subscriptionRows) {
    fuzzy.push({
      rank: fuzzyRank(r.stripeSubscriptionId, q),
      type: 'subscription',
      id: r.id,
      label: r.stripeSubscriptionId,
      sub_label: r.status,
      href: `/admin/billing?highlight=${r.id}`,
    });
  }
  for (const r of sshKeyRows) {
    fuzzy.push({
      rank: fuzzyRank(r.name, q),
      type: 'ssh_key',
      id: r.id,
      label: r.name,
      sub_label: r.fingerprint,
      href: `/admin/keys?highlight=${r.id}&tab=ssh`,
    });
  }
  for (const r of apiKeyRows) {
    fuzzy.push({
      rank: fuzzyRank(r.name, q),
      type: 'api_key',
      id: r.id,
      label: r.name,
      sub_label: r.keyPrefix,
      href: `/admin/keys?highlight=${r.id}&tab=api`,
    });
  }

  // Merge: uuid exact (rank 0) + fuzzy (rank 1/2), dedupe by (type, id).
  const merged: RankedResult[] = [...uuidResults, ...fuzzy];
  const seen = new Set<string>();
  const deduped: RankedResult[] = [];
  for (const r of merged) {
    const k = `${r.type}:${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }

  // Stable sort: rank asc, then keep insertion order within rank buckets.
  deduped.sort((a, b) => a.rank - b.rank);

  const capped = deduped.slice(0, limit);

  const countsByType = capped.reduce<Record<string, number>>((acc, r) => {
    acc[r.type] = (acc[r.type] ?? 0) + 1;
    return acc;
  }, {});

  // Strip internal `rank` before returning.
  const results: AdminSearchResult[] = capped.map((r) => ({
    type: r.type,
    id: r.id,
    label: r.label,
    sub_label: r.sub_label,
    href: r.href,
    ...(r.slug !== undefined ? { slug: r.slug } : {}),
  }));

  return c.json({
    q,
    total: results.length,
    results,
    counts_by_type: countsByType,
  });
});
