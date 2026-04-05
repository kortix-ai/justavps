import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export function badRequest(message: string) {
  return NextResponse.json({ error: true, message }, { status: 400 });
}

export function conflict(message: string) {
  return NextResponse.json({ error: true, message }, { status: 409 });
}

export function serverError(message = 'Internal server error') {
  return NextResponse.json({ error: true, message }, { status: 500 });
}

export function success<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function firstZodError(error: ZodError): string {
  return error.issues[0]?.message || 'Invalid input';
}
