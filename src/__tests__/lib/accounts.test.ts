import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/server/db';
import { users, accounts, accountMemberships, accountInvitations } from '@/server/db/schema';
import {
  ensureUserAccountGraph,
  createOrganizationAccount,
  createAccountInvitation,
  redeemAccountInvitation,
  resolveAccountForUser,
} from "@/server/auth/accounts";
import { hashPassword } from "@/server/core/crypto";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdInvitationIds: string[] = [];

afterAll(async () => {
  if (createdInvitationIds.length) {
    await db.delete(accountInvitations).where(inArray(accountInvitations.id, createdInvitationIds));
  }
  if (createdAccountIds.length) {
    await db.delete(accountMemberships).where(inArray(accountMemberships.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe.skipIf(!process.env.DATABASE_URL)('account and invitation flows', () => {
  it('creates a personal account automatically and resolves active account context', async () => {
    const email = `account-lib-${Date.now()}@example.com`;
    const [user] = await db.insert(users).values({
      email,
      name: 'Account Lib User',
      passwordHash: await hashPassword('TestPass123!'),
    }).returning();
    createdUserIds.push(user.id);

    const personalAccount = await ensureUserAccountGraph(user);
    createdAccountIds.push(personalAccount.id);

    const memberships = await db.select().from(accountMemberships).where(eq(accountMemberships.userId, user.id));
    expect(personalAccount.type).toBe('personal');
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');

    const resolved = await resolveAccountForUser({ ...user, defaultAccountId: personalAccount.id }, null);
    expect(resolved.active.account.id).toBe(personalAccount.id);
    expect(resolved.active.membership.role).toBe('owner');
  });

  it('creates an org invite and redeems it for a matching signed-in user', async () => {
    const ownerEmail = `owner-${Date.now()}@example.com`;
    const inviteeEmail = `invitee-${Date.now()}@example.com`;

    const [owner] = await db.insert(users).values({
      email: ownerEmail,
      name: 'Owner User',
      passwordHash: await hashPassword('TestPass123!'),
    }).returning();
    createdUserIds.push(owner.id);

    const [invitee] = await db.insert(users).values({
      email: inviteeEmail,
      name: 'Invitee User',
      passwordHash: await hashPassword('TestPass123!'),
    }).returning();
    createdUserIds.push(invitee.id);

    const ownerPersonal = await ensureUserAccountGraph(owner);
    const inviteePersonal = await ensureUserAccountGraph(invitee);
    createdAccountIds.push(ownerPersonal.id, inviteePersonal.id);

    const org = await createOrganizationAccount({
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      name: `Org ${Date.now()}`,
    });
    createdAccountIds.push(org.id);

    const { invitation, rawToken } = await createAccountInvitation({
      accountId: org.id,
      email: invitee.email,
      role: 'member',
      invitedByUserId: owner.id,
    });
    createdInvitationIds.push(invitation.id);

    expect(rawToken).toBeTruthy();

    const redeemed = await redeemAccountInvitation({
      token: rawToken!,
      userId: invitee.id,
      userEmail: invitee.email,
    });

    expect(redeemed.membership.accountId).toBe(org.id);
    expect(redeemed.membership.userId).toBe(invitee.id);
    expect(redeemed.membership.role).toBe('member');

    const memberships = await db.select().from(accountMemberships).where(
      and(eq(accountMemberships.userId, invitee.id), eq(accountMemberships.accountId, org.id)),
    );
    expect(memberships).toHaveLength(1);
  });
});
