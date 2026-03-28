/**
 * Drizzle ORM schema — Postgres via Neon.
 * This is the source of truth for the database structure.
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accountTypeEnum = pgEnum('account_type', ['personal', 'organization']);
export const accountRoleEnum = pgEnum('account_role', ['owner', 'admin', 'member']);

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash'), // bcrypt hash — null for legacy/OAuth users
  githubId: text('github_id').unique(),
  googleId: text('google_id').unique(),
  name: text('name'),
  emailVerified: timestamp('email_verified'), // null = not verified
  stripeCustomerId: text('stripe_customer_id'),
  defaultAccountId: uuid('default_account_id'),
  isAdmin: boolean('is_admin').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Email Verification Tokens ──────────────────────────────────────────────

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(), // SHA-256 of the 6-digit code
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Accounts / Memberships / Invitations ───────────────────────────────────

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: accountTypeEnum('type').notNull().default('personal'),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  personalForUserId: uuid('personal_for_user_id').references(() => users.id).unique(),
  billingEmail: text('billing_email'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const accountMemberships = pgTable('account_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: accountRoleEnum('role').notNull().default('member'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  accountUserUnique: uniqueIndex('account_memberships_account_user_uidx').on(table.accountId, table.userId),
}));

export const accountInvitations = pgTable('account_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  email: text('email').notNull(),
  role: accountRoleEnum('role').notNull().default('member'),
  tokenSha256: text('token_sha256').unique().notNull(),
  invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── SSH Keys ───────────────────────────────────────────────────────────────

export const sshKeys = pgTable('ssh_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  providerKeyId: text('provider_key_id'), // provider-specific SSH key ID (string for portability)
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Images ─────────────────────────────────────────────────────────────────

/**
 * User-owned images — point-in-time captures of running machines.
 * Users can boot new machines from their images. Default = ubuntu-24.04 (no image record needed).
 */
export const images = pgTable('images', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('creating'),
  // creating | ready | failed | deleted
  isTemplate: boolean('is_public').default(false).notNull(),
  sourceMachineId: uuid('source_machine_id'), // which machine was captured (no FK — machine may be deleted)
  provider: text('provider').notNull().default('cloud'),
  providerImageId: text('provider_image_id'), // Provider snapshot ID
  diskSizeGb: integer('disk_size_gb'),
  architecture: text('architecture').default('x86'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Machines ───────────────────────────────────────────────────────────────

export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('provisioning'),
  // provisioning | ready | error | stopped | deleted

  // Provider-agnostic fields
  provider: text('provider').notNull(), // "cloud" | future providers...
  imageId: uuid('image_id'), // nullable, no FK
  serverType: text('server_type').notNull(),
  region: text('region').notNull(),
  ip: text('ip'),

  // Provider-specific (generic storage)
  providerServerId: text('provider_server_id'), // Provider-specific server ID
  providerMeta: jsonb('provider_meta').$type<Record<string, unknown>>().default({}),

  // Machine credentials
  machineToken: text('machine_token').notNull(),
  codeServerPassword: text('code_server_password').default('').notNull(), // Legacy — no longer used (OpenCode replaced code-server)
  sshPublicKey: text('ssh_public_key'),
  sshPrivateKey: text('ssh_private_key'),

  // Backups
  backupsEnabled: boolean('backups_enabled').default(true).notNull(),

  // Source tracking (user = self-provisioned, kortix = imported from Kortix)
  source: text('source').default('user').notNull(),
  kortixSandboxId: text('kortix_sandbox_id'),

  // Billing
  priceMonthly: integer('price_monthly'),

  // Networking
  domains: jsonb('domains').$type<string[]>().default([]),

  // Provisioning progress
  provisioningStage: text('provisioning_stage'), // server_creating | server_created | cloud_init_running | cloud_init_done | services_ready
  provisioningStageUpdatedAt: timestamp('provisioning_stage_updated_at'),

  // Daemon
  daemonVersion: text('daemon_version'),

  // Health
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  lastHeartbeat: jsonb('last_heartbeat').$type<{
    cpu: number;
    memory: number;
    disk: number;
    services: Record<string, boolean>;
    network?: {
      bytes_in: number;
      bytes_out: number;
      rate_in: number;
      rate_out: number;
      connections: number;
    };
    security?: {
      ufw_active: boolean;
      fail2ban_active: boolean;
      ssh_key_only: boolean;
    };
  }>(),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  readyAt: timestamp('ready_at'),
  deletedAt: timestamp('deleted_at'),
});

