/**
 * SSH key generation — creates ed25519 keypairs for machine provisioning.
 * Each machine gets its own unique keypair.
 *
 * Uses Node.js crypto (pure JS) — works on Vercel serverless (no ssh-keygen binary needed).
 */

import { generateKeyPairSync, createHash, randomBytes } from 'crypto';

interface GeneratedKeyPair {
  publicKey: string;   // ssh-ed25519 AAAA... machine@justavps
  privateKey: string;  // -----BEGIN OPENSSH PRIVATE KEY-----...
  fingerprint: string; // SHA256:xxx
}

/**
 * Generate an ed25519 SSH keypair in OpenSSH format.
 * Pure JS — no external binaries required.
 */
export function generateSSHKeyPair(comment: string = 'machine@justavps'): GeneratedKeyPair {
  // Generate ed25519 key pair
  const { publicKey: pubPem, privateKey: privPem } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // Extract raw 32-byte ed25519 keys from DER-encoded buffers
  // SPKI DER for ed25519: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes>
  const rawPub = pubPem.subarray(pubPem.length - 32);
  // PKCS8 DER for ed25519: ... 04 20 <32 bytes private> (last 32 bytes before optional public)
  const rawPriv = privPem.subarray(privPem.length - 32);

  // Build OpenSSH public key: ssh-ed25519 <base64(blob)> comment
  const pubBlob = buildOpenSSHPubBlob(rawPub);
  const publicKey = `ssh-ed25519 ${pubBlob.toString('base64')} ${comment}`;

  // Build OpenSSH private key (the full PEM format openssh uses)
  const privateKey = buildOpenSSHPrivateKey(rawPub, rawPriv, comment);

  // Fingerprint: SHA256 of the raw public key blob
  const fp = createHash('sha256').update(pubBlob).digest('base64').replace(/=+$/, '');
  const fingerprint = `SHA256:${fp}`;

  return { publicKey, privateKey, fingerprint };
}

/**
 * Build the OpenSSH public key blob (the binary format inside the base64 part).
 * Format: string "ssh-ed25519" + string <32-byte public key>
 */
function buildOpenSSHPubBlob(rawPub: Buffer): Buffer {
  const keyType = Buffer.from('ssh-ed25519');
  const parts = [
    encodeString(keyType),
    encodeString(rawPub),
  ];
  return Buffer.concat(parts);
}

/**
 * Build OpenSSH private key PEM (the -----BEGIN OPENSSH PRIVATE KEY----- format).
 *
 * Reference: https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key
 */
function buildOpenSSHPrivateKey(rawPub: Buffer, rawPriv: Buffer, comment: string): string {
  const keyType = Buffer.from('ssh-ed25519');
  const commentBuf = Buffer.from(comment);
  const cipherName = Buffer.from('none');
  const kdfName = Buffer.from('none');
  const kdfOptions = Buffer.alloc(0);
  const numKeys = 1;

  // Public key section (same as pub blob)
  const pubBlob = buildOpenSSHPubBlob(rawPub);

  // Check bytes (two identical random uint32 — proves decryption worked, since cipher=none)
  const checkBytes = randomBytes(4);

  // Private section (unencrypted since cipher=none)
  const privSection = Buffer.concat([
    checkBytes,
    checkBytes,
    encodeString(keyType),
    encodeString(rawPub),
    encodeString(Buffer.concat([rawPriv, rawPub])), // ed25519 private key = 64 bytes (priv + pub)
    encodeString(commentBuf),
  ]);

  // Pad to block size (8 for none cipher)
  const blockSize = 8;
  const padLen = blockSize - (privSection.length % blockSize);
  const padding = Buffer.alloc(padLen === blockSize ? 0 : padLen);
  for (let i = 0; i < padding.length; i++) padding[i] = i + 1;
  const paddedPriv = Buffer.concat([privSection, padding]);

  // Full key blob
  const authMagic = Buffer.from('openssh-key-v1\0');
  const blob = Buffer.concat([
    authMagic,
    encodeString(cipherName),
    encodeString(kdfName),
    encodeString(kdfOptions),
    encodeUint32(numKeys),
    encodeString(pubBlob),
    encodeString(paddedPriv),
  ]);

  // PEM-encode
  const b64 = blob.toString('base64');
  const lines = b64.match(/.{1,70}/g) || [b64];
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function encodeUint32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n, 0);
  return buf;
}

function encodeString(data: Buffer): Buffer {
  return Buffer.concat([encodeUint32(data.length), data]);
}
