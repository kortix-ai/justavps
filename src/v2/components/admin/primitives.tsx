"use client";

import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toneClasses, type Tone } from "./tones";

export function AdminPageHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2.5">
          {Icon ? (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </div>
          ) : null}
          <h1 className="font-heading text-2xl tracking-tight md:text-3xl">{title}</h1>
        </div>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AdminKpiCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        {Icon ? (
          <div
            className={cn(
              "flex size-7 items-center justify-center rounded-md border",
              toneClasses(tone),
            )}
          >
            <Icon className="size-3.5" />
          </div>
        ) : null}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function AdminStatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("capitalize", toneClasses(tone), className)}>
      {children}
    </Badge>
  );
}

export function AdminSectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  padding = "default",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padding?: "default" | "tight" | "none";
}) {
  const hasHeader = title || actions;
  return (
    <section className={cn("rounded-2xl border bg-card", className)}>
      {hasHeader ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-sm font-medium tracking-tight">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div
        className={cn(
          padding === "none" ? "" : padding === "tight" ? "p-3" : "p-5",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function AdminEmptyState({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center">
      {Icon ? (
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="space-y-1">
        <div className="text-sm font-medium">{title}</div>
        {description ? (
          <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function AdminFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3">
      {children}
    </div>
  );
}

export function AdminLoadingRows({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function AdminMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium">{value}</div>
      {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function AdminUsageBar({
  used,
  total,
  className,
}: {
  used: number;
  total: number | null | undefined;
  className?: string;
}) {
  const pct =
    !total || total <= 0 ? 0 : Math.min(100, Math.round((used / total) * 100));
  const tone: Tone =
    pct >= 90 ? "danger" : pct >= 70 ? "warning" : "success";
  return (
    <div className={cn("w-full", className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "success" && "bg-emerald-500",
            tone === "warning" && "bg-yellow-500",
            tone === "danger" && "bg-red-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AdminKpiGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">{children}</div>
  );
}

/**
 * TipButton — a small action button that documents itself on hover.
 *
 * Every admin action should explain what it does, when to use it, and what
 * the consequences are. Prefer this over raw <Button> for anything that
 * mutates state.
 */
export function TipButton({
  label,
  explanation,
  onClick,
  disabled,
  pending,
  variant = "outline",
  size = "sm",
  icon,
  className,
}: {
  label: string;
  explanation: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive";
  size?: "default" | "xs" | "sm" | "lg";
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={variant}
              size={size}
              className={cn("h-7 gap-1.5 px-2.5 text-xs", className)}
              disabled={disabled || pending}
              onClick={onClick}
            />
          }
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : icon}
          <span>{label}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-left leading-snug">
          <div className="font-semibold mb-0.5">{label}</div>
          <div className="text-background/80">{explanation}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * HelpTip — a small ℹ️ hover tip for inline concepts (lease, stale, drift, etc.)
 */
export function HelpTip({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex size-4 items-center justify-center rounded-full border border-muted-foreground/30 text-[10px] text-muted-foreground/70 hover:bg-muted"
              aria-label={label ?? "Help"}
            />
          }
        >
          ?
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-left leading-snug">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function relativeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "—";
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
