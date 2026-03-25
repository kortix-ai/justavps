/**
 * Shared Zod schemas — SINGLE SOURCE OF TRUTH.
 * Used by API routes (via @hono/zod-openapi). The OpenAPI spec is
 * auto-generated at runtime from these schemas + the createRoute() definitions.
 * No separate extract-openapi script needed.
 */

import { z } from '@hono/zod-openapi';

// ─── Machine Schemas ────────────────────────────────────────────────────────

export const CreateMachineSchema = z.object({
  image_id: z.string().optional().nullable().describe('Image or built-in template to boot from. Null = default JustAVPS base'),
  provider: z.string().min(1).default('cloud').describe('Cloud provider'),
  server_type: z.string().min(1).describe('Server type / plan identifier'),
  region: z.string().min(1).describe('Region (e.g. "eu", "us")'),
  name: z.string().min(1).max(64).optional().describe('Human-readable name'),
  env_vars: z.record(z.string(), z.string()).optional().describe('Extra environment variables written to /etc/justavps/env on the machine'),
  docker_image: z.string().optional().describe('Docker image to run on boot (e.g. "myapp:latest")'),
  entrypoint: z.string().optional().describe('Optional Docker --entrypoint override (binary/path only)'),
  command: z.string().optional().describe('Optional container command/args passed after the image name'),
  ssh_key_ids: z.array(z.string().uuid()).optional().describe('IDs of user SSH keys to add to the machine. Auto-generated key is always included.'),
  billing_interval: z.enum(['monthly', 'yearly', '2year']).optional().default('monthly').describe('Billing interval: monthly, yearly (20% off), or 2year (30% off, billed annually)'),
  enable_backups: z.boolean().optional().default(false).describe('Enable daily automatic backups (+20% of base price). Defaults to false.'),
});

export const ResizeMachineSchema = z.object({
  server_type: z.string().min(1).describe('New server type'),
});

export const CreateImageSchema = z.object({
  name: z.string().min(1).max(128).describe('Name for the image'),
});

export const MachineSSHKeySchema = z.object({
  private_key: z.string().nullable(),
  public_key: z.string().nullable(),
  setup_command: z.string().nullable(),
  key_path: z.string(),
}).nullable();

export const MachineResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['provisioning', 'ready', 'error', 'stopped', 'deleted']),
  provisioning_stage: z.string().nullable(),
  provisioning_stage_updated_at: z.string().nullable(),
  provider: z.string(),
  image_id: z.string().nullable(),
  server_type: z.string(),
  region: z.string(),
  ip: z.string().nullable(),
  provider_progress: z.number().nullable(),
  provider_status: z.string().nullable(),
  callback_expected: z.boolean().nullable(),
  callback_url: z.string().nullable(),
  price_monthly: z.number().nullable(),
  backups_enabled: z.boolean(),
  created_at: z.string(),
  ready_at: z.string().nullable(),
  urls: z.object({
    proxy: z.string(),
    terminal: z.string(),
    port_template: z.string(),
  }).nullable(),
  ssh: z.string().nullable(),
  ssh_key: MachineSSHKeySchema,
  connect: z.object({
    ssh_command: z.string().nullable(),
    setup_command: z.string().nullable(),
    vscode_url: z.string(),
    cursor_ssh: z.string().nullable(),
  }).nullable(),
  subscription: z.object({
    status: z.string(),
    cancel_at_period_end: z.boolean(),
    cancel_at: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    current_period_end: z.string().nullable(),
  }).nullable().optional(),
  health: z.object({
    cpu: z.number(),
    memory: z.number(),
    disk: z.number(),
    services: z.record(z.string(), z.boolean()),
    last_heartbeat_at: z.string().nullable(),
  }).nullable(),
});

export const MachineListResponseSchema = z.object({
  machines: z.array(MachineResponseSchema),
});

export const CheckoutRequiredSchema = z.object({
  requires_checkout: z.literal(true),
  checkout_url: z.string(),
  message: z.string(),
});

export const ActionResponseSchema = z.object({
  action: z.string(),
  status: z.string(),
});

export const ResizeResponseSchema = z.object({
  action: z.literal('resize'),
  old_type: z.string(),
  new_type: z.string(),
  status: z.string(),
});

