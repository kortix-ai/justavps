/**
 * Drizzle ORM schema — Postgres via Neon.
 * This is the source of truth for the database structure.
 */

import { pgTable, uuid, text, timestamp, bigint, integer, jsonb, decimal, boolean } from 'drizzle-orm/pg-core';

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash'), // bcrypt hash — null for legacy/OAuth users
  githubId: text('github_id').unique(),
  name: text('name'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── SSH Keys ───────────────────────────────────────────────────────────────

export const sshKeys = pgTable('ssh_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  providerKeyId: text('provider_key_id'), // provider-specific SSH key ID (string for portability)
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Snapshots ──────────────────────────────────────────────────────────────

/**
 * User-owned snapshots built from Docker images.
 * Each snapshot can be materialized into provider-specific artifacts on demand.
 *
 * providerData stores per-provider snapshot metadata:
 * {
 *   "hetzner": { "snapshotId": "12345678", "diskSize": 40, "architecture": "x86" },
 *   "aws":     { "amiId": "ami-abc123", "diskSize": 40, "architecture": "x86" },
 * }
 */
export const snapshots = pgTable('snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  dockerImage: text('docker_image').notNull(), // e.g. "kortix/computer:0.8.6"
  status: text('status').notNull().default('building'),
  // building | ready | failed | deleted
  architecture: text('architecture').default('x86'), // x86 | arm
  providerData: jsonb('provider_data').$type<
    Record<string, { snapshotId: string; diskSize: number; architecture: string; [key: string]: unknown }>
  >().default({}),
  buildLogs: text('build_logs'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Machines ───────────────────────────────────────────────────────────────

export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('provisioning'),
  // provisioning | ready | error | stopped | deleted

  // Provider-agnostic fields
  provider: text('provider').notNull(), // "hetzner" | "aws" | "azure" | ...
  snapshotId: uuid('snapshot_id').references(() => snapshots.id),
  serverType: text('server_type').notNull(),
  region: text('region').notNull(),
  ip: text('ip'),

  // Provider-specific (generic storage)
  providerServerId: text('provider_server_id'), // Hetzner server ID, AWS instance ID, etc.
  providerMeta: jsonb('provider_meta').$type<Record<string, unknown>>().default({}),

  // Machine credentials
  machineToken: text('machine_token').notNull(),
  codeServerPassword: text('code_server_password').notNull(),
  sshPublicKey: text('ssh_public_key'),
  sshPrivateKey: text('ssh_private_key'),

  // Billing
  priceMonthly: integer('price_monthly'),
  stripeSubItemId: text('stripe_sub_item_id'),

  // Networking
  domains: jsonb('domains').$type<string[]>().default([]),

  // Health
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  lastHeartbeat: jsonb('last_heartbeat').$type<{
    cpu: number;
    memory: number;
    disk: number;
    services: Record<string, boolean>;
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
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  lastUsed: timestamp('last_used'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Subscriptions ──────────────────────────────────────────────────────────

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull(),
  stripePriceId: text('stripe_price_id'),
  status: text('status').notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
});

// ─── Machine Billing Records ────────────────────────────────────────────────

export const machineBilling = pgTable('machine_billing', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id).notNull(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  serverType: text('server_type').notNull(),
  hours: decimal('hours'),
});

// ─── Type Exports ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type SSHKey = typeof sshKeys.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
