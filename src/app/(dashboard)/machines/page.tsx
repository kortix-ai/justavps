"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MachineCard } from "@/components/dashboard/machine-card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";

interface Machine {
  id: string;
  slug: string;
  name: string;
  status: string;
  server_type: string;
  region: string;
  ip: string | null;
  specs: { vcpu: number; ram_gb: number; disk_gb: number; cpu_type: string; architecture: string } | null;
  price_monthly: number | null;
  created_at: string;
  ready_at: string | null;
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ machines: Machine[] }>('/machines')
      .then(data => setMachines(data.machines || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Machines</h1>
        <Link href="/machines/new" className={cn(buttonVariants())}>
          New Machine
        </Link>
      </div>

      {error && (
        <div className="text-center py-12">
          <p className="text-destructive">Error: {error}</p>
          <Button variant="outline" onClick={() => window.location.reload()} className="mt-4">
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-6 border rounded-lg space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : !error && machines.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🖥️</div>
          <h2 className="text-2xl font-semibold mb-2">No machines yet</h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Get started by creating your first VPS.
          </p>
          <Link href="/machines/new" className={cn(buttonVariants({ size: "lg" }))}>
            Create Your First Machine
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {machines.map((machine) => (
            <MachineCard key={machine.id} machine={machine} />
          ))}
        </div>
      )}
    </div>
  );
}