// ─── Image Schemas ──────────────────────────────────────────────────────────

export const ImageResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['creating', 'ready', 'failed', 'deleted']),
  kind: z.enum(['template', 'snapshot']),
  is_template: z.boolean(),
  source_machine_id: z.string().nullable(),
  provider: z.string(),
  provider_image_id: z.string().nullable(),
  disk_size_gb: z.number().nullable(),
  architecture: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ImageListResponseSchema = z.object({
  images: z.array(ImageResponseSchema),
});

// ─── SSH Key Schemas ────────────────────────────────────────────────────────

export const CreateSSHKeySchema = z.object({
  name: z.string().min(1).max(128),
  public_key: z.string().min(1).describe('SSH public key (e.g. ssh-ed25519 AAAA...)'),
});

export const SSHKeyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  fingerprint: z.string(),
  created_at: z.string(),
});

export const SSHKeyListResponseSchema = z.object({
  ssh_keys: z.array(SSHKeyResponseSchema),
});

// ─── API Key Schemas ────────────────────────────────────────────────────────

export const PermissionEnum = z.enum(['*', 'read', 'write', 'delete', 'exec', 'proxy']);

export const CreateAPIKeySchema = z.object({
  name: z.string().min(1).max(128),
  scope: z.enum(['account', 'machine']).optional().default('account').describe('Key scope: account (full) or machine (restricted)'),
  machine_ids: z.array(z.string().uuid()).optional().nullable().describe('Machine UUIDs this key can access (required if scope=machine)'),
  permissions: z.array(PermissionEnum).optional().default(['*']).describe('Permissions: * (all), read, write, delete, exec, proxy'),
  expires_in_seconds: z.number().int().min(60).max(31536000).optional().nullable().describe('Expiration in seconds from now (null = never)'),
});

export const APIKeyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  key: z.string().optional().describe('Only returned on creation'),
  key_prefix: z.string(),
  scope: z.enum(['account', 'machine']),
  machine_ids: z.array(z.string()).nullable(),
  permissions: z.array(z.string()),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  last_used: z.string().nullable(),
});

export const APIKeyListResponseSchema = z.object({
  api_keys: z.array(APIKeyResponseSchema),
});

// ─── Proxy Token Schemas ────────────────────────────────────────────────────

export const CreateProxyTokenSchema = z.object({
  machine_id: z.string().uuid().describe('Machine UUID to grant access to'),
  label: z.string().max(128).optional().nullable().describe('Human-readable label'),
  ports: z.array(z.number().int().min(1).max(65535)).optional().nullable().describe('Specific ports to allow (null = all)'),
  expires_in_seconds: z.number().int().min(60).max(604800).optional().default(3600).describe('Expiration in seconds (default 1h, max 7 days)'),
});

export const ProxyTokenResponseSchema = z.object({
  id: z.string().uuid(),
  token: z.string().optional().describe('Only returned on creation'),
  token_prefix: z.string(),
  label: z.string().nullable(),
  machine_id: z.string().uuid(),
  machine_slug: z.string(),
  ports: z.array(z.number()).nullable(),
  expires_at: z.string(),
  proxy_url: z.string().optional().describe('Pre-built shareable URL (only on creation)'),
  created_at: z.string(),
});

export const ProxyTokenListResponseSchema = z.object({
  proxy_tokens: z.array(ProxyTokenResponseSchema),
});

// ─── Webhook Schemas ────────────────────────────────────────────────────────

const VALID_EVENTS = ['*', 'machine.stage_changed', 'machine.status_changed', 'machine.heartbeat'] as const;
export type ValidWebhookEvent = typeof VALID_EVENTS[number];

export const CreateWebhookSchema = z.object({
  url: z.string().url().describe('HTTPS URL to receive webhook POSTs'),
  events: z.array(z.enum(VALID_EVENTS)).min(1).describe('Event types to subscribe to'),
  secret: z.string().min(16).optional().describe('HMAC secret (auto-generated if omitted)'),
});

export const WebhookResponseSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  events: z.array(z.string()),
  secret: z.string().optional().describe('Only returned on creation'),
  active: z.boolean(),
  created_at: z.string(),
});

export const WebhookListResponseSchema = z.object({
  webhooks: z.array(WebhookResponseSchema.omit({ secret: true })),
});

