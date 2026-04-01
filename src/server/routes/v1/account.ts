/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { setCookie } from 'hono/cookie';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import {
  accounts,
  accountMemberships,
  machines,
  users,
} from '../../db/schema';
import { apiGuard, type AuthVariables } from '../../lib/api-guard';
import { stripeClient } from '../../lib/stripe';
import { config } from '../../lib/config';
import { hashPassword } from '../../lib/crypto';
import {
  ACCOUNT_COOKIE_NAME,
  acceptInvitationById,
  canManageBilling,
  canManageMembers,
  createAccountInvitation,
  createOrganizationAccount,
  deleteOrganizationAccount,
  getUserMemberships,
  isAccountOwner,
  listActiveInvitationsForAccount,
  listMembersForAccount,
  listPendingInvitationsForEmail,
  renameOrganizationAccount,
  resolveAccountForUser,
  redeemAccountInvitation,
  revokeInvitation,
  removeMembership,
  updateMembershipRole,
  userHasAccountAccess,
} from '../../lib/accounts';
import { emailClient } from '../../lib/email';
import {
  AccountLimitsResponseSchema,
  AccountPasswordSetupSchema,
  AccountUsageResponseSchema,
  BillingResponseSchema,
  BillingSetupResponseSchema,
  ErrorResponseSchema,
} from '@/lib/schemas';
import {
  countActiveImages,
  countActiveMachines,
  getAccountLimits,
} from '../../lib/account-limits';

export const accountApp = new OpenAPIHono<{ Variables: AuthVariables }>();
accountApp.use('*', apiGuard);

const bearerSecurity = [{ bearerAuth: [] as string[] }, { cookieAuth: [] as string[] }] as Record<string, string[]>[];

const ActiveAccountResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  type: z.enum(['personal', 'organization']),
  name: z.string(),
  role: z.enum(['owner', 'admin', 'member']).nullable(),
  email: z.string(),
  user_id: z.string().uuid(),
  user_name: z.string().nullable(),
  has_password: z.boolean(),
  is_admin: z.boolean(),
  can_manage_billing: z.boolean(),
  can_manage_members: z.boolean(),
  machines_count: z.number(),
  stripe_customer_id: z.string().nullable(),
  created_at: z.string(),
});

const MembershipSummarySchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member']),
  account: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    type: z.enum(['personal', 'organization']),
    created_at: z.string(),
  }),
});

const MeResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string(),
    name: z.string().nullable(),
    has_password: z.boolean(),
    is_admin: z.boolean(),
    default_account_id: z.string().uuid().nullable(),
  }),
  active_account: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    type: z.enum(['personal', 'organization']),
    role: z.enum(['owner', 'admin', 'member']).nullable(),
  }),
  memberships: z.array(MembershipSummarySchema),
});

const MembershipListResponseSchema = z.object({
  memberships: z.array(MembershipSummarySchema),
});

const CreateOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
});

const UpdateOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
});

const SwitchAccountSchema = z.object({
  account_id: z.string().uuid(),
});

const MembersResponseSchema = z.object({
  members: z.array(z.object({
    id: z.string().uuid(),
    role: z.enum(['owner', 'admin', 'member']),
    user: z.object({
      id: z.string().uuid(),
      email: z.string(),
      name: z.string().nullable(),
      created_at: z.string(),
    }),
    created_at: z.string(),
  })),
});

const InvitationsResponseSchema = z.object({
  invitations: z.array(z.object({
    id: z.string().uuid(),
    email: z.string(),
    role: z.enum(['owner', 'admin', 'member']),
    expires_at: z.string(),
    created_at: z.string(),
  })),
});

const CreateInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
});

const RedeemInvitationSchema = z.object({
  token: z.string().min(1),
});

const UpdateMembershipRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});

async function getCurrentUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

async function getCurrentAccount(accountId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return account ?? null;
}

function accountCookieOptions(c: any) {
  const url = new URL(c.req.url);
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: url.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 30,
  };
}

function requireBillingManager(c: any) {
  if (!canManageBilling(c.get('accountRole'))) {
    return c.json({ error: true, message: 'Only account owners/admins can manage billing', status: 403 }, 403);
  }
  return null;
}

