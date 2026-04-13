/**
 * Drizzle ORM schema — Postgres via Neon.
 * This is the source of truth for the database structure.
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, pgEnum, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accountTypeEnum = pgEnum('account_type', ['personal', 'organization']);
export const accountRoleEnum = pgEnum('account_role', ['owner', 'admin', 'member']);
export const machineTelemetrySeriesEnum = pgEnum('machine_telemetry_series', [
  'heartbeat',
  'security_tamper',
  'network_anomaly',
  'watchdog_alert',
]);
export const machineTelemetryRetentionClassEnum = pgEnum('machine_telemetry_retention_class', [
  'heartbeat_minute_7d',
  'alert_30d',
]);
export const cellAdmissionStateEnum = pgEnum('cell_admission_state', ['open', 'restricted', 'closed']);
export const cellSellabilityStateEnum = pgEnum('cell_sellability_state', ['sellable', 'reserve_only', 'unsellable']);
export const machinePortProtocolEnum = pgEnum('machine_port_protocol', ['ssh', 'http']);
export const machineModeEnum = pgEnum('machine_mode', ['vm', 'container']);
export const machineImageSourceKindEnum = pgEnum('machine_image_source_kind', ['golden', 'catalog', 'docker']);
export const machineReadyViaEnum = pgEnum('machine_ready_via', ['heartbeat', 'probe']);
export const machineBenchmarkScenarioEnum = pgEnum('machine_benchmark_scenario', [
  'cold_create',
  'warm_pool_start',
  'snapshot_restore',
  'user_image_cold_create',
  'stop_start',
]);

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash'), // bcrypt hash — null for legacy/OAuth users
  githubId: text('github_id').unique(),
  name: text('name'),
  stripeCustomerId: text('stripe_customer_id'),
  defaultAccountId: uuid('default_account_id'),
  isAdmin: boolean('is_admin').default(false).notNull(),
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
}, (table) => ({
  accountStatusCreatedIdx: index('images_account_status_created_idx').on(table.accountId, table.status, table.createdAt.desc()),
}));

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
  machineMode: machineModeEnum('machine_mode').notNull().default('vm'),
  requestedImageKind: machineImageSourceKindEnum('requested_image_kind').default('golden'),
  requestedImageRef: text('requested_image_ref'),
  imageId: uuid('image_id'), // nullable, no FK
  serverType: text('server_type').notNull(), // V1: plan id; V2: 'custom'
  region: text('region').notNull(),
  baremetalHostId: uuid('baremetal_host_id').references(() => baremetalHosts.id, { onDelete: 'set null' }),
  vcpu: integer('vcpu'),        // V2: actual allocated vCPU count
  ramGb: integer('ram_gb'),     // V2: actual allocated RAM in GB
  diskGb: integer('disk_gb'),   // V2: actual allocated disk in GB
  ip: text('ip'),
  publicIpv4: text('public_ipv4'),
  publicIpv6: text('public_ipv6'),
  sshPort: integer('ssh_port'),
  httpPort: integer('http_port'),
  readyVia: machineReadyViaEnum('ready_via'),
  providerProgress: integer('provider_progress'),
  providerStatus: text('provider_status'),
  createActionId: text('create_action_id'),
  callbackExpected: boolean('callback_expected'),
  callbackUrl: text('callback_url'),
  lastCallbackAt: text('last_callback_at'),
  lastProbeAt: text('last_probe_at'),
  daemonReachableAt: text('daemon_reachable_at'),

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
}, (table) => ({
  accountDeletedCreatedIdx: index('machines_account_deleted_created_idx').on(table.accountId, table.deletedAt, table.createdAt.desc()),
  statusDeletedIdx: index('machines_status_deleted_idx').on(table.status, table.deletedAt),
  providerRegionStatusDeletedIdx: index('machines_provider_region_status_deleted_idx').on(table.provider, table.region, table.status, table.deletedAt),
  baremetalHostStatusDeletedIdx: index('machines_baremetal_host_status_deleted_idx').on(table.baremetalHostId, table.status, table.deletedAt),
  providerServerIdIdx: index('machines_provider_server_id_idx').on(table.providerServerId),
  lastHeartbeatAtIdx: index('machines_last_heartbeat_at_idx').on(table.lastHeartbeatAt),
}));

export const machineHeartbeatStates = pgTable('machine_heartbeat_states', {
  machineId: uuid('machine_id').primaryKey().references(() => machines.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id),
  daemonVersion: text('daemon_version'),
  lastHeartbeatAt: timestamp('last_heartbeat_at').notNull(),
  lastProjectedAt: timestamp('last_projected_at'),
  heartbeatCount: integer('heartbeat_count').notNull().default(0),
  lastReadyAt: timestamp('last_ready_at'),
  uptimeSec: integer('uptime_sec'),
  services: jsonb('services').$type<Record<string, boolean>>().notNull().default({}),
  load: jsonb('load').$type<{
    cpu: number;
    memory: number;
    disk: number;
  }>().notNull().default({ cpu: 0, memory: 0, disk: 0 }),
  network: jsonb('network').$type<{
    bytes_in: number;
    bytes_out: number;
    rate_in: number;
    rate_out: number;
    connections: number;
  }>(),
  security: jsonb('security').$type<{
    ufw_active: boolean;
    fail2ban_active: boolean;
    ssh_key_only: boolean;
  }>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  accountHeartbeatIdx: index('machine_heartbeat_states_account_heartbeat_idx').on(table.accountId, table.lastHeartbeatAt.desc()),
  projectedHeartbeatIdx: index('machine_heartbeat_states_projected_heartbeat_idx').on(table.lastProjectedAt, table.lastHeartbeatAt.desc()),
}));

/**
 * Retained telemetry history is bucketed separately from the hot heartbeat
 * summary so OLTP rows are no longer the forever-home for high-volume machine
 * metrics and anomaly events.
 */
