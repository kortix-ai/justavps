import { randomBytes, createHash } from 'crypto';
import { and, eq, isNull, asc, ne } from 'drizzle-orm';
import { db } from '../db';
import {
  accounts,
  accountInvitations,
  accountLimits,
  accountMemberships,
  apiKeys,
  images,
  machines,
  proxyTokens,
  subscriptions,
  sshKeys,
  users,
  webhooks,
  type Account,
  type AccountInvitation,
  type AccountMembership,
  type User,
} from '../db/schema';

export const ACCOUNT_COOKIE_NAME = '__justavps_account';

export type AccountRole = AccountMembership['role'];
export type AccountWithMembership = {
  account: Account;
  membership: AccountMembership;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'account';
}

async function createUniqueAccountSlug(base: string, excludeAccountId?: string): Promise<string> {
  const normalized = slugify(base);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = attempt === 0
      ? normalized
      : `${normalized}-${randomBytes(3).toString('hex')}`;

    const [existing] = await db.select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.slug, candidate))
      .limit(1);

    if (!existing || existing.id === excludeAccountId) return candidate;
  }

  return `${normalized}-${randomBytes(6).toString('hex')}`;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function ensurePersonalAccountForUser(user: Pick<User, 'id' | 'email' | 'name' | 'stripeCustomerId' | 'defaultAccountId'>) {
  const [existing] = await db.select()
    .from(accounts)
    .where(eq(accounts.personalForUserId, user.id))
    .limit(1);

  if (existing) {
    await ensureMembership(existing.id, user.id, 'owner');

    if (!user.defaultAccountId) {
      await db.update(users)
        .set({ defaultAccountId: existing.id })
        .where(eq(users.id, user.id));
    }

    if (!existing.stripeCustomerId && user.stripeCustomerId) {
      await db.update(accounts)
        .set({ stripeCustomerId: user.stripeCustomerId, updatedAt: new Date() })
        .where(eq(accounts.id, existing.id));
      return { ...existing, stripeCustomerId: user.stripeCustomerId };
    }

    return existing;
  }

  const slug = await createUniqueAccountSlug(user.email.split('@')[0] || user.name || 'personal');
  const [created] = await db.insert(accounts).values({
    type: 'personal',
    name: user.name?.trim() || user.email,
    slug,
    personalForUserId: user.id,
    billingEmail: user.email,
    stripeCustomerId: user.stripeCustomerId ?? null,
  }).returning();

  await ensureMembership(created.id, user.id, 'owner');
  await db.update(users).set({ defaultAccountId: created.id }).where(eq(users.id, user.id));
  await backfillLegacyUserResources(user.id, created.id);
  return created;
}

export async function ensureUserAccountGraph(user: Pick<User, 'id' | 'email' | 'name' | 'stripeCustomerId' | 'defaultAccountId'>) {
  const personalAccount = await ensurePersonalAccountForUser(user);
  await backfillLegacyUserResources(user.id, personalAccount.id);
  return personalAccount;
}

