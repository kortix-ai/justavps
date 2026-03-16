import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateAuth, AuthResult, createMockKV } from '../src/auth';

// Mock KV store for testing
const mockKV = createMockKV();

describe('validateAuth', () => {
  beforeEach(() => {
    mockKV.clear();
  });

  describe('Bearer token authentication', () => {
    it('should validate valid API key', async () => {
      // Setup KV data
      const apiKeyHash = 'sha256_of_sk_live_test123';
      const ownerId = 'user_123';
      
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: ownerId,
        name: 'Test API Key'
      }));
      
      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'running',
        server_type: 'code-server'
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: {
          'Authorization': 'Bearer sk_live_test123'
        }
      });

      const result = await validateAuth(request, 'abc123', mockKV as any);
      
      expect(result).toEqual({
        success: true,
        ownerId,
        machineInfo: {
          owner_id: ownerId,
          ip: '1.2.3.4',
          status: 'running',
          server_type: 'code-server'
        }
      });
    });

    it('should reject invalid API key', async () => {
      const request = new Request('https://abc123.kortix.cloud', {
        headers: {
          'Authorization': 'Bearer sk_live_invalid'
        }
      });

      const result = await validateAuth(request, 'abc123', mockKV as any);
      
      expect(result).toEqual({
        success: false,
        error: 'Invalid API key'
      });
    });

    it('should reject when user does not own machine', async () => {
      // Setup KV data with different owner
      const apiKeyHash = 'sha256_of_sk_live_test123';
      const apiKeyOwner = 'user_123';
      const machineOwner = 'user_456';
      
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: apiKeyOwner,
        name: 'Test API Key'
      }));
      
      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: machineOwner,
        ip: '1.2.3.4',
        status: 'running',
        server_type: 'code-server'
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: {
          'Authorization': 'Bearer sk_live_test123'
        }
      });

      const result = await validateAuth(request, 'abc123', mockKV as any);
      
      expect(result).toEqual({
        success: false,
        error: 'Machine not found or access denied'
      });
    });
  });

  describe('JWT cookie authentication', () => {
    it('should validate valid JWT cookie', async () => {
      const ownerId = 'user_123';
      
      // Mock JWT that would decode to { userId: 'user_123' }
      const validJWT = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyXzEyMyIsImV4cCI6OTk5OTk5OTk5OX0.mock_signature';
      
      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'running',
        server_type: 'code-server'
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: {
          'Cookie': `__session=${validJWT}`
        }
      });

      const result = await validateAuth(request, 'abc123', mockKV as any);
      
      expect(result).toEqual({
        success: true,
        ownerId,
        machineInfo: {
          owner_id: ownerId,
          ip: '1.2.3.4',
          status: 'running',
          server_type: 'code-server'
        }
      });
    });

    it('should reject invalid JWT', async () => {
      const request = new Request('https://abc123.kortix.cloud', {
        headers: {
          'Cookie': '__session=invalid_jwt'
        }
      });

      const result = await validateAuth(request, 'abc123', mockKV as any);
      
      expect(result).toEqual({
        success: false,
        error: 'Invalid session'
      });
    });
  });

  describe('Query parameter authentication', () => {
    it('should validate token from query parameter', async () => {
      const apiKeyHash = 'sha256_of_sk_live_test123';
      const ownerId = 'user_123';
      
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: ownerId,
        name: 'Test API Key'
      }));
      
      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'running',
        server_type: 'code-server'
      }));

      const request = new Request('https://abc123.kortix.cloud?token=sk_live_test123');

      const result = await validateAuth(request, 'abc123', mockKV as any);
      
      expect(result).toEqual({
        success: true,
        ownerId,
        machineInfo: {
          owner_id: ownerId,
          ip: '1.2.3.4',
          status: 'running',
          server_type: 'code-server'
        }
      });
    });
  });

  describe('No authentication', () => {
    it('should reject requests without auth', async () => {
      const request = new Request('https://abc123.kortix.cloud');

      const result = await validateAuth(request, 'abc123', mockKV as any);
      
      expect(result).toEqual({
        success: false,
        error: 'Authentication required'
      });
    });
  });

  describe('Machine validation', () => {
    it('should reject when machine does not exist', async () => {
      const apiKeyHash = 'sha256_of_sk_live_test123';
      
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: 'user_123',
        name: 'Test API Key'
      }));

      const request = new Request('https://nonexistent.kortix.cloud', {
        headers: {
          'Authorization': 'Bearer sk_live_test123'
        }
      });

      const result = await validateAuth(request, 'nonexistent', mockKV as any);
      
      expect(result).toEqual({
        success: false,
        error: 'Machine not found or access denied'
      });
    });

    it('should reject when machine is not running', async () => {
      const apiKeyHash = 'sha256_of_sk_live_test123';
      const ownerId = 'user_123';
      
      mockKV.set(`apikey:${apiKeyHash}`, JSON.stringify({
        owner_id: ownerId,
        name: 'Test API Key'
      }));
      
      mockKV.set('machine:abc123', JSON.stringify({
        owner_id: ownerId,
        ip: '1.2.3.4',
        status: 'stopped',
        server_type: 'code-server'
      }));

      const request = new Request('https://abc123.kortix.cloud', {
        headers: {
          'Authorization': 'Bearer sk_live_test123'
        }
      });

      const result = await validateAuth(request, 'abc123', mockKV as any);
      
      expect(result).toEqual({
        success: false,
        error: 'Machine is not running'
      });
    });
  });
});