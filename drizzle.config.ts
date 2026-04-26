import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

export default defineConfig({
  schema: './apps/v1-api/src/server/db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://justavps:justavps123@localhost:54330/justavps',
  },
});
