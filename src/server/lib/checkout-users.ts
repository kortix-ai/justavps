import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { isAutoAdminEmail } from './auto-admin';
import { ensureUserAccountGraph } from './accounts';

type ResolveCheckoutUserParams = {
  email: string;
  name?: string | null;
  stripeCustomerId?: string | null;
};

export async function resolveCheckoutUser(params: ResolveCheckoutUserParams) {
  const email = params.email.trim().toLowerCase();
  const fallbackName = email.split('@')[0] || 'justavps';
  const desiredName = params.name?.trim() || fallbackName;

  const [existingUser] = await db.select().from(users).where(eq(users.email, email));

  const isAdmin = isAutoAdminEmail(email);

  if (!existingUser) {
    const [createdUser] = await db.insert(users).values({
      email,
      name: desiredName,
      stripeCustomerId: params.stripeCustomerId ?? null,
      passwordHash: null,
      isAdmin,
    }).returning();

    const account = await ensureUserAccountGraph(createdUser);

    return {
      user: createdUser,
      accountId: account.id,
      created: true,
      requiresPasswordSetup: true,
    };
  }

  const updates: Partial<typeof users.$inferInsert> = {};
  if (!existingUser.name && desiredName) {
    updates.name = desiredName;
  }
  if (!existingUser.stripeCustomerId && params.stripeCustomerId) {
    updates.stripeCustomerId = params.stripeCustomerId;
  }
  if (isAdmin && !existingUser.isAdmin) {
    updates.isAdmin = true;
  }

  const user = Object.keys(updates).length > 0
    ? (await db.update(users).set(updates).where(eq(users.id, existingUser.id)).returning())[0]
    : existingUser;

  const account = await ensureUserAccountGraph(user);

  return {
    user,
    accountId: account.id,
    created: false,
    requiresPasswordSetup: !user.passwordHash,
  };
}