// ─── Server Type Schemas ───────────────────────────────────────────────────

export const ServerTypeResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  vcpu: z.number(),
  ram_gb: z.number(),
  disk_gb: z.number(),
  cpu_type: z.enum(['shared', 'dedicated']),
  architecture: z.enum(['x86', 'arm']),
  price_monthly: z.number().describe('Base monthly price (without backups)'),
  backup_price_monthly: z.number().describe('Additional monthly cost for daily backups (+20% of base price)'),
  provider_price_monthly: z.number().describe('Raw provider price'),
  available: z.boolean(),
});

export const ServerTypeListResponseSchema = z.object({
  provider: z.string(),
  region: z.string(),
  server_types: z.array(ServerTypeResponseSchema),
});

export const ProviderSchema = z.object({
  name: z.string(),
  displayName: z.string(),
});

export const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderSchema),
});

export const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  city: z.string(),
});

export const RegionListResponseSchema = z.object({
  provider: z.string(),
  regions: z.array(RegionSchema),
});

// ─── Account Schemas ────────────────────────────────────────────────────────

export const AccountResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  machines_count: z.number(),
  stripe_customer_id: z.string().nullable(),
  has_password: z.boolean(),
  is_admin: z.boolean(),
  created_at: z.string(),
});

export const AccountUsageResponseSchema = z.object({
  current_period: z.object({
    machines: z.array(z.object({
      id: z.string().uuid(),
      slug: z.string(),
      server_type: z.string(),
      status: z.string(),
    })),
    total_machines: z.number(),
    estimated_cost: z.number(),
  }),
});

export const BillingResponseSchema = z.object({
  portal_url: z.string().nullable(),
  has_payment_method: z.boolean(),
  message: z.string().optional(),
});

export const BillingSetupResponseSchema = z.object({
  checkout_url: z.string(),
});

export const AccountPasswordSetupSchema = z.object({
  password: z.string().min(8).max(128),
});

// ─── Account Limits Schemas ─────────────────────────────────────────────────

export const AccountLimitsResponseSchema = z.object({
  limits: z.object({
    max_machines: z.number(),
    max_images: z.number(),
  }),
  usage: z.object({
    machines: z.number(),
    images: z.number(),
  }),
});

// ─── Internal Schemas ───────────────────────────────────────────────────────

export const HeartbeatSchema = z.object({
  slug: z.string(),
  machine_token: z.string(),
  daemon_version: z.string().optional(),
  uptime: z.number(),
  services: z.record(z.string(), z.boolean()),
  load: z.object({
    cpu: z.number(),
    memory: z.number(),
    disk: z.number(),
  }),
  network: z.object({
    bytes_in: z.number(),
    bytes_out: z.number(),
    rate_in: z.number(),
    rate_out: z.number(),
    connections: z.number(),
  }).optional(),
  security: z.object({
    ufw_active: z.boolean(),
    fail2ban_active: z.boolean(),
    ssh_key_only: z.boolean(),
  }).optional(),
});

export const StageReportSchema = z.object({
  slug: z.string().min(1),
  machine_token: z.string().min(1),
  stage: z.string().min(1),
  message: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AckResponseSchema = z.object({
  ack: z.boolean(),
});

export const ValidateKeyResponseSchema = z.object({
  valid: z.boolean(),
  account_id: z.string().uuid().optional(),
  scope: z.enum(['account', 'machine']).optional(),
  machine_ids: z.array(z.string()).nullable().optional(),
  permissions: z.array(z.string()).optional(),
  expires_at: z.string().nullable().optional(),
  message: z.string().optional(),
});

// ─── Toolbox: Filesystem Schemas ────────────────────────────────────────────

export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number(),
  mode: z.string().describe('Human-readable mode string, e.g. "-rw-r--r--"'),
  mode_bits: z.string().describe('Octal permission bits, e.g. "644"'),
  owner: z.string(),
  group: z.string(),
  mod_time: z.string(),
  symlink_target: z.string().nullable(),
});

export const ListFilesResponseSchema = z.object({
  entries: z.array(FileEntrySchema),
});

export const FileExistsResponseSchema = z.object({
  exists: z.boolean(),
  type: z.enum(['file', 'dir']).nullable(),
});

export const UploadFileResponseSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.literal('file'),
  size: z.number(),
});

