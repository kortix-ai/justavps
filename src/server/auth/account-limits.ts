/**
 * Account limits — utility functions for checking and retrieving per-account resource limits.
 * Used by machine/image creation routes to enforce caps.
 */

import { eq, and, ne } from 'drizzle-orm';
import { db } from "@/server/db/index";
import { accountLimits, machines, images, users } from "@/server/db/schema";
import { ensureAutoAdminUser } from "@/server/auth/auto-admin";

/** Default limits applied when no row exists for a user */
export const DEFAULT_LIMITS = {
  maxMachines: 5,
  maxImages: 10,
} as const;

export const ADMIN_UNLIMITED_LIMIT = Number.MAX_SAFE_INTEGER;

async function hasUnlimitedAccountLimits(userId: string | null | undefined, isAdmin = false): Promise<boolean> {
  if (isAdmin) return true;
  if (!userId) return false;

  const [user] = await db
    .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return false;

  const resolvedUser = await ensureAutoAdminUser(user);
  return resolvedUser.isAdmin;
}

/**
 * Get the resource limits for an account. Returns defaults if no row exists.
 */
export async function getAccountLimits(accountId: string, userId?: string | null, isAdmin = false) {
  if (await hasUnlimitedAccountLimits(userId, isAdmin)) {
    return {
      maxMachines: ADMIN_UNLIMITED_LIMIT,
      maxImages: ADMIN_UNLIMITED_LIMIT,
    };
  }

  const [row] = await db.select().from(accountLimits).where(eq(accountLimits.accountId, accountId));
  return {
    maxMachines: row?.maxMachines ?? DEFAULT_LIMITS.maxMachines,
    maxImages: row?.maxImages ?? DEFAULT_LIMITS.maxImages,
  };
}

/**
 * Count active (non-deleted) machines for an account.
 */
export async function countActiveMachines(accountId: string): Promise<number> {
  const rows = await db.select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.accountId, accountId), ne(machines.status, 'deleted')));
  return rows.length;
}

/**
 * Count active (non-deleted, non-public) images for an account.
 */
export async function countActiveImages(accountId: string): Promise<number> {
  const rows = await db.select({ id: images.id })
    .from(images)
    .where(and(
      eq(images.accountId, accountId),
      ne(images.status, 'deleted'),
      eq(images.isTemplate, false),
    ));
  return rows.length;
}

/**
 * Check if the account can create another machine. Returns { allowed, current, max }.
 */
export async function checkMachineLimit(accountId: string, userId?: string | null, isAdmin = false) {
  const [limits, current] = await Promise.all([
    getAccountLimits(accountId, userId, isAdmin),
    countActiveMachines(accountId),
  ]);
  return {
    allowed: current < limits.maxMachines,
    current,
    max: limits.maxMachines,
  };
}

/**
 * Check if the account can create another image. Returns { allowed, current, max }.
 */
export async function checkImageLimit(accountId: string, userId?: string | null, isAdmin = false) {
  const [limits, current] = await Promise.all([
    getAccountLimits(accountId, userId, isAdmin),
    countActiveImages(accountId),
  ]);
  return {
    allowed: current < limits.maxImages,
    current,
    max: limits.maxImages,
  };
}
