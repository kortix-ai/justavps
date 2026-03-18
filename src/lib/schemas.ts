/**
 * Shared Zod schemas — used by both API routes and frontend.
 * Provider-agnostic: regions and server types come from the API at runtime.
 */

import { z } from 'zod';

// ─── Machine Schemas ────────────────────────────────────────────────────────

export const CreateMachineSchema = z.object({
  image_id: z.string().uuid().optional().nullable().describe('Image to boot from. Null = Ubuntu 24.04'),
  provider: z.string().min(1).describe('Cloud provider (e.g. "hetzner")'),
  server_type: z.string().min(1).describe('Provider-specific server type (e.g. "cpx22", "t3.medium")'),
  region: z.string().min(1).describe('Provider-specific region (e.g. "nbg1", "us-east-1")'),
  name: z.string().min(1).max(64).optional().describe('Human-readable name'),
  docker_image: z.string().optional(),
  entrypoint: z.string().optional(),
});

export const ResizeMachineSchema = z.object({
  server_type: z.string().min(1).describe('New server type'),
});

export const MachineResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  provider: z.string(),
  image_id: z.string().uuid().nullable(),
  server_type: z.string(),
  region: z.string(),
  ip: z.string().nullable(),
  price_monthly: z.number().nullable(),
  created_at: z.string(),
  ready_at: z.string().nullable(),
  urls: z.object({
    vscode: z.string(),
    pty: z.string(),
  }).nullable(),
  ssh: z.string().nullable(),
  connect: z.object({
    ssh_command: z.string().nullable(),
    setup_command: z.string().nullable(),
    vscode_url: z.string(),
    vscode_password: z.string(),
    cursor_ssh: z.string().nullable(),
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

// ─── Server Type Schema (runtime, from provider) ───────────────────────────

export const ServerTypeResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  vcpu: z.number(),
  ram_gb: z.number(),
  disk_gb: z.number(),
  cpu_type: z.enum(['shared', 'dedicated']),
  architecture: z.enum(['x86', 'arm']),
  price_monthly: z.number().describe('Our price after markup'),
  provider_price_monthly: z.number().describe('Raw provider price'),
  available: z.boolean(),
});

// ─── Provider Schemas ──────────────────────────────────────────────────────

export const ProviderSchema = z.object({
  name: z.string(),
  displayName: z.string(),
});

export const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  city: z.string(),
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
