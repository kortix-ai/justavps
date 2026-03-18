/**
 * Drizzle ORM schema — Postgres via Neon.
 * This is the source of truth for the database structure.
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, decimal, boolean } from 'drizzle-orm/pg-core';

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

// ─── Images ─────────────────────────────────────────────────────────────────

/**
 * User-owned images — point-in-time captures of running machines.
 * Users can boot new machines from their images. Default = ubuntu-24.04 (no image record needed).
 */
export const images = pgTable('images', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('creating'),
  // creating | ready | failed | deleted
  isPublic: boolean('is_public').default(false).notNull(), // public = visible to all users (base images)
  sourceMachineId: uuid('source_machine_id'), // which machine was captured (no FK — machine may be deleted)
  provider: text('provider').notNull().default('hetzner'),
  providerImageId: text('provider_image_id'), // Hetzner snapshot ID
  diskSizeGb: integer('disk_size_gb'),
  architecture: text('architecture').default('x86'),
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
  imageId: uuid('image_id'), // nullable, no FK
  dockerImage: text('docker_image'),
  entrypoint: text('entrypoint'),
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

  // Provisioning progress
  provisioningStage: text('provisioning_stage'), // server_creating | server_created | cloud_init_running | cloud_init_done | docker_pulling | docker_running | services_starting | services_ready
  provisioningStageUpdatedAt: timestamp('provisioning_stage_updated_at'),

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

// ─── Machine Events (append-only log) ──────────────────────────────────────

export const machineEvents = pgTable('machine_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id).notNull(),
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
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: jsonb('events').$type<string[]>().notNull().default(['*']),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Type Exports ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ImageRow = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type SSHKey = typeof sshKeys.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type MachineEventRow = typeof machineEvents.$inferSelect;
export type WebhookRow = typeof webhooks.$inferSelect;
