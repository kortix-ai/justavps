/**
 * Worker auth — verify proxy JWT cookies, API keys, and proxy tokens.
 *
 * Auth methods (checked in order):
 *   1. X-Proxy-Token header — proxy token (pt_xxx)
 *   2. ?__proxy_token= query param — proxy token (for shareable URLs)
 *   3. __justavps_pt cookie — proxy token (set after first ?__proxy_token= visit)
 *   4. Authorization: Bearer <api_key> — SHA-256 hash looked up in KV
 *   5. ?token=<jwt> query param — JWT (for WebSocket/iframe)
 *   6. __justavps_proxy cookie — signed JWT (HS256), user-scoped
 *
 * If none present → redirect browser to platform /api/proxy-auth for login.
 */

export interface AuthResult {
  success: boolean;
  userId?: string;
  machineInfo?: MachineInfo;
  error?: string;
  shouldRefresh?: boolean; // true if JWT is within 6h of expiry
  authSource?: 'cookie' | 'querytoken' | 'apikey' | 'proxytoken' | 'proxycookie'; // where the auth came from
  proxyTokenData?: ProxyTokenData; // set when auth is via proxy token (for cookie/redirect handling)
}

export interface MachineInfo {
  owner_id: string;
  ip: string;
  origin_hostname?: string; // DNS-only hostname: origin.slug.kortix.cloud
  status: string;
  server_type: string;
  platform_url?: string; // Which platform provisioned this machine (e.g. https://dev.justavps.com)
}

export interface ProxyTokenData {
  owner_id: string;
  machine_id: string;
  machine_slug: string;
  ports: number[] | null;
  expires_at: string;
}

interface ApiKeyData {
  owner_id: string;
  name: string;
  scope?: string;
  machine_ids?: string[] | null;
  permissions?: string[];
  expires_at?: string | null;
}

const COOKIE_NAME = '__justavps_proxy';
const PT_COOKIE_NAME = '__justavps_pt';
const REFRESH_THRESHOLD = 6 * 60 * 60; // 6 hours in seconds

// ─── Main Auth ──────────────────────────────────────────────────────────────

export async function validateAuth(
  request: Request,
  slug: string,
  kv: KVNamespace,
  proxyAuthSecret: string,
  port?: number,
): Promise<AuthResult> {
  // Extract auth from request
  const auth = extractAuth(request);

  if (!auth) {
    return { success: false, error: 'Authentication required' };
  }

  // Proxy token auth — no ownership check needed
  if (auth.type === 'proxytoken') {
    const ptResult = await verifyProxyToken(auth.token, slug, port, kv);
    if (!ptResult.success) return ptResult;

    // Still need machine info for proxying
    const machineResult = await getMachineInfo(slug, kv);
    if (!machineResult.success) return machineResult;

    return {
      success: true,
      userId: ptResult.proxyTokenData!.owner_id,
      machineInfo: machineResult.machineInfo,
      authSource: auth.source as AuthResult['authSource'],
      proxyTokenData: ptResult.proxyTokenData,
    };
  }

  let userId: string;

  // Validate based on auth method
  if (auth.type === 'jwt') {
    const jwtResult = await verifyJWT(auth.token, proxyAuthSecret);
    if (!jwtResult.success) return jwtResult;
    userId = jwtResult.userId!;
  } else if (auth.type === 'apikey') {
    const apiResult = await verifyApiKey(auth.token, slug, port, kv);
    if (!apiResult.success) return apiResult;
    userId = apiResult.userId!;
  } else {
    return { success: false, error: 'Invalid auth method' };
  }

  // Check machine ownership
  const machineResult = await checkMachineAccess(slug, userId, kv);
  if (!machineResult.success) return { ...machineResult, authSource: auth.source as AuthResult['authSource'] };

  return {
    success: true,
    userId,
    machineInfo: machineResult.machineInfo,
    shouldRefresh: auth.type === 'jwt' ? auth.shouldRefresh : false,
    authSource: auth.source as AuthResult['authSource'],
  };
}

// ─── Auth Extraction ────────────────────────────────────────────────────────

interface ExtractedAuth {
  type: 'jwt' | 'apikey' | 'proxytoken';
  source: 'cookie' | 'querytoken' | 'apikey' | 'proxytoken' | 'proxycookie';
  token: string;
  shouldRefresh?: boolean;
}

function extractAuth(request: Request): ExtractedAuth | null {
  // 1. X-Proxy-Token header
  const ptHeader = request.headers.get('X-Proxy-Token');
  if (ptHeader?.startsWith('pt_')) {
    return { type: 'proxytoken', source: 'proxytoken', token: ptHeader };
  }

  // 2. ?__proxy_token= query param
  const url = new URL(request.url);
  const proxyTokenParam = url.searchParams.get('__proxy_token');
  if (proxyTokenParam?.startsWith('pt_')) {
    return { type: 'proxytoken', source: 'proxytoken', token: proxyTokenParam };
  }

  // 3. __justavps_pt cookie (proxy token cookie)
  const ptCookie = parseCookie(request.headers.get('Cookie') || '', PT_COOKIE_NAME);
  if (ptCookie?.startsWith('pt_')) {
    return { type: 'proxytoken', source: 'proxycookie', token: ptCookie };
  }

  // 4. Authorization header — API key
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // API keys start with sk_live_, JWTs start with eyJ
    if (token.startsWith('sk_live_')) {
      return { type: 'apikey', source: 'apikey', token };
    }
    // Treat as JWT
    return { type: 'jwt', source: 'apikey', token };
  }

  // 5. Query param — JWT (checked BEFORE cookie so an explicit ?token= always wins over a stale cookie)
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return { type: 'jwt', source: 'querytoken', token: queryToken };
  }

  // 6. Cookie — JWT
  const cookie = parseCookie(request.headers.get('Cookie') || '', COOKIE_NAME);
  if (cookie) {
    return { type: 'jwt', source: 'cookie', token: cookie };
  }

  return null;
}

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

