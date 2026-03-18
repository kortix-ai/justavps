import { describe, it, expect } from 'vitest';
import { parseHostname } from '../src/hostname';

describe('parseHostname', () => {
  it('should parse simple slug with default port 80 (Caddy)', () => {
    const result = parseHostname('abc123.kortix.cloud');
    expect(result).toEqual({
      slug: 'abc123',
      port: 80, // Default: CF Worker → VPS:80 (Caddy → code-server)
      isPty: false,
    });
  });

  it('should parse slug with custom port from subdomain', () => {
    const result = parseHostname('3000.abc123.kortix.cloud');
    expect(result).toEqual({
      slug: 'abc123',
      port: 3000,
      isPty: false,
    });
  });

  it('should handle complex port numbers', () => {
    const result = parseHostname('8080.def456.kortix.cloud');
    expect(result).toEqual({
      slug: 'def456',
      port: 8080,
      isPty: false,
    });
  });

  it('should handle multi-digit ports', () => {
    const result = parseHostname('12345.xyz789.kortix.cloud');
    expect(result).toEqual({
      slug: 'xyz789',
      port: 12345,
      isPty: false,
    });
  });

  it('should handle OpenCode port 3456', () => {
    const result = parseHostname('3456.abc123.kortix.cloud');
    expect(result).toEqual({
      slug: 'abc123',
      port: 3456,
      isPty: false,
    });
  });

  it('should detect PTY WebSocket requests', () => {
    const result = parseHostname('abc123.kortix.cloud', '/_pty');
    expect(result).toEqual({
      slug: 'abc123',
      port: 80,
      isPty: true,
    });
  });

  it('should detect PTY with custom port', () => {
    const result = parseHostname('3000.abc123.kortix.cloud', '/_pty');
    expect(result).toEqual({
      slug: 'abc123',
      port: 3000,
      isPty: true,
    });
  });

  it('should handle www subdomain gracefully', () => {
    expect(parseHostname('www.kortix.cloud')).toBeNull();
  });

  it('should handle invalid hostnames', () => {
    expect(parseHostname('kortix.cloud')).toBeNull();
    expect(parseHostname('invalid.host')).toBeNull();
    expect(parseHostname('')).toBeNull();
  });

  it('should handle malformed port subdomains', () => {
    expect(parseHostname('notaport.abc123.kortix.cloud')).toBeNull();
    expect(parseHostname('0.abc123.kortix.cloud')).toBeNull();
    expect(parseHostname('99999.abc123.kortix.cloud')).toBeNull(); // Port too high
  });

  it('should validate slug format', () => {
    expect(parseHostname('ab.kortix.cloud')).toBeNull(); // Too short
    expect(parseHostname('abc-123.kortix.cloud')).toEqual({
      slug: 'abc-123',
      port: 80,
      isPty: false,
    });
    expect(parseHostname('ABC123.kortix.cloud')).toEqual({
      slug: 'abc123', // Should lowercase
      port: 80,
      isPty: false,
    });
  });
});