export const machineTelemetryRollups = pgTable('machine_telemetry_rollups', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  series: machineTelemetrySeriesEnum('series').notNull(),
  retentionClass: machineTelemetryRetentionClassEnum('retention_class').notNull(),
  bucketStart: timestamp('bucket_start').notNull(),
  bucketResolutionSec: integer('bucket_resolution_sec').notNull().default(60),
  firstObservedAt: timestamp('first_observed_at').notNull(),
  lastObservedAt: timestamp('last_observed_at').notNull(),
  sampleCount: integer('sample_count').notNull().default(1),
  lastPayload: jsonb('last_payload').$type<Record<string, unknown>>().notNull().default({}),
  retentionUntil: timestamp('retention_until').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  machineSeriesBucketUidx: uniqueIndex('machine_telemetry_rollups_machine_series_bucket_uidx').on(
    table.machineId,
    table.series,
    table.bucketStart,
    table.bucketResolutionSec,
  ),
  retentionIdx: index('machine_telemetry_rollups_retention_idx').on(table.retentionUntil, table.series),
  accountSeriesBucketIdx: index('machine_telemetry_rollups_account_series_bucket_idx').on(
    table.accountId,
    table.series,
    table.bucketStart.desc(),
  ),
}));

// ─── Bare-metal fleet ────────────────────────────────────────────────────────

export const cells = pgTable('cells', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  region: text('region').notNull(),
  hostClass: text('host_class').notNull(),
  generation: text('generation').notNull().default('gen1'),
  status: text('status').notNull().default('active'), // active | constrained | disabled
  reservePolicy: jsonb('reserve_policy').$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  regionHostClassGenerationUidx: uniqueIndex('cells_region_host_class_generation_uidx').on(table.region, table.hostClass, table.generation),
  statusRegionIdx: index('cells_status_region_idx').on(table.status, table.region, table.updatedAt),
}));

