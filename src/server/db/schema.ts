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
  hetznerKeyId: bigint('hetzner_key_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Machines ───────────────────────────────────────────────────────────────

export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('provisioning'),
  // provisioning | ready | error | stopped | deleted
  serverType: text('server_type').notNull(),
  template: text('template').notNull().default('blank'),
  region: text('region').notNull().default('nbg1'),
  ip: text('ip'),
  hetznerId: bigint('hetzner_id', { mode: 'number' }),
  hetznerFwId: bigint('hetzner_fw_id', { mode: 'number' }),
  machineToken: text('machine_token').notNull(),
  codeServerPassword: text('code_server_password').notNull(),
  sshPublicKey: text('ssh_public_key'),    // auto-generated, injected into VPS
  sshPrivateKey: text('ssh_private_key'),  // shown to user ONCE for download
  priceMonthly: integer('price_monthly'),  // USD/mo as integer (e.g., 8 = $8/mo)
  baseSnapshotId: text('base_snapshot_id'), // hetzner base image ID used at provision
  stripeSubItemId: text('stripe_sub_item_id'),
  domains: jsonb('domains').$type<string[]>().default([]),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  lastHeartbeat: jsonb('last_heartbeat').$type<{
    cpu: number;
    memory: number;
    disk: number;
    services: Record<string, boolean>;
  }>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  readyAt: timestamp('ready_at'),
  deletedAt: timestamp('deleted_at'),
});

// ─── API Keys ───────────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(), // "sk_live_abc..." (first 12 chars for display)
  keyHash: text('key_hash').notNull(), // bcrypt hash
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
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type SSHKey = typeof sshKeys.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
