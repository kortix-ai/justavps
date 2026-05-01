export type IncusEnvelope<T> = {
  type: string;
  status: string;
  status_code: number;
  operation?: string;
  error?: string;
  metadata: T;
};

export type IncusServer = {
  environment?: {
    certificate?: string;
    server_name?: string;
    server_clustered?: boolean;
    server_version?: string;
  };
};

export type IncusClusterMember = {
  server_name: string;
  url: string;
  status: string;
  message?: string;
  roles?: string[];
};

export type IncusImage = {
  fingerprint: string;
  filename?: string;
  size?: number;
  architecture?: string;
  type?: string;
  public?: boolean;
  aliases?: Array<{ name: string; description?: string }>;
  properties?: Record<string, string>;
  uploaded_at?: string;
};

export type IncusInstance = {
  name: string;
  type: 'container' | 'virtual-machine';
  status: string;
  status_code?: number;
  location?: string;
  architecture?: string;
  config?: Record<string, string>;
  devices?: Record<string, Record<string, string>>;
  created_at?: string;
};

export type IncusInstanceState = {
  status?: string;
  status_code?: number;
  disk?: Record<string, unknown>;
  memory?: Record<string, unknown>;
  network?: Record<string, {
    addresses?: Array<{
      family?: string;
      address?: string;
      netmask?: string;
      scope?: string;
    }>;
    counters?: Record<string, unknown>;
    hwaddr?: string;
    host_name?: string;
    mtu?: number;
    state?: string;
    type?: string;
  }>;
  pid?: number;
  processes?: number;
};

export type IncusOperation = {
  id: string;
  class: string;
  description: string;
  status: string;
  status_code: number;
  err?: string;
  created_at?: string;
  updated_at?: string;
};

export type IncusSnapshot = {
  name: string;
  created_at?: string;
  expires_at?: string;
  stateful?: boolean;
  size?: number;
  config?: Record<string, string>;
  devices?: Record<string, Record<string, string>>;
};

export type IncusBackup = {
  name: string;
  created_at?: string;
  expires_at?: string;
  instance_only?: boolean;
  optimized_storage?: boolean;
  size?: number;
};
