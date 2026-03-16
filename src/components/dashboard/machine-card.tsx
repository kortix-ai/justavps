"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Machine } from "@/lib/types";

const statusConfig = {
  provisioning: { label: "Provisioning", variant: "secondary" as const, dotClass: "bg-yellow-500 animate-pulse" },
  ready: { label: "Ready", variant: "default" as const, dotClass: "bg-green-500" },
  error: { label: "Error", variant: "destructive" as const, dotClass: "bg-red-500" },
  stopped: { label: "Stopped", variant: "outline" as const, dotClass: "bg-muted-foreground" },
};

interface MachineCardProps {
  machine: Machine;
  onDelete?: (id: string) => void;
}

export function MachineCard({ machine, onDelete }: MachineCardProps) {
  const status = statusConfig[machine.status as keyof typeof statusConfig] || statusConfig.stopped;

  return (
    <Card className="transition-colors hover:bg-muted/30 shadow-none group relative">
      <Link href={`/machines/${machine.id}`} className="block">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base font-medium">{machine.name || machine.slug}</CardTitle>
              <div className="flex items-center gap-2 mt-1.5">
                <div className={`size-2 rounded-full ${status.dotClass}`} />
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
            </div>
            {machine.price_monthly && (
              <span className="text-sm text-muted-foreground font-mono">${machine.price_monthly}/mo</span>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Type</span>
              <span className="text-foreground font-mono">{machine.server_type}</span>
            </div>
            <div className="flex justify-between">
              <span>Region</span>
              <span className="text-foreground">{machine.region.toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span>IP</span>
              <span className="text-foreground font-mono">{machine.ip || "Assigning..."}</span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
            Created {new Date(machine.created_at).toLocaleDateString()}
            {machine.ready_at && (
              <> &middot; Ready {new Date(machine.ready_at).toLocaleDateString()}</>
            )}
          </div>
        </CardContent>
      </Link>

      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-3 right-3 size-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.preventDefault(); onDelete(machine.id); }}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </Card>
  );
}
