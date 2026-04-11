import { config } from './config';

export type ConfigAuditSeverity = 'ok' | 'warning' | 'error';

export interface ConfigAuditCheck {
  key: string;
  severity: ConfigAuditSeverity;
  message: string;
  details?: string;
}

export function buildConfigAuditChecks(): ConfigAuditCheck[] {
  const checks: ConfigAuditCheck[] = [];

  checks.push(config.isDatabaseConfigured()
    ? { key: 'database_url', severity: 'ok', message: 'DATABASE_URL configured' }
    : { key: 'database_url', severity: 'error', message: 'DATABASE_URL missing' });

  checks.push(config.AUTH_SECRET
    ? { key: 'auth_secret', severity: 'ok', message: 'AUTH_SECRET configured' }
    : { key: 'auth_secret', severity: 'error', message: 'AUTH_SECRET missing' });

  checks.push(config.PROXY_AUTH_SECRET
    ? { key: 'proxy_auth_secret', severity: 'ok', message: 'PROXY_AUTH_SECRET configured' }
    : { key: 'proxy_auth_secret', severity: 'error', message: 'PROXY_AUTH_SECRET missing' });

  checks.push(config.DATA_ENCRYPTION_KEY
    ? { key: 'data_encryption_key', severity: 'ok', message: 'DATA_ENCRYPTION_KEY configured' }
    : { key: 'data_encryption_key', severity: 'error', message: 'DATA_ENCRYPTION_KEY missing' });

  checks.push(config.isCloudProviderConfigured()
    ? { key: 'hetzner_api', severity: 'ok', message: 'Hetzner Cloud API configured' }
    : { key: 'hetzner_api', severity: 'warning', message: 'Hetzner Cloud API key missing' });

  checks.push(config.hasHetznerRobotCredentials()
    ? { key: 'hetzner_robot', severity: 'ok', message: 'Hetzner Robot credentials configured' }
    : { key: 'hetzner_robot', severity: 'warning', message: 'Hetzner Robot credentials missing' });

  checks.push(config.isCloudflareConfigured()
    ? { key: 'cloudflare_core', severity: 'ok', message: 'Cloudflare core config present' }
    : { key: 'cloudflare_core', severity: 'warning', message: 'Cloudflare API/zone config incomplete' });

  checks.push(process.env.CF_KV_NAMESPACE_ID
    ? { key: 'cloudflare_kv_namespace', severity: 'ok', message: 'Cloudflare KV namespace configured' }
    : { key: 'cloudflare_kv_namespace', severity: 'warning', message: 'Cloudflare KV namespace missing' });

  checks.push(config.BROKER_SHARED_SECRET
    ? { key: 'broker_shared_secret', severity: 'ok', message: 'BROKER_SHARED_SECRET configured' }
    : { key: 'broker_shared_secret', severity: 'warning', message: 'BROKER_SHARED_SECRET missing' });

  checks.push(config.MACHINE_CALLBACK_URL
    ? { key: 'machine_callback_url', severity: 'ok', message: 'MACHINE_CALLBACK_URL configured', details: config.MACHINE_CALLBACK_URL }
    : { key: 'machine_callback_url', severity: 'warning', message: 'MACHINE_CALLBACK_URL missing' });

  checks.push(config.isStripeConfigured()
    ? { key: 'stripe_secret_key', severity: 'ok', message: 'Stripe secret key configured' }
    : { key: 'stripe_secret_key', severity: 'warning', message: 'Stripe secret key missing' });

  checks.push(config.STRIPE_WEBHOOK_SECRET
    ? { key: 'stripe_webhook_secret', severity: 'ok', message: 'Stripe webhook secret configured' }
    : { key: 'stripe_webhook_secret', severity: 'warning', message: 'Stripe webhook secret missing' });

  checks.push(config.isMailtrapConfigured()
    ? { key: 'mail_provider', severity: 'ok', message: 'Mail provider configured' }
    : { key: 'mail_provider', severity: 'warning', message: 'Mail provider missing' });

  checks.push(config.LEGACY_PLATFORM_PROXY_ENABLED
    ? { key: 'legacy_platform_proxy', severity: 'warning', message: 'Legacy direct platform proxy is still enabled' }
    : { key: 'legacy_platform_proxy', severity: 'ok', message: 'Legacy direct platform proxy disabled' });

  checks.push(config.CONTROL_PLANE_RUNTIME_DISABLED === true || process.env.CONTROL_PLANE_RUNTIME_DISABLED === 'true'
    ? { key: 'control_plane_runtime_mode', severity: 'warning', message: 'Web process control-plane runtime disabled; separate worker required' }
    : { key: 'control_plane_runtime_mode', severity: 'ok', message: 'Control-plane runtime enabled in current app process' });

  return checks;
}

export function summarizeConfigAudit(checks: ConfigAuditCheck[]) {
  const counts = {
    ok: checks.filter((check) => check.severity === 'ok').length,
    warning: checks.filter((check) => check.severity === 'warning').length,
    error: checks.filter((check) => check.severity === 'error').length,
  };

  return {
    status: counts.error > 0 ? 'degraded' : counts.warning > 0 ? 'warning' : 'ok',
    counts,
  };
}
