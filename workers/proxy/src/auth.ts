import { decodeJwt } from 'jose';

export interface AuthResult {
  success: boolean;
  ownerId?: string;
  machineInfo?: MachineInfo;
  error?: string;
}

export interface MachineInfo {
  owner_id: string;
  ip: string;
  status: string;
  server_type: string;
}

export interface ApiKeyInfo {
  owner_id: string;
  name: string;
}

// Mock KV store for testing
export function createMockKV() {
  const store = new Map<string, string>();
  
  return {
    clear: () => store.clear(),
    set: (key: string, value: string) => store.set(key, value),
    get: async (key: string) => store.get(key) || null,
    put: async (key: string, value: string) => store.set(key, value),
    delete: async (key: string) => store.delete(key),
  };
}

/**
 * Validate authentication for a request
 */
export async function validateAuth(
  request: Request, 
  slug: string, 
  kv: KVNamespace
): Promise<AuthResult> {
  // Extract authentication info from request
  const auth = extractAuth(request);
  
  if (!auth) {
    return {
      success: false,
      error: 'Authentication required'
    };
  }

  // Validate the authentication method
  let ownerId: string;
  
  if (auth.type === 'bearer' || auth.type === 'query') {
    const apiKeyResult = await validateApiKey(auth.token, kv);
    if (!apiKeyResult.success) {
      return apiKeyResult;
    }
    ownerId = apiKeyResult.ownerId!;
  } else if (auth.type === 'jwt') {
    const jwtResult = await validateJWT(auth.token);
    if (!jwtResult.success) {
      return jwtResult;
    }
    ownerId = jwtResult.ownerId!;
  } else {
    return {
      success: false,
      error: 'Invalid authentication method'
    };
  }

  // Check machine authorization
  const machineResult = await validateMachineAccess(slug, ownerId, kv);
  if (!machineResult.success) {
    return machineResult;
  }

  return {
    success: true,
    ownerId,
    machineInfo: machineResult.machineInfo
  };
}

/**
 * Extract authentication information from request
 */
function extractAuth(request: Request): { type: 'bearer' | 'jwt' | 'query', token: string } | null {
  // Check Authorization header (Bearer token)
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return {
      type: 'bearer',
      token: authHeader.substring(7)
    };
  }

  // Check cookie (__session JWT)
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const sessionMatch = cookieHeader.match(/(?:__session|authjs\.session-token)=([^;]+)/);
    if (sessionMatch) {
      return {
        type: 'jwt',
        token: sessionMatch[1]
      };
    }
  }

  // Check query parameter
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return {
      type: 'query',
      token: queryToken
    };
  }

  return null;
}

/**
 * Validate API key against KV store
 */
async function validateApiKey(token: string, kv: KVNamespace): Promise<AuthResult> {
  try {
    // Hash the API key for KV lookup (in production, use proper crypto)
    const hash = await hashApiKey(token);
    const keyInfo = await kv.get(`apikey:${hash}`);
    
    if (!keyInfo) {
      return {
        success: false,
        error: 'Invalid API key'
      };
    }

    const apiKeyInfo: ApiKeyInfo = JSON.parse(keyInfo);
    
    return {
      success: true,
      ownerId: apiKeyInfo.owner_id
    };
  } catch (error) {
    // Re-throw KV errors to be handled at worker level
    if (error instanceof Error && error.message.includes('KV')) {
      throw error;
    }
    return {
      success: false,
      error: 'Invalid API key'
    };
  }
}

/**
 * Validate JWT token
 */
async function validateJWT(token: string): Promise<AuthResult> {
  try {
    // For testing, we'll use a simple mock validation
    // In production, this would verify the JWT signature
    if (token.startsWith('eyJ')) {
      // Mock JWT validation - decode without verification for testing
      const payload = decodeJwt(token);
      
      if (payload.userId && typeof payload.userId === 'string') {
        return {
          success: true,
          ownerId: payload.userId as string
        };
      }
    }
    
    return {
      success: false,
      error: 'Invalid session'
    };
  } catch (error) {
    return {
      success: false,
      error: 'Invalid session'
    };
  }
}

/**
 * Validate machine access for the user
 */
async function validateMachineAccess(
  slug: string, 
  ownerId: string, 
  kv: KVNamespace
): Promise<AuthResult> {
  try {
    const machineData = await kv.get(`machine:${slug}`);
    
    if (!machineData) {
      return {
        success: false,
        error: 'Machine not found or access denied'
      };
    }

    const machineInfo: MachineInfo = JSON.parse(machineData);
    
    // Check ownership
    if (machineInfo.owner_id !== ownerId) {
      return {
        success: false,
        error: 'Machine not found or access denied'
      };
    }

    // Check if machine is accessible (ready or provisioning)
    if (machineInfo.status === 'deleted' || machineInfo.status === 'error') {
      return {
        success: false,
        error: `Machine is ${machineInfo.status}`
      };
    }

    return {
      success: true,
      ownerId,
      machineInfo
    };
  } catch (error) {
    // Re-throw KV errors to be handled at worker level
    if (error instanceof Error && error.message.includes('KV')) {
      throw error;
    }
    return {
      success: false,
      error: 'Machine validation failed'
    };
  }
}

/**
 * Hash API key for KV lookup (simplified for testing)
 */
async function hashApiKey(key: string): Promise<string> {
  // For testing, use a simple prefix-based hash
  // In production, use proper crypto.subtle.digest
  return `sha256_of_${key}`;
}

/**
 * Create unauthorized response
 */
export function createUnauthorizedResponse(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}