/**
 * Server-side configuration — reads from environment variables.
 * All config access goes through this module.
 */

export const config = {
  // Cloud provider
  HETZNER_API_KEY: process.env.HETZNER_API_KEY || '',
  HETZNER_DEFAULT_LOCATION: process.env.HETZNER_DEFAULT_LOCATION || 'nbg1',
  HETZNER_ROBOT_USER: (process.env.HETZNER_ROBOT_USER || '').trim(),
  HETZNER_ROBOT_PASSWORD: (process.env.HETZNER_ROBOT_PASSWORD || '').trim(),
  BAREMETAL_BOOTSTRAP_PUBLIC_KEY: (process.env.BAREMETAL_BOOTSTRAP_PUBLIC_KEY || '').trim(),
  BAREMETAL_BOOTSTRAP_PRIVATE_KEY: (process.env.BAREMETAL_BOOTSTRAP_PRIVATE_KEY || '').trim(),
  // Pre-built snapshot with all platform software (OpenCode, Caddy, Docker, daemon, etc.)
  // Machines from this snapshot skip install and only do machine-specific config (~5s vs ~100s)
  HETZNER_BASE_SNAPSHOT_ID: (process.env.HETZNER_BASE_SNAPSHOT_ID || '').trim(),
  // Cloudflare (DNS + KV only — no tunnels)
  CLOUDFLARE_API_KEY: process.env.CLOUDFLARE_GLOBAL_API_KEY || '',
  CLOUDFLARE_EMAIL: process.env.CLOUDFLARE_EMAIL || '',
  CLOUDFLARE_ZONE_ID: process.env.CLOUDFLARE_ZONE_ID || '',
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || '',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || '',

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',

  // Email (Mailtrap)
  MAILTRAP_API_TOKEN: (process.env.MAILTRAP_API_TOKEN || process.env.MAILTRAP_API_KEY || '').trim(),
  MAILTRAP_USE_SANDBOX: (process.env.MAILTRAP_USE_SANDBOX || '').trim().toLowerCase() === 'true',
  MAILTRAP_INBOX_ID: parseInt(process.env.MAILTRAP_INBOX_ID || '0', 10),
  MAILTRAP_SENDER_EMAIL: (process.env.MAILTRAP_SENDER_EMAIL || 'justavps@kortix.ai').trim(),
  MAILTRAP_SENDER_NAME: (process.env.MAILTRAP_SENDER_NAME || 'JustAVPS').trim(),

  // Platform
  PLATFORM_URL: (process.env.PLATFORM_URL || 'https://justavps.com').trim(),
  PROXY_DOMAIN: (process.env.PROXY_DOMAIN || 'kortix.cloud').trim(),
  BROKER_HOST: (process.env.BROKER_HOST || '').trim(),
  BROKER_IPV4: (process.env.BROKER_IPV4 || '').trim(),
  BROKER_IPV6: (process.env.BROKER_IPV6 || '').trim(),
  BROKER_SHARED_SECRET: (process.env.BROKER_SHARED_SECRET || '').trim(),
  APP_URL: (process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com').trim(),
  API_URL: (process.env.NEXT_PUBLIC_API_URL || 'https://justavps.com/api').trim(),
  LEGACY_PLATFORM_PROXY_ENABLED: (process.env.LEGACY_PLATFORM_PROXY_ENABLED || 'false').trim().toLowerCase() === 'true',
  // v2 is gated behind this flag. DEFAULT OFF IN EVERY ENVIRONMENT — dev,
  // preview, prod. Must be explicitly opted in via FEATURE_V2_ENABLED=true.
  // Rationale: prevents any accidental exposure of the v2 surface (API +
  // dashboard + docs) on a deploy. Local dev opts in via .env.local.
  FEATURE_V2_ENABLED: (process.env.FEATURE_V2_ENABLED || 'false').trim().toLowerCase() === 'true',
  // Public-facing mirror so client-side code (middleware, pages) can make
  // routing decisions. Must be kept in sync with FEATURE_V2_ENABLED; same
  // fail-closed default.
  NEXT_PUBLIC_FEATURE_V2_ENABLED: (process.env.NEXT_PUBLIC_FEATURE_V2_ENABLED || 'false').trim().toLowerCase() === 'true',
  // Public callback URL embedded into new machines for /api/v1/internal/* callbacks.
  // Must be reachable from the public Internet; localhost will not work for remote VPSes.
  MACHINE_CALLBACK_URL: (process.env.MACHINE_CALLBACK_URL || '').trim(),
  BAREMETAL_ENABLED: (process.env.BAREMETAL_ENABLED || '').trim().toLowerCase() === 'true',
  BAREMETAL_PURCHASE_APPROVAL_REQUIRED: (process.env.BAREMETAL_PURCHASE_APPROVAL_REQUIRED || 'true').trim().toLowerCase() !== 'false',
  // Daemon release channel: "dev" downloads from daemon/dev/latest/, "latest" (default) from daemon/latest/
  DAEMON_CHANNEL: (process.env.DAEMON_CHANNEL || 'latest').trim() as 'dev' | 'latest',
  // Daemon auto-update: set to a version string (e.g. "a1b2c3d") to trigger fleet-wide update.
  // Machines with a different daemon_version will be told to update on their next heartbeat.
  DAEMON_DESIRED_VERSION: (process.env.DAEMON_DESIRED_VERSION || '').trim(),
  DAEMON_DOWNLOAD_URL: (process.env.DAEMON_DOWNLOAD_URL || '').trim(),
  CONTROL_PLANE_RUNTIME_DISABLED: (process.env.CONTROL_PLANE_RUNTIME_DISABLED || 'false').trim().toLowerCase() === 'true',

  // Encryption
  // AES-256-GCM key for encrypting secrets at rest (SSH private keys, machine tokens).
  // Required in production. Without it, secrets are stored as plaintext (with a warning).
  DATA_ENCRYPTION_KEY: (process.env.DATA_ENCRYPTION_KEY || '').trim(),

  // Auth
  AUTH_SECRET: (process.env.AUTH_SECRET || '').trim(),
  // PROXY_AUTH_SECRET signs JWT tokens for the CF Worker proxy.
  // Dev and prod use separate Workers + KV namespaces + secrets for full isolation.
  // Dev: kortix-cloud-proxy-dev (*.kortix-dev.cloud) / Prod: kortix-cloud-proxy (*.kortix.cloud)
  PROXY_AUTH_SECRET: (process.env.PROXY_AUTH_SECRET || process.env.AUTH_SECRET || '').trim(),

  // Kortix OAuth
  KORTIX_OAUTH_CLIENT_ID: (process.env.KORTIX_OAUTH_CLIENT_ID || '').trim(),
  KORTIX_OAUTH_CLIENT_SECRET: (process.env.KORTIX_OAUTH_CLIENT_SECRET || '').trim(),
  KORTIX_OAUTH_BASE_URL: (process.env.KORTIX_OAUTH_BASE_URL || 'https://api.computer.kortix.com/v1/oauth').trim(),
  KORTIX_FRONTEND_URL: (process.env.KORTIX_FRONTEND_URL || 'https://computer.kortix.com').trim(),

  // Helpers
  isKortixConfigured(): boolean {
    return !!this.KORTIX_OAUTH_CLIENT_ID && !!this.KORTIX_OAUTH_CLIENT_SECRET;
  },
  isCloudProviderConfigured(): boolean {
    return !!this.HETZNER_API_KEY;
  },
  isBaremetalConfigured(): boolean {
    return this.BAREMETAL_ENABLED;
  },
  hasHetznerRobotCredentials(): boolean {
    return !!this.HETZNER_ROBOT_USER && !!this.HETZNER_ROBOT_PASSWORD;
  },
  hasBaremetalBootstrapKey(): boolean {
    return !!this.BAREMETAL_BOOTSTRAP_PUBLIC_KEY && !!this.BAREMETAL_BOOTSTRAP_PRIVATE_KEY;
  },
  isCloudflareConfigured(): boolean {
    return !!this.CLOUDFLARE_API_KEY && !!this.CLOUDFLARE_ZONE_ID;
  },
  brokerSourceIPs(): string[] {
    return [this.BROKER_IPV4, this.BROKER_IPV6].filter(Boolean);
  },
  isDatabaseConfigured(): boolean {
    return !!this.DATABASE_URL;
  },
  isStripeConfigured(): boolean {
    return !!this.STRIPE_SECRET_KEY;
  },
  isMailtrapConfigured(): boolean {
    return !!this.MAILTRAP_API_TOKEN;
  },
} as const;
