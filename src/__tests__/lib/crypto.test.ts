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
  encryptSecret,
  decryptSecret,
  isEncrypted,
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

  // ─── AES-256-GCM Envelope Encryption ────────────────────────────────────

  describe('encryptSecret / decryptSecret', () => {
    // setup.ts sets DATA_ENCRYPTION_KEY='test-encryption-key-for-vitest-only'

    it('round-trips a simple string', () => {
      const plaintext = 'hello world';
      const encrypted = encryptSecret(plaintext);

      expect(encrypted).not.toBe(plaintext);
      expect(isEncrypted(encrypted)).toBe(true);
      expect(decryptSecret(encrypted)).toBe(plaintext);
    });

    it('round-trips an SSH private key', () => {
      const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACCqj+0OifJPJPJPJPJPJPJPJPJPJPJPJPJPJPJPJPJPJAAAAJgAAAAtz
c2gtZWQyNTUxOQAAACCqj+0OifJPJPJPJPJPJPJPJPJPJPJPJPJPJPJPJPJPJAAAAEAi
-----END OPENSSH PRIVATE KEY-----`;

      const encrypted = encryptSecret(privateKey);
      expect(isEncrypted(encrypted)).toBe(true);
      expect(decryptSecret(encrypted)).toBe(privateKey);
    });

    it('round-trips a machine token', () => {
      const token = generateMachineToken();
      const encrypted = encryptSecret(token);

      expect(isEncrypted(encrypted)).toBe(true);
      expect(encrypted).not.toBe(token);
      expect(decryptSecret(encrypted)).toBe(token);
    });

    it('produces different ciphertexts for the same plaintext (unique IV)', () => {
      const plaintext = 'same-secret';
      const enc1 = encryptSecret(plaintext);
      const enc2 = encryptSecret(plaintext);

      expect(enc1).not.toBe(enc2); // different IV each time
      expect(decryptSecret(enc1)).toBe(plaintext);
      expect(decryptSecret(enc2)).toBe(plaintext);
    });

    it('is idempotent — encrypting already-encrypted value returns it unchanged', () => {
      const plaintext = 'encrypt-me-once';
      const encrypted = encryptSecret(plaintext);
      const doubleEncrypted = encryptSecret(encrypted);

      expect(doubleEncrypted).toBe(encrypted); // no double-encryption
      expect(decryptSecret(doubleEncrypted)).toBe(plaintext);
    });

    it('decryptSecret passes through plaintext (unencrypted) values', () => {
      const plaintext = 'mt_abcdef1234567890';
      expect(decryptSecret(plaintext)).toBe(plaintext);
    });

    it('isEncrypted detects envelope prefix', () => {
      expect(isEncrypted('enc:v1:abc:def:012')).toBe(true);
      expect(isEncrypted('mt_plaintoken')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted('enc:v2:wrong-version')).toBe(false);
    });

    it('handles empty string', () => {
      const encrypted = encryptSecret('');
      expect(decryptSecret(encrypted)).toBe('');
    });

    it('handles unicode / special characters', () => {
      const special = '🔐 pässwörd with "quotes" & <angle> brackets';
      const encrypted = encryptSecret(special);
      expect(decryptSecret(encrypted)).toBe(special);
    });

    it('throws on tampered ciphertext (GCM auth tag verification)', () => {
      const encrypted = encryptSecret('sensitive-data');
      // Tamper with the ciphertext (last hex char)
      const tampered = encrypted.slice(0, -1) + (encrypted.slice(-1) === '0' ? '1' : '0');

      expect(() => decryptSecret(tampered)).toThrow();
    });

    it('throws on wrong encryption key', () => {
      const encrypted = encryptSecret('secret');

      // Temporarily change the key
      const origKey = process.env.DATA_ENCRYPTION_KEY;
      process.env.DATA_ENCRYPTION_KEY = 'wrong-key-entirely-different';

      expect(() => decryptSecret(encrypted)).toThrow();

      process.env.DATA_ENCRYPTION_KEY = origKey;
    });

    it('throws informative error when encrypted data found but no key configured', () => {
      const encrypted = encryptSecret('secret');

      const origKey = process.env.DATA_ENCRYPTION_KEY;
      process.env.DATA_ENCRYPTION_KEY = '';

      expect(() => decryptSecret(encrypted)).toThrow(/DATA_ENCRYPTION_KEY is not configured/);

      process.env.DATA_ENCRYPTION_KEY = origKey;
    });

    it('returns plaintext when no encryption key is configured (no-op mode)', () => {
      const origKey = process.env.DATA_ENCRYPTION_KEY;
      process.env.DATA_ENCRYPTION_KEY = '';

      const plaintext = 'no-encryption-configured';
      const result = encryptSecret(plaintext);
      expect(result).toBe(plaintext); // stored as plaintext
      expect(isEncrypted(result)).toBe(false);

      process.env.DATA_ENCRYPTION_KEY = origKey;
    });
  });
});