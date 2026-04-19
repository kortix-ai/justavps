import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { machineKeys } from "@/v1/hooks/use-machines";
import type { Machine } from "@/shared/lib/types";

/**
 * Connects to the SSE stream for a provisioning machine.
 * Automatically invalidates React Query cache on status/stage changes
 * so the UI updates instantly without waiting for the next poll cycle.
 *
 * Only connects when status is "provisioning". Disconnects on terminal states.
 */
export function useMachineSSE(machineId: string, status: string | undefined) {
  const qc = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Only connect during provisioning — once ready/error/deleted, polling is enough
    if (status !== "provisioning") {
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }

    // Don't double-connect
    if (sourceRef.current) return;

    const es = new EventSource(`/api/v1/machines/${machineId}/status/stream`);
    sourceRef.current = es;

    const handleStageOrStatus = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);

        // Optimistically patch the cached machine with new stage/status
        qc.setQueryData<Machine>(machineKeys.detail(machineId), (old) => {
          if (!old) return old;
          return {
            ...old,
            ...(data.status && data.status !== old.status ? { status: data.status } : {}),
            ...(data.provisioning_stage ? { provisioning_stage: data.provisioning_stage } : {}),
            ...(data.ip && !old.ip ? { ip: data.ip } : {}),
            ...(typeof data.provider_progress === "number" || data.provider_progress === null
              ? { provider_progress: data.provider_progress }
              : {}),
            ...(typeof data.provider_status === "string" || data.provider_status === null
              ? { provider_status: data.provider_status }
              : {}),
          };
        });

        // Also invalidate so the next poll gets fresh server data
        qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
        qc.invalidateQueries({ queryKey: machineKeys.all });
      } catch {
        // Ignore parse errors
      }
    };

    es.addEventListener("stage", handleStageOrStatus);
    es.addEventListener("status", handleStageOrStatus);

    es.addEventListener("done", () => {
      // Terminal — force refetch to get final state
      qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
      es.close();
      sourceRef.current = null;
    });

    es.addEventListener("error", () => {
      // EventSource auto-reconnects on error, but if the connection
      // was closed by the server (readyState === CLOSED), clean up
      if (es.readyState === EventSource.CLOSED) {
        sourceRef.current = null;
      }
    });

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [machineId, status, qc]);
}
