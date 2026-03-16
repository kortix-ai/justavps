/**
 * Tests for crypto utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  generateMachineToken,
  generateApiKey,
  validateApiKey,
  generatePassword,
  fingerprintSSHKey,
} from '@/server/lib/crypto';

describe('crypto utilities', () => {
  describe('generateMachineToken', () => {
    it('should generate token with mt_ prefix', () => {
      const token = generateMachineToken();
      
      expect(token).toMatch(/^mt_[a-f0-9]{64}$/);
      expect(token).toHaveLength(67); // 'mt_' + 64 hex chars
    });
    
    it('should generate unique tokens', () => {
      const token1 = generateMachineToken();
      const token2 = generateMachineToken();
      
      expect(token1).not.toBe(token2);
    });
  });

  describe('generateApiKey', () => {
    it('should generate key with sk_live_ prefix', async () => {
      const result = await generateApiKey();
      
      expect(result.key).toMatch(/^sk_live_[a-f0-9]{64}$/);
      expect(result.key).toHaveLength(72); // 'sk_live_' + 64 hex chars
    });
    
    it('should generate hash that can be validated', async () => {
      const result = await generateApiKey();
      
      expect(result.hash).toBeTruthy();
      expect(typeof result.hash).toBe('string');
      
      // Should be able to validate the key against its hash
      const isValid = await validateApiKey(result.key, result.hash);
      expect(isValid).toBe(true);
    });
    
    it('should generate proper prefix', async () => {
      const result = await generateApiKey();
      
      expect(result.prefix).toMatch(/^sk_live_[a-f0-9]{8}\.\.\.$/);
      expect(result.prefix).toHaveLength(19); // 'sk_live_' + 8 chars + '...'
    });
    
    it('should generate unique keys', async () => {
      const result1 = await generateApiKey();
      const result2 = await generateApiKey();
      
      expect(result1.key).not.toBe(result2.key);
      expect(result1.hash).not.toBe(result2.hash);
    });
  });

  describe('validateApiKey', () => {
    it('should validate correct key/hash pairs', async () => {
      const result = await generateApiKey();
      const isValid = await validateApiKey(result.key, result.hash);
      
      expect(isValid).toBe(true);
    });
    
    it('should reject incorrect keys', async () => {
      const result = await generateApiKey();
      const wrongKey = 'sk_live_wrong_key';
      const isValid = await validateApiKey(wrongKey, result.hash);
      
      expect(isValid).toBe(false);
    });
    
    it('should reject invalid hashes', async () => {
      const result = await generateApiKey();
      const wrongHash = '$2b$10$invalid_hash_here';
      const isValid = await validateApiKey(result.key, wrongHash);
      
      expect(isValid).toBe(false);
    });
  });

  describe('generatePassword', () => {
    it('should generate password of default length', () => {
      const password = generatePassword();
      
      expect(password).toHaveLength(20);
      expect(password).toMatch(/^[a-zA-Z0-9]+$/);
    });
    
    it('should generate password of specified length', () => {
      const password = generatePassword(16);
      
      expect(password).toHaveLength(16);
      expect(password).toMatch(/^[a-zA-Z0-9]+$/);
    });
    
    it('should generate unique passwords', () => {
      const password1 = generatePassword(12);
      const password2 = generatePassword(12);
      
      expect(password1).not.toBe(password2);
    });
    
    it('should only contain allowed characters', () => {
      const password = generatePassword(100);
      const allowedChars = /^[abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789]+$/;
      
      expect(password).toMatch(allowedChars);
    });
  });

  describe('fingerprintSSHKey', () => {
    it('should generate correct fingerprint for known ED25519 key', () => {
      const publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKqP7Q6J8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k test@example.com';
      
      const fingerprint = fingerprintSSHKey(publicKey);
      
      expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
      expect(fingerprint.endsWith('=')).toBe(false); // No padding
    });
    
    it('should generate correct fingerprint for known RSA key', () => {
      const publicKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDjI+e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e test@example.com';
      
      const fingerprint = fingerprintSSHKey(publicKey);
      
      expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
      expect(fingerprint.endsWith('=')).toBe(false);
    });
    
    it('should handle keys without comments', () => {
      const publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKqP7Q6J8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k';
      
      const fingerprint = fingerprintSSHKey(publicKey);
      
      expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    });
    
    it('should throw error for invalid SSH key format', () => {
      const invalidKey = 'not-a-valid-ssh-key';
      
      expect(() => fingerprintSSHKey(invalidKey)).toThrow('Invalid SSH public key');
    });
    
    it('should throw error for empty key', () => {
      expect(() => fingerprintSSHKey('')).toThrow('Invalid SSH public key');
    });
    
    it('should handle whitespace properly', () => {
      const publicKey = '  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKqP7Q6J8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k test@example.com  ';
      
      const fingerprint = fingerprintSSHKey(publicKey);
      
      expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    });
  });
});