import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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

/**
 * Map internal server type SKUs to user-friendly plan names.
 * Never expose raw provider SKUs (e.g. cpx32) to users.
 */
const PLAN_NAME_MAP: Record<string, string> = {
  // EU SKUs
  cpx32: "Starter", cpx42: "Pro", cpx52: "Power", cpx62: "Ultra",
  // US SKUs
  cpx11: "Starter", cpx21: "Pro", cpx31: "Power", cpx41: "Ultra",
};

export function planName(serverType: string): string {
  return PLAN_NAME_MAP[serverType] ?? serverType;
}

/**
 * Map SKU → advertised specs (vcpu / memory GB / disk GB).
 * Mirrors PLAN_TIERS in src/server/lib/providers/hetzner.ts.
 */
const PLAN_SPECS_MAP: Record<string, { vcpu: number; memory: number; disk: number }> = {
  // EU SKUs
  cpx32: { vcpu: 2,  memory: 4,  disk: 80  },
  cpx42: { vcpu: 4,  memory: 8,  disk: 160 },
  cpx52: { vcpu: 8,  memory: 16, disk: 320 },
  cpx62: { vcpu: 16, memory: 32, disk: 640 },
  // US SKUs
  cpx11: { vcpu: 2,  memory: 4,  disk: 80  },
  cpx21: { vcpu: 4,  memory: 8,  disk: 160 },
  cpx31: { vcpu: 8,  memory: 16, disk: 320 },
  cpx41: { vcpu: 16, memory: 32, disk: 640 },
};

export function planSpecs(serverType: string): { vcpu: number; memory: number; disk: number } | null {
  return PLAN_SPECS_MAP[serverType] ?? null;
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