export const BulkUploadResponseSchema = z.object({
  uploaded: z.array(z.object({ path: z.string(), size: z.number() })),
  errors: z.array(z.object({ path: z.string(), error: z.string() })),
});

export const CreateFolderResponseSchema = z.object({
  path: z.string(),
  created: z.boolean(),
});

export const DeleteFileResponseSchema = z.object({
  deleted: z.boolean(),
  path: z.string(),
});

export const MoveFileResponseSchema = z.object({
  source: z.string(),
  destination: z.string(),
});

export const FindTextMatchSchema = z.object({
  file: z.string(),
  line: z.number(),
  content: z.string(),
});

export const FindTextResponseSchema = z.object({
  matches: z.array(FindTextMatchSchema),
  truncated: z.boolean(),
  total: z.number(),
});

export const ReplaceTextRequestSchema = z.object({
  files: z.array(z.string()).min(1).describe('Absolute file paths to search'),
  pattern: z.string().min(1).describe('Regex pattern to match'),
  new_value: z.string().describe('Replacement string'),
});

export const ReplaceTextResponseSchema = z.object({
  results: z.array(z.object({
    file: z.string(),
    replacements: z.number(),
  })),
});

export const SetPermissionsRequestSchema = z.object({
  mode: z.string().optional().describe('Octal permission bits, e.g. "755"'),
  owner: z.string().optional().describe('File owner username'),
  group: z.string().optional().describe('File group name'),
});

export const SetPermissionsResponseSchema = z.object({
  path: z.string(),
  mode: z.string(),
  owner: z.string(),
  group: z.string(),
});

// ─── Toolbox: Process/Exec Schemas ──────────────────────────────────────────

export const ExecuteCommandRequestSchema = z.object({
  command: z.string().min(1).describe('Shell command to execute'),
  cwd: z.string().optional().describe('Working directory (default: /root)'),
  timeout: z.number().int().min(1).max(3600).optional().describe('Timeout in seconds (default: 60)'),
  env: z.record(z.string(), z.string()).optional().describe('Additional environment variables'),
  user: z.string().optional().describe('User to run as (default: root)'),
});

export const ExecuteCommandResponseSchema = z.object({
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number(),
});

export const CodeRunRequestSchema = z.object({
  code: z.string().min(1).describe('Code to execute'),
  language: z.enum(['python', 'python3', 'node', 'javascript', 'typescript', 'bash', 'shell', 'ruby', 'go']).optional().describe('Language (auto-detected if omitted)'),
  timeout: z.number().int().min(1).max(3600).optional().describe('Timeout in seconds (default: 30)'),
  env: z.record(z.string(), z.string()).optional().describe('Additional environment variables'),
});

export const ProcessInfoSchema = z.object({
  pid: z.number().int(),
  command: z.string(),
  args: z.string(),
  cwd: z.string().optional(),
  user: z.string().optional(),
  state: z.string().optional(),
  memory_rss_bytes: z.number().optional(),
  started_at: z.string().optional(),
});

export const ListProcessesResponseSchema = z.object({
  processes: z.array(ProcessInfoSchema),
});

export const KillProcessRequestSchema = z.object({
  pid: z.number().int().min(1).describe('Process ID to kill'),
  signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'TERM', 'KILL', 'INT', 'HUP']).optional().describe('Signal to send (default: SIGTERM)'),
});

export const KillProcessResponseSchema = z.object({
  killed: z.boolean(),
  pid: z.number().int(),
  signal: z.string(),
});

export const ToolboxErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
});

export const BulkDownloadRequestSchema = z.object({
  paths: z.array(z.string()).min(1).describe('Absolute file paths to include in the zip'),
});

// ─── Exec Schemas ──────────────────────────────────────────────────────────

export const ExecRequestSchema = z.object({
  command: z.string().min(1).max(4096).describe('Shell command to execute on the host'),
  timeout: z.number().int().min(1).max(600).optional().default(60).describe('Timeout in seconds (default 60, max 600)'),
});

export const ExecResponseSchema = z.object({
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number(),
});

// ─── Error Schema ───────────────────────────────────────────────────────────

export const ErrorResponseSchema = z.object({
  error: z.boolean().default(true),
  message: z.string(),
  status: z.number(),
});
