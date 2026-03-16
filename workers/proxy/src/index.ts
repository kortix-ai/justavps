/**
 * Cloudflare Worker for *.kortix.cloud auth proxy gateway
 * 
 * Handles authentication and proxying for VPS instances
 */

import { parseHostname } from './hostname';
import { validateAuth, createUnauthorizedResponse } from './auth';
import { handleCORSPreflight, isWebSocketUpgrade, proxyHTTPRequest, proxyWebSocket } from './proxy';

export interface Env {
  KV: KVNamespace;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Parse the hostname to extract slug and port
      const url = new URL(request.url);
      const pathname = url.pathname;
      const hostname = url.hostname;
      
      const parsed = parseHostname(hostname, pathname);
      
      if (!parsed) {
        return new Response(JSON.stringify({ 
          error: 'Invalid hostname format',
          expected: 'slug.kortix.cloud or port.slug.kortix.cloud' 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const { slug, port, isPty } = parsed;

      // Handle CORS preflight before authentication
      if (request.method === 'OPTIONS') {
        const corsResponse = handleCORSPreflight(request);
        if (corsResponse) {
          return corsResponse;
        }
      }

      // Validate authentication and authorization
      const authResult = await validateAuth(request, slug, env.KV);
      
      if (!authResult.success) {
        // For browser requests, redirect to login page
        if (isBrowserRequest(request) && request.method === 'GET') {
          const loginUrl = `https://justavps.com/login?redirect=${encodeURIComponent(request.url)}`;
          return Response.redirect(loginUrl, 302);
        }
        
        return createUnauthorizedResponse(authResult.error || 'Authentication failed');
      }

      // Log successful authentication
      console.log(`Authenticated request for machine ${slug} by user ${authResult.ownerId}`);

      // Handle WebSocket upgrade requests
      if (isWebSocketUpgrade(request)) {
        return await proxyWebSocket(request, authResult.machineInfo!, port);
      }

      // Handle regular HTTP requests
      return await proxyHTTPRequest(request, authResult.machineInfo!, port);

    } catch (error) {
      console.error('Worker error:', error);
      
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        details: env.ENVIRONMENT === 'development' && error instanceof Error ? error.message : undefined
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};

/**
 * Determine if this is a browser request vs API request
 */
function isBrowserRequest(request: Request): boolean {
  const accept = request.headers.get('Accept') || '';
  const userAgent = request.headers.get('User-Agent') || '';
  
  // Check for browser Accept header patterns
  const browserAcceptPatterns = [
    'text/html',
    'application/xhtml+xml',
    'text/html,application/xhtml+xml'
  ];
  
  const hasBrowserAccept = browserAcceptPatterns.some(pattern => 
    accept.includes(pattern)
  );
  
  // Check for browser user agents
  const browserUserAgents = [
    'Mozilla',
    'Chrome',
    'Safari',
    'Firefox',
    'Edge'
  ];
  
  const hasBrowserUserAgent = browserUserAgents.some(browser => 
    userAgent.includes(browser)
  );
  
  return hasBrowserAccept || hasBrowserUserAgent;
}