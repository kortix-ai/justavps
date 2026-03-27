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
    // In CI/production environments the DB requires SSL. postgres.js needs
    // ssl:true passed as an option (sslmode=require in the URL is not enough).
    const requireSsl = url.includes('sslmode=require') || url.includes('ssl=require') || process.env.DB_SSL === 'true';
    const sql = postgres(url, requireSsl ? { ssl: 'require' } : {});
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