export async function ensureMembership(accountId: string, userId: string, role: AccountRole, createdByUserId?: string | null) {
  const [existing] = await db.select()
    .from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, accountId), eq(accountMemberships.userId, userId)))
    .limit(1);

  if (existing) {
    if (existing.role !== role) {
      const [updated] = await db.update(accountMemberships)
        .set({ role, updatedAt: new Date() })
        .where(eq(accountMemberships.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const [created] = await db.insert(accountMemberships).values({
    accountId,
    userId,
    role,
    createdByUserId: createdByUserId ?? null,
  }).returning();

  return created;
}

export async function backfillLegacyUserResources(userId: string, accountId: string) {
  const now = new Date();

  await Promise.all([
    db.update(machines).set({ accountId }).where(and(eq(machines.ownerId, userId), isNull(machines.accountId))),
    db.update(images).set({ accountId }).where(and(eq(images.ownerId, userId), isNull(images.accountId))),
    db.update(sshKeys).set({ accountId }).where(and(eq(sshKeys.ownerId, userId), isNull(sshKeys.accountId))),
    db.update(apiKeys).set({ accountId }).where(and(eq(apiKeys.ownerId, userId), isNull(apiKeys.accountId))),
    db.update(proxyTokens).set({ accountId }).where(and(eq(proxyTokens.ownerId, userId), isNull(proxyTokens.accountId))),
    db.update(webhooks).set({ accountId }).where(and(eq(webhooks.ownerId, userId), isNull(webhooks.accountId))),
    db.update(subscriptions).set({ accountId }).where(and(eq(subscriptions.ownerId, userId), isNull(subscriptions.accountId))),
    db.update(accountLimits).set({ accountId, updatedAt: now }).where(and(eq(accountLimits.userId, userId), isNull(accountLimits.accountId))),
  ]);
}

export async function getAccountById(accountId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return account ?? null;
}

export async function getUserMemberships(userId: string): Promise<AccountWithMembership[]> {
  const rows = await db.select({ account: accounts, membership: accountMemberships })
    .from(accountMemberships)
    .innerJoin(accounts, eq(accountMemberships.accountId, accounts.id))
    .where(and(eq(accountMemberships.userId, userId), isNull(accounts.deletedAt)))
    .orderBy(asc(accounts.createdAt));

  return rows;
}

export async function resolveAccountForUser(user: Pick<User, 'id' | 'email' | 'name' | 'stripeCustomerId' | 'defaultAccountId'>, requestedAccountId?: string | null) {
  await ensureUserAccountGraph(user);

  const memberships = await getUserMemberships(user.id);
  if (memberships.length === 0) {
    throw new Error('User has no account memberships');
  }

  const pick = (accountId?: string | null) => accountId
    ? memberships.find((row) => row.account.id === accountId)
    : undefined;

  let resolved = pick(requestedAccountId) || pick(user.defaultAccountId);
  if (!resolved) {
    resolved = memberships.find((row) => row.account.type === 'personal') || memberships[0];
  }

  if (!user.defaultAccountId || user.defaultAccountId !== resolved.account.id) {
    await db.update(users)
      .set({ defaultAccountId: resolved.account.id })
      .where(eq(users.id, user.id));
  }

  return {
    active: resolved,
    memberships,
  };
}

export async function createOrganizationAccount(params: {
  ownerUserId: string;
  ownerEmail: string;
  name: string;
}) {
  const slug = await createUniqueAccountSlug(params.name);
  const [account] = await db.insert(accounts).values({
    type: 'organization',
    name: params.name.trim(),
    slug,
    billingEmail: params.ownerEmail,
  }).returning();

  await ensureMembership(account.id, params.ownerUserId, 'owner', params.ownerUserId);
  return account;
}

export async function renameOrganizationAccount(params: {
  accountId: string;
  name: string;
}) {
  const trimmedName = params.name.trim();
  const slug = await createUniqueAccountSlug(trimmedName, params.accountId);

  const [account] = await db.update(accounts)
    .set({
      name: trimmedName,
      slug,
      updatedAt: new Date(),
    })
    .where(and(
      eq(accounts.id, params.accountId),
      eq(accounts.type, 'organization'),
      isNull(accounts.deletedAt),
    ))
    .returning();

  return account ?? null;
}

export async function deleteOrganizationAccount(accountId: string) {
  const now = new Date();

  const [machine, image, sshKey, apiKey, proxyToken, subscription, webhook] = await Promise.all([
    db.select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.accountId, accountId), isNull(machines.deletedAt)))
      .limit(1),
    db.select({ id: images.id })
      .from(images)
      .where(and(eq(images.accountId, accountId), ne(images.status, 'deleted')))
      .limit(1),
    db.select({ id: sshKeys.id })
      .from(sshKeys)
      .where(eq(sshKeys.accountId, accountId))
      .limit(1),
    db.select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.accountId, accountId))
      .limit(1),
    db.select({ id: proxyTokens.id })
      .from(proxyTokens)
      .where(and(eq(proxyTokens.accountId, accountId), isNull(proxyTokens.revokedAt)))
      .limit(1),
    db.select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.accountId, accountId))
      .limit(1),
    db.select({ id: webhooks.id })
      .from(webhooks)
      .where(eq(webhooks.accountId, accountId))
      .limit(1),
  ]);

  if (machine.length > 0) throw new Error('Delete all machines before deleting this organization');
  if (image.length > 0) throw new Error('Delete all images before deleting this organization');
  if (sshKey.length > 0) throw new Error('Delete all SSH keys before deleting this organization');
  if (apiKey.length > 0) throw new Error('Delete all API keys before deleting this organization');
  if (proxyToken.length > 0) throw new Error('Revoke all proxy tokens before deleting this organization');
  if (subscription.length > 0) throw new Error('Cancel all subscriptions before deleting this organization');
  if (webhook.length > 0) throw new Error('Delete all webhooks before deleting this organization');

  await db.transaction(async (tx) => {
    await tx.update(accountInvitations)
      .set({ revokedAt: now })
      .where(and(
        eq(accountInvitations.accountId, accountId),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.revokedAt),
      ));

    await tx.delete(accountMemberships).where(eq(accountMemberships.accountId, accountId));

    await tx.update(accounts)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(
        eq(accounts.id, accountId),
        eq(accounts.type, 'organization'),
        isNull(accounts.deletedAt),
      ));
  });
}

