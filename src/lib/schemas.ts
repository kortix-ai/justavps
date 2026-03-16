/**
 * Shared Zod schemas — used by both API routes and frontend.
 */

import { z } from 'zod';

// ─── Allowed Regions ────────────────────────────────────────────────────────

export const ALLOWED_REGIONS = ['hel1', 'nbg1', 'fsn1', 'ash', 'hil'] as const;
export type Region = typeof ALLOWED_REGIONS[number];

export const REGION_LABELS: Record<Region, string> = {
  hel1: 'Helsinki, Finland',
  nbg1: 'Nuremberg, Germany',
  fsn1: 'Falkenstein, Germany',
  ash: 'Ashburn, USA (East)',
  hil: 'Hillsboro, USA (West)',
};

// ─── Allowed Server Types (CCX dedicated only) ─────────────────────────────

export const ALLOWED_SERVER_TYPES = [
  // Shared AMD (CPX) — best value
  'cpx22', 'cpx32', 'cpx42', 'cpx52', 'cpx62',
  // Dedicated (CCX) — guaranteed performance
  'ccx13', 'ccx23', 'ccx33', 'ccx43', 'ccx53', 'ccx63',
] as const;
export type ServerTypeName = typeof ALLOWED_SERVER_TYPES[number];

// ─── Machine Schemas ────────────────────────────────────────────────────────

export const CreateMachineSchema = z.object({
  server_type: z.enum(ALLOWED_SERVER_TYPES).describe('Server type (cpx22–cpx62, ccx13–ccx63)'),
  name: z.string().min(1).max(64).optional().describe('Human-readable name'),
  region: z.enum(ALLOWED_REGIONS).default('hel1').describe('Hetzner datacenter region'),
});

export const ResizeMachineSchema = z.object({
  server_type: z.enum(ALLOWED_SERVER_TYPES).describe('New server type'),
});

export const MachineResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  server_type: z.string(),
  region: z.string(),
  ip: z.string().nullable(),
  price_monthly: z.number().nullable(),
  created_at: z.string(),
  ready_at: z.string().nullable(),
  urls: z.object({
    vscode: z.string(),
    pty: z.string(),
    opencode: z.string(),
  }).nullable(),
  ssh: z.string().nullable(),
  connect: z.object({
    ssh_command: z.string().nullable(),
    setup_command: z.string().nullable(),
    vscode_url: z.string(),
    vscode_password: z.string(),
    cursor_ssh: z.string().nullable(),
    claude_code: z.string().nullable(),
    opencode: z.string(),
  }).nullable(),
  health: z.object({
    cpu: z.number(),
    memory: z.number(),
    disk: z.number(),
    services: z.record(z.boolean()),
    last_heartbeat_at: z.string().nullable(),
  }).nullable(),
});

export const MachineListResponseSchema = z.object({
  machines: z.array(MachineResponseSchema),
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

// ─── API Key Schemas ────────────────────────────────────────────────────────

export const CreateAPIKeySchema = z.object({
  name: z.string().min(1).max(128),
});

export const APIKeyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  key: z.string().optional().describe('Only returned on creation'),
  key_prefix: z.string(),
  created_at: z.string(),
  last_used: z.string().nullable(),
});

// ─── Server Type Schemas ────────────────────────────────────────────────────

export const ServerTypeResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  vcpu: z.number(),
  ram_gb: z.number(),
  disk_gb: z.number(),
  cpu_type: z.enum(['shared', 'dedicated']),
  architecture: z.enum(['x86', 'arm']),
  price_monthly: z.number().describe('Our price (Hetzner × 2.5, rounded up, +20% backups)'),
  hetzner_price_monthly: z.number().describe('Raw Hetzner price (EUR)'),
  backup_price_monthly: z.number().describe('Backup cost (20% of server price)'),
  available: z.boolean(),
});

// ─── Internal Schemas ───────────────────────────────────────────────────────

export const HeartbeatSchema = z.object({
  slug: z.string(),
  machine_token: z.string(),
  uptime: z.number(),
  services: z.record(z.boolean()),
  load: z.object({
    cpu: z.number(),
    memory: z.number(),
    disk: z.number(),
  }),
});

// ─── Error Schema ───────────────────────────────────────────────────────────

export const ErrorResponseSchema = z.object({
  error: z.boolean().default(true),
  message: z.string(),
  status: z.number(),
});