export const cellAdmissionControls = pgTable('cell_admission_controls', {
  cellId: uuid('cell_id').primaryKey().references(() => cells.id, { onDelete: 'cascade' }),
  admissionState: cellAdmissionStateEnum('admission_state').notNull().default('open'),
  sellabilityState: cellSellabilityStateEnum('sellability_state').notNull().default('sellable'),
  reason: text('reason'),
  source: text('source').notNull().default('manual'),
  setAt: timestamp('set_at').defaultNow().notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  admissionStateIdx: index('cell_admission_controls_state_idx').on(table.admissionState, table.updatedAt),
  sellabilityStateIdx: index('cell_admission_controls_sellability_idx').on(table.sellabilityState, table.updatedAt),
}));

export const baremetalHosts = pgTable('baremetal_hosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  vendor: text('vendor').notNull().default('hetzner_robot'),
  hostClass: text('host_class').notNull(),
  generation: text('generation').notNull().default('gen1'),
  region: text('region').notNull(),
  location: text('location').notNull(),
  cellId: uuid('cell_id').references(() => cells.id, { onDelete: 'set null' }),
  name: text('name').notNull().unique(),
  status: text('status').notNull().default('requested'), // requested | ordering | bootstrapping | active | draining | disabled | error | deleted
  providerServerNumber: text('provider_server_number').unique(),
  providerTransactionId: text('provider_transaction_id'),
  publicIpv4: text('public_ipv4'),
  publicIpv6: text('public_ipv6'),
  runnerBaseUrl: text('runner_base_url'),
  runnerToken: text('runner_token'),
  totalVcpu: integer('total_vcpu'),
  totalMemoryGb: integer('total_memory_gb'),
  totalDiskGb: integer('total_disk_gb'),
  usedVcpu: integer('used_vcpu').notNull().default(0),
  usedMemoryGb: integer('used_memory_gb').notNull().default(0),
  usedDiskGb: integer('used_disk_gb').notNull().default(0),
  maintenanceState: text('maintenance_state').notNull().default('in_service'), // in_service | drain_requested | draining | drained | maintenance
  maintenanceRequestedAt: timestamp('maintenance_requested_at'),
  maintenanceStartedAt: timestamp('maintenance_started_at'),
  maintenanceCompletedAt: timestamp('maintenance_completed_at'),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  regionStatusHostClassIdx: index('baremetal_hosts_region_status_host_class_idx').on(table.region, table.status, table.hostClass),
  statusUpdatedAtIdx: index('baremetal_hosts_status_updated_at_idx').on(table.status, table.updatedAt),
  maintenanceStateUpdatedAtIdx: index('baremetal_hosts_maintenance_state_updated_idx').on(table.maintenanceState, table.updatedAt),
  cellStatusIdx: index('baremetal_hosts_cell_status_idx').on(table.cellId, table.status, table.updatedAt),
}));

export const machineBenchmarks = pgTable('machine_benchmarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  baremetalHostId: uuid('baremetal_host_id').references(() => baremetalHosts.id, { onDelete: 'set null' }),
  machineMode: machineModeEnum('machine_mode').notNull(),
  scenario: machineBenchmarkScenarioEnum('machine_benchmark_scenario').notNull(),
  success: boolean('success').notNull().default(true),
  totalMs: integer('total_ms'),
  stageTimings: jsonb('stage_timings').$type<Record<string, number>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  machineCreatedIdx: index('machine_benchmarks_machine_created_idx').on(table.machineId, table.createdAt.desc()),
  accountCreatedIdx: index('machine_benchmarks_account_created_idx').on(table.accountId, table.createdAt.desc()),
  modeScenarioCreatedIdx: index('machine_benchmarks_mode_scenario_created_idx').on(table.machineMode, table.scenario, table.createdAt.desc()),
}));

export const hostCapacityReservations = pgTable('host_capacity_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id').references(() => baremetalHosts.id, { onDelete: 'cascade' }).notNull(),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }).notNull(),
  reservationType: text('reservation_type').notNull().default('machine_create'),
  state: text('state').notNull().default('reserved'), // reserved | committed | released | expired
  vcpu: integer('vcpu').notNull(),
  memoryGb: integer('memory_gb').notNull(),
  diskGb: integer('disk_gb').notNull(),
  expiresAt: timestamp('expires_at'),
  committedAt: timestamp('committed_at'),
  releasedAt: timestamp('released_at'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  hostStateExpiresIdx: index('host_capacity_reservations_host_state_expires_idx').on(table.hostId, table.state, table.expiresAt),
  machineTypeUidx: uniqueIndex('host_capacity_reservations_machine_type_uidx').on(table.machineId, table.reservationType),
  stateExpiresIdx: index('host_capacity_reservations_state_expires_idx').on(table.state, table.expiresAt),
}));

