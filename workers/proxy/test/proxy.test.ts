import { describe, it, expect } from 'vitest';
import { stripHopByHopHeaders, handleCORSPreflight, isWebSocketUpgrade } from '../src/proxy';

describe('proxy module', () => {
  describe('stripHopByHopHeaders', () => {
    it('should remove hop-by-hop headers', () => {
      const headers = new Headers();
      headers.set('Connection', 'keep-alive');
      headers.set('Transfer-Encoding', 'chunked');
      headers.set('Upgrade', 'websocket');
      headers.set('Proxy-Authentication', 'basic');
      headers.set('Proxy-Authorization', 'bearer token');
      headers.set('TE', 'trailers');
      headers.set('Trailers', 'X-Custom');
      headers.set('Content-Type', 'application/json');
      headers.set('Authorization', 'Bearer token');

      const cleaned = stripHopByHopHeaders(headers);

      expect(cleaned.has('Connection')).toBe(false);
      expect(cleaned.has('Transfer-Encoding')).toBe(false);
      expect(cleaned.has('Upgrade')).toBe(false);
      expect(cleaned.has('Proxy-Authentication')).toBe(false);
      expect(cleaned.has('Proxy-Authorization')).toBe(false);
      expect(cleaned.has('TE')).toBe(false);
      expect(cleaned.has('Trailers')).toBe(false);

      expect(cleaned.has('Content-Type')).toBe(true);
      expect(cleaned.has('Authorization')).toBe(true);
    });

    it('should preserve non-hop-by-hop headers', () => {
      const headers = new Headers();
      headers.set('X-Custom', 'value');
      headers.set('Accept', 'text/html');
      headers.set('Host', 'example.com');

      const cleaned = stripHopByHopHeaders(headers);
      expect(cleaned.get('X-Custom')).toBe('value');
      expect(cleaned.get('Accept')).toBe('text/html');
      expect(cleaned.get('Host')).toBe('example.com');
    });
  });

  describe('handleCORSPreflight', () => {
    it('should handle OPTIONS request with proper CORS headers', () => {
      const request = new Request('https://abc123.kortix.cloud/api/test', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type,Authorization',
        },
      });

      const response = handleCORSPreflight(request);

      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
      expect(response!.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response!.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,Authorization');
      expect(response!.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should handle OPTIONS request without origin', () => {
      const request = new Request('https://abc123.kortix.cloud/api/test', {
        method: 'OPTIONS',
      });

      const response = handleCORSPreflight(request);

      expect(response).not.toBeNull();
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should return null for non-OPTIONS requests', () => {
      const request = new Request('https://abc123.kortix.cloud/api/test', { method: 'GET' });
      expect(handleCORSPreflight(request)).toBeNull();
    });
  });

  describe('isWebSocketUpgrade', () => {
    it('should detect WebSocket upgrade', () => {
      const request = new Request('https://test.kortix.cloud/', {
        headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade' },
      });
      expect(isWebSocketUpgrade(request)).toBe(true);
    });

    it('should reject non-WebSocket requests', () => {
      const request = new Request('https://test.kortix.cloud/');
      expect(isWebSocketUpgrade(request)).toBe(false);
    });

    it('should reject partial WebSocket headers (missing Connection)', () => {
      const request = new Request('https://test.kortix.cloud/', {
        headers: { 'Upgrade': 'websocket' },
      });
      expect(isWebSocketUpgrade(request)).toBe(false);
    });
  });
});
