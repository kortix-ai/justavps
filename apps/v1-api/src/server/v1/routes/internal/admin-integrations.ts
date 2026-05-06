/**
 * Admin Integrations — live probes of every upstream service the platform
 * depends on. One-glance health dashboard for operators.
 *
 * Scope: read-only liveness probes. Each probe:
 *   - Runs in parallel (Promise.allSettled) so one hang can't block the others.
 *   - Has a hard 5s timeout via AbortSignal.timeout, plus a master 8s cap.
 *   - Never leaks credentials in error strings or context.
 *   - Returns `status: 'not_configured'` when the env var / client is missing.
 *
 * Endpoints:
 *   GET /admin/integrations        — probe every integration
 *   GET /admin/integrations/:id    — re-probe one integration (for "Re-probe" buttons)
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, gt, sql, isNotNull, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { stripeEvents, controlPlaneJobs, webhookDeliveries } from '@/server/db/schema';
import { apiGuard, type AuthVariables } from '@/server/auth/api-guard';
import { errorResponse } from '@/server/core/route-helpers';
import { config } from '@/server/core/config';
import Stripe from 'stripe';
import { HetznerRobotClient } from '@/server/platform/baremetal/vendors/hetzner-robot';

export const adminIntegrationsApp = new OpenAPIHono<{ Variables: AuthVariables }>();
adminIntegrationsApp.use('*', apiGuard);

function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('isAdmin')) {
    return errorResponse(c, 403, 'Admin access required');
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type IntegrationId =
  | 'stripe'
  | 'hetzner_robot'
  | 'hetzner_cloud'
  | 'cloudflare_kv'
  | 'cloudflare_dns'
  | 'database'
  | 'smtp';

type IntegrationStatus = 'ok' | 'degraded' | 'down' | 'not_configured';

type IntegrationBlock = {
  id: IntegrationId;
  label: string;
  status: IntegrationStatus;
  configured: boolean;
  probe_ms: number | null;
  checked_at: string | null;
  error: string | null;
  context: Record<string, unknown>;
};

const INTEGRATIONS: Array<{ id: IntegrationId; label: string }> = [
  { id: 'stripe', label: 'Stripe' },
  { id: 'hetzner_robot', label: 'Hetzner Robot' },
  { id: 'hetzner_cloud', label: 'Hetzner Cloud' },
  { id: 'cloudflare_kv', label: 'Cloudflare KV' },
  { id: 'cloudflare_dns', label: 'Cloudflare DNS' },
  { id: 'database', label: 'Database' },
  { id: 'smtp', label: 'Email (SMTP)' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const PROBE_TIMEOUT_MS = 5_000;
const MASTER_TIMEOUT_MS = 8_000;

/**
 * Generalise a raw error into something safe to display. We never echo the
 * original message because it can contain URLs with query auth, Authorization
 * headers, or raw keys.
 */
function sanitizeError(err: unknown): string {
  if (!err) return 'unknown error';
  const msg = err instanceof Error ? err.message : String(err);
  const lowered = msg.toLowerCase();
  if (lowered.includes('abort') || lowered.includes('timeout')) return 'timeout';
  if (lowered.includes('enotfound') || lowered.includes('dns')) return 'dns lookup failed';
  if (lowered.includes('econnrefused') || lowered.includes('connect')) return 'unreachable';
  if (lowered.includes('401') || lowered.includes('403') || lowered.includes('unauthorized') || lowered.includes('forbidden')) {
    return 'authentication failed';
  }
  if (lowered.includes('429')) return 'rate limited';
  if (lowered.includes('500') || lowered.includes('502') || lowered.includes('503') || lowered.includes('504')) {
    return 'upstream error';
  }
  if (lowered.includes('not configured')) return 'not configured';
  // Default: a truncated, generic message. Strip any URL-looking substring.
  const cleaned = msg.replace(/https?:\/\/[^\s]+/gi, '<url>').replace(/Bearer\s+\S+/gi, 'Bearer <redacted>');
  return cleaned.slice(0, 200);
}

/**
 * Wrap a probe in a standard envelope. Measures probe_ms, catches errors,
 * and always returns a valid block.
 */