export const baremetalHostImages = pgTable('baremetal_host_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostId: uuid('host_id').references(() => baremetalHosts.id, { onDelete: 'cascade' }).notNull(),
  imageId: uuid('image_id').references(() => images.id, { onDelete: 'set null' }),
  imageAlias: text('image_alias'),
  imageRef: text('image_ref').notNull(),
  availabilityState: text('availability_state').notNull().default('unknown'), // local | warming | remote | unknown | error
  source: text('source').notNull().default('unknown'),
  lastSeenAt: timestamp('last_seen_at'),
  lastRequestedAt: timestamp('last_requested_at'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  hostImageRefUidx: uniqueIndex('baremetal_host_images_host_image_ref_uidx').on(table.hostId, table.imageRef),
  imageRefStateIdx: index('baremetal_host_images_image_ref_state_idx').on(table.imageRef, table.availabilityState),
  hostStateIdx: index('baremetal_host_images_host_state_idx').on(table.hostId, table.availabilityState),
}));

export const machineRoutingStates = pgTable('machine_routing_states', {
  machineId: uuid('machine_id').primaryKey().references(() => machines.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id),
  machineSlug: text('machine_slug').notNull().unique(),
  desiredState: text('desired_state').notNull().default('absent'), // present | absent
  machineStatus: text('machine_status').notNull().default('provisioning'),
  desiredIp: text('desired_ip'),
  desiredOriginPort: integer('desired_origin_port'),
  desiredOriginHostname: text('desired_origin_hostname'),
  kvState: text('kv_state').notNull().default('pending'), // pending | synced | absent | error
  dnsState: text('dns_state').notNull().default('pending'), // pending | synced | absent | error
  version: integer('version').notNull().default(1),
  lastAppliedAt: timestamp('last_applied_at'),
  lastKvSyncedAt: timestamp('last_kv_synced_at'),
  lastDnsSyncedAt: timestamp('last_dns_synced_at'),
  lastRepairAt: timestamp('last_repair_at'),
  lastError: text('last_error'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  desiredStateIdx: index('machine_routing_states_desired_state_idx').on(table.desiredState, table.updatedAt),
  repairIdx: index('machine_routing_states_repair_idx').on(table.kvState, table.dnsState, table.updatedAt),
}));

export const machinePortAllocations = pgTable('machine_port_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }).notNull(),
  hostId: uuid('host_id').references(() => baremetalHosts.id, { onDelete: 'cascade' }).notNull(),
  protocol: machinePortProtocolEnum('protocol').notNull(),
  publicPort: integer('public_port').notNull(),
  targetPort: integer('target_port').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  hostProtocolPortUidx: uniqueIndex('machine_port_allocations_host_protocol_port_uidx').on(table.hostId, table.protocol, table.publicPort),
  machineProtocolUidx: uniqueIndex('machine_port_allocations_machine_protocol_uidx').on(table.machineId, table.protocol),
  hostProtocolIdx: index('machine_port_allocations_host_protocol_idx').on(table.hostId, table.protocol, table.updatedAt),
}));

export const controlPlaneServiceStates = pgTable('control_plane_service_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  service: text('service').notNull(),
  scope: text('scope').notNull().default('global'),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at'),
  lastStartedAt: timestamp('last_started_at'),
  lastCompletedAt: timestamp('last_completed_at'),
  checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  serviceScopeUidx: uniqueIndex('control_plane_service_states_service_scope_uidx').on(table.service, table.scope),
  serviceLeaseIdx: index('control_plane_service_states_service_lease_idx').on(table.service, table.leaseExpiresAt),
  completedAtIdx: index('control_plane_service_states_completed_at_idx').on(table.lastCompletedAt, table.updatedAt),
}));

