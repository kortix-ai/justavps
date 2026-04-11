/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Database connection — supports both local Postgres and Neon serverless.
 * Uses postgres.js for local dev, falls back to Neon for serverless deployment.
 */

import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let _db: ReturnType<typeof drizzlePostgres<typeof schema>> | null = null;

declare global {
  var __justavpsSql: ReturnType<typeof postgres> | undefined;
  var __justavpsDb: ReturnType<typeof drizzlePostgres<typeof schema>> | undefined;
}

export function getDb() {
  if (!_db) {
    if (globalThis.__justavpsDb) {
      _db = globalThis.__justavpsDb;
      return _db;
    }

    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL not set. Configure it in .env');
    }
    // In CI/production environments the DB requires SSL. postgres.js needs
    // ssl:true passed as an option (sslmode=require in the URL is not enough).
    const requireSsl = url.includes('sslmode=require') || url.includes('ssl=require') || process.env.DB_SSL === 'true';
    const sql = globalThis.__justavpsSql ?? postgres(url, {
      ...(requireSsl ? { ssl: 'require' as const } : {}),
      max: Number(process.env.DB_MAX_CONNECTIONS || 5),
      idle_timeout: Number(process.env.DB_IDLE_TIMEOUT_SECONDS || 20),
      max_lifetime: Number(process.env.DB_MAX_LIFETIME_SECONDS || 60 * 30),
      application_name: process.env.DB_APPLICATION_NAME || 'justavps-api',
    });
    globalThis.__justavpsSql = sql;
    _db = drizzlePostgres(sql, { schema });
    globalThis.__justavpsDb = _db;
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
