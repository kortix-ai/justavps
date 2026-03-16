"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";


interface Machine {
  id: string;
  slug: string;
  name: string;
  status: string;
  server_type: string;
  region: string;
  ip: string | null;
  specs: {
    vcpu: number;
    ram_gb: number;
    disk_gb: number;
    cpu_type: string;
    architecture: string;
  } | null;
  price_monthly: number | null;
  created_at: string;
  ready_at: string | null;
}

interface MachineCardProps {
  machine: Machine;
}

const statusConfig = {
  provisioning: { label: "Provisioning", variant: "secondary" as const, color: "bg-yellow-500" },
  ready: { label: "Ready", variant: "default" as const, color: "bg-green-500" },
  error: { label: "Error", variant: "destructive" as const, color: "bg-red-500" },
  stopped: { label: "Stopped", variant: "outline" as const, color: "bg-gray-500" },
};

export function MachineCard({ machine }: MachineCardProps) {
  const status = statusConfig[machine.status as keyof typeof statusConfig] || statusConfig.stopped;

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <Link href={`/machines/${machine.id}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg">{machine.name || machine.slug}</CardTitle>
              <div className="flex items-center space-x-2 mt-1">
                <Badge variant={status.variant}>{status.label}</Badge>
                <div className={`w-2 h-2 rounded-full ${status.color}`} />
              </div>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              {machine.price_monthly && `$${machine.price_monthly}/mo`}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type:</span>
              <span className="font-medium">{machine.server_type}</span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-muted-foreground">Region:</span>
              <span className="font-medium">{machine.region.toUpperCase()}</span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-muted-foreground">IP:</span>
              <span className="font-mono text-xs">
                {machine.ip || "Assigning..."}
              </span>
            </div>

            {machine.specs && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Specs:</span>
                <span className="text-xs">
                  {machine.specs.vcpu} vCPU, {machine.specs.ram_gb}GB RAM
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t">
            <div className="text-xs text-muted-foreground">
              Created {new Date(machine.created_at).toLocaleDateString()}
              {machine.ready_at && (
                <> • Ready {new Date(machine.ready_at).toLocaleDateString()}</>
              )}
            </div>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}