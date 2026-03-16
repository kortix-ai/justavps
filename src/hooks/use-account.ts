import { useQuery } from "@tanstack/react-query";
import { api } from "./api-client";
import type { AccountUsage, BillingPortal } from "@/lib/types";

export const accountKeys = {
  usage: ["account", "usage"] as const,
  billing: ["account", "billing"] as const,
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
