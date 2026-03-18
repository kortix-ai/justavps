/**
 * Worker auth — verify proxy JWT cookies and API keys.
 *
 * Auth methods (checked in order):
 *   1. Cookie `__justavps_proxy` — signed JWT (HS256), user-scoped
 *   2. Authorization: Bearer <api_key> — SHA-256 hash looked up in KV
 *   3. Query param `?token=<jwt>` — same as cookie JWT (for WebSocket/iframe)
 *
 * If none present → redirect browser to platform /api/proxy-auth for login.
 */

export interface AuthResult {
  success: boolean;
  userId?: string;
  machineInfo?: MachineInfo;
  error?: string;
  shouldRefresh?: boolean; // true if JWT is within 6h of expiry
}

export interface MachineInfo {
  owner_id: string;
  ip: string;
  origin_hostname?: string; // DNS-only hostname: origin.slug.kortix.cloud
  status: string;
  server_type: string;
}

const COOKIE_NAME = '__justavps_proxy';
const REFRESH_THRESHOLD = 6 * 60 * 60; // 6 hours in seconds

// ─── Main Auth ──────────────────────────────────────────────────────────────

export async function validateAuth(
  request: Request,
  slug: string,
  kv: KVNamespace,
  proxyAuthSecret: string,
): Promise<AuthResult> {
  // Extract auth from request
  const auth = extractAuth(request);

  if (!auth) {
    return { success: false, error: 'Authentication required' };
  }

  let userId: string;

  // Validate based on auth method
  if (auth.type === 'jwt') {
    const jwtResult = await verifyJWT(auth.token, proxyAuthSecret);
    if (!jwtResult.success) return jwtResult;
    userId = jwtResult.userId!;
  } else if (auth.type === 'apikey') {
    const apiResult = await verifyApiKey(auth.token, kv);
    if (!apiResult.success) return apiResult;
    userId = apiResult.userId!;
  } else {
    return { success: false, error: 'Invalid auth method' };
  }

  // Check machine ownership
  const machineResult = await checkMachineAccess(slug, userId, kv);
  if (!machineResult.success) return machineResult;

  return {
    success: true,
    userId,
    machineInfo: machineResult.machineInfo,
    shouldRefresh: auth.type === 'jwt' ? auth.shouldRefresh : false,
  };
}

// ─── Auth Extraction ────────────────────────────────────────────────────────

interface ExtractedAuth {
  type: 'jwt' | 'apikey';
  token: string;
  shouldRefresh?: boolean;
}

function extractAuth(request: Request): ExtractedAuth | null {
  // 1. Authorization header — API key
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // API keys start with sk_live_, JWTs start with eyJ
    if (token.startsWith('sk_live_')) {
      return { type: 'apikey', token };
    }
    // Treat as JWT
    return { type: 'jwt', token };
  }

  // 2. Cookie — JWT
  const cookie = parseCookie(request.headers.get('Cookie') || '', COOKIE_NAME);
  if (cookie) {
    return { type: 'jwt', token: cookie };
  }

  // 3. Query param — JWT
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return { type: 'jwt', token: queryToken };
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
    if (!valid) {
      // Debug: log secret length to help diagnose mismatches (no secret value!)
      console.log(`JWT sig verify failed. Secret length: ${secret.length}, token header: ${headerB64.slice(0, 20)}`);
      return { success: false, error: `Invalid JWT signature (secret_len=${secret.length})` };
    }

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
  kv: KVNamespace,
): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    const hash = await sha256Hex(key);
    const data = await kv.get(`apikey:${hash}`);
    if (!data) {
      return { success: false, error: 'Invalid API key' };
    }
    const info = JSON.parse(data) as { owner_id: string; name: string };
    return { success: true, userId: info.owner_id };
  } catch {
    return { success: false, error: 'API key verification failed' };
  }
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
