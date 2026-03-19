import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
