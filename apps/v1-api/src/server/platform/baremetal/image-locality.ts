import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/server/db';
import { baremetalHostImages, type BaremetalHostImageRow } from '@/server/db/schema';
import type { BaremetalHostCandidate, BaremetalSchedulerImageLocalityMetadata } from "@/server/platform/baremetal/types";

const HOST_IMAGE_AVAILABILITY_STATES = ['local', 'warming', 'remote', 'unknown', 'error'] as const;
type HostImageAvailabilityState = (typeof HOST_IMAGE_AVAILABILITY_STATES)[number];

type ImageAvailabilityExecutor = Pick<typeof db, 'select' | 'insert' | 'update'>;

interface RequestedImageRef {
  imageId: string | null;
  imageAlias: string | null;
  imageRef: string;
}

function asUuidOrNull(value: string | null | undefined) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function nextLocalityState(states: HostImageAvailabilityState[]): HostImageAvailabilityState {
  if (states.includes('local')) return 'local';
  if (states.includes('warming')) return 'warming';
  if (states.includes('remote')) return 'remote';
  if (states.includes('error')) return 'error';
  return 'unknown';
}

export function buildRequestedImageAvailabilityRefs(input: {
  imageId?: string | null;
  imageAlias?: string | null;
}): RequestedImageRef[] {
  const refs: RequestedImageRef[] = [];

  if (input.imageId) {
    refs.push({ imageId: input.imageId, imageAlias: null, imageRef: input.imageId });
  }
  if (input.imageAlias) {
    refs.push({ imageId: null, imageAlias: input.imageAlias, imageRef: input.imageAlias });
  }

  return refs.filter((ref, index, all) => all.findIndex((candidate) => candidate.imageRef === ref.imageRef) === index);
}

function buildSchedulerImageLocalityMetadata(rows: BaremetalHostImageRow[]): (BaremetalSchedulerImageLocalityMetadata & { state: HostImageAvailabilityState }) | null {
  if (rows.length === 0) return null;

  const states = rows
    .map((row) => row.availabilityState)
    .filter((state): state is HostImageAvailabilityState => HOST_IMAGE_AVAILABILITY_STATES.includes(state as HostImageAvailabilityState));

  return {
    state: nextLocalityState(states),
    imageIds: unique(rows.filter((row) => row.availabilityState === 'local' && !!row.imageId).map((row) => row.imageId!)),
    aliases: unique(rows.filter((row) => row.availabilityState === 'local' && !!row.imageAlias).map((row) => row.imageAlias!)),
  };
}

export function applyExplicitImageAvailabilityToHosts<T extends BaremetalHostCandidate>(hosts: T[], rows: BaremetalHostImageRow[]): T[] {
  if (rows.length === 0) return hosts;

  const rowsByHostId = new Map<string, BaremetalHostImageRow[]>();
  for (const row of rows) {
    const list = rowsByHostId.get(row.hostId) ?? [];
    list.push(row);
    rowsByHostId.set(row.hostId, list);
  }

  return hosts.map((host) => {
    const locality = buildSchedulerImageLocalityMetadata(rowsByHostId.get(host.id) ?? []);
    if (!locality) return host;

    const metadata = ((host.metadata ?? {}) as Record<string, unknown>);
    const scheduler = ((metadata.scheduler ?? {}) as Record<string, unknown>);
    return {
      ...host,
      metadata: {
        ...metadata,
        scheduler: {
          ...scheduler,
          image_locality: {
            ...(scheduler.image_locality as Record<string, unknown> | undefined ?? {}),
            state: locality.state,
            image_ids: locality.imageIds,
            aliases: locality.aliases,
          },
        },
      },
    };
  });
}

export async function loadImageAvailabilityRows(input: {
  hostIds: string[];
  imageId?: string | null;
  imageAlias?: string | null;
  executor?: ImageAvailabilityExecutor;
}) {
  const executor = input.executor ?? db;
  const refs = buildRequestedImageAvailabilityRefs({ imageId: input.imageId, imageAlias: input.imageAlias });
  if (input.hostIds.length === 0 || refs.length === 0) return [];

  return executor.select().from(baremetalHostImages).where(and(
    inArray(baremetalHostImages.hostId, input.hostIds),
    inArray(baremetalHostImages.imageRef, refs.map((ref) => ref.imageRef)),
  ));
}

export async function syncHostImageAvailabilityFromRunnerState(input: {
  hostId: string;
  images: Array<{ imageId: string; aliases: string[] }>;
  executor?: ImageAvailabilityExecutor;
  at?: Date;
}) {
  const executor = input.executor ?? db;
  const writer = executor as Partial<ImageAvailabilityExecutor>;
  const at = input.at ?? new Date();
  const presentRefs = new Set<string>();
  if (!writer.insert || !writer.select || !writer.update) return;

  for (const image of input.images) {
    const refs = unique([image.imageId, ...image.aliases].filter(Boolean));
    for (const ref of refs) {
      presentRefs.add(ref);
      await writer.insert(baremetalHostImages)
        .values({
          hostId: input.hostId,
          imageId: ref === image.imageId ? asUuidOrNull(image.imageId) : null,
          imageAlias: ref !== image.imageId ? ref : null,
          imageRef: ref,
          availabilityState: 'local',
          source: 'reconcile',
          lastSeenAt: at,
          metadata: {
            provider_image_id: image.imageId,
          },
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [baremetalHostImages.hostId, baremetalHostImages.imageRef],
          set: {
            imageId: ref === image.imageId ? asUuidOrNull(image.imageId) : baremetalHostImages.imageId,
            imageAlias: ref !== image.imageId ? ref : baremetalHostImages.imageAlias,
            availabilityState: 'local',
            source: 'reconcile',
            lastSeenAt: at,
            metadata: {
              provider_image_id: image.imageId,
            },
            updatedAt: at,
          },
        });
    }
  }

  const existing = await writer.select().from(baremetalHostImages).where(eq(baremetalHostImages.hostId, input.hostId));
  for (const row of existing) {
    if (presentRefs.has(row.imageRef)) continue;
    if (row.availabilityState !== 'local' && row.availabilityState !== 'warming') continue;
    await writer.update(baremetalHostImages).set({
      availabilityState: 'remote',
      source: 'reconcile',
      updatedAt: at,
      metadata: {
        ...(row.metadata ?? {}),
        last_missing_from_host_at: at.toISOString(),
      },
    }).where(eq(baremetalHostImages.id, row.id));
  }
}