async function runProbe(
  id: IntegrationId,
  label: string,
  probe: () => Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }>,
): Promise<IntegrationBlock> {
  const start = Date.now();
  const checked_at = new Date().toISOString();
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS),
    );
    const result = await Promise.race([probe(), timeoutPromise]);
    return {
      id,
      label,
      status: result.status,
      configured: result.configured,
      probe_ms: Date.now() - start,
      checked_at,
      error: null,
      context: result.context,
    };
  } catch (err) {
    return {
      id,
      label,
      status: 'down',
      configured: true, // if probe ran, it was configured enough to attempt
      probe_ms: Date.now() - start,
      checked_at,
      error: sanitizeError(err),
      context: {},
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Probes
// ═══════════════════════════════════════════════════════════════════════════

async function probeStripe(): Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }> {
  if (!config.STRIPE_SECRET_KEY) {
    return { status: 'not_configured', configured: false, context: {} };
  }
  // Construct a lightweight client. We intentionally don't import the shared
  // singleton because it's configured with 30s timeout + retries; we want a
  // fast-fail probe here.
  const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0,
    timeout: PROBE_TIMEOUT_MS,
  });
  const balance = await stripe.balance.retrieve();

  // recent_events_24h — count of processed webhook events in the last 24h.
  let recent_events_24h = 0;
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(stripeEvents)
      .where(gt(stripeEvents.processedAt, twentyFourHoursAgo));
    recent_events_24h = Number(row?.count ?? 0);
  } catch {
    // DB check has its own probe — if this fails, surface only in the
    // `database` block, don't fail the Stripe block.
  }

  return {
    status: 'ok',
    configured: true,
    context: {
      livemode: balance.livemode,
      account_id: null, // balance.retrieve does not return account id; would need accounts.retrieve()
      recent_events_24h,
    },
  };
}

async function probeHetznerRobot(): Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }> {
  if (!config.hasHetznerRobotCredentials()) {
    return { status: 'not_configured', configured: false, context: {} };
  }
  const client = new HetznerRobotClient();
  const servers = await client.listServers();
  // Separate probe for the product catalog — it's a different endpoint and
  // failure here doesn't mean Robot as a whole is down.
  let product_catalog_reachable = false;
  try {
    const products = await client.listServerProducts();
    product_catalog_reachable = Array.isArray(products);
  } catch {
    product_catalog_reachable = false;
  }
  const status: IntegrationStatus = product_catalog_reachable ? 'ok' : 'degraded';
  return {
    status,
    configured: true,
    context: {
      server_count: servers.length,
      product_catalog_reachable,
    },
  };
}

