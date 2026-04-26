import type { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateBindingValue } from './auth-tokens';

export const VERIFICATION_BINDING_COOKIE = 'justavps.verify-binding';
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

type CookieOptions = {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
};

function buildCookieOptions(value: string): CookieOptions {
  return {
    name: VERIFICATION_BINDING_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export function issueVerificationBinding(response: NextResponse): string {
  const value = generateBindingValue();
  response.cookies.set(buildCookieOptions(value));
  return value;
}

export function readVerificationBinding(request: NextRequest): string | null {
  return request.cookies.get(VERIFICATION_BINDING_COOKIE)?.value ?? null;
}

export function clearVerificationBinding(response: NextResponse): void {
  response.cookies.set({
    name: VERIFICATION_BINDING_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
