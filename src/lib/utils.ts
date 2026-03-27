import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { resolvePlanForDisplay } from "@/lib/plan-catalog"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Proxy domain — single source of truth for client-side code.
 * Set via NEXT_PUBLIC_PROXY_DOMAIN in Vercel env per environment:
 *   Production → kortix.cloud
 *   Preview    → kortix-dev.cloud
 */
export const PROXY_DOMAIN = process.env.NEXT_PUBLIC_PROXY_DOMAIN || 'kortix.cloud';

/**
 * Format a date string as a relative time (e.g. "2 hours ago").
 */
/**
 * Map internal region IDs to user-friendly display labels.
 * Never expose raw provider region codes (e.g. hel1, nbg1) to users.
 */
const REGION_DISPLAY: Record<string, { flag: string; label: string }> = {
  hel1: { flag: "\u{1F1EA}\u{1F1FA}", label: "EU" },
  fsn1: { flag: "\u{1F1EA}\u{1F1FA}", label: "EU" },
  nbg1: { flag: "\u{1F1EA}\u{1F1FA}", label: "EU" },
  hil:  { flag: "\u{1F1FA}\u{1F1F8}", label: "US" },
  ash:  { flag: "\u{1F1FA}\u{1F1F8}", label: "US" },
};

export function regionDisplay(regionId: string): { flag: string; label: string } {
  return REGION_DISPLAY[regionId] ?? { flag: "\u{1F30D}", label: regionId.toUpperCase() };
}

export function planName(serverType: string): string {
  return resolvePlanForDisplay(serverType)?.label ?? serverType;
}

/**
 * Map plan ID or legacy SKU -> actual specs (vcpu / memory GB / disk GB).
 */
export function planSpecs(serverType: string): { vcpu: number; memory: number; disk: number } | null {
  const plan = resolvePlanForDisplay(serverType);
  if (!plan) return null;
  return { vcpu: plan.vcpu, memory: plan.memory, disk: plan.disk };
}

/**
 * Format a date string as a relative time (e.g. "2 hours ago").
 */
export function timeAgo(date: string | null | undefined): string {
  if (!date) return "Never";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

/**
 * Format a date relative to now, handling both past and future values.
 * Examples: "Just now", "5m ago", "in 1h", "in 7d".
 */
export function relativeTime(date: string | null | undefined): string {
  if (!date) return "Never";

  const diffSeconds = Math.floor((new Date(date).getTime() - Date.now()) / 1000);
  const future = diffSeconds > 0;
  const seconds = Math.abs(diffSeconds);

  if (seconds < 60) return future ? "in <1m" : "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  return new Date(date).toLocaleDateString();
}