export const cellCapacitySnapshots = pgTable('cell_capacity_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  cellId: uuid('cell_id').references(() => cells.id, { onDelete: 'set null' }),
  cellSlug: text('cell_slug').notNull(),
  region: text('region').notNull(),
  hostClass: text('host_class').notNull(),
  generation: text('generation').notNull(),
  admissionState: cellAdmissionStateEnum('admission_state').notNull(),
  sellabilityState: cellSellabilityStateEnum('sellability_state').notNull(),
  hostCount: integer('host_count').notNull(),
  activeHostCount: integer('active_host_count').notNull(),
  activeSchedulableHostCount: integer('active_schedulable_host_count').notNull().default(0),
  constrainedHostCount: integer('constrained_host_count').notNull(),
  totalVcpu: integer('total_vcpu').notNull(),
  totalMemoryGb: integer('total_memory_gb').notNull(),
  totalDiskGb: integer('total_disk_gb').notNull(),
  usedVcpu: integer('used_vcpu').notNull(),
  usedMemoryGb: integer('used_memory_gb').notNull(),
  usedDiskGb: integer('used_disk_gb').notNull(),
  reservedVcpu: integer('reserved_vcpu').notNull(),
  reservedMemoryGb: integer('reserved_memory_gb').notNull(),
  reservedDiskGb: integer('reserved_disk_gb').notNull(),
  reserveBudgetVcpu: integer('reserve_budget_vcpu').notNull(),
  reserveBudgetMemoryGb: integer('reserve_budget_memory_gb').notNull(),
  reserveBudgetDiskGb: integer('reserve_budget_disk_gb').notNull(),
  availableVcpu: integer('available_vcpu').notNull(),
  availableMemoryGb: integer('available_memory_gb').notNull(),
  availableDiskGb: integer('available_disk_gb').notNull(),
  sellableVcpu: integer('sellable_vcpu').notNull(),
  sellableMemoryGb: integer('sellable_memory_gb').notNull(),
  sellableDiskGb: integer('sellable_disk_gb').notNull(),
  utilizationScore: integer('utilization_score_basis_points').notNull(),
  snapshotWindowStart: timestamp('snapshot_window_start').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  cellWindowUidx: uniqueIndex('cell_capacity_snapshots_cell_window_uidx').on(table.cellSlug, table.snapshotWindowStart),
  cellObservedIdx: index('cell_capacity_snapshots_cell_observed_idx').on(table.cellId, table.snapshotWindowStart.desc()),
  observedIdx: index('cell_capacity_snapshots_observed_idx').on(table.snapshotWindowStart.desc(), table.region, table.hostClass),
}));

