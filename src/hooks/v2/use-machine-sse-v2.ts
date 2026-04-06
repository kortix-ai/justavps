import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { machineKeys } from "@/hooks/v2/use-machines-v2";
import type { Machine } from "@/lib/types";

export function useMachineSSE(machineId: string, status: string | undefined) {
  const qc = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (status !== "provisioning") {
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }
    if (sourceRef.current) return;

    const es = new EventSource(`/api/v2/machines/${machineId}/status/stream`);
    sourceRef.current = es;

    const handleStageOrStatus = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        qc.setQueryData<Machine>(machineKeys.detail(machineId), (old) => {
          if (!old) return old;
          return {
            ...old,
            ...(data.status && data.status !== old.status ? { status: data.status } : {}),
            ...(data.provisioning_stage ? { provisioning_stage: data.provisioning_stage } : {}),
            ...(data.ip && !old.ip ? { ip: data.ip } : {}),
            ...(typeof data.provider_progress === "number" || data.provider_progress === null ? { provider_progress: data.provider_progress } : {}),
            ...(typeof data.provider_status === "string" || data.provider_status === null ? { provider_status: data.provider_status } : {}),
          };
        });
        qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
        qc.invalidateQueries({ queryKey: machineKeys.all });
      } catch {
        // ignore parse errors
      }
    };

    es.addEventListener("stage", handleStageOrStatus);
    es.addEventListener("status", handleStageOrStatus);

    es.addEventListener("done", () => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
      es.close();
      sourceRef.current = null;
    });

    es.addEventListener("error", () => {
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
