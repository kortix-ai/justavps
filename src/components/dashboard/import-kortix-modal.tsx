"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useKortixLinkStatus,
  useKortixClaimableMachines,
  useStartKortixImport,
  useClaimKortixMachines,
} from "@/hooks/use-kortix-import";
import { toast } from "sonner";
import { Loader2, Check, Download } from "lucide-react";

interface ImportKortixModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportKortixModal({ open, onOpenChange }: ImportKortixModalProps) {
  const { data: linkStatus, isLoading: statusLoading } = useKortixLinkStatus();
  const {
    data: claimableMachines,
    isLoading: machinesLoading,
  } = useKortixClaimableMachines(open && !!linkStatus?.linked);
  const startImport = useStartKortixImport();
  const claimMachines = useClaimKortixMachines();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!claimableMachines) return;
    if (selected.size === claimableMachines.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(claimableMachines.map((m) => m.external_id)));
    }
  };

  const handleClaim = () => {
    if (selected.size === 0) return;
    claimMachines.mutate([...selected], {
      onSuccess: (result) => {
        if (result.claimed.length > 0) {
          toast.success(`Imported ${result.claimed.length} machine${result.claimed.length > 1 ? "s" : ""}`);
        }
        if (result.skipped.length > 0) {
          toast.warning(
            `Skipped ${result.skipped.length}: ${result.skipped.map((s) => s.reason).join(", ")}`
          );
        }
        setSelected(new Set());
        if (result.claimed.length > 0) {
          onOpenChange(false);
        }
      },
      onError: (err) => toast.error(err.message),
    });
  };

  const isLinked = linkStatus?.linked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Kortix</DialogTitle>
          <DialogDescription>
            {isLinked
              ? "Select machines to import into JustAVPS. Imported machines are billed through Kortix."
              : "Link your Kortix account to import machines provisioned through Kortix Compute."}
          </DialogDescription>
        </DialogHeader>

        {statusLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !isLinked ? (
          <div className="py-4">
            <Button
              onClick={() => startImport.mutate()}
              disabled={startImport.isPending}
              className="w-full"
            >
              {startImport.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Link Kortix Account
            </Button>
          </div>
        ) : machinesLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
                <Skeleton className="size-4 rounded" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : !claimableMachines?.length ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <p>No machines available to import.</p>
            <p className="mt-1">
              Linked as <span className="font-medium">{linkStatus?.kortix_email}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {linkStatus?.kortix_email && (
              <p className="text-xs text-muted-foreground">
                Linked as {linkStatus.kortix_email}
              </p>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {claimableMachines.length} machine{claimableMachines.length > 1 ? "s" : ""} available
              </span>
              <Button variant="ghost" size="sm" onClick={selectAll}>
                {selected.size === claimableMachines.length ? "Deselect All" : "Select All"}
              </Button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {claimableMachines.map((m) => {
                const isSelected = selected.has(m.external_id);
                return (
                  <button
                    key={m.external_id}
                    type="button"
                    onClick={() => toggleSelect(m.external_id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className={`size-4 rounded border flex items-center justify-center shrink-0 ${
                        isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                      }`}
                    >
                      {isSelected && <Check className="size-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{m.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Created {new Date(m.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {m.status}
                    </Badge>
                  </button>
                );
              })}
            </div>

            <Button
              onClick={handleClaim}
              disabled={selected.size === 0 || claimMachines.isPending}
              className="w-full"
            >
              {claimMachines.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Import {selected.size > 0 ? `${selected.size} Machine${selected.size > 1 ? "s" : ""}` : "Selected"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
