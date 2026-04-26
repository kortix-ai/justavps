export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function shortId(value: unknown, length = 14): string {
  const str = String(value ?? '');
  if (str.length <= length) return str;
  return `${str.slice(0, Math.floor(length / 2))}…${str.slice(-Math.floor(length / 2))}`;
}

export function statusTone(status: unknown): 'ok' | 'warn' | 'bad' | '' {
  const s = String(status ?? '').toLowerCase();
  if (['ready', 'running', 'online', 'success', 'approved', 'order_planned', 'bootstrap_planned'].includes(s)) return 'ok';
  if (['stopped', 'provisioning', 'planned', 'order_blocked', 'bootstrap_blocked'].includes(s)) return 'warn';
  if (['error', 'failed', 'offline', 'deleted', 'cancelled'].includes(s)) return 'bad';
  return '';
}

export function randomSuffix(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function formatBytes(value: number | string | null | undefined): string {
  if (value == null) return '-';
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (num <= 0) return '0';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = num;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function pickIncusUiUrl(item: { links?: { ui_url?: string | null } | null; url?: string | null; endpoint?: string | null }): string | null {
  const link = item.links?.ui_url ?? null;
  if (link) return link;
  const candidate = item.url || item.endpoint || null;
  if (!candidate) return null;
  try {
    return `${new URL(candidate).origin}/ui/`;
  } catch {
    return null;
  }
}

export function pickIncusApiUrl(item: { links?: { api_url?: string | null } | null; url?: string | null; endpoint?: string | null }): string | null {
  const link = item.links?.api_url ?? null;
  if (link) return link;
  const candidate = item.url || item.endpoint || null;
  if (!candidate) return null;
  try {
    return `${new URL(candidate).origin}/1.0`;
  } catch {
    return null;
  }
}
