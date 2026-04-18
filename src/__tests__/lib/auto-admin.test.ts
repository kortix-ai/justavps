import { describe, expect, it } from 'vitest';
import { isAutoAdminEmail } from "@/server/auth/auto-admin";

describe('isAutoAdminEmail', () => {
  it('matches kortix.ai addresses', () => {
    expect(isAutoAdminEmail('marko@kortix.ai')).toBe(true);
  });

  it('matches kortix.com addresses after normalization', () => {
    expect(isAutoAdminEmail('  MARKO@KORTIX.COM ')).toBe(true);
  });

  it('rejects unrelated domains', () => {
    expect(isAutoAdminEmail('marko@example.com')).toBe(false);
    expect(isAutoAdminEmail('marko@notkortix.com')).toBe(false);
  });
});
