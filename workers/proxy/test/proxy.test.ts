import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProxyRequest, stripHopByHopHeaders, handleCORSPreflight } from '../src/proxy';
import type { MachineInfo } from '../src/auth';

const mockMachineInfo: MachineInfo = {
  owner_id: 'user_123',
  ip: '1.2.3.4',
  status: 'running',
  server_type: 'code-server'
};

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

      // These should be removed
      expect(cleaned.has('Connection')).toBe(false);
      expect(cleaned.has('Transfer-Encoding')).toBe(false);
      expect(cleaned.has('Upgrade')).toBe(false);
      expect(cleaned.has('Proxy-Authentication')).toBe(false);
      expect(cleaned.has('Proxy-Authorization')).toBe(false);
      expect(cleaned.has('TE')).toBe(false);
      expect(cleaned.has('Trailers')).toBe(false);

      // These should be preserved
      expect(cleaned.has('Content-Type')).toBe(true);
      expect(cleaned.has('Authorization')).toBe(true);
    });
  });

  describe('createProxyRequest', () => {
    it('should create proxy request with correct target URL', () => {
      const originalRequest = new Request('https://abc123.kortix.cloud/api/test', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer token',
          'Content-Type': 'application/json'
        }
      });

      const proxyRequest = createProxyRequest(originalRequest, mockMachineInfo, 8080);

      expect(proxyRequest.url).toBe('http://1.2.3.4:8080/api/test');
      expect(proxyRequest.method).toBe('GET');
      expect(proxyRequest.headers.get('Authorization')).toBe('Bearer token');
      expect(proxyRequest.headers.get('Content-Type')).toBe('application/json');
    });

    it('should handle custom ports', () => {
      const originalRequest = new Request('https://3000.abc123.kortix.cloud/dashboard');

      const proxyRequest = createProxyRequest(originalRequest, mockMachineInfo, 3000);

      expect(proxyRequest.url).toBe('http://1.2.3.4:3000/dashboard');
    });

    it('should preserve query parameters', () => {
      const originalRequest = new Request('https://abc123.kortix.cloud/api/data?filter=active&limit=10');

      const proxyRequest = createProxyRequest(originalRequest, mockMachineInfo, 8080);

      expect(proxyRequest.url).toBe('http://1.2.3.4:8080/api/data?filter=active&limit=10');
    });

    it('should handle POST requests with body', async () => {
      const body = JSON.stringify({ name: 'test' });
      const originalRequest = new Request('https://abc123.kortix.cloud/api/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body
      });

      const proxyRequest = createProxyRequest(originalRequest, mockMachineInfo, 8080);

      expect(proxyRequest.method).toBe('POST');
      expect(proxyRequest.headers.get('Content-Type')).toBe('application/json');
      expect(await proxyRequest.text()).toBe(body);
    });

    it('should strip hop-by-hop headers from proxy request', () => {
      const originalRequest = new Request('https://abc123.kortix.cloud/api/test', {
        headers: {
          'Authorization': 'Bearer token',
          'Connection': 'keep-alive',
          'Transfer-Encoding': 'chunked'
        }
      });

      const proxyRequest = createProxyRequest(originalRequest, mockMachineInfo, 8080);

      expect(proxyRequest.headers.has('Authorization')).toBe(true);
      expect(proxyRequest.headers.has('Connection')).toBe(false);
      expect(proxyRequest.headers.has('Transfer-Encoding')).toBe(false);
    });
  });

  describe('handleCORSPreflight', () => {
    it('should handle OPTIONS request with proper CORS headers', () => {
      const request = new Request('https://abc123.kortix.cloud/api/test', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type,Authorization'
        }
      });

      const response = handleCORSPreflight(request);

      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
      expect(response!.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, PATCH, OPTIONS');
      expect(response!.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,Authorization');
      expect(response!.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should handle OPTIONS request without origin', () => {
      const request = new Request('https://abc123.kortix.cloud/api/test', {
        method: 'OPTIONS'
      });

      const response = handleCORSPreflight(request);

      expect(response).not.toBeNull();
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should return null for non-OPTIONS requests', () => {
      const request = new Request('https://abc123.kortix.cloud/api/test', {
        method: 'GET'
      });

      const response = handleCORSPreflight(request);

      expect(response).toBeNull();
    });
  });
});