export const baremetalProcurements = pgTable('baremetal_procurements', {
  id: uuid('id').primaryKey().defaultRandom(),
  vendor: text('vendor').notNull().default('hetzner_robot'),
  hostClass: text('host_class').notNull(),
  generation: text('generation').notNull().default('gen1'),
  targetCellId: uuid('target_cell_id').references(() => cells.id, { onDelete: 'set null' }),
  procurementPurpose: text('procurement_purpose').notNull().default('capacity_growth'), // capacity_growth | reserve_replenishment | bootstrap | specialization
  productId: text('product_id').notNull(),
  region: text('region').notNull(),
  location: text('location').notNull(),
  status: text('status').notNull().default('requested'), // requested | approved | ordering | bootstrapping | active | failed | cancelled
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id).notNull(),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
  hostId: uuid('host_id').references(() => baremetalHosts.id),
  providerTransactionId: text('provider_transaction_id'),
  requiresApproval: boolean('requires_approval').notNull().default(true),
  error: text('error'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  approvedAt: timestamp('approved_at'),
  orderedAt: timestamp('ordered_at'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const backupArtifacts = pgTable('backup_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
  imageId: uuid('image_id').references(() => images.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  artifactType: text('artifact_type').notNull(),
  backupKind: text('backup_kind').notNull().default('user_snapshot'), // user_snapshot | operator_dr_export
  inventoryScope: text('inventory_scope').notNull().default('customer'), // customer | operator
  storageScope: text('storage_scope').notNull().default('host_local'), // host_local | remote_object_storage
  displayName: text('display_name'),
  provider: text('provider').notNull(),
  providerArtifactId: text('provider_artifact_id'),
  sourceMachineSlug: text('source_machine_slug'),
  storageUrl: text('storage_url'),
  sizeBytes: integer('size_bytes'),
  checksum: text('checksum'),
  retentionUntil: timestamp('retention_until'),
  status: text('status').notNull().default('creating'), // creating | ready | failed | deleted
  sourceHostId: uuid('source_host_id').references(() => baremetalHosts.id, { onDelete: 'set null' }),
  lastVerifiedAt: timestamp('last_verified_at'),
  restoreCount: integer('restore_count').notNull().default(0),
  lastRestoreAt: timestamp('last_restore_at'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  machineCreatedIdx: index('backup_artifacts_machine_created_idx').on(table.machineId, table.createdAt.desc()),
  statusCreatedIdx: index('backup_artifacts_status_created_idx').on(table.status, table.createdAt.desc()),
  providerArtifactIdx: uniqueIndex('backup_artifacts_provider_artifact_uidx').on(table.provider, table.providerArtifactId),
  sourceHostCreatedIdx: index('backup_artifacts_source_host_created_idx').on(table.sourceHostId, table.createdAt.desc()),
  accountScopeStatusCreatedIdx: index('backup_artifacts_account_scope_status_created_idx').on(table.accountId, table.inventoryScope, table.status, table.createdAt.desc()),
  backupKindCreatedIdx: index('backup_artifacts_kind_created_idx').on(table.backupKind, table.createdAt.desc()),
}));

export const restoreExecutions = pgTable('restore_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  artifactId: uuid('artifact_id').references(() => backupArtifacts.id, { onDelete: 'cascade' }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
  sourceHostId: uuid('source_host_id').references(() => baremetalHosts.id, { onDelete: 'set null' }),
  targetHostId: uuid('target_host_id').references(() => baremetalHosts.id, { onDelete: 'set null' }),
  executionType: text('execution_type').notNull().default('snapshot_restore'),
  triggerSource: text('trigger_source').notNull().default('user_request'), // user_request | operator_drill | system_recovery
  status: text('status').notNull().default('running'), // running | succeeded | failed
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  result: jsonb('result').$type<Record<string, unknown>>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  artifactCreatedIdx: index('restore_executions_artifact_created_idx').on(table.artifactId, table.createdAt.desc()),
  statusCreatedIdx: index('restore_executions_status_created_idx').on(table.status, table.createdAt.desc()),
  machineCreatedIdx: index('restore_executions_machine_created_idx').on(table.machineId, table.createdAt.desc()),
  accountStatusCreatedIdx: index('restore_executions_account_status_created_idx').on(table.accountId, table.status, table.createdAt.desc()),
  targetHostCreatedIdx: index('restore_executions_target_host_created_idx').on(table.targetHostId, table.createdAt.desc()),
}));

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

// ─── Machine lifecycle events (SSE / status stream hot path) ───────────────

export const machineEvents = pgTable('machine_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  event: text('event').notNull(), // stage_changed | status_changed
  stage: text('stage'), // provisioning stage name
  message: text('message'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  machineCreatedIdx: index('machine_events_machine_created_idx').on(table.machineId, table.createdAt.desc()),
  accountCreatedIdx: index('machine_events_account_created_idx').on(table.accountId, table.createdAt.desc()),
}));

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
}, (table) => ({
  accountActiveIdx: index('webhooks_account_active_idx').on(table.accountId, table.active),
}));

// ─── Control-plane jobs ──────────────────────────────────────────────────────

