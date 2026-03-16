/**
 * SSH key generation — creates ed25519 keypairs for machine provisioning.
 * Each machine gets its own unique keypair.
 */

import { execSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';

interface GeneratedKeyPair {
  publicKey: string;   // ssh-ed25519 AAAA... machine@justavps
  privateKey: string;  // -----BEGIN OPENSSH PRIVATE KEY-----...
  fingerprint: string; // SHA256:xxx
}

/**
 * Generate an ed25519 SSH keypair.
 * Uses ssh-keygen for maximum compatibility.
 */
export function generateSSHKeyPair(comment: string = 'machine@justavps'): GeneratedKeyPair {
  const tmpPath = `/tmp/justavps_keygen_${randomBytes(8).toString('hex')}`;

  try {
    // Generate key with ssh-keygen
    execSync(`ssh-keygen -t ed25519 -f ${tmpPath} -N "" -C "${comment}" -q`, {
      stdio: 'pipe',
    });

    const privateKey = readFileSync(tmpPath, 'utf-8').trim();
    const publicKey = readFileSync(`${tmpPath}.pub`, 'utf-8').trim();

    // Extract fingerprint
    const fpOutput = execSync(`ssh-keygen -lf ${tmpPath}.pub`, { encoding: 'utf-8' });
    const fingerprint = fpOutput.split(' ')[1] || 'unknown';

    return { publicKey, privateKey, fingerprint };
  } finally {
    // Clean up temp files
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch {}
    try { if (existsSync(`${tmpPath}.pub`)) unlinkSync(`${tmpPath}.pub`); } catch {}
  }
}
