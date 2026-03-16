/**
 * Crypto utilities — key generation, hashing, password generation.
 */

import { randomBytes, createHash } from 'crypto';
import bcryptjs from 'bcryptjs';

/**
 * Generate a machine token (mt_xxx format).
 */
export function generateMachineToken(): string {
  return `mt_${randomBytes(32).toString('hex')}`;
}

/**
 * Generate an API key (sk_live_xxx format).
 * Returns both the plain key and the bcrypt hash.
 */
export async function generateApiKey(): Promise<{ key: string; hash: string; prefix: string }> {
  const rawKey = randomBytes(32).toString('hex');
  const key = `sk_live_${rawKey}`;
  const hash = await bcryptjs.hash(key, 10);
  const prefix = key.slice(0, 16) + '...';
  return { key, hash, prefix };
}

/**
 * Validate an API key against a bcrypt hash.
 */
export async function validateApiKey(key: string, hash: string): Promise<boolean> {
  return bcryptjs.compare(key, hash);
}

/**
 * Generate a random password.
 */
export function generatePassword(length: number = 20): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

/**
 * Hash a user password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcryptjs.hash(password, 12);
}

/**
 * Verify a password against a bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcryptjs.compare(password, hash);
}

/**
 * Generate SSH key fingerprint from public key string.
 */
export function fingerprintSSHKey(publicKey: string): string {
  const parts = publicKey.trim().split(' ');
  if (parts.length < 2) throw new Error('Invalid SSH public key');
  const keyData = Buffer.from(parts[1], 'base64');
  const hash = createHash('sha256').update(keyData).digest('base64');
  return `SHA256:${hash.replace(/=+$/, '')}`;
}
