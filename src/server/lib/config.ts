/**
 * Server-side configuration — reads from environment variables.
 * All config access goes through this module.
 */

export const config = {
  // Hetzner
  HETZNER_API_KEY: process.env.HETZNER_API_KEY || '',
  HETZNER_DEFAULT_LOCATION: process.env.HETZNER_DEFAULT_LOCATION || 'nbg1',
  // Cloudflare
  CLOUDFLARE_API_KEY: process.env.CLOUDFLARE_GLOBAL_API_KEY || '',
  CLOUDFLARE_EMAIL: process.env.CLOUDFLARE_EMAIL || '',
  CLOUDFLARE_ZONE_ID: process.env.CLOUDFLARE_ZONE_ID || '',
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  CLOUDFLARE_TUNNEL_ID: process.env.CLOUDFLARE_TUNNEL_ID || '',
  CLOUDFLARE_TUNNEL_TOKEN: process.env.CLOUDFLARE_TUNNEL_TOKEN || '',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || '',

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_COMPUTE_PRODUCT_ID: process.env.STRIPE_COMPUTE_PRODUCT_ID || '',

  // Platform
  PLATFORM_URL: process.env.PLATFORM_URL || 'https://api.kortix.cloud',
  PROXY_DOMAIN: process.env.PROXY_DOMAIN || 'kortix.cloud',
  APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'https://justavps.com',
  API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://api.kortix.cloud',

  // Pricing
  COMPUTE_MARKUP: parseFloat(process.env.COMPUTE_MARKUP || '2.5'),

  // Auth
  AUTH_SECRET: process.env.AUTH_SECRET || '',
  PROXY_AUTH_SECRET: process.env.PROXY_AUTH_SECRET || process.env.AUTH_SECRET || '',

  // Helpers
  isHetznerConfigured(): boolean {
    return !!this.HETZNER_API_KEY;
  },
  isCloudflareConfigured(): boolean {
    return !!this.CLOUDFLARE_API_KEY && !!this.CLOUDFLARE_ZONE_ID;
  },
  isDatabaseConfigured(): boolean {
    return !!this.DATABASE_URL;
  },
  isStripeConfigured(): boolean {
    return !!this.STRIPE_SECRET_KEY;
  },
} as const;
