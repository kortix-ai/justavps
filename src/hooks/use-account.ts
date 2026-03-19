import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "./api-client";
import type { AccountUsage, AccountLimits, BillingPortal, BillingSetup } from "@/lib/types";

export const accountKeys = {
  usage: ["account", "usage"] as const,
  billing: ["account", "billing"] as const,
  limits: ["account", "limits"] as const,
};

export function useUsage() {
  return useQuery({
    queryKey: accountKeys.usage,
    queryFn: () => api.get<AccountUsage>("/account/usage"),
  });
}

export function useBillingPortal() {
  return useQuery({
    queryKey: accountKeys.billing,
    queryFn: () => api.get<BillingPortal>("/account/billing"),
  });
}

export function useAccountLimits() {
  return useQuery({
    queryKey: accountKeys.limits,
    queryFn: () => api.get<AccountLimits>("/account/limits"),
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