export async function createAccountInvitation(params: {
  accountId: string;
  email: string;
  role: AccountRole;
  invitedByUserId: string;
}) {
  const email = params.email.trim().toLowerCase();

  await db.update(accountInvitations)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(accountInvitations.accountId, params.accountId),
      eq(accountInvitations.email, email),
      isNull(accountInvitations.acceptedAt),
      isNull(accountInvitations.revokedAt),
    ));

  const rawToken = randomBytes(32).toString('hex');
  const tokenSha256 = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [invitation] = await db.insert(accountInvitations).values({
    accountId: params.accountId,
    email,
    role: params.role,
    tokenSha256,
    invitedByUserId: params.invitedByUserId,
    expiresAt,
  }).returning();

  return { invitation, rawToken, reused: false };
}

export async function getInvitationByToken(token: string) {
  const [invitation] = await db.select()
    .from(accountInvitations)
    .where(eq(accountInvitations.tokenSha256, hashInvitationToken(token)))
    .limit(1);

  return invitation ?? null;
}

export async function redeemAccountInvitation(params: {
  token: string;
  userId: string;
  userEmail: string;
}) {
  const invitation = await getInvitationByToken(params.token);
  if (!invitation) {
    throw new Error('Invitation not found');
  }
  if (invitation.revokedAt) {
    throw new Error('Invitation has been revoked');
  }
  if (invitation.acceptedAt) {
    throw new Error('Invitation has already been accepted');
  }
  if (invitation.expiresAt < new Date()) {
    throw new Error('Invitation has expired');
  }
  if (invitation.email !== params.userEmail.trim().toLowerCase()) {
    throw new Error('Signed-in email does not match invitation email');
  }

  const membership = await ensureMembership(invitation.accountId, params.userId, invitation.role, invitation.invitedByUserId);

  await db.update(accountInvitations)
    .set({ acceptedAt: new Date(), acceptedByUserId: params.userId })
    .where(eq(accountInvitations.id, invitation.id));

  return { invitation, membership };
}

export async function listActiveInvitationsForAccount(accountId: string) {
  return db.select()
    .from(accountInvitations)
    .where(and(
      eq(accountInvitations.accountId, accountId),
      isNull(accountInvitations.acceptedAt),
      isNull(accountInvitations.revokedAt),
    ));
}

/**
 * List all pending (not accepted, not revoked, not expired) invitations
 * addressed to a specific email. Joins the account table so we can return
 * the account name / type to the caller.
 */
export async function listPendingInvitationsForEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const now = new Date();
  const rows = await db
    .select({ invitation: accountInvitations, account: accounts })
    .from(accountInvitations)
    .innerJoin(accounts, eq(accountInvitations.accountId, accounts.id))
    .where(and(
      eq(accountInvitations.email, normalized),
      isNull(accountInvitations.acceptedAt),
      isNull(accountInvitations.revokedAt),
    ));

  // Filter expired in JS (simpler than gt/lt with Drizzle timestamps)
  return rows.filter((r) => r.invitation.expiresAt > now);
}

/**
 * Accept an invitation by ID — used when the signed-in user can see the
 * invitation in the sidebar (matched by email) and clicks "Accept".
 * No raw token is needed because the server already validated email match.
 */
