import { BILLING_V2_COMPONENT_ORDER, BILLING_V2_COMPONENTS, type BillingV2Component } from './types.js';

export type BillingWindow = {
  from: Date;
  to: Date;
  asOf: Date;
  finalizedThrough: Date;
};

export type BillingLedgerAggregateInput = {
  accountId: string;
  machineId: string | null;
  sourceType: string;
  sourceId: string;
  component: string;
  intervalStart: Date;
  intervalEnd: Date;
  quantity: unknown;
  quantityUnit: string;
  microEur: bigint | number | string;
  status: string;
  measurementExact: boolean;
  metadata: unknown;
};

export function floorUtcHour(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

export function parseMonthWindow(month: string | null | undefined, now = new Date()): BillingWindow {
  const match = month ? /^(\d{4})-(\d{2})$/.exec(month) : null;
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { from, to, asOf: now, finalizedThrough: floorUtcHour(now) };
}

export function parseExplicitWindow(input: { from?: string | null; to?: string | null; month?: string | null }, now = new Date()): BillingWindow {
  const monthly = parseMonthWindow(input.month, now);
  const from = input.from ? new Date(input.from) : monthly.from;
  const to = input.to ? new Date(input.to) : monthly.to;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new Error('Invalid billing window; pass month=YYYY-MM or valid from/to ISO timestamps');
  }
  return { from, to, asOf: now, finalizedThrough: floorUtcHour(now) };
}

export function splitIntervalByHour(start: Date, end: Date, windowFrom: Date, windowTo: Date): Array<{ start: Date; end: Date; seconds: number }> {
  const clippedStartMs = Math.max(start.getTime(), windowFrom.getTime());
  const clippedEndMs = Math.min(end.getTime(), windowTo.getTime());
  if (clippedEndMs <= clippedStartMs) return [];
  const slices: Array<{ start: Date; end: Date; seconds: number }> = [];
  let cursor = clippedStartMs;
  while (cursor < clippedEndMs) {
    const cursorDate = new Date(cursor);
    const nextHour = new Date(floorUtcHour(cursorDate).getTime() + 3600_000).getTime();
    const sliceEnd = Math.min(nextHour, clippedEndMs);
    slices.push({ start: new Date(cursor), end: new Date(sliceEnd), seconds: (sliceEnd - cursor) / 1000 });
    cursor = sliceEnd;
  }
  return slices;
}

export function eurFromMicro(microEur: bigint): number {
  return Number(microEur) / 1_000_000;
}

export function aggregateBillingLedger(entries: BillingLedgerAggregateInput[]) {
  const total = entries.reduce((sum, entry) => sum + microToBigInt(entry.microEur), 0n);
  const componentMap = new Map<string, { key: string; label: string; quantity: number; quantityUnit: string; microEur: bigint }>();
  const sourceMap = new Map<string, { sourceType: string; sourceId: string; machineId: string | null; name: string | null; microEur: bigint; components: Set<string> }>();
  const hourlyMap = new Map<string, { hour: string; microEur: bigint; components: Map<string, bigint> }>();

  for (const entry of entries) {
    const componentKey = entry.component;
    const componentMeta = BILLING_V2_COMPONENTS[componentKey as BillingV2Component];
    const microEur = microToBigInt(entry.microEur);
    const quantity = Number(entry.quantity ?? 0);
    const currentComponent = componentMap.get(componentKey) ?? {
      key: componentKey,
      label: componentMeta?.label ?? humanize(componentKey),
      quantity: 0,
      quantityUnit: entry.quantityUnit,
      microEur: 0n,
    };
    currentComponent.quantity += Number.isFinite(quantity) ? quantity : 0;
    currentComponent.microEur += microEur;
    componentMap.set(componentKey, currentComponent);

    const sourceKey = `${entry.sourceType}:${entry.sourceId}`;
    const source = sourceMap.get(sourceKey) ?? {
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      machineId: entry.machineId,
      name: sourceNameFromMetadata(entry.metadata),
      microEur: 0n,
      components: new Set<string>(),
    };
    source.microEur += microEur;
    source.components.add(componentKey);
    if (!source.name) source.name = sourceNameFromMetadata(entry.metadata);
    sourceMap.set(sourceKey, source);

    const hour = floorUtcHour(entry.intervalStart).toISOString();
    const hourly = hourlyMap.get(hour) ?? { hour, microEur: 0n, components: new Map<string, bigint>() };
    hourly.microEur += microEur;
    hourly.components.set(componentKey, (hourly.components.get(componentKey) ?? 0n) + microEur);
    hourlyMap.set(hour, hourly);
  }

  const orderIndex = new Map(BILLING_V2_COMPONENT_ORDER.map((key, index) => [key, index]));
  return {
    totalMicroEur: total,
    components: Array.from(componentMap.values())
      .sort((a, b) => (orderIndex.get(a.key as BillingV2Component) ?? 999) - (orderIndex.get(b.key as BillingV2Component) ?? 999) || a.key.localeCompare(b.key))
      .map((component) => ({
        key: component.key,
        label: component.label,
        quantity: Number(component.quantity.toFixed(9)),
        quantity_unit: component.quantityUnit,
        micro_eur: component.microEur.toString(),
        eur: eurFromMicro(component.microEur),
      })),
    sources: Array.from(sourceMap.values())
      .sort((a, b) => Number(b.microEur - a.microEur))
      .map((source) => ({
        source_type: source.sourceType,
        source_id: source.sourceId,
        machine_id: source.machineId,
        name: source.name,
        micro_eur: source.microEur.toString(),
        eur: eurFromMicro(source.microEur),
        components: Array.from(source.components).sort(),
      })),
    hourly: Array.from(hourlyMap.values())
      .sort((a, b) => a.hour.localeCompare(b.hour))
      .map((hour) => ({
        hour: hour.hour,
        micro_eur: hour.microEur.toString(),
        eur: eurFromMicro(hour.microEur),
        components: Object.fromEntries(Array.from(hour.components.entries()).map(([key, value]) => [key, eurFromMicro(value)])),
      })),
  };
}

function microToBigInt(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  return BigInt(value);
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function sourceNameFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  for (const key of ['source_name', 'machine_name', 'template_name', 'policy_name', 'name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}
