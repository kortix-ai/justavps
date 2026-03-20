/**
 * Crypto utilities — key generation, hashing, password generation,
 * and AES-256-GCM envelope encryption for secrets at rest.
 */

import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto';
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

// ─── AES-256-GCM Envelope Encryption ────────────────────────────────────────
//
// Used to encrypt secrets at rest in the database (SSH private keys,
// machine tokens). The DATA_ENCRYPTION_KEY env var is required in
// production — without it, secrets are stored/returned as plaintext
// (with a startup warning).
//
// Format: "enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>"
// - v1 = algorithm version (allows future migration)
// - iv  = 12-byte random nonce (unique per encryption)
// - authTag = 16-byte GCM authentication tag
// - ciphertext = AES-256-GCM encrypted data

const ENC_PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Derive a 32-byte encryption key from the DATA_ENCRYPTION_KEY env var.
 * Uses SHA-256 so the env var can be any length/format.
 * Reads from process.env directly (not config) so it's always current.
 */
function getEncryptionKey(): Buffer | null {
  const raw = process.env.DATA_ENCRYPTION_KEY || '';
  if (!raw) return null;
  return createHash('sha256').update(raw).digest();
}

/**
 * Check if a value is already encrypted (has our envelope prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * Returns the encrypted envelope string, or the original plaintext
 * if no DATA_ENCRYPTION_KEY is configured.
 *
 * Safe to call on already-encrypted values — returns them unchanged.
 */
export function encryptSecret(plaintext: string): string {
  if (isEncrypted(plaintext)) return plaintext; // already encrypted
  const key = getEncryptionKey();
  if (!key) return plaintext; // no key configured — store plaintext

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted envelope string.
 *
 * Returns the decrypted plaintext, or the original string if:
 * - The value is not encrypted (no envelope prefix)
 * - No DATA_ENCRYPTION_KEY is configured
 *
 * Throws if the value IS encrypted but the key is wrong (auth tag mismatch).
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value; // plaintext passthrough
  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'Cannot decrypt: DATA_ENCRYPTION_KEY is not configured but encrypted data was found in the database. ' +
      'Set DATA_ENCRYPTION_KEY to the same value used when the data was encrypted.'
    );
  }

  const parts = value.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted envelope format');

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  if (iv.length !== IV_BYTES) throw new Error(`Invalid IV length: ${iv.length}`);
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error(`Invalid auth tag length: ${authTag.length}`);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}
