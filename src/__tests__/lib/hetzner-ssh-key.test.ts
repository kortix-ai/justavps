import { describe, expect, it } from 'vitest';
import { normalizeSshPublicKey } from '@/server/platform/baremetal/vendors/hetzner-robot';

const VALID_ED25519 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMEXMvSElkld6uzCDIyIpEjWk9r9SCm0FfNqvqbIEy6H justavps-host-20260407';
const VALID_RSA_NO_COMMENT = 'ssh-rsa AAAAB3NzaC1yc2EAAAABJQAAAQEAlONG+base64';

describe('normalizeSshPublicKey', () => {
  it('passes a clean ed25519 key through unchanged', () => {
    expect(normalizeSshPublicKey(VALID_ED25519)).toBe(VALID_ED25519);
  });

  it('accepts a key without a comment', () => {
    expect(normalizeSshPublicKey(VALID_RSA_NO_COMMENT)).toBe(VALID_RSA_NO_COMMENT);
  });

  it('strips surrounding double quotes (env file mishap)', () => {
    expect(normalizeSshPublicKey(`"${VALID_ED25519}"`)).toBe(VALID_ED25519);
  });

  it('strips surrounding single quotes', () => {
    expect(normalizeSshPublicKey(`'${VALID_ED25519}'`)).toBe(VALID_ED25519);
  });

  it('unescapes backslash-escaped spaces (printf %q corruption)', () => {
    const corrupted = 'ssh-ed25519\\ AAAAC3NzaC1lZDI1NTE5AAAAIMEXMvSElkld6uzCDIyIpEjWk9r9SCm0FfNqvqbIEy6H\\ justavps-host-20260407';
    expect(normalizeSshPublicKey(corrupted)).toBe(VALID_ED25519);
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeSshPublicKey(`  \t${VALID_ED25519}\n  `)).toBe(VALID_ED25519);
  });

  it('rejects an empty string', () => {
    expect(() => normalizeSshPublicKey('')).toThrow(/empty/i);
    expect(() => normalizeSshPublicKey('   ')).toThrow(/empty|malformed/i);
  });

  it('rejects a key with internal newlines', () => {
    expect(() => normalizeSshPublicKey('ssh-ed25519\nAAAAC3Nz...\ncomment')).toThrow(/newline/i);
  });

  it('rejects a key missing the base64 body', () => {
    expect(() => normalizeSshPublicKey('ssh-ed25519')).toThrow(/malformed/i);
  });

  it('rejects a key with an unsupported type', () => {
    expect(() => normalizeSshPublicKey('ssh-made-up-type AAAAB3NzaC1yc2E')).toThrow(/unsupported type/i);
  });

  it('rejects a key with invalid base64 characters', () => {
    expect(() => normalizeSshPublicKey('ssh-ed25519 AAAA!!!NOT-BASE64@@@')).toThrow(/base64/i);
  });

  it('preserves multi-word comments', () => {
    const k = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMEXMvSElkld6uzCDIyIpEjWk9r9SCm0FfNqvqbIEy6H justavps host key 20260407';
    expect(normalizeSshPublicKey(k)).toBe(k);
  });
});
