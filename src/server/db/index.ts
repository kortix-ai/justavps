/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Database connection — supports both local Postgres and Neon serverless.
 * Uses postgres.js for local dev, falls back to Neon for serverless deployment.
 */

import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let _db: ReturnType<typeof drizzlePostgres<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL not set. Configure it in .env');
    }
    const sql = postgres(url);
    _db = drizzlePostgres(sql, { schema });
  }
  return _db;
}

// Proxy for convenient import: `import { db } from './db'`
export const db = new Proxy({} as ReturnType<typeof drizzlePostgres<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

export type Database = ReturnType<typeof drizzlePostgres<typeof schema>>;
export { schema };
