import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "./api-client";
import type { Provider, Region, ServerType } from "@/lib/types";

export const serverTypeKeys = {
  providers: ["providers"] as const,
  regions: (provider: string) => ["regions", provider] as const,
  types: (provider: string, region: string) => ["server-types", provider, region] as const,
};

export function useProviders() {
  return useQuery({
    queryKey: serverTypeKeys.providers,
    queryFn: () =>
      api.get<{ providers: Provider[] }>("/server-types/providers").then((d) => d.providers),
    staleTime: 5 * 60_000,
  });
}

export function useRegions(provider: string | undefined) {
  return useQuery({
    queryKey: serverTypeKeys.regions(provider ?? ""),
    queryFn: () =>
      api.get<{ regions: Region[] }>(`/server-types/regions?provider=${provider}`).then((d) => d.regions),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

export function useServerTypes(provider: string | undefined, region: string | undefined) {
  return useQuery({
    queryKey: serverTypeKeys.types(provider ?? "", region ?? ""),
    queryFn: () =>
      api
        .get<{ server_types: ServerType[] }>(`/server-types?provider=${provider}&region=${region}`)
        .then((d) => d.server_types),
    enabled: !!provider && !!region,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/* ═══ Geo-based default region ═══ */

const EU_LOCALE_REGIONS = new Set([
  "AL", "AD", "AT", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GI", "GR",
  "HU", "IS", "IE", "IM", "IT", "XK", "LV", "LI", "LT", "LU", "MT", "MD", "MC", "ME", "NL", "MK",
  "NO", "PL", "PT", "RO", "SM", "RS", "SK", "SI", "ES", "SE", "CH", "UA", "GB", "VA",
]);

const EU_TIMEZONE_PREFIXES = ["Europe/"];
const US_TIMEZONE_PREFIXES = ["US/", "America/", "Pacific/Honolulu"];
const EU_REFERENCE_TIMEZONE = "Europe/Berlin";
const US_REFERENCE_TIMEZONE = "America/Los_Angeles";

export interface BrowserRegionSignals {
  locales?: readonly string[];
  timeZone?: string;
  offsetMinutes?: number;
}

function detectRegionFromLocale(locales: readonly string[]): string | null {
  for (const locale of locales) {
    if (!locale) continue;
    try {
      const region = new Intl.Locale(locale).region;
      if (region === "US") return "hil";
      if (region && EU_LOCALE_REGIONS.has(region)) return "hel1";
    } catch {
      continue;
    }
  }
  return null;
}

function parseGMTOffsetToMinutes(value: string): number | null {
  const normalized = value.replace("UTC", "GMT");
  if (normalized === "GMT") return 0;
  const match = normalized.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function getOffsetForTimeZone(timeZone: string, date: Date): number | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    });
    const zoneName = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
    return zoneName ? parseGMTOffsetToMinutes(zoneName) : null;
  } catch {
    return null;
  }
}

function detectRegionFromTimeZone(timeZone: string | undefined, offsetMinutes: number): string {
  const now = new Date();

  if (timeZone) {
    if (EU_TIMEZONE_PREFIXES.some((prefix) => timeZone.startsWith(prefix))) return "hel1";
    if (US_TIMEZONE_PREFIXES.some((prefix) => timeZone.startsWith(prefix))) return "hil";
  }

  const euOffset = getOffsetForTimeZone(EU_REFERENCE_TIMEZONE, now);
  const usOffset = getOffsetForTimeZone(US_REFERENCE_TIMEZONE, now);

  if (euOffset === null || usOffset === null) return "hil";

  const euDistance = Math.abs(offsetMinutes - euOffset);
  const usDistance = Math.abs(offsetMinutes - usOffset);

  if (euDistance < usDistance) return "hel1";
  return "hil";
}

export function detectDefaultRegionFromBrowserInfo({
  locales = [],
  timeZone,
  offsetMinutes,
}: BrowserRegionSignals): string {
  const timezoneRegion = detectRegionFromTimeZone(timeZone, offsetMinutes ?? 0);
  const localeRegion = detectRegionFromLocale(locales);

  if (timeZone && EU_TIMEZONE_PREFIXES.some((prefix) => timeZone.startsWith(prefix))) return "hel1";
  if (timeZone && US_TIMEZONE_PREFIXES.some((prefix) => timeZone.startsWith(prefix))) return "hil";

  return localeRegion ?? timezoneRegion;
}

/**
 * Detect the best default deploy region from browser locale + timezone.
 * Locale wins when it clearly identifies EU/US; otherwise timezone proximity picks
 * the closer deploy region between EU-Central and US-West. Fallback stays US.
 */
export function detectDefaultRegion(): string {
  if (typeof Intl === "undefined") return "hil";
  try {
    const locales = typeof navigator === "undefined"
      ? []
      : (navigator.languages?.length ? navigator.languages : [navigator.language]).filter(Boolean);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMinutes = -new Date().getTimezoneOffset();

    return detectDefaultRegionFromBrowserInfo({ locales, timeZone, offsetMinutes });
  } catch {
    return "hil";
  }
}

/**
 * Pick the best default region from available regions based on geo-detection.
 * Falls back to the first available region if the detected one isn't in the list.
 */
export function pickDefaultRegion(regions: { id: string }[] | undefined): string {
  if (!regions || regions.length === 0) return "";
  const detected = detectDefaultRegion();
  const match = regions.find((r) => r.id === detected);
  return match ? match.id : regions[0].id;
}
