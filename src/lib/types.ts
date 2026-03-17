/**
 * Shared TypeScript types — single source of truth for API shapes.
 * Used by both React Query hooks and page components.
 */

// ─── Machine ─────────────────────────────────────────────────────────────────

export interface Machine {
  id: string;
  slug: string;
  name: string;
  status: string;
  provider: string;
  snapshot_id: string | null;
  server_type: string;
  region: string;
  ip: string | null;
  price_monthly: number | null;
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
    vscode_password: string;
    cursor_ssh: string | null;
  } | null;
  health: {
    cpu: number;
    memory: number;
    disk: number;
    services: Record<string, boolean>;
    last_heartbeat_at: string | null;
  } | null;
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface ProviderArtifact {
  snapshotId: string;
  diskSize: number;
  architecture: string;
}

export interface Snapshot {
  id: string;
  name: string;
  docker_image: string;
  status: string;
  architecture: string | null;
  providers: Record<string, ProviderArtifact>;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
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
  cpu_type: string;
  architecture: string;
  price_monthly: number;
  provider_price_monthly: number;
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

export interface BillingPortal {
  portal_url: string | null;
  message?: string;
}
