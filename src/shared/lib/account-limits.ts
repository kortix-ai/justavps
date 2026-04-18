const EFFECTIVELY_UNLIMITED_LIMIT = 1_000_000_000;

export function isUnlimitedLimit(limit: number | null | undefined) {
  return typeof limit === "number" && limit >= EFFECTIVELY_UNLIMITED_LIMIT;
}

export function formatLimit(limit: number | null | undefined) {
  if (isUnlimitedLimit(limit)) return "Unlimited";
  if (typeof limit !== "number") return "-";
  return String(limit);
}