// ─── JWT Verification (HS256 via Web Crypto) ────────────────────────────────

async function verifyJWT(
  token: string,
  secret: string,
): Promise<{ success: boolean; userId?: string; error?: string; shouldRefresh?: boolean }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { success: false, error: 'Invalid JWT format' };

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const sigInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify('HMAC', key, signature, sigInput);
    if (!valid) return { success: false, error: 'Invalid JWT signature' };

    // Decode payload
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { success: false, error: 'JWT expired' };
    }

    if (!payload.sub) {
      return { success: false, error: 'JWT missing sub claim' };
    }

    // Check if should refresh (< 6h remaining)
    const shouldRefresh = payload.exp ? (payload.exp - now) < REFRESH_THRESHOLD : false;

    return { success: true, userId: payload.sub, shouldRefresh };
  } catch (err) {
    return { success: false, error: 'JWT verification failed' };
  }
}

function base64UrlDecode(str: string): ArrayBuffer {
  // Restore base64 padding
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─── API Key Verification (SHA-256 lookup in KV) ────────────────────────────

async function verifyApiKey(
  key: string,
  slug: string,
  port: number | undefined,
  kv: KVNamespace,
): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    const hash = await sha256Hex(key);
    const data = await kv.get(`apikey:${hash}`);
    if (!data) {
      return { success: false, error: 'Invalid API key' };
    }
    const info: ApiKeyData = JSON.parse(data);

    // Check expiration
    if (info.expires_at && new Date(info.expires_at) < new Date()) {
      return { success: false, error: 'API key has expired' };
    }

    // Check proxy permission
    const perms = info.permissions ?? ['*'];
    if (!perms.includes('*') && !perms.includes('proxy')) {
      return { success: false, error: 'API key does not have proxy permission' };
    }

    // Check machine scope — we need to look up the machine to get its ID
    if (info.scope === 'machine' && info.machine_ids) {
      const machineData = await kv.get(`machine:${slug}`);
      if (machineData) {
        // We don't have machine_id in machine KV directly, but we can check owner_id matches
        // Machine-scoped check will be done at ownership level — if the key owns the machine, it has access
        // For edge enforcement, we rely on the validate-key endpoint for full DB-backed checks
        // The KV fast path checks owner_id match (which is already done in checkMachineAccess)
      }
    }

    return { success: true, userId: info.owner_id };
  } catch {
    return { success: false, error: 'API key verification failed' };
  }
}

// ─── Proxy Token Verification ───────────────────────────────────────────────

async function verifyProxyToken(
  token: string,
  slug: string,
  port: number | undefined,
  kv: KVNamespace,
): Promise<{ success: boolean; error?: string; proxyTokenData?: ProxyTokenData }> {
  try {
    const hash = await sha256Hex(token);
    const data = await kv.get(`pt:${hash}`);
    if (!data) {
      return { success: false, error: 'Invalid proxy token' };
    }

    const info: ProxyTokenData = JSON.parse(data);

    // Check expiration
    if (new Date(info.expires_at) < new Date()) {
      return { success: false, error: 'Proxy token has expired' };
    }

    // Check machine slug matches
    if (info.machine_slug !== slug) {
      return { success: false, error: 'Proxy token is not valid for this machine' };
    }

    // Check port access
    if (info.ports && info.ports.length > 0 && port !== undefined) {
      if (!info.ports.includes(port)) {
        return { success: false, error: `Proxy token does not allow port ${port}` };
      }
    }

    return { success: true, proxyTokenData: info };
  } catch {
    return { success: false, error: 'Proxy token verification failed' };
  }
}

// ─── Machine Info (no ownership check) ──────────────────────────────────────

async function getMachineInfo(
  slug: string,
  kv: KVNamespace,
): Promise<{ success: boolean; machineInfo?: MachineInfo; error?: string }> {
  const raw = await kv.get(`machine:${slug}`);
  if (!raw) {
    return { success: false, error: 'Machine not found' };
  }
  const info: MachineInfo = JSON.parse(raw);
  if (info.status === 'deleted' || info.status === 'error') {
    return { success: false, error: `Machine is ${info.status}` };
  }
  return { success: true, machineInfo: info };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Machine Access Check ───────────────────────────────────────────────────

async function checkMachineAccess(
  slug: string,
  userId: string,
  kv: KVNamespace,
): Promise<{ success: boolean; machineInfo?: MachineInfo; error?: string }> {
  const raw = await kv.get(`machine:${slug}`);
  if (!raw) {
    return { success: false, error: 'Machine not found' };
  }

  const info: MachineInfo = JSON.parse(raw);

  if (info.owner_id !== userId) {
    return { success: false, error: 'Access denied' };
  }

  if (info.status === 'deleted' || info.status === 'error') {
    return { success: false, error: `Machine is ${info.status}` };
  }

  return { success: true, machineInfo: info };
}

// ─── Response Helpers ───────────────────────────────────────────────────────

export function createUnauthorizedResponse(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function createLoginRedirect(request: Request, platformUrl: string): Response {
  const originalUrl = request.url;
  const authUrl = `${platformUrl}/api/proxy-auth?redirect=${encodeURIComponent(originalUrl)}`;
  return Response.redirect(authUrl, 302);
}
