export interface Env {
  KV: KVNamespace;
  PLATFORM_URL: string;
  PROXY_DOMAINS?: string;
  ENVIRONMENT?: string;
}

export interface ParsedHostname {
  slug: string;
  port: number;
  rewrittenPath?: string;
}

export interface MachineInfo {
  machine_id: string;
  account_id: string;
  ip?: string;
  origin_hostname?: string;
  status: string;
  server_type?: string;
  platform_url?: string;
}

export interface ProxyTokenData {
  account_id: string;
  machine_id: string;
  machine_slug: string;
  ports: number[] | null;
  expires_at: string;
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  error?: string;
  source?: 'header' | 'query' | 'cookie';
  machine?: MachineInfo;
  token?: ProxyTokenData;
  rawToken?: string;
}