export async function acceptInvitationById(params: {
  invitationId: string;
  userId: string;
  userEmail: string;
}) {
  const [invitation] = await db.select()
    .from(accountInvitations)
    .where(eq(accountInvitations.id, params.invitationId))
    .limit(1);

  if (!invitation) throw new Error('Invitation not found');
  if (invitation.revokedAt) throw new Error('Invitation has been revoked');
  if (invitation.acceptedAt) throw new Error('Invitation has already been accepted');
  if (invitation.expiresAt < new Date()) throw new Error('Invitation has expired');
  if (invitation.email !== params.userEmail.trim().toLowerCase()) {
    throw new Error('Signed-in email does not match invitation email');
  }

  const membership = await ensureMembership(
    invitation.accountId, params.userId, invitation.role, invitation.invitedByUserId,
  );

  await db.update(accountInvitations)
    .set({ acceptedAt: new Date(), acceptedByUserId: params.userId })
    .where(eq(accountInvitations.id, invitation.id));

  return { invitation, membership };
}

export async function revokeInvitation(accountId: string, invitationId: string) {
  const [updated] = await db.update(accountInvitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(accountInvitations.accountId, accountId), eq(accountInvitations.id, invitationId)))
    .returning();

  return updated ?? null;
}

export async function listMembersForAccount(accountId: string) {
  return db.select({ membership: accountMemberships, user: users })
    .from(accountMemberships)
    .innerJoin(users, eq(accountMemberships.userId, users.id))
    .where(eq(accountMemberships.accountId, accountId))
    .orderBy(asc(accountMemberships.createdAt));
}

export async function updateMembershipRole(accountId: string, membershipId: string, role: AccountRole) {
  const [existing] = await db.select()
    .from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, accountId), eq(accountMemberships.id, membershipId)))
    .limit(1);

  if (!existing) return null;

  if (existing.role === 'owner' && role !== 'owner') {
    const owners = await db.select({ id: accountMemberships.id })
      .from(accountMemberships)
      .where(and(eq(accountMemberships.accountId, accountId), eq(accountMemberships.role, 'owner')));

    if (owners.length <= 1) {
      throw new Error('An account must keep at least one owner');
    }
  }

  const [updated] = await db.update(accountMemberships)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(accountMemberships.accountId, accountId), eq(accountMemberships.id, membershipId)))
    .returning();

  return updated ?? null;
}

export async function removeMembership(accountId: string, membershipId: string) {
  const [membership] = await db.select()
    .from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, accountId), eq(accountMemberships.id, membershipId)))
    .limit(1);

  if (!membership) return null;

  if (membership.role === 'owner') {
    const owners = await db.select({ id: accountMemberships.id })
      .from(accountMemberships)
      .where(and(eq(accountMemberships.accountId, accountId), eq(accountMemberships.role, 'owner')));

    if (owners.length <= 1) {
      throw new Error('An account must keep at least one owner');
    }
  }

  await db.delete(accountMemberships).where(eq(accountMemberships.id, membershipId));
  return membership;
}

export async function getPrimaryOwnerUserForAccount(accountId: string) {
  const [row] = await db.select({ user: users })
    .from(accountMemberships)
    .innerJoin(users, eq(accountMemberships.userId, users.id))
    .where(and(eq(accountMemberships.accountId, accountId), eq(accountMemberships.role, 'owner')))
    .orderBy(asc(accountMemberships.createdAt))
    .limit(1);

  return row?.user ?? null;
}

export async function resolveActorUserIdForAccount(accountId: string): Promise<string | null> {
  const owner = await getPrimaryOwnerUserForAccount(accountId);
  return owner?.id ?? null;
}

export async function getAccountForInvitation(invitation: AccountInvitation) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, invitation.accountId)).limit(1);
  return account ?? null;
}

export async function userHasAccountAccess(userId: string, accountId: string) {
  const [membership] = await db.select()
    .from(accountMemberships)
    .where(and(eq(accountMemberships.userId, userId), eq(accountMemberships.accountId, accountId)))
    .limit(1);
  return membership ?? null;
}

export function canManageMembers(role?: AccountRole | null) {
  return role === 'owner' || role === 'admin';
}

export function canManageBilling(role?: AccountRole | null) {
  return role === 'owner' || role === 'admin';
}

export function isAccountOwner(role?: AccountRole | null) {
  return role === 'owner';
}

export function isAccountAdmin(role?: AccountRole | null) {
  return role === 'owner' || role === 'admin';
}
