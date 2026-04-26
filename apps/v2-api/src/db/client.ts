import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (process.env.V2_DATABASE_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.V2_DATABASE_URL;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL or V2_DATABASE_URL is required');
  prisma ??= new PrismaClient();
  return prisma;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.V2_DATABASE_URL || process.env.DATABASE_URL);
}

export async function disconnectPrisma() {
  if (!prisma) return;
  const current = prisma;
  prisma = null;
  await current.$disconnect();
}