async function probeHetznerCloud(): Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }> {
  if (!config.HETZNER_API_KEY) {
    return { status: 'not_configured', configured: false, context: {} };
  }
  const res = await fetch('https://api.hetzner.cloud/v1/images?per_page=1', {
    headers: { Authorization: `Bearer ${config.HETZNER_API_KEY}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }

  // Optionally verify the base snapshot exists (non-fatal: if it doesn't,
  // we flag it but still return `ok` overall).
  let base_snapshot_exists = false;
  const baseId = config.HETZNER_BASE_SNAPSHOT_ID;
  if (baseId) {
    try {
      const snapRes = await fetch(`https://api.hetzner.cloud/v1/images/${encodeURIComponent(baseId)}`, {
        headers: { Authorization: `Bearer ${config.HETZNER_API_KEY}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      base_snapshot_exists = snapRes.ok;
    } catch {
      base_snapshot_exists = false;
    }
  }

  const status: IntegrationStatus = baseId && !base_snapshot_exists ? 'degraded' : 'ok';
  return {
    status,
    configured: true,
    context: {
      base_snapshot_id: baseId || null,
      base_snapshot_exists,
    },
  };
}

async function probeCloudflareKV(): Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }> {
  const kvNs = process.env.CF_KV_NAMESPACE_ID || '';
  const token = config.CLOUDFLARE_API_KEY;
  const email = config.CLOUDFLARE_EMAIL;
  const accountId = config.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !email || !accountId || !kvNs) {
    return {
      status: 'not_configured',
      configured: false,
      context: { namespace_id: kvNs || null, keys_listed: false },
    };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvNs}/keys?limit=1`;
  const res = await fetch(url, {
    headers: {
      'X-Auth-Key': token,
      'X-Auth-Email': email,
    },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }
  return {
    status: 'ok',
    configured: true,
    context: {
      namespace_id: kvNs,
      keys_listed: true,
    },
  };
}

async function probeCloudflareDNS(): Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }> {
  const token = config.CLOUDFLARE_API_KEY;
  const email = config.CLOUDFLARE_EMAIL;
  const zoneId = config.CLOUDFLARE_ZONE_ID;
  if (!token || !email || !zoneId) {
    return {
      status: 'not_configured',
      configured: false,
      context: { zone_id: zoneId || null, records_reachable: false },
    };
  }
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=1`;
  const res = await fetch(url, {
    headers: {
      'X-Auth-Key': token,
      'X-Auth-Email': email,
    },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }
  return {
    status: 'ok',
    configured: true,
    context: {
      zone_id: zoneId,
      records_reachable: true,
    },
  };
}

async function probeDatabase(): Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }> {
  if (!config.isDatabaseConfigured()) {
    return { status: 'not_configured', configured: false, context: {} };
  }
  // SELECT 1 — tests connectivity + authentication.
  await db.execute(sql`select 1`);

  // control_plane_jobs has no deletedAt column — count all queued rows.
  const [queuedRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(controlPlaneJobs)
    .where(eq(controlPlaneJobs.status, 'queued'));
  const queued_jobs = Number(queuedRow?.count ?? 0);

  // webhook_deliveries has no deletedAt column either.
  const [dlqRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(webhookDeliveries)
    .where(
      and(
        isNotNull(webhookDeliveries.deadLetteredAt),
        eq(webhookDeliveries.status, 'dead_lettered'),
      ),
    );
  // If no rows match with status='dead_lettered' filter (maybe it's encoded differently),
  // fall back to just the deadLetteredAt non-null count.
  let dead_lettered_deliveries = Number(dlqRow?.count ?? 0);
  if (dead_lettered_deliveries === 0) {
    const [fallbackRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(webhookDeliveries)
      .where(isNotNull(webhookDeliveries.deadLetteredAt));
    dead_lettered_deliveries = Number(fallbackRow?.count ?? 0);
  }

  return {
    status: 'ok',
    configured: true,
    context: {
      queued_jobs,
      dead_lettered_deliveries,
    },
  };
}

async function probeSmtp(): Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }> {
  // Pragmatic: we don't issue a real send-probe because that would charge
  // money / spam a recipient. Mailtrap's "ping" endpoint is not public, so
  // we report configured=true → ok. A real health check would require us to
  // call GET /api/accounts which needs a different auth scope; TODO.
  if (!config.isMailtrapConfigured()) {
    return {
      status: 'not_configured',
      configured: false,
      context: { provider: 'mailtrap' },
    };
  }
  return {
    status: 'ok',
    configured: true,
    context: {
      provider: 'mailtrap',
      sandbox: config.MAILTRAP_USE_SANDBOX,
      // TODO: swap for a real API credential check when Mailtrap exposes one.
      verified: false,
    },
  };
}

// Map integration id → probe fn. Keep this list in sync with INTEGRATIONS.
const PROBES: Record<IntegrationId, () => Promise<{ status: IntegrationStatus; configured: boolean; context: Record<string, unknown> }>> = {
  stripe: probeStripe,
  hetzner_robot: probeHetznerRobot,
  hetzner_cloud: probeHetznerCloud,
  cloudflare_kv: probeCloudflareKV,
  cloudflare_dns: probeCloudflareDNS,
  database: probeDatabase,
  smtp: probeSmtp,
};

async function runAllProbes(): Promise<IntegrationBlock[]> {
  // Master timeout: if the whole probe pool hangs longer than this, we still
  // return. Individual probes each have their own 5s cap, but master ensures
  // bounded response latency even if something escapes that.
  const masterTimeout = new Promise<'__master_timeout__'>((resolve) =>
    setTimeout(() => resolve('__master_timeout__'), MASTER_TIMEOUT_MS),
  );

  const probePromises = INTEGRATIONS.map((entry) => runProbe(entry.id, entry.label, PROBES[entry.id]));
  // Promise.allSettled — one probe's crash never drops the whole fleet status.
  const settled = await Promise.race([Promise.allSettled(probePromises), masterTimeout]);

  if (settled === '__master_timeout__') {
    // Fallback: mark everything we haven't resolved as timeout.
    return INTEGRATIONS.map((entry) => ({
      id: entry.id,
      label: entry.label,
      status: 'down' as IntegrationStatus,
      configured: true,
      probe_ms: null,
      checked_at: new Date().toISOString(),
      error: 'probe timeout',
      context: {},
    }));
  }

  return settled.map((res, i) => {
    if (res.status === 'fulfilled') return res.value;
    return {
      id: INTEGRATIONS[i].id,
      label: INTEGRATIONS[i].label,
      status: 'down' as IntegrationStatus,
      configured: true,
      probe_ms: null,
      checked_at: new Date().toISOString(),
      error: sanitizeError(res.reason),
      context: {},
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════

adminIntegrationsApp.get('/integrations', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const probed_at = new Date().toISOString();
  const integrations = await runAllProbes();

  return c.json({ probed_at, integrations });
});

adminIntegrationsApp.get('/integrations/:id', async (c) => {
  const adminError = requireAdmin(c);
  if (adminError) return adminError;

  const id = c.req.param('id') as IntegrationId;
  const entry = INTEGRATIONS.find((x) => x.id === id);
  if (!entry) {
    return errorResponse(c, 404, 'Unknown integration');
  }

  const block = await runProbe(entry.id, entry.label, PROBES[entry.id]);
  return c.json(block);
});
