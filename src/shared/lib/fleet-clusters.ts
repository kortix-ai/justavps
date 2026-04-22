import { regionLabel } from "@/shared/lib/regions";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

export type DerivedFleetClusterRef = {
  id: string;
  name: string;
  region: string;
  incus_cluster_name: string;
  incus_member_name: string;
};

export function defaultClusterId(region: string) {
  return `${region}-1`;
}

export function defaultClusterName(region: string) {
  return `${regionLabel(region)} Cluster 1`;
}

export function defaultIncusClusterName(region: string) {
  return `justavps-${region}-1`;
}

export function deriveClusterRef(input: {
  region: string;
  hostName?: string | null;
  metadata?: Record<string, unknown> | null;
}): DerivedFleetClusterRef {
  const bootstrap = asRecord(input.metadata?.bootstrap);
  const cluster = asRecord(input.metadata?.cluster) ?? asRecord(bootstrap?.cluster);
  const id = typeof cluster?.id === "string" && cluster.id.trim() ? cluster.id.trim() : defaultClusterId(input.region);
  const name = typeof cluster?.name === "string" && cluster.name.trim() ? cluster.name.trim() : defaultClusterName(input.region);
  const incusClusterName =
    typeof cluster?.incus_cluster_name === "string" && cluster.incus_cluster_name.trim()
      ? cluster.incus_cluster_name.trim()
      : typeof bootstrap?.incus_cluster_name === "string" && bootstrap.incus_cluster_name.trim()
        ? bootstrap.incus_cluster_name.trim()
        : defaultIncusClusterName(input.region);
  const incusMemberName =
    typeof cluster?.incus_member_name === "string" && cluster.incus_member_name.trim()
      ? cluster.incus_member_name.trim()
      : typeof bootstrap?.incus_member_name === "string" && bootstrap.incus_member_name.trim()
        ? bootstrap.incus_member_name.trim()
        : input.hostName?.trim() || `${id}-member`;

  return {
    id,
    name,
    region: input.region,
    incus_cluster_name: incusClusterName,
    incus_member_name: incusMemberName,
  };
}
