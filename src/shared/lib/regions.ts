/**
 * Canonical region definitions.
 *
 * A **Region** is a coarse geographic bucket (`eu`, `us`). Every bare-metal
 * host and machine belongs to exactly one region. The physical datacenter
 * (HEL1-DC4, NBG1-DC1, ASH-DC1, ...) lives in the host's `location` field, not
 * in the region. This keeps the region user-facing and stable while letting
 * the fleet spread across many DCs inside one region.
 */

interface RegionInfo {
  /** DNS-safe region id. */
  id: string;
  /** Human label, e.g. "Europe". */
  label: string;
  /** Continent hint for UI sorting. */
  continent: "EU" | "NA";
  /** Whether we currently deploy hosts in this region. */
  active: boolean;
  /** Hetzner Robot datacenter codes that sit inside this region. */
  hetznerLocations: readonly string[];
}

const REGIONS = [
  {
    id: "eu",
    label: "Europe",
    continent: "EU",
    active: true,
    hetznerLocations: [
      "HEL1-DC4",
      "HEL1-DC5",
      "NBG1-DC1",
      "NBG1-DC2",
      "NBG1-DC3",
      "FSN1-DC14",
      "FSN1-DC17",
      "FSN1-DC18",
    ],
  },
  {
    id: "us",
    label: "United States",
    continent: "NA",
    active: true,
    hetznerLocations: ["ASH-DC1", "HIL-DC1"],
  },
] as const satisfies readonly RegionInfo[];

/** Active regions suitable for new procurements. */
export const ACTIVE_REGIONS: readonly RegionInfo[] = REGIONS.filter((r) => r.active);