// ─── API Keys ───────────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  keySha256: text('key_sha256'),
  // Scoping & permissions
  scope: text('scope').notNull().default('account'), // 'account' | 'machine'
  machineIds: text('machine_ids').array(), // UUIDs of machines (scope=machine)
  permissions: text('permissions').array().notNull().default(sql`ARRAY['*']::text[]`), // '*' | 'read' | 'write' | 'delete' | 'exec' | 'proxy'
  expiresAt: timestamp('expires_at'), // null = never expires
  lastUsed: timestamp('last_used'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Proxy Tokens (shareable machine access) ────────────────────────────────

export const proxyTokens = pgTable('proxy_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull(), // bcrypt hash
  tokenSha256: text('token_sha256').notNull(), // SHA-256 for O(1) lookup
  tokenPrefix: text('token_prefix').notNull(), // 'pt_abc1...'
  label: text('label'),
  ports: integer('ports').array(), // null = all ports
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Subscriptions ──────────────────────────────────────────────────────────

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }).unique(),       // 1:1 machine ↔ subscription
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  stripeSubscriptionId: text('stripe_subscription_id').notNull(),
  stripeSubscriptionItemId: text('stripe_subscription_item_id'),              // si_xxx — needed for price updates on resize
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),                // cs_xxx — idempotency on checkout webhook
  stripePriceId: text('stripe_price_id'),
  status: text('status').notNull().default('active'),                         // active | past_due | unpaid | canceled | incomplete
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  cancelAt: timestamp('cancel_at'),                                           // when machine will be destroyed (set by Stripe)
  cancelledAt: timestamp('cancelled_at'),                                     // when cancellation was initiated
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Machine Events (append-only log) ──────────────────────────────────────

export const machineEvents = pgTable('machine_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  event: text('event').notNull(), // stage_changed | status_changed | heartbeat
  stage: text('stage'), // provisioning stage name
  message: text('message'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Webhooks ──────────────────────────────────────────────────────────────

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: jsonb('events').$type<string[]>().notNull().default(['*']),
  active: boolean('active').notNull().default(true),
  failureCount: integer('failure_count').notNull().default(0),
  lastDeliveredAt: timestamp('last_delivered_at'),
  disabledAt: timestamp('disabled_at'),
  disableReason: text('disable_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Webhook Deliveries ─────────────────────────────────────────────────────

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').references(() => webhooks.id, { onDelete: 'cascade' }).notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  durationMs: integer('duration_ms'),
  attempt: integer('attempt').notNull().default(1),
  success: boolean('success').notNull().default(false),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Processed Stripe Events (webhook idempotency) ────────────────────────

/**
 * Tracks processed Stripe webhook event IDs to prevent duplicate processing.
 * Unique constraint on eventId ensures at-most-once delivery per event.
 */
export const stripeEvents = pgTable('stripe_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: text('event_id').unique().notNull(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
});

// ─── Account Limits ────────────────────────────────────────────────────────

/**
 * Per-user resource limits. One row per user (upserted on first access).
 * NULL = unlimited (no cap). Default limits are applied at the application layer
 * when no row exists for a user.
 */
export const accountLimits = pgTable('account_limits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull().unique(),
  accountId: uuid('account_id').references(() => accounts.id).unique(),
  maxMachines: integer('max_machines').default(5).notNull(),
  maxImages: integer('max_images').default(10).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Kortix Links ──────────────────────────────────────────────────────────

export const kortixLinks = pgTable('kortix_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  kortixUserId: text('kortix_user_id').notNull(),
  kortixAccountId: text('kortix_account_id').notNull(),
  kortixEmail: text('kortix_email'),
  accessTokenEnc: text('access_token_enc'),
  refreshTokenEnc: text('refresh_token_enc'),
  tokenExpiresAt: timestamp('token_expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Type Exports ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type AccountMembership = typeof accountMemberships.$inferSelect;
export type NewAccountMembership = typeof accountMemberships.$inferInsert;
export type AccountInvitation = typeof accountInvitations.$inferSelect;
export type NewAccountInvitation = typeof accountInvitations.$inferInsert;
export type ImageRow = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type SSHKey = typeof sshKeys.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ProxyTokenRow = typeof proxyTokens.$inferSelect;
export type NewProxyToken = typeof proxyTokens.$inferInsert;
export type MachineEventRow = typeof machineEvents.$inferSelect;
export type WebhookRow = typeof webhooks.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type AccountLimitRow = typeof accountLimits.$inferSelect;
export type NewAccountLimit = typeof accountLimits.$inferInsert;
export type KortixLink = typeof kortixLinks.$inferSelect;
export type NewKortixLink = typeof kortixLinks.$inferInsert;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
