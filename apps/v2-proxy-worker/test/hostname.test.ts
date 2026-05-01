import { describe, expect, it } from 'vitest';
import { cookieDomainFor, parseHostname } from '../src/hostname';

const UUID = 'fd7510ee-2be6-49f2-a747-c0ccd2660c53';

describe('v2 hostname parsing', () => {
  it('parses UUID path on the isolated v2 dev host by default', () => {
    expect(parseHostname('v2.kortix-dev.cloud', `/${UUID}/`)).toEqual({ slug: UUID, port: 80, rewrittenPath: '/' });
  });

  it('parses port--UUID paths', () => {
    expect(parseHostname('v2.kortix-dev.cloud', `/8000--${UUID}/app`)).toEqual({ slug: UUID, port: 8000, rewrittenPath: '/app' });
  });

  it('parses host-based path port routing for custom domains', () => {
    expect(parseHostname(`v2-${UUID}.kortix-dev.cloud`, '/_port/3000/app')).toEqual({ slug: UUID, port: 3000, rewrittenPath: '/app' });
  });

  it('supports explicit custom domains without code changes', () => {
    expect(parseHostname(`v2-${UUID}.sandboxes.example.com`, '/', 'sandboxes.example.com')).toEqual({ slug: UUID, port: 80 });
    expect(parseHostname('v2.kortix-dev.cloud', `/${UUID}/`, 'sandboxes.example.com')).toBeNull();
  });

  it('rejects nested hostnames and reserved slugs', () => {
    expect(parseHostname(`foo.v2-${UUID}.kortix-dev.cloud`)).toBeNull();
    expect(parseHostname('www.kortix-dev.cloud')).toBeNull();
  });

  it('derives cookie domain from configured proxy suffix', () => {
    expect(cookieDomainFor('v2.kortix-dev.cloud', 'kortix-dev.cloud')).toBe('.kortix-dev.cloud');
    expect(cookieDomainFor(`v2-${UUID}.sandboxes.example.com`, 'sandboxes.example.com')).toBe('.sandboxes.example.com');
  });
});
