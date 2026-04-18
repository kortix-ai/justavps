function coerceFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function coerceNonNegativeInteger(value: unknown, fallback = 0): number {
  const coerced = Math.trunc(coerceFiniteNumber(value, fallback));
  return coerced >= 0 ? coerced : fallback;
}

export function formatMachineHealthPercent(value: unknown): string {
  return `${Math.max(0, Math.round(coerceFiniteNumber(value, 0)))}%`;
}

export function getAdminMachinesTotalPages(total: unknown, pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 0;
  return Math.ceil(coerceNonNegativeInteger(total, 0) / pageSize);
}

export function getAdminMachinesRangeLabel(
  pagination: { offset?: unknown; total?: unknown } | null | undefined,
  visibleCount: number,
): string {
  const count = coerceNonNegativeInteger(visibleCount, 0);
  const offset = coerceNonNegativeInteger(pagination?.offset, 0);
  const rawTotal = coerceNonNegativeInteger(pagination?.total, count);
  const total = Math.max(rawTotal, offset + count);

  if (count === 0 || total === 0) {
    return 'Showing 0 of 0';
  }

  const start = Math.min(offset + 1, total);
  const end = Math.min(offset + count, total);
  return `Showing ${start}–${end} of ${total}`;
}
