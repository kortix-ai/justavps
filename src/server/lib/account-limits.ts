/**
 * Account limits — utility functions for checking and retrieving per-user resource limits.
 * Used by machine/image creation routes to enforce caps.
 */

import { eq, and, ne } from 'drizzle-orm';
import { db } from '../db';
import { accountLimits, machines, images } from '../db/schema';

/** Default limits applied when no row exists for a user */
export const DEFAULT_LIMITS = {
  maxMachines: 5,
  maxImages: 10,
} as const;

/**
 * Get the resource limits for a user. Returns defaults if no row exists.
 */
export async function getAccountLimits(userId: string) {
  const [row] = await db.select().from(accountLimits).where(eq(accountLimits.userId, userId));
  return {
    maxMachines: row?.maxMachines ?? DEFAULT_LIMITS.maxMachines,
    maxImages: row?.maxImages ?? DEFAULT_LIMITS.maxImages,
  };
}

/**
 * Count active (non-deleted) machines for a user.
 */
export async function countActiveMachines(userId: string): Promise<number> {
  const rows = await db.select({ id: machines.id })
    .from(machines)
    .where(and(eq(machines.ownerId, userId), ne(machines.status, 'deleted')));
  return rows.length;
}

/**
 * Count active (non-deleted, non-public) images for a user.
 */
export async function countActiveImages(userId: string): Promise<number> {
  const rows = await db.select({ id: images.id })
    .from(images)
    .where(and(
      eq(images.ownerId, userId),
      ne(images.status, 'deleted'),
      eq(images.isTemplate, false),
    ));
  return rows.length;
}

/**
 * Check if the user can create another machine. Returns { allowed, current, max }.
 */
export async function checkMachineLimit(userId: string) {
  const [limits, current] = await Promise.all([
    getAccountLimits(userId),
    countActiveMachines(userId),
  ]);
  return {
    allowed: current < limits.maxMachines,
    current,
    max: limits.maxMachines,
  };
}

/**
 * Check if the user can create another image. Returns { allowed, current, max }.
 */
export async function checkImageLimit(userId: string) {
  const [limits, current] = await Promise.all([
    getAccountLimits(userId),
    countActiveImages(userId),
  ]);
  return {
    allowed: current < limits.maxImages,
    current,
    max: limits.maxImages,
  };
}
