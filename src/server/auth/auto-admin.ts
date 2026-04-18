import { eq } from 'drizzle-orm';
import { db } from "@/server/db/index";
import { users } from "@/server/db/schema";

const AUTO_ADMIN_EMAIL_DOMAINS = ['kortix.ai', 'kortix.com'] as const;

export function isAutoAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return AUTO_ADMIN_EMAIL_DOMAINS.some((domain) => normalized.endsWith(`@${domain}`));
}

type AutoAdminUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  emailVerified: Date | null;
};

export async function ensureAutoAdminUser<T extends AutoAdminUser>(user: T): Promise<T> {
  if (user.isAdmin) return user;
  if (!user.emailVerified) return user;
  if (!isAutoAdminEmail(user.email)) return user;

  await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id));
  return { ...user, isAdmin: true } as T;
}
