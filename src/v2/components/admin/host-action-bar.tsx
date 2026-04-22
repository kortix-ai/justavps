"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CircleAlert,
  ExternalLink,
  EyeOff,
  Info,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Shield,
  ShieldOff,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button, buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { toast } from "sonner";
import type { FleetHost, FleetHostMaintenanceState } from "@/shared/hooks/use-fleet";

export type HostActionBarProps = {
  host: FleetHost;
  maintenancePending: boolean;
  onMaintenance: (state: FleetHostMaintenanceState) => void;
  orphansPending: boolean;
  onCleanupOrphans: () => void;
  schedulerPending: boolean;
  onQuarantine: () => void;
  onClearQuarantine: () => void;
  operatorPending: boolean;
  onEnableOperatorIncusUi: () => void;
  onDisableIncusUi: () => void;
};

function IconButtonTip({
  label,
  explanation,
  onClick,
  disabled,
  pending,
  icon,
  tone = "neutral",
}: {
  label: string;
  explanation: string;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  icon: ReactNode;
  tone?: "neutral" | "primary" | "warning" | "danger";
}) {
  const variant = tone === "danger" ? "destructive" : tone === "primary" ? "default" : "outline";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant={variant}
            className={cn(
              "h-7 gap-1.5 px-2.5 text-xs",
              tone === "warning" && "border-yellow-500/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10",
            )}
            disabled={disabled || pending}
            onClick={onClick}
          />
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : icon}
        <span className="hidden sm:inline">{label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left leading-snug">
        <div className="font-semibold mb-0.5">{label}</div>
        <div className="text-background/80">{explanation}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function maintenancePhase(state: FleetHostMaintenanceState):
  | "serving"
  | "draining"
  | "drained"
  | "maintenance" {
  if (state === "in_service") return "serving";
  if (state === "drain_requested" || state === "draining") return "draining";
  if (state === "drained") return "drained";
  return "maintenance";
}

/**
 * HostActionBar — consolidated, one-click, tooltip-documented actions.
 *
 * Design goals:
 *   - Incus UI link is ALWAYS one click away when available (primary anchor).
 *   - Drain is a single lifecycle, not 5 micro-buttons. "Start drain" sets
 *     drain_requested; the control plane auto-advances it. Operator can
 *     force "mark drained" or "mark maintenance" via the advanced menu.
 *   - Every action has an explanation tooltip — no guessing what a button does.
 *   - Destructive/irreversible actions are visually distinct + confirm-gated.
 */
export function HostActionBar(props: HostActionBarProps) {
  const {
    host,
    maintenancePending,
    onMaintenance,
    orphansPending,
    onCleanupOrphans,
    schedulerPending,
    onQuarantine,
    onClearQuarantine,
    operatorPending,
    onEnableOperatorIncusUi,
    onDisableIncusUi,
  } = props;

  const phase = maintenancePhase(host.maintenance_state);
  // Incus runs per-host on port 8443 by default. The `exposure` flag is just our
  // admin-UI preference for whether to surface the link — the URL is always
  // derivable from the host IP. Show the link whenever we know the IP unless
  // exposure was explicitly set to "disabled".
  const incusUiUrl =
    host.incus_ui.url ?? (host.public_ipv4 ? `https://${host.public_ipv4}:8443` : null);
  const hasIncusUi = host.incus_ui.exposure !== "disabled" && Boolean(incusUiUrl);
  const canEnableIncusUi = host.incus_ui.exposure === "disabled" && Boolean(host.public_ipv4);
  const quarantined = host.scheduler.schedulable === false;
  const hasOrphans = host.reconciliation_report.orphan_instance_ids.length > 0;

  const [confirmQuarantine, setConfirmQuarantine] = useState(false);

  function maintenanceToast(target: FleetHostMaintenanceState, label: string) {
    onMaintenance(target);
    toast.info(`${host.name} → ${label}`);
  }

  return (
    <TooltipProvider delay={200}>
      <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
        {/* PRIMARY — Open Incus UI in one click */}
        {hasIncusUi && incusUiUrl ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href={incusUiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "default", size: "sm" }),
                    "h-7 gap-1.5 px-2.5 text-xs",
                  )}
                />
              }
            >
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">Open Incus UI</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-left leading-snug">
              <div className="font-semibold mb-0.5">Open Incus operator UI</div>
              <div className="text-background/80">
                Launches the Incus web console in a new tab ({incusUiUrl}).
                You&apos;ll see a TLS warning on first visit — that&apos;s expected (self-signed cert).
              </div>
            </TooltipContent>
          </Tooltip>
        ) : canEnableIncusUi ? (
          // Enable + open in one click — the most common case
          <IconButtonTip
            label="Enable & open Incus UI"
            explanation={`Flips this host's Incus exposure to operator_only then opens the console at https://${host.public_ipv4}:8443 in a new tab. One click = enabled + opened.`}
            icon={<Sparkles className="size-3.5" />}
            tone="primary"
            disabled={operatorPending}
            pending={operatorPending}
            onClick={() => {
              onEnableOperatorIncusUi();
              if (host.public_ipv4 && typeof window !== "undefined") {
                window.open(`https://${host.public_ipv4}:8443`, "_blank", "noreferrer");
              }
            }}
          />
        ) : (
          <IconButtonTip
            label="No IP yet"
            explanation="Incus UI can't be opened until the host has a public IP. Wait for the host to finish bootstrapping."
            icon={<Sparkles className="size-3.5" />}
            tone="neutral"
            disabled
            onClick={() => {}}
          />
        )}

        {/* PRIMARY — Drain lifecycle, one clear action per phase */}
        {phase === "serving" && (
          <IconButtonTip
            label="Start drain"
            explanation="Stops scheduling new machines on this host and waits for active workloads to finish. The control plane auto-advances the host to 'drained' once there are zero blockers. Reversible via 'Return to service' at any point."
            icon={<PauseCircle className="size-3.5" />}
            tone="warning"
            disabled={maintenancePending}
            pending={maintenancePending}
            onClick={() => maintenanceToast("drain_requested", "drain requested")}
          />
        )}

        {phase === "draining" && (
          <>
            <IconButtonTip
              label="Return to service"
              explanation="Cancels the drain and re-enables scheduling on this host. Active workloads keep running untouched."
              icon={<PlayCircle className="size-3.5" />}
              tone="primary"
              disabled={maintenancePending}
              pending={maintenancePending}
              onClick={() => maintenanceToast("in_service", "returned to service")}
            />
            {host.drain_report.blockers_total === 0 && (
              <IconButtonTip
                label="Finish drain"
                explanation="Marks the host fully drained. Only shown because drain_blockers = 0. Host is now safe to take into maintenance."
                icon={<Shield className="size-3.5" />}
                tone="neutral"
                disabled={maintenancePending}
                pending={maintenancePending}
                onClick={() => maintenanceToast("drained", "drained")}
              />
            )}
          </>
        )}

        {phase === "drained" && (
          <>
            <IconButtonTip
              label="Return to service"
              explanation="Re-enables scheduling on this host. Use after verifying the host is healthy."
              icon={<PlayCircle className="size-3.5" />}
              tone="primary"
              disabled={maintenancePending}
              pending={maintenancePending}
              onClick={() => maintenanceToast("in_service", "returned to service")}
            />
            <IconButtonTip
              label="Take into maintenance"
              explanation="Marks the host as actively under maintenance work. Use when you're physically servicing the box. Scheduling stays off."
              icon={<Wrench className="size-3.5" />}
              tone="warning"
              disabled={maintenancePending}
              pending={maintenancePending}
              onClick={() => maintenanceToast("maintenance", "under maintenance")}
            />
          </>
        )}

        {phase === "maintenance" && (
          <IconButtonTip
            label="Return to service"
            explanation="Exit maintenance mode and re-enable scheduling. The host reboots if needed."
            icon={<PlayCircle className="size-3.5" />}
            tone="primary"
            disabled={maintenancePending}
            pending={maintenancePending}
            onClick={() => maintenanceToast("in_service", "returned to service")}
          />
        )}

        {/* SECONDARY — Cleanup, if orphans exist */}
        {hasOrphans && (
          <IconButtonTip
            label={`Cleanup ${host.reconciliation_report.orphan_instance_ids.length} orphan${host.reconciliation_report.orphan_instance_ids.length === 1 ? "" : "s"}`}
            explanation="Removes Incus instances that exist on the host but have no matching machine row in the DB. Safe operation — it deletes stale compute without touching live machines. Orphans usually come from a failed create or a partial delete."
            icon={<Trash2 className="size-3.5" />}
            tone="warning"
            disabled={orphansPending}
            pending={orphansPending}
            onClick={onCleanupOrphans}
          />
        )}

        {/* ADVANCED menu — everything destructive or rarely-used */}
        <DropdownMenu>
          <DropdownMenuTrigger
            title="More actions"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "size-7",
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
              <Info className="size-3" />
              Advanced
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Quarantine */}
            {!quarantined ? (
              <DropdownMenuItem
                disabled={schedulerPending}
                onSelect={() => setConfirmQuarantine(true)}
                className="gap-2"
              >
                <ShieldOff className="size-3.5 text-red-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">Quarantine scheduler</div>
                  <div className="text-[11px] text-muted-foreground">
                    Stops all new placements. Existing machines keep running. Use when something is wrong and you need time to investigate.
                  </div>
                </div>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={schedulerPending}
                onSelect={() => onClearQuarantine()}
                className="gap-2"
              >
                <Shield className="size-3.5 text-emerald-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">Clear quarantine</div>
                  <div className="text-[11px] text-muted-foreground">
                    Re-enables the scheduler for this host.
                  </div>
                </div>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {/* Incus UI operator toggle */}
            {hasIncusUi ? (
              <DropdownMenuItem
                disabled={operatorPending}
                onSelect={() => onDisableIncusUi()}
                className="gap-2"
              >
                <EyeOff className="size-3.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">Disable Incus UI</div>
                  <div className="text-[11px] text-muted-foreground">
                    Hides the operator console. Regular scheduling is unaffected.
                  </div>
                </div>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={operatorPending}
                onSelect={() => onEnableOperatorIncusUi()}
                className="gap-2"
              >
                <Sparkles className="size-3.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">Enable Incus UI (operator-only)</div>
                  <div className="text-[11px] text-muted-foreground">
                    Shows a one-click link to the Incus console at https://{host.public_ipv4}:8443.
                  </div>
                </div>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {/* Forced maintenance transitions — escape hatch for stuck states */}
            {phase !== "serving" && (
              <>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Force transitions
                </DropdownMenuLabel>
                {phase !== "draining" && (
                  <DropdownMenuItem
                    disabled={maintenancePending}
                    onSelect={() => onMaintenance("draining")}
                    className="gap-2"
                  >
                    <CircleAlert className="size-3.5 text-yellow-500" />
                    <span>Force state: <code>draining</code></span>
                  </DropdownMenuItem>
                )}
                {phase !== "drained" && (
                  <DropdownMenuItem
                    disabled={maintenancePending}
                    onSelect={() => onMaintenance("drained")}
                    className="gap-2"
                  >
                    <CircleAlert className="size-3.5 text-yellow-500" />
                    <span>Force state: <code>drained</code></span>
                  </DropdownMenuItem>
                )}
                {phase !== "maintenance" && (
                  <DropdownMenuItem
                    disabled={maintenancePending}
                    onSelect={() => onMaintenance("maintenance")}
                    className="gap-2"
                  >
                    <CircleAlert className="size-3.5 text-yellow-500" />
                    <span>Force state: <code>maintenance</code></span>
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Quarantine confirm dialog — inline */}
      {confirmQuarantine && (
        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
          <div className="font-medium text-red-700 dark:text-red-400">
            Quarantine {host.name}?
          </div>
          <div className="mt-0.5 text-muted-foreground">
            New placements will be rejected. Existing machines keep running. You can clear this at any time.
          </div>
          <div className="mt-2 flex gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              disabled={schedulerPending}
              onClick={() => {
                onQuarantine();
                setConfirmQuarantine(false);
              }}
            >
              Quarantine
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setConfirmQuarantine(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}
