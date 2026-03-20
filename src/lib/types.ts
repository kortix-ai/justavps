/**
 * Shared TypeScript types — single source of truth for API shapes.
 * Used by both React Query hooks and page components.
 */

// ─── Status Unions ───────────────────────────────────────────────────────────

export type MachineStatus = 'provisioning' | 'ready' | 'error' | 'stopped' | 'deleted';
export type ImageStatus = 'creating' | 'ready' | 'failed' | 'deleted';

// ─── Machine ─────────────────────────────────────────────────────────────────

export interface Machine {
  id: string;
  slug: string;
  name: string;
  status: MachineStatus;
  provisioning_stage: string | null;
  provisioning_stage_updated_at: string | null;
  provider: string;
  image_id: string | null;
  server_type: string;
  region: string;
  ip: string | null;
  price_monthly: number | null;
  backups_enabled: boolean;
  created_at: string;
  ready_at: string | null;
  urls: { vscode: string; pty: string } | null;
  ssh: string | null;
  ssh_key: {
    private_key: string | null;
    public_key: string | null;
    setup_command: string | null;
    key_path: string;
  } | null;
  connect: {
    ssh_command: string | null;
    setup_command: string | null;
    vscode_url: string;
    cursor_ssh: string | null;
  } | null;
  source: 'user' | 'kortix';
  kortix_sandbox_id: string | null;
  health: {
    cpu: number;
    memory: number;
    disk: number;
    services: Record<string, boolean>;
    last_heartbeat_at: string | null;
  } | null;
}

// ─── Image ──────────────────────────────────────────────────────────────────

export interface Image {
  id: string;
  name: string;
  description: string | null;
  status: ImageStatus;
  kind: 'template' | 'snapshot';
  is_template: boolean;
  source_machine_id: string | null;
  provider: string;
  provider_image_id: string | null;
  disk_size_gb: number | null;
  architecture: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Provider / Region / ServerType ──────────────────────────────────────────

export interface Provider {
  name: string;
  displayName: string;
}

export interface Region {
  id: string;
  name: string;
  country: string;
  city: string;
}

export interface ServerType {
  name: string;
  description: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  cpu_type: 'shared' | 'dedicated';
  architecture: string;
  price_monthly: number;
  provider_price_monthly: number;
  backup_price_monthly: number;
  available: boolean;
}

// ─── SSH Keys ────────────────────────────────────────────────────────────────

export interface SSHKey {
  id: string;
  name: string;
  fingerprint: string;
  created_at: string;
}

// ─── API Keys ────────────────────────────────────────────────────────────────

export interface APIKey {
  id: string;
  name: string;
  key?: string;
  key_prefix: string;
  created_at: string;
  last_used: string | null;
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
}

export interface CreateWebhookInput {
  url: string;
  events: string[];
  secret?: string;
}

export interface CreateWebhookResponse extends Webhook {
  secret: string;
}

// ─── Account ─────────────────────────────────────────────────────────────────

export interface AccountUsage {
  current_period: {
    machines: Array<{
      id: string;
      slug: string;
      server_type: string;
      status: string;
    }>;
    total_machines: number;
    estimated_cost: number;
  };
}

export interface AccountProfile {
  id: string;
  email: string;
  name: string | null;
  machines_count: number;
  stripe_customer_id: string | null;
  has_password: boolean;
  created_at: string;
}

export interface BillingPortal {
  portal_url: string | null;
  has_payment_method: boolean;
  message?: string;
}

/** Returned from POST /machines when a payment method is required (402) */
export interface CheckoutRequired {
  requires_checkout: true;
  checkout_url: string;
  message: string;
}

/** Returned from POST /account/billing/setup */
export interface BillingSetup {
  checkout_url: string;
}

// ─── Account Limits ─────────────────────────────────────────────────────────

export interface AccountLimits {
  limits: {
    max_machines: number;
    max_images: number;
  };
  usage: {
    machines: number;
    images: number;
  };
}