export const controlPlaneJobs = pgTable('control_plane_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobType: text('job_type').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  status: text('status').notNull().default('queued'),
  priority: integer('priority').notNull().default(100),
  attempt: integer('attempt').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at'),
  runAfter: timestamp('run_after').defaultNow().notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  error: text('error'),
  lastAttemptAt: timestamp('last_attempt_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  typeRunAfterIdx: index('control_plane_jobs_type_run_after_idx').on(table.jobType, table.status, table.runAfter),
  statusRunAfterIdx: index('control_plane_jobs_status_run_after_idx').on(table.status, table.runAfter),
  subjectIdx: index('control_plane_jobs_subject_idx').on(table.subjectType, table.subjectId),
  jobTypeIdempotencyKeyUidx: uniqueIndex('control_plane_jobs_type_idempotency_uidx').on(table.jobType, table.idempotencyKey),
}));

// ─── Webhook Deliveries ─────────────────────────────────────────────────────

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').references(() => webhooks.id, { onDelete: 'cascade' }).notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  payloadVersion: integer('payload_version').notNull().default(1),
  status: text('status').notNull().default('queued'),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  durationMs: integer('duration_ms'),
  attempt: integer('attempt').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at'),
  lastAttemptAt: timestamp('last_attempt_at'),
  success: boolean('success').notNull().default(false),
  error: text('error'),
  deliveredAt: timestamp('delivered_at'),
  deadLetteredAt: timestamp('dead_lettered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  webhookCreatedIdx: index('webhook_deliveries_webhook_created_idx').on(table.webhookId, table.createdAt.desc()),
  statusNextAttemptIdx: index('webhook_deliveries_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
}));

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
export type MachineHeartbeatStateRow = typeof machineHeartbeatStates.$inferSelect;
export type NewMachineHeartbeatState = typeof machineHeartbeatStates.$inferInsert;
export type MachineTelemetryRollupRow = typeof machineTelemetryRollups.$inferSelect;
export type NewMachineTelemetryRollup = typeof machineTelemetryRollups.$inferInsert;
export type CellRow = typeof cells.$inferSelect;
export type NewCell = typeof cells.$inferInsert;
export type CellAdmissionControlRow = typeof cellAdmissionControls.$inferSelect;
export type NewCellAdmissionControl = typeof cellAdmissionControls.$inferInsert;
export type BaremetalHost = typeof baremetalHosts.$inferSelect;
export type NewBaremetalHost = typeof baremetalHosts.$inferInsert;
export type HostCapacityReservationRow = typeof hostCapacityReservations.$inferSelect;
export type NewHostCapacityReservation = typeof hostCapacityReservations.$inferInsert;
export type BaremetalHostImageRow = typeof baremetalHostImages.$inferSelect;
export type NewBaremetalHostImage = typeof baremetalHostImages.$inferInsert;
export type BaremetalProcurement = typeof baremetalProcurements.$inferSelect;
export type NewBaremetalProcurement = typeof baremetalProcurements.$inferInsert;
export type MachineRoutingStateRow = typeof machineRoutingStates.$inferSelect;
export type NewMachineRoutingState = typeof machineRoutingStates.$inferInsert;
export type ControlPlaneServiceStateRow = typeof controlPlaneServiceStates.$inferSelect;
export type NewControlPlaneServiceState = typeof controlPlaneServiceStates.$inferInsert;
export type BackupArtifactRow = typeof backupArtifacts.$inferSelect;
export type NewBackupArtifact = typeof backupArtifacts.$inferInsert;
export type RestoreExecutionRow = typeof restoreExecutions.$inferSelect;
export type NewRestoreExecution = typeof restoreExecutions.$inferInsert;
export type SSHKey = typeof sshKeys.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ProxyTokenRow = typeof proxyTokens.$inferSelect;
export type NewProxyToken = typeof proxyTokens.$inferInsert;
export type MachineEventRow = typeof machineEvents.$inferSelect;
export type WebhookRow = typeof webhooks.$inferSelect;
export type ControlPlaneJobRow = typeof controlPlaneJobs.$inferSelect;
export type NewControlPlaneJob = typeof controlPlaneJobs.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type AccountLimitRow = typeof accountLimits.$inferSelect;
export type NewAccountLimit = typeof accountLimits.$inferInsert;
export type KortixLink = typeof kortixLinks.$inferSelect;
export type NewKortixLink = typeof kortixLinks.$inferInsert;
