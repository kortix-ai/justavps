import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number | null | undefined, frac = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let n = Math.abs(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${(bytes < 0 ? -n : n).toFixed(i === 0 ? 0 : frac)} ${units[i]}`;
}

export function shortId(id: string | null | undefined, take = 8): string {
  if (!id) return '—';
  if (id.length <= take + 3) return id;
  return `${id.slice(0, take)}…`;
}

export function randomSuffix(len = 6): string {
  return Math.random().toString(36).slice(2, 2 + len);
}
