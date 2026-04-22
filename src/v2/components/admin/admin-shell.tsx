"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Skeleton } from "@/shared/ui/skeleton";
import { useAccount } from "@/shared/hooks/use-account";
import {
  useFleetControlPlaneServices,
  useFleetHostAudit,
  useFleetProcurements,
} from "@/shared/hooks/use-fleet";
import { ADMIN_NAV, ADMIN_NAV_GROUPS } from "./nav";
import { CommandPalette } from "./command-palette";

type StatusSignal = {
  label: string;
  value: string | number;
  tone: "success" | "warning" | "danger" | "neutral";
  hint?: string;
  icon?: LucideIcon;
};

function useAdminTopSignals(enabled: boolean): StatusSignal[] {
  const hostAudit = useFleetHostAudit(enabled);
  const services = useFleetControlPlaneServices(enabled);
  const procurements = useFleetProcurements(enabled);

  return useMemo(() => {
    const summary = hostAudit.data?.summary;
    const pending = summary?.pending_validation_hosts ?? 0;
    const quarantined = summary?.quarantined_hosts ?? 0;
    const blockingDrift = summary?.blocking_drift_hosts ?? 0;
    const staleServices = (services.data ?? []).filter((s) => s.stale).length;
    const openProcurements = (procurements.data ?? []).filter((p) => p.resolved_at === null).length;

    const signals: StatusSignal[] = [
      {
        label: "Blocking drift",
        value: blockingDrift,
        tone: blockingDrift > 0 ? "danger" : "success",
        icon: blockingDrift > 0 ? AlertTriangle : CheckCircle2,
        hint: `${summary?.warning_drift_hosts ?? 0} warning`,
      },
      {
        label: "Quarantined",
        value: quarantined,
        tone: quarantined > 0 ? "warning" : "success",
        icon: quarantined > 0 ? AlertTriangle : CheckCircle2,
      },
      {
        label: "Pending validation",
        value: pending,
        tone: pending > 0 ? "warning" : "success",
        icon: pending > 0 ? Loader2 : CheckCircle2,
      },
      {
        label: "Stale services",
        value: staleServices,
        tone: staleServices > 0 ? "warning" : "success",
        icon: staleServices > 0 ? AlertTriangle : CheckCircle2,
      },
      {
        label: "Open procurements",
        value: openProcurements,
        tone: openProcurements > 0 ? "warning" : "neutral",
        icon: openProcurements > 0 ? Loader2 : CheckCircle2,
      },
    ];
    return signals;
  }, [hostAudit.data, services.data, procurements.data]);
}

function SignalChip({ signal }: { signal: StatusSignal }) {
  const toneClass =
    signal.tone === "danger"
      ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
      : signal.tone === "warning"
      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
      : signal.tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : "border-border bg-muted/40 text-muted-foreground";

  const Icon = signal.icon;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
        toneClass,
      )}
      data-testid={`admin-signal-${signal.label.replace(/\s+/g, "-").toLowerCase()}`}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span className="font-medium truncate">{signal.label}</span>
      <span className="tabular-nums font-semibold">{signal.value}</span>
    </div>
  );
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { data: account, isLoading } = useAccount();

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-3 rounded-2xl border p-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ShieldCheck className="size-6" />
        </div>
        <h1 className="font-heading text-2xl tracking-tight">Admin access required</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This panel is restricted to operators with an admin role on their account.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

function AdminNavRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-y-auto rounded-2xl border bg-card p-2"
    >
      <div className="flex items-center gap-2 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        Admin
      </div>
      {ADMIN_NAV_GROUPS.map((group) => {
        const items = ADMIN_NAV.filter((item) => item.group === group.id);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="mt-1">
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {items.map((item) => {
                const isActive =
                  item.href === "/v2/admin"
                    ? pathname === "/v2/admin"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                    data-testid={`admin-nav-${item.href}`}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function AdminMobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin sections"
      className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1 md:hidden"
    >
      {ADMIN_NAV.map((item) => {
        const isActive =
          item.href === "/v2/admin"
            ? pathname === "/v2/admin"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AdminStatusRail({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { data: account } = useAccount();
  const enabled = account?.is_admin === true;
  const signals = useAdminTopSignals(enabled);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        data-testid="admin-search-trigger"
        aria-label="Open admin search"
      >
        <Search className="size-3.5 shrink-0" />
        <span>Search…</span>
        <kbd className="ml-1 hidden select-none rounded border bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
          ⌘K
        </kbd>
      </button>
      {signals.map((signal) => (
        <SignalChip key={signal.label} signal={signal} />
      ))}
    </div>
  );
}

/**
 * True when focus is in a text-ish field so we don't hijack the user's
 * keystrokes with Cmd-K — the backslash / semicolon escape hatch would be
 * surprising if they're mid-edit in an Input, Textarea, or contenteditable.
 * The palette's own input is an exception (we want Esc to close it, not
 * Cmd-K to re-toggle it while already open).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (!isCmdK) return;
      // Don't hijack keystrokes inside other text fields UNLESS the palette is
      // already focused (our own input) — in that case Esc is the closer.
      if (!paletteOpen && isEditableTarget(e.target)) return;
      e.preventDefault();
      setPaletteOpen((prev) => !prev);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen]);

  return (
    <AdminGuard>
      <div className="flex flex-col gap-4">
        <AdminMobileNav />
        <div className="flex items-start gap-6">
          <div className="sticky top-4 hidden w-56 shrink-0 md:block">
            <AdminNavRail />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <AdminStatusRail onOpenSearch={() => setPaletteOpen(true)} />
            <div className="min-w-0">{children}</div>
          </div>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </AdminGuard>
  );
}
