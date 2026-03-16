import type { MachineInfo } from './auth';

// Hop-by-hop headers that should not be forwarded
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate', 
  'proxy-authentication',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade'
]);

/**
 * Create a proxy request to forward to the target machine
 */
export function createProxyRequest(
  request: Request,
  machineInfo: MachineInfo,
  port: number
): Request {
  const url = new URL(request.url);
  
  // Create target URL
  const targetUrl = new URL(url.pathname + url.search, `http://${machineInfo.ip}:${port}`);
  
  // Clone and clean headers
  const headers = stripHopByHopHeaders(request.headers);
  
  // Create new request
  const requestInit: RequestInit = {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body
  };

  // Add duplex for streaming bodies
  if (requestInit.body && typeof (requestInit as any).duplex === 'undefined') {
    (requestInit as any).duplex = 'half';
  }

  const proxyRequest = new Request(targetUrl.toString(), requestInit);
  
  return proxyRequest;
}

/**
 * Strip hop-by-hop headers that shouldn't be forwarded
 */
export function stripHopByHopHeaders(headers: Headers): Headers {
  const cleanHeaders = new Headers();
  
  headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      cleanHeaders.set(name, value);
    }
  });
  
  return cleanHeaders;
}

/**
 * Handle CORS preflight requests
 */
export function handleCORSPreflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  const origin = request.headers.get('Origin');
  const requestMethod = request.headers.get('Access-Control-Request-Method');
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');

  const corsHeaders = new Headers();
  
  // Set CORS headers
  corsHeaders.set('Access-Control-Allow-Origin', origin || '*');
  corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  
  if (requestHeaders) {
    corsHeaders.set('Access-Control-Allow-Headers', requestHeaders);
  } else {
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  
  corsHeaders.set('Access-Control-Max-Age', '86400'); // 24 hours
  corsHeaders.set('Vary', 'Origin');

  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
}

/**
 * Proxy an HTTP request to the target machine
 */
export async function proxyHTTPRequest(
  request: Request,
  machineInfo: MachineInfo,
  port: number
): Promise<Response> {
  try {
    const proxyRequest = createProxyRequest(request, machineInfo, port);
    
    // Forward the request
    const response = await fetch(proxyRequest);
    
    // Create response with CORS headers
    const responseHeaders = new Headers(response.headers);
    addCORSHeaders(responseHeaders, request);
    
    // Return response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
    
  } catch (error) {
    console.error('Proxy request failed:', error);
    
    const errorHeaders = new Headers({
      'Content-Type': 'application/json'
    });
    addCORSHeaders(errorHeaders, request);
    
    return new Response(JSON.stringify({ 
      error: 'Proxy request failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 502,
      headers: errorHeaders
    });
  }
}

/**
 * Handle WebSocket upgrade requests
 */
export async function proxyWebSocket(
  request: Request,
  machineInfo: MachineInfo,
  port: number
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const targetUrl = `ws://${machineInfo.ip}:${port}${url.pathname}${url.search}`;
    
    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    
    // Connect to target WebSocket
    const targetWebSocket = new WebSocket(targetUrl);
    
    // Pipe data between client and target
    server.addEventListener('message', (event) => {
      if (targetWebSocket.readyState === WebSocket.OPEN) {
        targetWebSocket.send(event.data);
      }
    });
    
    server.addEventListener('close', () => {
      targetWebSocket.close();
    });
    
    targetWebSocket.addEventListener('message', (event) => {
      if (server.readyState === WebSocket.OPEN) {
        server.send(event.data);
      }
    });
    
    targetWebSocket.addEventListener('close', () => {
      server.close();
    });
    
    // Accept the WebSocket connection
    server.accept();
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
    
  } catch (error) {
    console.error('WebSocket proxy failed:', error);
    
    return new Response(JSON.stringify({ 
      error: 'WebSocket proxy failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

/**
 * Add CORS headers to response
 */
function addCORSHeaders(headers: Headers, request: Request): void {
  const origin = request.headers.get('Origin');
  
  headers.set('Access-Control-Allow-Origin', origin || '*');
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Vary', 'Origin');
}

/**
 * Check if request is a WebSocket upgrade
 */
export function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get('Upgrade');
  const connection = request.headers.get('Connection');
  
  return !!(
    upgrade?.toLowerCase() === 'websocket' &&
    connection?.toLowerCase().includes('upgrade')
  );
}