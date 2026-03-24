import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "./api-client";
import type {
  AccountUsage,
  AccountLimits,
  BillingPortal,
  BillingSetup,
  AccountProfile,
  CurrentUserContext,
  AccountMembershipSummary,
  AccountInvitation,
  AccountMember,
} from "@/lib/types";

export const accountKeys = {
  profile: ["account", "profile"] as const,
  usage: ["account", "usage"] as const,
  billing: ["account", "billing"] as const,
  limits: ["account", "limits"] as const,
  me: ["account", "me"] as const,
  memberships: ["account", "memberships"] as const,
  members: ["account", "members"] as const,
  invitations: ["account", "invitations"] as const,
};

export function useAccount() {
  return useQuery({
    queryKey: accountKeys.profile,
    queryFn: () => api.get<AccountProfile>("/account"),
  });
}

export function useUsage() {
  return useQuery({
    queryKey: accountKeys.usage,
    queryFn: () => api.get<AccountUsage>("/account/usage"),
  });
}

export function useMe() {
  return useQuery({
    queryKey: accountKeys.me,
    queryFn: () => api.get<CurrentUserContext>("/account/me"),
  });
}

export function useAccountMemberships() {
  return useQuery({
    queryKey: accountKeys.memberships,
    queryFn: async () => {
      const data = await api.get<{ memberships: AccountMembershipSummary[] }>("/account/memberships");
      return data.memberships;
    },
  });
}

export function useAccountMembers(enabled = true) {
  return useQuery({
    queryKey: accountKeys.members,
    queryFn: async () => {
      const data = await api.get<{ members: AccountMember[] }>("/account/members");
      return data.members;
    },
    enabled,
  });
}

export function useAccountInvitations(enabled = true) {
  return useQuery({
    queryKey: accountKeys.invitations,
    queryFn: async () => {
      const data = await api.get<{ invitations: AccountInvitation[] }>("/account/invitations");
      return data.invitations;
    },
    enabled,
  });
}

export function useBillingPortal() {
  return useQuery({
    queryKey: accountKeys.billing,
    queryFn: () => api.get<BillingPortal>("/account/billing"),
  });
}

export function useAccountLimits(enabled = true) {
  return useQuery({
    queryKey: accountKeys.limits,
    queryFn: () => api.get<AccountLimits>("/account/limits"),
    enabled,
  });
}

/**
 * Mutation to create a Stripe Checkout session for adding a payment method.
 * On success, redirects the browser to the Stripe Checkout page.
 */
export function useSetupPaymentMethod() {
  return useMutation({
    mutationFn: () => api.post<BillingSetup>("/account/billing/setup"),
    onSuccess: (data) => {
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    },
  });
}

export function useSetAccountPassword() {
  return useMutation({
    mutationFn: (password: string) => api.post<{ ok: true }>("/account/password", { password }),
  });
}

export function useSwitchAccount() {
  return useMutation({
    mutationFn: (accountId: string) => api.post<{ ok: true; account_id: string }>("/account/switch", { account_id: accountId }),
  });
}

export function useCreateOrganization() {
  return useMutation({
    mutationFn: (name: string) => api.post<{ id: string; name: string; slug: string }>("/account/organizations", { name }),
  });
}

export function useInviteAccountMember() {
  return useMutation({
    mutationFn: (input: { email: string; role: "owner" | "admin" | "member" }) =>
      api.post<{ id: string; email: string; role: string; expires_at: string }>("/account/invitations", input),
  });
}

export function useRedeemInvitation() {
  return useMutation({
    mutationFn: (token: string) => api.post<{ ok: true; account_id: string; redirect_to: string }>("/account/invitations/redeem", { token }),
  });
}

export function useUpdateMemberRole() {
  return useMutation({
    mutationFn: (input: { membershipId: string; role: "owner" | "admin" | "member" }) =>
      api.patch<{ ok: true }>(`/account/members/${input.membershipId}`, { role: input.role }),
  });
}

export function useRemoveMember() {
  return useMutation({
    mutationFn: (membershipId: string) => api.delete(`/account/members/${membershipId}`),
  });
}

export function useRevokeInvitation() {
  return useMutation({
    mutationFn: (invitationId: string) => api.delete(`/account/invitations/${invitationId}`),
  });
}
