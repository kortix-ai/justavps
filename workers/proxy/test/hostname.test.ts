import { describe, it, expect } from 'vitest';
import { parseHostname } from '../src/hostname';

describe('parseHostname', () => {
  it('should parse simple slug with default port 80', () => {
    expect(parseHostname('abc123.kortix.cloud')).toEqual({
      slug: 'abc123', port: 80, isPty: false,
    });
  });

  it('should parse PORT--SLUG format (single-level subdomain)', () => {
    expect(parseHostname('4096--abc123.kortix.cloud')).toEqual({
      slug: 'abc123', port: 4096, isPty: false,
    });
    expect(parseHostname('3000--def456.kortix.cloud')).toEqual({
      slug: 'def456', port: 3000, isPty: false,
    });
    expect(parseHostname('8080--myserver.kortix.cloud')).toEqual({
      slug: 'myserver', port: 8080, isPty: false,
    });
  });

  it('should parse legacy PORT.SLUG format (two-level subdomain)', () => {
    expect(parseHostname('3000.abc123.kortix.cloud')).toEqual({
      slug: 'abc123', port: 3000, isPty: false,
    });
  });

  it('should handle OpenCode port 3456', () => {
    expect(parseHostname('3456--abc123.kortix.cloud')).toEqual({
      slug: 'abc123', port: 3456, isPty: false,
    });
  });

  it('should detect PTY WebSocket requests', () => {
    expect(parseHostname('abc123.kortix.cloud', '/_pty')).toEqual({
      slug: 'abc123', port: 80, isPty: true,
    });
  });

  it('should parse path-based port routing', () => {
    const result = parseHostname('abc123.kortix.cloud', '/_port/9000/some/path');
    expect(result).toEqual({
      slug: 'abc123', port: 9000, isPty: false, rewrittenPath: '/some/path',
    });
  });

  it('should parse path-based port with no trailing path', () => {
    const result = parseHostname('abc123.kortix.cloud', '/_port/4096');
    expect(result).toEqual({
      slug: 'abc123', port: 4096, isPty: false, rewrittenPath: '/',
    });
  });

  it('should reject invalid hostnames', () => {
    expect(parseHostname('kortix.cloud')).toBeNull();
    expect(parseHostname('invalid.host')).toBeNull();
    expect(parseHostname('')).toBeNull();
    expect(parseHostname('www.kortix.cloud')).toBeNull();
    expect(parseHostname('ab.kortix.cloud')).toBeNull();
  });

  it('should reject invalid port numbers', () => {
    expect(parseHostname('0--abc123.kortix.cloud')).toBeNull();
    expect(parseHostname('99999--abc123.kortix.cloud')).toBeNull();
  });

  it('should lowercase slugs', () => {
    const result = parseHostname('ABC123.kortix.cloud');
    expect(result?.slug).toBe('abc123');
  });
});