function requireMemberManager(c: any) {
  if (!canManageMembers(c.get('accountRole'))) {
    return c.json({ error: true, message: 'Only account owners/admins can manage members', status: 403 }, 403);
  }
  return null;
}

async function getOrCreateStripeCustomerForAccount(params: {
  accountId: string;
  fallbackEmail: string;
}) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, params.accountId)).limit(1);
  if (!account) throw new Error('Account not found');

  const billingEmail = account.billingEmail || params.fallbackEmail;
  const customerId = await stripeClient.getOrCreateCustomer(account.id, billingEmail, account.stripeCustomerId);

  if (!account.stripeCustomerId) {
    await db.update(accounts)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(accounts.id, account.id));
  }

  return customerId;
}

const getAccountRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get active account info',
  responses: {
    200: { description: 'Active account details', content: { 'application/json': { schema: ActiveAccountResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(getAccountRoute, async (c) => {
  const userId = c.get('userId');
  const accountId = c.get('accountId');

  const [user, account, machineCount] = await Promise.all([
    getCurrentUser(userId),
    getCurrentAccount(accountId),
    countActiveMachines(accountId),
  ]);

  if (!user || !account) {
    return c.json({ error: true, message: 'Account context not found', status: 404 }, 404);
  }

  return c.json({
    id: account.id,
    slug: account.slug,
    type: account.type,
    name: account.name,
    role: c.get('accountRole'),
    email: user.email,
    user_id: user.id,
    user_name: user.name,
    has_password: !!user.passwordHash,
    is_admin: user.isAdmin,
    can_manage_billing: canManageBilling(c.get('accountRole')),
    can_manage_members: canManageMembers(c.get('accountRole')),
    machines_count: machineCount,
    stripe_customer_id: account.stripeCustomerId ?? null,
    created_at: account.createdAt.toISOString(),
  });
});

const updateAccountRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Rename active organization account',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: UpdateOrganizationSchema } },
    },
  },
  responses: {
    200: { description: 'Active account updated', content: { 'application/json': { schema: ActiveAccountResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Not Found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(updateAccountRoute, async (c) => {
  const userId = c.get('userId');
  const accountId = c.get('accountId');

  if (!canManageMembers(c.get('accountRole'))) {
    return c.json({ error: true, message: 'Only account owners/admins can rename organizations', status: 403 }, 403);
  }

  const [user, existingAccount] = await Promise.all([
    getCurrentUser(userId),
    getCurrentAccount(accountId),
  ]);

  if (!user || !existingAccount) {
    return c.json({ error: true, message: 'Account context not found', status: 404 }, 404);
  }

  if (existingAccount.type !== 'organization') {
    return c.json({ error: true, message: 'Only organization accounts can be renamed', status: 403 }, 403);
  }

  const { name } = c.req.valid('json');
  const account = await renameOrganizationAccount({ accountId, name });

  if (!account) {
    return c.json({ error: true, message: 'Organization not found', status: 404 }, 404);
  }

  const machineCount = await countActiveMachines(account.id);

  return c.json({
    id: account.id,
    slug: account.slug,
    type: account.type,
    name: account.name,
    role: c.get('accountRole'),
    email: user.email,
    user_id: user.id,
    user_name: user.name,
    has_password: !!user.passwordHash,
    is_admin: user.isAdmin,
    can_manage_billing: canManageBilling(c.get('accountRole')),
    can_manage_members: canManageMembers(c.get('accountRole')),
    machines_count: machineCount,
    stripe_customer_id: account.stripeCustomerId ?? null,
    created_at: account.createdAt.toISOString(),
  });
});

const getMeRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get current user + memberships',
  responses: {
    200: { description: 'Current user and memberships', content: { 'application/json': { schema: MeResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(getMeRoute, async (c) => {
  const userId = c.get('userId');
  const accountId = c.get('accountId');
  const [user, memberships] = await Promise.all([
    getCurrentUser(userId),
    getUserMemberships(userId),
  ]);

  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  const activeMembership = memberships.find((row) => row.account.id === accountId) ?? memberships[0];

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      has_password: !!user.passwordHash,
      is_admin: user.isAdmin,
      default_account_id: user.defaultAccountId ?? null,
    },
    active_account: {
      id: activeMembership.account.id,
      name: activeMembership.account.name,
      slug: activeMembership.account.slug,
      type: activeMembership.account.type,
      role: activeMembership.membership.role,
    },
    memberships: memberships.map((row) => ({
      id: row.membership.id,
      role: row.membership.role,
      account: {
        id: row.account.id,
        name: row.account.name,
        slug: row.account.slug,
        type: row.account.type,
        created_at: row.account.createdAt.toISOString(),
      },
    })),
  });
});

const listMembershipsRoute = createRoute({
  method: 'get',
  path: '/memberships',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'List accessible accounts',
  responses: {
    200: { description: 'List memberships', content: { 'application/json': { schema: MembershipListResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(listMembershipsRoute, async (c) => {
  const userId = c.get('userId');
  const memberships = await getUserMemberships(userId);
  return c.json({
    memberships: memberships.map((row) => ({
      id: row.membership.id,
      role: row.membership.role,
      account: {
        id: row.account.id,
        name: row.account.name,
        slug: row.account.slug,
        type: row.account.type,
        created_at: row.account.createdAt.toISOString(),
      },
    })),
  });
});

const switchAccountRoute = createRoute({
  method: 'post',
  path: '/switch',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Switch active account',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SwitchAccountSchema } },
    },
  },
  responses: {
    200: { description: 'Account switched', content: { 'application/json': { schema: z.object({ ok: z.literal(true), account_id: z.string().uuid() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(switchAccountRoute, async (c) => {
  const userId = c.get('userId');
  const { account_id } = c.req.valid('json');
  const membership = await userHasAccountAccess(userId, account_id);

  if (!membership) {
    return c.json({ error: true, message: 'Account access denied', status: 403 }, 403);
  }

  setCookie(c, ACCOUNT_COOKIE_NAME, account_id, accountCookieOptions(c));
  await db.update(users).set({ defaultAccountId: account_id }).where(eq(users.id, userId));
  return c.json({ ok: true, account_id });
});

const createOrganizationRoute = createRoute({
  method: 'post',
  path: '/organizations',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Create an organization account',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateOrganizationSchema } },
    },
  },
  responses: {
    201: { description: 'Organization created', content: { 'application/json': { schema: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }) } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(createOrganizationRoute, async (c) => {
  const userId = c.get('userId');
  const user = await getCurrentUser(userId);
  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  const { name } = c.req.valid('json');
  const account = await createOrganizationAccount({
    ownerUserId: user.id,
    ownerEmail: user.email,
    name,
  });

  setCookie(c, ACCOUNT_COOKIE_NAME, account.id, accountCookieOptions(c));
  await db.update(users).set({ defaultAccountId: account.id }).where(eq(users.id, user.id));

  return c.json({ id: account.id, name: account.name, slug: account.slug }, 201);
});

const getAccountUsageRoute = createRoute({
  method: 'get',
  path: '/usage',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get active account usage',
  responses: {
    200: { description: 'Usage statistics', content: { 'application/json': { schema: AccountUsageResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(getAccountUsageRoute, async (c) => {
  const accountId = c.get('accountId');
  const userMachines = await db.select().from(machines)
    .where(eq(machines.accountId, accountId))
    .then((rows) => rows.filter((row) => row.status !== 'deleted'));

  const estimatedCost = userMachines.reduce((sum, machine) => sum + (machine.priceMonthly ?? 0), 0);

  return c.json({
    current_period: {
      machines: userMachines.map((machine) => ({
        id: machine.id,
        slug: machine.slug,
        server_type: machine.serverType,
        status: machine.status,
      })),
      total_machines: userMachines.length,
      estimated_cost: estimatedCost,
    },
  });
});

const getBillingRoute = createRoute({
  method: 'get',
  path: '/billing',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get active account billing info',
  responses: {
    200: { description: 'Billing info', content: { 'application/json': { schema: BillingResponseSchema.extend({ can_manage_billing: z.boolean() }) } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(getBillingRoute, async (c) => {
  const userId = c.get('userId');
  const accountId = c.get('accountId');
  const canManage = canManageBilling(c.get('accountRole'));
  const [user, account] = await Promise.all([
    getCurrentUser(userId),
    getCurrentAccount(accountId),
  ]);

  if (!user || !account) {
    return c.json({ error: true, message: 'Account not found', status: 404 }, 404);
  }

  if (!stripeClient.isConfigured()) {
    return c.json({ portal_url: null, has_payment_method: false, can_manage_billing: canManage, message: 'Stripe not configured' });
  }

  if (!account.stripeCustomerId) {
    return c.json({
      portal_url: null,
      has_payment_method: false,
      can_manage_billing: canManage,
      message: canManage ? 'No payment method on file.' : 'Billing can only be managed by account owners/admins.',
    });
  }

  const hasPM = await stripeClient.hasPaymentMethod(account.stripeCustomerId);
  if (!canManage) {
    return c.json({
      portal_url: null,
      has_payment_method: hasPM,
      can_manage_billing: false,
      message: 'Billing can only be managed by account owners/admins.',
    });
  }

  const portalUrl = await stripeClient.createPortalSession(account.stripeCustomerId, `${config.APP_URL}/billing`);
  if (!portalUrl) {
    // Stale Stripe customer — clear it so next request creates a fresh one
    await db.update(accounts)
      .set({ stripeCustomerId: null, updatedAt: new Date() })
      .where(eq(accounts.id, accountId));
    return c.json({ portal_url: null, has_payment_method: false, can_manage_billing: true, message: 'Billing account needs to be re-linked. Please add a payment method.' });
  }
  return c.json({ portal_url: portalUrl, has_payment_method: hasPM, can_manage_billing: true });
});

const createBillingSetupRoute = createRoute({
  method: 'post',
  path: '/billing/setup',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Create billing setup session for active account',
  responses: {
    200: { description: 'Checkout URL', content: { 'application/json': { schema: BillingSetupResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(createBillingSetupRoute, async (c) => {
  const denied = requireBillingManager(c);
  if (denied) return denied;

  if (!stripeClient.isConfigured()) {
    return c.json({ error: true, message: 'Stripe not configured', status: 503 }, 503);
  }

  const user = await getCurrentUser(c.get('userId'));
  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  const customerId = await getOrCreateStripeCustomerForAccount({
    accountId: c.get('accountId'),
    fallbackEmail: user.email,
  });

  const { url } = await stripeClient.createSetupCheckoutSession({
    customerId,
    successUrl: `${config.APP_URL}/billing`,
    cancelUrl: `${config.APP_URL}/billing`,
  });

  return c.json({ checkout_url: url });
});

const setAccountPasswordRoute = createRoute({
  method: 'post',
  path: '/password',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Set account password',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: AccountPasswordSetupSchema } },
    },
  },
  responses: {
    200: { description: 'Password set successfully' },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(setAccountPasswordRoute, async (c) => {
  const user = await getCurrentUser(c.get('userId'));
  const { password } = c.req.valid('json');

  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }
  if (user.passwordHash) {
    return c.json({ error: true, message: 'Password is already set for this account', status: 400 }, 400);
  }

  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  return c.json({ ok: true as const });
});

const getAccountLimitsRoute = createRoute({
  method: 'get',
  path: '/limits',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Get active account limits',
  responses: {
    200: { description: 'Account limits and usage', content: { 'application/json': { schema: AccountLimitsResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(getAccountLimitsRoute, async (c) => {
  const accountId = c.get('accountId');
  const userId = c.get('userId');
  const isAdmin = c.get('isAdmin');

  const [limits, machineCount, imageCount] = await Promise.all([
    getAccountLimits(accountId, userId, isAdmin),
    countActiveMachines(accountId),
    countActiveImages(accountId),
  ]);

  return c.json({
    limits: {
      max_machines: limits.maxMachines,
      max_images: limits.maxImages,
    },
    usage: {
      machines: machineCount,
      images: imageCount,
    },
  });
});

const listMembersRoute = createRoute({
  method: 'get',
  path: '/members',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'List members of active account',
  responses: {
    200: { description: 'Account members', content: { 'application/json': { schema: MembersResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(listMembersRoute, async (c) => {
  const members = await listMembersForAccount(c.get('accountId'));
  return c.json({
    members: members.map((row) => ({
      id: row.membership.id,
      role: row.membership.role,
      user: {
        id: row.user.id,
        email: row.user.email,
        name: row.user.name,
        created_at: row.user.createdAt.toISOString(),
      },
      created_at: row.membership.createdAt.toISOString(),
    })),
  });
});

const updateMemberRoute = createRoute({
  method: 'patch',
  path: '/members/{membershipId}',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Update member role',
  request: {
    params: z.object({ membershipId: z.string().uuid() }),
    body: {
      required: true,
      content: { 'application/json': { schema: UpdateMembershipRoleSchema } },
    },
  },
  responses: {
    200: { description: 'Member updated', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(updateMemberRoute, async (c) => {
  const denied = requireMemberManager(c);
  if (denied) return denied;

  const activeAccount = await getCurrentAccount(c.get('accountId'));
  if (!activeAccount || activeAccount.type !== 'organization') {
    return c.json({ error: true, message: 'Member roles can only be managed on organization accounts', status: 400 }, 400);
  }

  const { membershipId } = c.req.valid('param');
  const { role } = c.req.valid('json');
  let updated;
  try {
    updated = await updateMembershipRole(c.get('accountId'), membershipId, role);
  } catch (error) {
    return c.json({ error: true, message: error instanceof Error ? error.message : 'Failed to update member', status: 400 }, 400);
  }
  if (!updated) {
    return c.json({ error: true, message: 'Member not found', status: 404 }, 404);
  }
  return c.json({ ok: true });
});

const leaveOrganizationRoute = createRoute({
  method: 'delete',
  path: '/members/me',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Leave active organization',
  responses: {
    200: { description: 'Left organization', content: { 'application/json': { schema: z.object({ ok: z.literal(true), account_id: z.string().uuid() }) } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(leaveOrganizationRoute, async (c) => {
  const userId = c.get('userId');
  const activeAccount = await getCurrentAccount(c.get('accountId'));
  if (!activeAccount || activeAccount.type !== 'organization') {
    return c.json({ error: true, message: 'You can only leave organization accounts', status: 400 }, 400);
  }

  const membership = await userHasAccountAccess(userId, c.get('accountId'));
  if (!membership) {
    return c.json({ error: true, message: 'Membership not found', status: 404 }, 404);
  }

  try {
    await removeMembership(c.get('accountId'), membership.id);
  } catch (error) {
    return c.json({ error: true, message: error instanceof Error ? error.message : 'Failed to leave organization', status: 400 }, 400);
  }

  const user = await getCurrentUser(userId);
  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  const resolved = await resolveAccountForUser(user);
  setCookie(c, ACCOUNT_COOKIE_NAME, resolved.active.account.id, accountCookieOptions(c));
  return c.json({ ok: true, account_id: resolved.active.account.id });
});

const deleteMemberRoute = createRoute({
  method: 'delete',
  path: '/members/{membershipId}',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Remove member from active account',
  request: {
    params: z.object({ membershipId: z.string().uuid() }),
  },
  responses: {
    204: { description: 'Member removed' },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(deleteMemberRoute, async (c) => {
  const denied = requireMemberManager(c);
  if (denied) return denied;

  const activeAccount = await getCurrentAccount(c.get('accountId'));
  if (!activeAccount || activeAccount.type !== 'organization') {
    return c.json({ error: true, message: 'Members can only be removed from organization accounts', status: 400 }, 400);
  }

  const { membershipId } = c.req.valid('param');
  let removed;
  try {
    removed = await removeMembership(c.get('accountId'), membershipId);
  } catch (error) {
    return c.json({ error: true, message: error instanceof Error ? error.message : 'Failed to remove member', status: 400 }, 400);
  }
  if (!removed) {
    return c.json({ error: true, message: 'Member not found', status: 404 }, 404);
  }
  return c.body(null, 204);
});

const deleteOrganizationRoute = createRoute({
  method: 'delete',
  path: '/',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Delete active organization',
  responses: {
    200: { description: 'Organization deleted', content: { 'application/json': { schema: z.object({ ok: z.literal(true), account_id: z.string().uuid() }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(deleteOrganizationRoute, async (c) => {
  const userId = c.get('userId');
  const accountId = c.get('accountId');
  const activeAccount = await getCurrentAccount(accountId);
  if (!activeAccount || activeAccount.type !== 'organization') {
    return c.json({ error: true, message: 'Only organization accounts can be deleted', status: 400 }, 400);
  }
  if (!isAccountOwner(c.get('accountRole'))) {
    return c.json({ error: true, message: 'Only organization owners can delete this organization', status: 403 }, 403);
  }

  try {
    await deleteOrganizationAccount(accountId);
  } catch (error) {
    return c.json({ error: true, message: error instanceof Error ? error.message : 'Failed to delete organization', status: 400 }, 400);
  }

  const user = await getCurrentUser(userId);
  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  const resolved = await resolveAccountForUser(user);
  setCookie(c, ACCOUNT_COOKIE_NAME, resolved.active.account.id, accountCookieOptions(c));
  return c.json({ ok: true, account_id: resolved.active.account.id });
});

const listInvitationsRoute = createRoute({
  method: 'get',
  path: '/invitations',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'List pending invitations for active account',
  responses: {
    200: { description: 'Pending invitations', content: { 'application/json': { schema: InvitationsResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(listInvitationsRoute, async (c) => {
  const denied = requireMemberManager(c);
  if (denied) return denied;

  const activeAccount = await getCurrentAccount(c.get('accountId'));
  if (!activeAccount || activeAccount.type !== 'organization') {
    return c.json({ invitations: [] });
  }

  const invitations = await listActiveInvitationsForAccount(c.get('accountId'));
  return c.json({
    invitations: invitations.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expiresAt.toISOString(),
      created_at: invite.createdAt.toISOString(),
    })),
  });
});

const createInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Invite a user to the active account',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateInvitationSchema } },
    },
  },
  responses: {
    201: { description: 'Invitation created', content: { 'application/json': { schema: z.object({ id: z.string().uuid(), email: z.string(), role: z.string(), expires_at: z.string() }) } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(createInvitationRoute, async (c) => {
  const denied = requireMemberManager(c);
  if (denied) return denied;

  const accountId = c.get('accountId');
  const userId = c.get('userId');
  const actor = await getCurrentUser(userId);
  const account = await getCurrentAccount(accountId);

  if (!actor || !account) {
    return c.json({ error: true, message: 'Account context not found', status: 404 }, 404);
  }
  if (account.type !== 'organization') {
    return c.json({ error: true, message: 'Invitations are only available on organization accounts', status: 400 }, 400);
  }

  const { email, role } = c.req.valid('json');
  const normalizedEmail = email.trim().toLowerCase();

  const existingUsers = await db.select({ userId: users.id })
    .from(users)
    .innerJoin(accountMemberships, eq(accountMemberships.userId, users.id))
    .where(and(eq(users.email, normalizedEmail), eq(accountMemberships.accountId, accountId)));

  if (existingUsers.length > 0) {
    return c.json({ error: true, message: 'That user is already a member of this account', status: 409 }, 409);
  }

  const { invitation, rawToken } = await createAccountInvitation({
    accountId,
    email: normalizedEmail,
    role,
    invitedByUserId: userId,
  });

  if (rawToken) {
    await emailClient.sendAccountInvitationEmail({
      email: normalizedEmail,
      invitedByName: actor.name,
      invitedByEmail: actor.email,
      accountName: account.name,
      role,
      inviteToken: rawToken,
    });
  }

  return c.json({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expires_at: invitation.expiresAt.toISOString(),
  }, 201);
});

const revokeInvitationRoute = createRoute({
  method: 'delete',
  path: '/invitations/{invitationId}',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Revoke an invitation for the active account',
  request: {
    params: z.object({ invitationId: z.string().uuid() }),
  },
  responses: {
    204: { description: 'Invitation revoked' },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(revokeInvitationRoute, async (c) => {
  const denied = requireMemberManager(c);
  if (denied) return denied;

  const activeAccount = await getCurrentAccount(c.get('accountId'));
  if (!activeAccount || activeAccount.type !== 'organization') {
    return c.json({ error: true, message: 'Invitations are only available on organization accounts', status: 400 }, 400);
  }

  const { invitationId } = c.req.valid('param');
  const revoked = await revokeInvitation(c.get('accountId'), invitationId);
  if (!revoked) {
    return c.json({ error: true, message: 'Invitation not found', status: 404 }, 404);
  }
  return c.body(null, 204);
});

const redeemInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations/redeem',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Redeem an account invitation',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: RedeemInvitationSchema } },
    },
  },
  responses: {
    200: { description: 'Invitation redeemed', content: { 'application/json': { schema: z.object({ ok: z.literal(true), account_id: z.string().uuid(), redirect_to: z.string() }) } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(redeemInvitationRoute, async (c) => {
  const user = await getCurrentUser(c.get('userId'));
  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  try {
    const { token } = c.req.valid('json');
    const { invitation } = await redeemAccountInvitation({
      token,
      userId: user.id,
      userEmail: user.email,
    });

    setCookie(c, ACCOUNT_COOKIE_NAME, invitation.accountId, accountCookieOptions(c));
    await db.update(users).set({ defaultAccountId: invitation.accountId }).where(eq(users.id, user.id));

    return c.json({ ok: true, account_id: invitation.accountId, redirect_to: '/machines?invite=accepted' });
  } catch (error) {
    return c.json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to redeem invitation',
      status: 400,
    }, 400);
  }
});

// ─── Incoming invitations for the current user ─────────────────────────────

const MyPendingInvitationsResponseSchema = z.object({
  invitations: z.array(z.object({
    id: z.string().uuid(),
    role: z.enum(['owner', 'admin', 'member']),
    account_name: z.string(),
    account_type: z.enum(['personal', 'organization']),
    expires_at: z.string(),
    created_at: z.string(),
  })),
});

const listMyPendingInvitationsRoute = createRoute({
  method: 'get',
  path: '/me/invitations',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'List pending invitations addressed to the current user',
  responses: {
    200: { description: 'Pending invitations for the signed-in user', content: { 'application/json': { schema: MyPendingInvitationsResponseSchema } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(listMyPendingInvitationsRoute, async (c) => {
  const user = await getCurrentUser(c.get('userId'));
  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  const rows = await listPendingInvitationsForEmail(user.email);
  return c.json({
    invitations: rows.map((r) => ({
      id: r.invitation.id,
      role: r.invitation.role,
      account_name: r.account.name,
      account_type: r.account.type,
      expires_at: r.invitation.expiresAt.toISOString(),
      created_at: r.invitation.createdAt.toISOString(),
    })),
  });
});

const acceptMyInvitationRoute = createRoute({
  method: 'post',
  path: '/me/invitations/{invitationId}/accept',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Accept an invitation addressed to the current user',
  request: {
    params: z.object({ invitationId: z.string().uuid() }),
  },
  responses: {
    200: { description: 'Invitation accepted', content: { 'application/json': { schema: z.object({ ok: z.literal(true), account_id: z.string().uuid() }) } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(acceptMyInvitationRoute, async (c) => {
  const user = await getCurrentUser(c.get('userId'));
  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  try {
    const { invitationId } = c.req.valid('param');
    const { invitation } = await acceptInvitationById({
      invitationId,
      userId: user.id,
      userEmail: user.email,
    });

    return c.json({ ok: true, account_id: invitation.accountId });
  } catch (error) {
    return c.json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to accept invitation',
      status: 400,
    }, 400);
  }
});

const declineMyInvitationRoute = createRoute({
  method: 'post',
  path: '/me/invitations/{invitationId}/decline',
  tags: ['Account'],
  security: bearerSecurity,
  summary: 'Decline an invitation addressed to the current user',
  request: {
    params: z.object({ invitationId: z.string().uuid() }),
  },
  responses: {
    200: { description: 'Invitation declined', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } },
  },
});

// @ts-ignore mixed success/error response shapes are declared above
accountApp.openapi(declineMyInvitationRoute, async (c) => {
  const user = await getCurrentUser(c.get('userId'));
  if (!user) {
    return c.json({ error: true, message: 'User not found', status: 404 }, 404);
  }

  try {
    const { invitationId } = c.req.valid('param');
    // Declining = revoking from the invitee's perspective.
    // Verify the invitation actually belongs to this user's email first.
    const rows = await listPendingInvitationsForEmail(user.email);
    const match = rows.find((r) => r.invitation.id === invitationId);
    if (!match) {
      return c.json({ error: true, message: 'Invitation not found', status: 404 }, 404);
    }

    await revokeInvitation(match.invitation.accountId, invitationId);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({
      error: true,
      message: error instanceof Error ? error.message : 'Failed to decline invitation',
      status: 400,
    }, 400);
  }
});
