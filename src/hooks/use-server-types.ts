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
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB",
]);

const US_TIMEZONES = new Set([
  "America/New_York",
  "America/Detroit",
  "America/Kentucky/Louisville",
  "America/Kentucky/Monticello",
  "America/Indiana/Indianapolis",
  "America/Indiana/Vincennes",
  "America/Indiana/Winamac",
  "America/Indiana/Marengo",
  "America/Indiana/Petersburg",
  "America/Indiana/Vevay",
  "America/Chicago",
  "America/Indiana/Tell_City",
  "America/Indiana/Knox",
  "America/Menominee",
  "America/North_Dakota/Center",
  "America/North_Dakota/New_Salem",
  "America/North_Dakota/Beulah",
  "America/Denver",
  "America/Boise",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Juneau",
  "America/Sitka",
  "America/Metlakatla",
  "America/Yakutat",
  "America/Nome",
  "America/Adak",
  "Pacific/Honolulu",
]);

function detectRegionFromLocale(): string | null {
  if (typeof navigator === "undefined") return null;
  const locales = navigator.languages?.length ? navigator.languages : [navigator.language];
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

/**
 * Detect whether the user is likely in the EU based on their browser timezone.
 * Returns "hel1" for EU users, "hil" (US) for everyone else (default).
 * Safe to call on server (returns "hil" fallback).
 */
export function detectDefaultRegion(): string {
  if (typeof Intl === "undefined") return "hil";
  try {
    const localeRegion = detectRegionFromLocale();
    if (localeRegion) return localeRegion;

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return "hil";
    if (tz.startsWith("Europe/")) return "hel1";
    if (US_TIMEZONES.has(tz) || tz.startsWith("US/")) return "hil";
    return "hil";
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
