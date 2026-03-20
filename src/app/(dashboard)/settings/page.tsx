"use client";

import type { ComponentType } from "react";
import { useSession } from "next-auth/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useAccountLimits } from "@/hooks/use-account";
import { Server, HardDrive, AlertTriangle } from "lucide-react";

function LimitCard({
  icon: Icon,
  label,
  current,
  max,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  current: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((current / max) * 100) : 0;
  const isAtLimit = current >= max;
  const isNearLimit = pct >= 80 && !isAtLimit;

  return (
    <div className="p-5 rounded-xl border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" />
          {label}
        </div>
        {isAtLimit && (
          <div className="flex items-center gap-1 text-xs text-destructive font-medium">
            <AlertTriangle className="size-3" />
            At limit
          </div>
        )}
        {isNearLimit && (
          <div className="flex items-center gap-1 text-xs text-amber-500 font-medium">
            <AlertTriangle className="size-3" />
            Near limit
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight">{current}</span>
        <span className="text-sm text-muted-foreground">/ {max}</span>
      </div>
      <Progress
        value={pct}
        className={`h-2 ${isAtLimit ? "[&_div[data-slot=progress-indicator]]:bg-destructive" : isNearLimit ? "[&_div[data-slot=progress-indicator]]:bg-amber-500" : ""}`}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const { data: limits, isLoading: limitsLoading } = useAccountLimits();

  const email = session?.user?.email || "user@example.com";
  const name = session?.user?.name || email.split("@")[0];
  const initial = name[0]?.toUpperCase() || "U";

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl tracking-tight">Settings</h1>

      {/* Account info */}
      <div className="p-5 rounded-xl border bg-card">
        <h2 className="text-sm font-medium text-muted-foreground mb-4">Account</h2>
        <div className="flex items-center gap-4">
          <Avatar className="size-12 rounded-lg">
            <AvatarFallback className="rounded-lg bg-muted text-muted-foreground text-lg">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{name}</div>
            <div className="text-sm text-muted-foreground">{email}</div>
          </div>
        </div>
      </div>

      {/* Resource Limits */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Resource Limits</h2>
        {limitsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="p-5 rounded-xl border bg-card space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        ) : limits ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LimitCard
              icon={Server}
              label="Machines"
              current={limits.usage.machines}
              max={limits.limits.max_machines}
            />
            <LimitCard
              icon={HardDrive}
              label="Images"
              current={limits.usage.images}
              max={limits.limits.max_images}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground mt-2">
          Need higher limits? Contact support to request an increase.
        </p>
      </div>
    </div>
  );
}
